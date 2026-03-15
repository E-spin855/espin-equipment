import { Pool } from "pg";
import { Resend } from "resend";
import { kv } from "@vercel/kv";
import { sendPushToUsers, sendBadgeOnlyPush } from "../_lib/push.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = "onboarding@resend.dev";

function norm(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "1" : "0";
  return String(v).trim();
}

export default async function handler(req, res) {

  const projectId = req.body?.projectId || req.query?.projectId;

  if (!projectId) {
    return res.status(400).json({ error: "Missing projectId" });
  }

  const client = await pool.connect();

  try {

    const userEmail =
      req.headers["x-user-email"] ||
      req.headers["x-useremail"] ||
      "system";

    /* ───────────────────────────────
       GET (LOAD FORM DATA)
    ─────────────────────────────── */

    if (req.method === "GET") {

      const { rows } = await client.query(
        `
        SELECT *
        FROM project_details
        WHERE project_id = $1
        `,
        [projectId]
      );

      return res.status(200).json(rows[0] || {});
    }

    /* ───────────────────────────────
       POST (SAVE EQUIPMENT DETAILS)
    ─────────────────────────────── */

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const payload = req.body?.data || {};

    /* ───────────────────────────────
       ARCHIVE GUARD
    ─────────────────────────────── */

    const archiveCheck = await client.query(
      `SELECT is_archived FROM projects WHERE id = $1`,
      [projectId]
    );

    if (archiveCheck.rows?.[0]?.is_archived) {
      return res.status(403).json({
        error: "Project is archived and read-only"
      });
    }

    /* ───────────────────────────────
       ENSURE DETAILS ROW EXISTS
    ─────────────────────────────── */

    await client.query(
      `
      INSERT INTO project_details (project_id)
      VALUES ($1)
      ON CONFLICT (project_id) DO NOTHING
      `,
      [projectId]
    );

    /* ───────────────────────────────
       BEFORE SNAPSHOT
    ─────────────────────────────── */

    const beforeRes = await client.query(
      `SELECT * FROM project_details WHERE project_id = $1`,
      [projectId]
    );

    const before = beforeRes.rows[0] || {};

    /* ───────────────────────────────
       DYNAMIC UPDATE BUILD
    ─────────────────────────────── */

    const keys = Object.keys(payload);

    if (!keys.length) {
      return res.status(200).json({ success: true, changedFields: [] });
    }

    const sets = [];
    const values = [];
    let idx = 1;

    for (const key of keys) {

      sets.push(`${key} = $${idx}`);
      values.push(payload[key]);
      idx++;
    }

    values.push(projectId);

    await client.query(
      `
      UPDATE project_details
      SET ${sets.join(", ")},
          updated_at = NOW()
      WHERE project_id = $${idx}
      `,
      values
    );

    /* ───────────────────────────────
       DIFF CALCULATION
    ─────────────────────────────── */

    const changedFields = [];

    for (const key of keys) {

      const beforeVal = norm(before[key]);
      const afterVal = norm(payload[key]);

      if (beforeVal !== afterVal) {
        changedFields.push(key);
      }
    }

    /* ───────────────────────────────
       STORE DIFF FOR UI BADGES
    ─────────────────────────────── */

    if (changedFields.length) {

      await kv.set(`proj:changed:${projectId}`, {
        changedFields,
        ts: Date.now()
      });
    }

    /* ───────────────────────────────
       GET PROJECT INFO
    ─────────────────────────────── */

    const { rows } = await client.query(
      `
      SELECT project_name, allowed_emails
      FROM projects
      WHERE id = $1
      `,
      [projectId]
    );

    const project = rows[0];

    /* ───────────────────────────────
       EMAIL NOTIFICATION
    ─────────────────────────────── */

    const allowed = Array.isArray(project?.allowed_emails)
      ? project.allowed_emails
      : [];

    await resend.emails.send({
      from: `Espin Medical <${FROM_EMAIL}>`,
      to: ["info@espinmedical.com", ...allowed],
      subject: `Project Update: ${project?.project_name || "Project"}`,
      html: "<p>Equipment details updated.</p>"
    });

    /* ───────────────────────────────
       EVENT LOG
    ─────────────────────────────── */

    const eventRes = await client.query(
      `
      INSERT INTO project_events
        (project_id, actor_email, event_type)
      VALUES ($1, $2, 'PROJECT_DETAILS_UPDATED')
      RETURNING id
      `,
      [projectId, userEmail]
    );

    const eventId = eventRes.rows[0].id;

    /* ───────────────────────────────
       BADGE COUNTERS
    ─────────────────────────────── */

    const ADMIN_EMAIL = "info@espinmedical.com";
    const MASTER_KEY = `stats:total_unread:${ADMIN_EMAIL}`;

    const users = await client.query(
      `
      SELECT LOWER(user_email) AS email
      FROM project_users
      WHERE project_id = $1
      `,
      [projectId]
    );

    let recipients = users.rows.map(u => u.email);

    if (!recipients.includes(ADMIN_EMAIL)) {
      recipients.push(ADMIN_EMAIL);
    }

    const incrementCount = changedFields.length || 1;

    for (const email of recipients) {

      const e = email.toLowerCase().trim();

      for (let i = 0; i < incrementCount; i++) {

        await kv.incr(`project:unread:${projectId}:${e}`);
        await kv.incr(MASTER_KEY);
      }
    }

    /* ───────────────────────────────
       PUSH NOTIFICATIONS
    ─────────────────────────────── */

    await sendPushToUsers(
      "Project Updated",
      project?.project_name || "Project",
      {
        type: "project_update",
        project_id: projectId,
        event_id: eventId,
        recipients
      }
    );

    for (const email of recipients) {
      await sendBadgeOnlyPush(email);
    }

    return res.status(200).json({
      success: true,
      changedFields
    });

  } catch (err) {

    console.error("SAVE ERROR:", err);

    return res.status(500).json({
      error: err.message
    });

  } finally {

    client.release();
  }
}