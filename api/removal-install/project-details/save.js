import { Pool } from "pg";
import { Resend } from "resend";
import { kv } from "@vercel/kv";
import { sendPushToUsers } from "../_lib/push.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = "onboarding@resend.dev";

const FIELD_IDS = [
  "project_start", "pathways_opening_start", "pathways_opened", "inspection_date",
  "inspection_completed", "power_shutdown", "power_shutdown_completed",
  "magnet_ramp_down", "magnet_ramp_down_completed", "magnet_quench_date",
  "magnet_quench_completed", "deinstall_start", "deinstall_completed",
  "rigout_date", "rigout_completed", "project_completion", "project_completed",
  "project_completed_by", "disposal_date", "disposal_completed", "notes"
];

// --- SECURITY HELPERS ---
async function isAdmin(client, email) {
  if (!email) return false;
  const clean = String(email).toLowerCase().trim();
  const { rows } = await client.query(
    `SELECT 1 FROM admins WHERE email = $1 LIMIT 1`,
    [clean]
  );
  return rows.length > 0;
}

function cleanHeaderEmail(req) {
  let email = req.headers["x-user-email"] || req.headers["x-useremail"] || "";
  if (Array.isArray(email)) email = email[0];
  return String(email).toLowerCase().trim();
}

function norm(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "1" : "0";
  return String(v).trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userEmail = cleanHeaderEmail(req);
  const client = await pool.connect();

  try {
    // --- RESTORED ADMIN GATE ---
    const ok = await isAdmin(client, userEmail);
    if (!ok) {
      console.warn(`🚨 Unauthorized Save Attempt: ${userEmail}`);
      return res.status(403).json({ error: "Admin only" });
    }

    let projectId = req.body.projectId;
    let payload = {};

    if (req.body.data && typeof req.body.data === "object") {
      payload = { ...req.body.data };
    } else {
      payload = { ...req.body };
      delete payload.projectId;
    }

    if (!projectId) throw new Error("Missing projectId");

    /* ───────── ARCHIVE GUARD ───────── */
    const archiveCheck = await client.query(
      `SELECT is_archived FROM projects WHERE id = $1`,
      [projectId]
    );
    if (archiveCheck.rows[0]?.is_archived) {
      return res.status(403).json({ error: "Project is archived and read-only" });
    }

    /* 🔥 AUTO-SET COMPLETION OWNER */
    if (payload.project_completed === true) {
      const existing = await client.query(
        `SELECT project_completed_by FROM project_details WHERE project_id = $1`,
        [projectId]
      );
      const alreadySet = existing.rows[0]?.project_completed_by;
      if (!payload.project_completed_by) {
        payload.project_completed_by = alreadySet || userEmail;
      }
    }

    /* ───────── BEFORE SNAPSHOT ───────── */
    const beforeRes = await client.query(
      `SELECT * FROM project_details WHERE project_id = $1`,
      [projectId]
    );
    const before = beforeRes.rows[0] || {};

    /* ───────── UPSERT ───────── */
    const fields = Object.keys(payload);
    const values = Object.values(payload);

    if (fields.length > 0) {
      const setClause = fields.map((f, i) => `${f} = $${i + 2}`).join(", ");
      const placeholders = fields.map((_, i) => `$${i + 2}`).join(", ");
      const columns = fields.join(", ");

      await client.query(
        `INSERT INTO project_details (project_id, ${columns})
         VALUES ($1, ${placeholders})
         ON CONFLICT (project_id)
         DO UPDATE SET ${setClause}, updated_at = NOW()`,
        [projectId, ...values]
      );
    }

    /* ───────── FETCH AFTER & DIFF ───────── */
    const { rows } = await client.query(
      `SELECT p.project_name, p.admin_email, p.sales_rep_email, d.*
       FROM projects p
       LEFT JOIN project_details d ON p.id = d.project_id
       WHERE p.id = $1`,
      [projectId]
    );

    const project = rows[0];
    const changedFields = FIELD_IDS.filter(key => norm(before[key]) !== norm(project[key]));

    if (payload.project_completed === true) {
      ["project_completed", "project_completion", "project_completed_by"].forEach(f => {
        if (!changedFields.includes(f)) changedFields.push(f);
      });
    }

    if (changedFields.length) {
      await kv.set(`proj:changed:${projectId}`, { changedFields, ts: Date.now() });
    }

    /* ───────── EMAIL NOTIFICATION ───────── */
    let recipients = ["info@espinmedical.com"];
    if (project.admin_email) recipients.push(project.admin_email.toLowerCase());
    if (project.sales_rep_email) recipients.push(project.sales_rep_email.toLowerCase());
    recipients = [...new Set(recipients)];

    if (changedFields.length && process.env.RESEND_API_KEY) {
      const htmlList = changedFields.map(f => `<li><b>${f}</b>: ${payload[f] ?? project[f] ?? ""}</li>`).join("");
      const html = `<div><h3>${project.project_name}</h3><ul>${htmlList}</ul></div>`;
      
      await resend.emails.send({
        from: `Espin Medical <${FROM_EMAIL}>`,
        to: recipients,
        subject: changedFields.includes("project_completed") 
          ? `✅ Project Completed: ${project.project_name}` 
          : `Project Update: ${project.project_name}`,
        html
      });
    }

    /* ───────── LOG EVENT & PUSH ───────── */
    const eventRes = await client.query(
      `INSERT INTO project_events (project_id, actor_email, event_type, entity_type, entity_id, payload)
       VALUES ($1, $2, 'PROJECT_DETAILS_UPDATED', 'project', $3, $4) RETURNING id`,
      [projectId, userEmail, projectId, JSON.stringify({ changedFields })]
    );

    try {
      const isCompleted = changedFields.includes("project_completed");
      await sendPushToUsers(
        isCompleted ? "Project Completed" : "Project Updated",
        project.project_name || "Update Received",
        { type: isCompleted ? "project_completed" : "project_update", project_id: projectId, event_id: eventRes.rows[0].id, recipients }
      );
    } catch (e) {
      console.log("⚠️ PUSH FAILED:", e.message);
    }

    return res.status(200).json({ success: true, changedFields });

  } catch (err) {
    console.error("❌ SAVE ERROR:", err);
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}