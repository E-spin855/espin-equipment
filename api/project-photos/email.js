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

/* ───────── HELPERS ───────── */
const clean = (v) => String(v || "").toLowerCase().trim();

function isHttpUrl(value) {
  return /^https?:\/\/.+/i.test(String(value || "").trim());
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildImageSrc(photo_url) {
  const raw = String(photo_url || "").trim();
  if (isHttpUrl(raw)) return raw;
  return null;
}

function safeJson(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body;
}

/* ───────── HANDLER ───────── */
export default async function handler(req, res) {
  console.log("EMAIL HANDLER HIT", Date.now());

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = safeJson(req.body);
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

    /* RECIPIENTS (exclude actor, always include admin) */
    const { rows: contactRows } = await client.query(
      `SELECT LOWER(email) AS email
       FROM project_contacts
       WHERE project_id = $1
         AND can_receive_email = true`,
      [projectId]
    );

    let recipients = contactRows
      .map(r => clean(r.email))
      .filter(Boolean)
      .filter(e => e !== actorEmail);

    if (!recipients.includes(clean(ADMIN_EMAIL))) recipients.push(clean(ADMIN_EMAIL));

    recipients = Array.from(new Set(recipients));

    if (!recipients.length) {
      return res.status(200).json({ sent: false, reason: "no_recipients" });
    }
   /* VERIFY IDS BELONG TO PROJECT */
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

    /* ✅ KEY FIX:
       DO NOT CLONE / INSERT NEW project_photos ROWS.
       If a recipient previously "deleted" (hid) an image, unhide it for them.
       This restores visibility without creating duplicates.
    */
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

    /* PREPARE EMAIL CONTENT (same images for all recipients) */
    const prepared = validRows
      .map(p => {
        const title = String(p.photo_title || "").trim();
        const src = buildImageSrc(p.photo_url);
        if (!title || !src) return null;
        return {
          title,
          comment: String(p.photo_comment || "").trim(),
          src
        };
      })
      .filter(Boolean);

    if (!prepared.length) {
      return res.status(200).json({ sent: false, reason: "no_renderable_images" });
    }

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

    /* SEND EMAIL (per recipient) */
    for (const email of recipients) {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: [email],
        subject: `Project Images – ${project.project_name} (${prepared.length})`,
        html
      });
    }

    /* PUSH (once) */
await sendPushToUsers(
  "Project Images Sent",
  `${prepared.length} images sent for ${project.project_name}.`,
  {
    type: "images",
    project_id: projectId,
    recipients
  }
);

await client.query(
  `UPDATE project_photos
   SET queued_for_email = false
   WHERE id = ANY($1::uuid[])`,
  [validIds]
);

return res.status(200).json({ sent: true, recipients: recipients.length, images: prepared.length });
  } catch (err) {
    console.error("project-photos/email error:", err);
    return res.status(500).json({ error: "Failed" });
  } finally {
    client.release();
  }
}