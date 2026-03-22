import { Pool } from "pg";
import { Resend } from "resend";
import { kv } from "@vercel/kv";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = "Espin Medical <info@espinmedical.com>";
const ADMIN_EMAIL = "info@espinmedical.com";

function clean(v) {
  return String(v || "").toLowerCase().trim();
}

function esc(v) {
  return String(v || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(v) {
  if (v === true || v === "true" || v === 1) return "Yes";
  if (v === false || v === "false" || v === 0) return "No";
  if (v == null || v === "") return "—";
  if (Array.isArray(v)) return v.map(x => String(x || "").trim()).filter(Boolean).join(", ") || "—";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function prettifyLabel(key) {
  return String(key || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, m => m.toUpperCase())
    .trim();
}

function isMeaningful(v) {
  if (v == null) return false;
  if (typeof v === "string" && !v.trim()) return false;
  if (Array.isArray(v) && !v.length) return false;
  return true;
}

async function bumpUnreadForRecipients({ projectId, modalityId, actorEmail, recipients }) {
  const actor = clean(actorEmail);
  const targets = [...new Set((recipients || []).map(clean).filter(Boolean))].filter(e => e !== actor);

  await Promise.all(
    targets.map(async (email) => {
      const keys = [`equipment:unread:project:${projectId}:${email}`];

      if (modalityId) {
        keys.push(`equipment:unread:images:${projectId}:${modalityId}:${email}`);
      }

      if (keys.length) {
        await Promise.all(keys.map(key => kv.incr(key)));
      }

      const [projectKeys, imageKeys] = await Promise.all([
        kv.keys(`equipment:unread:project:*:${email}`),
        kv.keys(`equipment:unread:images:*:${email}`)
      ]);

      const allKeys = [...projectKeys, ...imageKeys];
      let total = 0;

      if (allKeys.length) {
        const values = await kv.mget(...allKeys);
        total = values.reduce((sum, v) => sum + (Number(v) || 0), 0);
      }

      await Promise.all([
        kv.set(`app:badge:equipment:${email}`, total),
        kv.set(`ios:badge:counter:${email}`, total)
      ]);
    })
  );
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const actorEmail = clean(req.headers["x-user-email"] || req.body?.email || req.body?.actorEmail);
  const projectId = String(req.body?.projectId || "").trim();
  const modalityId = String(req.body?.modalityId || "").trim();

  if (!projectId) {
    return res.status(400).json({ error: "Missing projectId" });
  }

  const client = await pool.connect();

  try {
    const projectRes = await client.query(
      `
      SELECT
        id,
        project_name,
        site_address,
        zip_code,
        modality,
        admin_email,
        sales_rep_email,
        sales_rep,
        sales_rep_first,
        sales_rep_last
      FROM projects
      WHERE id = $1
      LIMIT 1
      `,
      [projectId]
    );

    const project = projectRes.rows[0];
    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const detailsRes = modalityId
      ? await client.query(
          `
          SELECT
            id,
            project_id,
            modality_id,
            modality,
            data,
            created_at,
            updated_at,
            mri_serial,
            xray_serial,
            pet_serial,
            carm_serial
          FROM equipment_details
          WHERE project_id = $1
            AND modality_id = $2
          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
          LIMIT 1
          `,
          [projectId, modalityId]
        )
      : await client.query(
          `
          SELECT
            id,
            project_id,
            modality_id,
            modality,
            data,
            created_at,
            updated_at,
            mri_serial,
            xray_serial,
            pet_serial,
            carm_serial
          FROM equipment_details
          WHERE project_id = $1
          ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
          LIMIT 1
          `,
          [projectId]
        );

    const details = detailsRes.rows[0] || {};
    const data = details?.data && typeof details.data === "object" && !Array.isArray(details.data)
      ? details.data
      : {};

    const accessRes = await client.query(
      `
      SELECT LOWER(email) AS email
      FROM equipment_project_access
      WHERE project_id = $1
      `,
      [projectId]
    );

    let recipients = [
      clean(project.admin_email),
      ...accessRes.rows.map(r => clean(r.email))
    ].filter(Boolean);

    if (!recipients.includes(ADMIN_EMAIL)) {
      recipients.push(ADMIN_EMAIL);
    }

    recipients = [...new Set(recipients)];

    const changedFieldsFromBody = Array.isArray(req.body?.changedFields)
      ? req.body.changedFields.map(v => String(v || "").trim()).filter(Boolean)
      : [];

    const changedFieldsFromKv = (() => {
      return null;
    })();

    const changedFields = changedFieldsFromBody.length
      ? changedFieldsFromBody
      : (Array.isArray(changedFieldsFromKv) ? changedFieldsFromKv : []);

    const rows = [];

    rows.push(["Project Name", project.project_name]);
    rows.push(["Site Address", project.site_address]);
    rows.push(["Zip Code", project.zip_code]);
    rows.push(["Project Modality", project.modality]);
    rows.push(["Equipment Unit Modality", details.modality]);
    rows.push(["MRI Serial", details.mri_serial]);
    rows.push(["X-Ray Serial", details.xray_serial]);
    rows.push(["PET Serial", details.pet_serial]);
    rows.push(["C-Arm Serial", details.carm_serial]);

    Object.entries(data).forEach(([key, value]) => {
      rows.push([prettifyLabel(key), value, key]);
    });

    const htmlRows = rows
      .filter(([, value]) => isMeaningful(value))
      .map(([label, value, rawKey]) => {
        const updated = rawKey && changedFields.includes(rawKey);
        const color = updated ? "#1F7BC8" : "#111827";
        const weight = updated ? "800" : "400";

        return `
          <tr>
            <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#111827;width:42%">
              ${esc(label)}
            </td>
            <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:${color};font-weight:${weight};white-space:pre-wrap">
              ${esc(fmt(value))}
            </td>
          </tr>
        `;
      })
      .join("");

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;color:#111827">
        <h2 style="margin:0 0 8px 0;">Equipment Update: ${esc(project.project_name || "—")}</h2>
        <p style="margin:0 0 18px 0;color:#4b5563;font-size:14px;">
          Address: ${esc(project.site_address || "—")}<br>
          Zip Code: ${esc(project.zip_code || "—")}<br>
          Project ID: ${esc(projectId)}<br>
          Modality ID: ${esc(modalityId || details.modality_id || "—")}
        </p>

        <table width="100%" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
          ${htmlRows || `
            <tr>
              <td style="padding:12px;">No equipment details found.</td>
            </tr>
          `}
        </table>
      </div>
    `;

    if (recipients.length) {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: [ADMIN_EMAIL],
        bcc: recipients,
        subject: `Equipment Update: ${project.project_name || "Project"}`,
        html
      });

      await bumpUnreadForRecipients({
        projectId,
        modalityId,
        actorEmail,
        recipients
      });
    }

    await kv.del(`equipment:changed:${projectId}`);
    if (modalityId) {
      await kv.del(`equipment:changed:${projectId}:${modalityId}`);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("send-equipment-emails error:", err);
    return res.status(500).json({ error: "Failed to send equipment email" });
  } finally {
    client.release();
  }
}