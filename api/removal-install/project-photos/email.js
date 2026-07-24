import { Pool } from "pg";
import { Resend } from "resend";
import { sendPushToUsers } from "../_lib/push.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = "Espin Medical <info@espinmedical.com>";
const ADMIN_EMAIL = "info@espinmedical.com";

/* HELPERS */
const clean = (v) => String(v || "").toLowerCase().trim();

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ACCESS FILTER */
async function getProjectUsers(client, projectId) {
  const { rows } = await client.query(
    `
    SELECT DISTINCT LOWER(email) AS email
    FROM project_contacts
    WHERE project_id = $1
    `,
    [projectId]
  );
  return rows.map(r => r.email);
}

/* HANDLER */
export default async function handler(req, res) {
  console.log("EMAIL HANDLER HIT", Date.now());

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body =
    typeof req.body === "string"
      ? JSON.parse(req.body)
      : req.body || {};

  const projectId = body.projectId;
  const originalIds = body.photoIds;

  const actorEmail = clean(req.headers["x-user-email"]);

  if (!projectId || !actorEmail || !Array.isArray(originalIds) || !originalIds.length) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const client = await pool.connect();

  try {
    /* PROJECT */
    const { rows: projectRows } = await client.query(
      `SELECT project_name, site_address, zip_code, modality
       FROM projects
       WHERE id = $1`,
      [projectId]
    );

    if (!projectRows.length) {
      return res.status(404).json({ error: "Project not found" });
    }

    const project = projectRows[0];

    /* ACCESS CONTROL */
   
    let allowedUsers = await getProjectUsers(client, projectId);
if (!allowedUsers.length) {
  console.log("⚠️ NO USERS — FALLBACK TO ADMIN");
  allowedUsers = [clean(ADMIN_EMAIL)];
}

   /* RECIPIENTS */
const { rows: contactRows } = await client.query(
  `
  SELECT LOWER(email) AS email
  FROM project_contacts
  WHERE project_id = $1
    AND (can_receive_email = true OR can_receive_email IS NULL)
  `,
  [projectId]
);

let recipients = contactRows
  .map(r => clean(r.email))
  .filter(Boolean)
  .filter(e => e !== actorEmail);

/* ALWAYS INCLUDE ADMIN */
if (!recipients.includes(clean(ADMIN_EMAIL))) {
  recipients.push(clean(ADMIN_EMAIL));
}

/* FILTER TO ALLOWED USERS */
recipients = recipients.filter(e =>
  allowedUsers.includes(e) || e === clean(ADMIN_EMAIL)
);

/* REMOVE DUPES */
recipients = Array.from(new Set(recipients));

if (!recipients.length) {
  return res.status(200).json({ sent: false });
}

    /* VALIDATE IMAGES */
    const { rows: validRows } = await client.query(
      `
      SELECT id, photo_title, photo_comment, photo_url
      FROM project_photos
      WHERE project_id = $1
      AND id = ANY($2::uuid[])
      `,
      [projectId, originalIds]
    );

    if (!validRows.length) {
      return res.status(400).json({ error: "No valid images" });
    }

    const validIds = validRows.map(r => r.id);

    /* RESTORE HIDDEN (from File 1) */
    for (const email of recipients) {
      await client.query(
        `
        DELETE FROM project_image_hidden
        WHERE lower(user_email) = $1
        AND image_id = ANY($2::uuid[])
        `,
        [email, validIds]
      );
    }

    /* PREPARE IMAGES (File 1 logic) */
    const prepared = validRows
      .map(p => {
        const title = String(p.photo_title || "").trim();
        const src = String(p.photo_url || "").trim();

        if (!title || !src) return null;

        return {
          title,
          comment: String(p.photo_comment || "").trim(),
          src
        };
      })
      .filter(Boolean);

    if (!prepared.length) {
      return res.status(200).json({ sent: false });
    }

    /* FULL HTML (File 1 logic) */
    const imagesHtml = prepared.map(img => `
      <div style="margin-bottom:32px;max-width:640px">
        <div style="font-weight:700;margin-bottom:8px;font-family:Arial">
          ${escapeHtml(img.title)}
        </div>
        <img
          src="${img.src}"
          style="width:100%;max-width:640px;border-radius:14px;border:1px solid #ddd;display:block;"
        />
        ${img.comment
          ? `<div style="margin-top:10px;font-size:14px;color:#444;border:1.5px solid #0066B2;border-radius:12px;padding:12px 14px;font-family:Arial;">
               ${escapeHtml(img.comment).replace(/\n/g, "<br/>")}
             </div>`
          : ""}
      </div>
    `).join("");

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:650px;margin:0 auto">
        <div style="margin-bottom:24px;padding:20px;border:1px solid #e6e6e6;border-radius:14px">
          <div style="font-size:18px;font-weight:800">${escapeHtml(project.project_name)}</div>
          <div>${escapeHtml(project.site_address || "—")}</div>
          <div>Zip: ${escapeHtml(project.zip_code || "—")}</div>
          <div>Modality: ${escapeHtml(project.modality || "—")}</div>
        </div>
        ${imagesHtml}
      </div>
    `;

    /* SEND EMAIL */
    for (const email of recipients) {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: [email],
        subject: `Project Images – ${project.project_name} (${prepared.length})`,
        html
      });
    }

    /* PUSH (UNCHANGED) */
    await sendPushToUsers(
      `Project: ${project.project_name}`,
      `${prepared.length} new image${prepared.length === 1 ? "" : "s"} added`,
      {
        projectId,
        recipients
      }
    );

    /* CLEAR QUEUE */
    await client.query(
      `
      UPDATE project_photos
      SET queued_for_email = false
      WHERE id = ANY($1::uuid[])
      `,
      [validIds]
    );

    return res.status(200).json({
      sent: true,
      recipients: recipients.length,
      images: prepared.length
    });

  } catch (err) {
    console.error("email error:", err);
    return res.status(500).json({ error: "Failed" });
  } finally {
    client.release();
  }
}