import { Pool } from "pg";
import { Resend } from "resend";
import { sendPushToUsers } from "../_lib/push.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

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

function buildImageSrc(photoUrl) {
  const raw = String(photoUrl || "").trim();
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

function accessClause(alias = "p", emailParam = "$2") {
  return `
    (
      LOWER(${alias}.admin_email) = LOWER(${emailParam})
      OR EXISTS (
        SELECT 1
        FROM project_contacts pc
        WHERE pc.project_id = ${alias}.id
          AND LOWER(pc.email) = LOWER(${emailParam})
      )
    )
  `;
}

/* ───────── BUILD EQUIPMENT DETAILS HTML ───────── */
function buildEquipmentHtml(details, modality) {
  if (!details || typeof details !== "object") return "";

  const rows = Object.entries(details)
    .filter(([k, v]) =>
      k &&
      typeof k === "string" &&
      v !== null &&
      v !== "" &&
      typeof v !== "object"
    )
    .map(([k, v]) => {
      const label = k
        .replace(/^(ct_|mri_|xray_|carm_|pet_)/, "")
        .replace(/_/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase());

      return `
        <tr>
          <td style="padding:6px 10px;font-weight:700;border-bottom:1px solid #eee">
            ${escapeHtml(label)}
          </td>
          <td style="padding:6px 10px;border-bottom:1px solid #eee">
            ${escapeHtml(String(v))}
          </td>
        </tr>
      `;
    })
    .join("");

  if (!rows) return "";

  return `
    <div style="margin-bottom:24px">
      <div style="font-size:18px;font-weight:800;margin-bottom:10px">
        Equipment Details
      </div>
      <table style="border-collapse:collapse;width:100%;font-family:Arial">
        ${rows}
      </table>
    </div>
  `;
}
/* ───────── HANDLER ───────── */
export default async function handler(req, res) {
  console.log("EQUIPMENT PHOTOS EMAIL HANDLER HIT", Date.now());

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;

  if (!RESEND_API_KEY) {
    console.error("RESEND_API_KEY missing");
    return res.status(500).json({ error: "Email service not configured" });
  }

  const resend = new Resend(RESEND_API_KEY);

  const body = safeJson(req.body);
  const projectId = String(body.projectId || "").trim();
  const originalIds = Array.isArray(body.photoIds) ? body.photoIds : [];
  const actorEmail = clean(
    req.headers["x-user-email"] ||
    req.headers["x-useremail"] ||
    req.headers["x-user_email"]
  );

  if (!projectId || !actorEmail || !originalIds.length) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const client = await pool.connect();

  try {
    /* PROJECT + ACCESS */
    const projectResult = await client.query(
      `
      SELECT
        p.id,
        p.project_name,
        p.site_address,
        p.zip_code,
        p.modality,
        p.hidden,
        p.is_archived
      FROM projects p
      WHERE p.id = $1
        AND p.hidden = false
        AND ${accessClause("p", "$2")}
      LIMIT 1
      `,
      [projectId, actorEmail]
    );

    if (!projectResult.rows.length) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const project = projectResult.rows[0];

    /* LOAD EQUIPMENT DETAILS */
const detailsRes = await client.query(
  `
  SELECT data
  FROM equipment_details
  WHERE project_id = $1
  LIMIT 1
  `,
  [projectId]
);

const equipmentDetails = detailsRes.rows[0]?.data || {};

    const equipmentHtml = buildEquipmentHtml(
      equipmentDetails,
      project.modality
    );

    /* ONLY SEND TO ADMIN */
    const recipients = [clean(ADMIN_EMAIL)];

    /* VERIFY IDS BELONG TO PROJECT */
    const validResult = await client.query(
      `
      SELECT id, photo_url, uploaded_by, created_at
      FROM equipment_photos
      WHERE project_id = $1
        AND hidden = false
        AND id = ANY($2::uuid[])
      ORDER BY created_at DESC
      `,
      [projectId, originalIds]
    );

    if (!validResult.rows.length) {
      return res.status(400).json({ error: "No valid images" });
    }

    const validIds = validResult.rows.map((r) => r.id);

    /* PREPARE EMAIL CONTENT */
    const prepared = validResult.rows
      .map((p, index) => {
        const src = buildImageSrc(p.photo_url);
        if (!src) return null;

        return {
          label: `Image ${index + 1}`,
          src,
          uploadedBy: String(p.uploaded_by || "").trim(),
          createdAt: p.created_at
        };
      })
      .filter(Boolean);

    if (!prepared.length) {
      return res.status(200).json({
        sent: false,
        reason: "no_renderable_images"
      });
    }

    const imagesHtml = prepared.map((img) => {
      const meta = [
        img.uploadedBy ? `Uploaded by: ${escapeHtml(img.uploadedBy)}` : "",
        img.createdAt ? `Created: ${escapeHtml(new Date(img.createdAt).toISOString())}` : ""
      ].filter(Boolean).join(" &nbsp;•&nbsp; ");

      return `
        <div style="margin-bottom:32px;max-width:640px">
          <div style="font-weight:700;margin-bottom:8px;font-family:Arial">
            ${escapeHtml(img.label)}
          </div>
          ${meta ? `<div style="margin-bottom:10px;font-size:13px;color:#666;font-family:Arial">${meta}</div>` : ""}
          <img
            src="${img.src}"
            style="width:100%;max-width:640px;border-radius:14px;border:1px solid #ddd;display:block;"
          />
        </div>
      `;
    }).join("");

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:650px;margin:0 auto">

        <div style="margin-bottom:24px;padding:20px;border:1px solid #e6e6e6;border-radius:14px">
          <div style="font-size:18px;font-weight:800">${escapeHtml(project.project_name || "Equipment Project")}</div>
          <div>${escapeHtml(project.site_address || "—")}</div>
          <div>Zip: ${escapeHtml(project.zip_code || "—")}</div>
          <div>Modality: ${escapeHtml(project.modality || "—")}</div>
          <div style="margin-top:10px;font-weight:700">Images: ${prepared.length}</div>
        </div>

        ${equipmentHtml}

        ${imagesHtml}

      </div>
    `;

    /* SEND EMAIL */
    await resend.emails.send({
      from: FROM_EMAIL,
      to: recipients,
      subject: `Equipment Images – ${project.project_name || "Project"} (${prepared.length})`,
      html
    });

    /* PUSH */
    await sendPushToUsers(
      "Equipment Images Sent",
      `${prepared.length} images sent for ${project.project_name || "project"}.`,
      {
        type: "equipment_images",
        project_id: projectId,
        recipients
      }
    );

    return res.status(200).json({
      sent: true,
      recipients: recipients.length,
      images: prepared.length,
      photoIds: validIds
    });

  } catch (err) {
    console.error("equipment-photos/email error:", err);

    return res.status(500).json({
      error: "Failed",
      details: String(err?.message || err)
    });

  } finally {
    client.release();
  }
}