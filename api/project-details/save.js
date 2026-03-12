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

const FIELD_IDS = [
  "project_start",
  "pathways_opening_start",
  "pathways_opened",
  "inspection_date",
  "inspection_completed",
  "power_shutdown",
  "power_shutdown_completed",
  "magnet_ramp_down",
  "magnet_ramp_completed",
  "magnet_quench_date",
  "magnet_quench_completed",
  "deinstall_start",
  "deinstall_completed",
  "rigout_date",
  "rigout_completed",
  "project_completion",
  "project_completed",
  "disposal_required",
  "notes"
];

function norm(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "1" : "0";
  return String(v).trim();
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const client = await pool.connect();

  try {
    const { projectId } = req.body;
    if (!projectId) throw new Error("Missing projectId");

    const userEmail =
      req.headers["x-user-email"] ||
      req.headers["x-useremail"] ||
      "system";

    /* ───────────────────────────────
       🔒 ARCHIVE GUARD (NEW)
    ─────────────────────────────── */
    const archiveCheck = await client.query(
      `SELECT is_archived FROM projects WHERE id = $1`,
      [projectId]
    );

    if (archiveCheck.rows[0]?.is_archived) {
      return res.status(403).json({
        error: "Project is archived and read-only"
      });
    }

    /* ───────────────────────────────
       BEFORE SNAPSHOT (AUTHORITATIVE)
    ─────────────────────────────── */
    const beforeRes = await client.query(
      `SELECT * FROM project_details WHERE project_id = $1`,
      [projectId]
    );
    const before = beforeRes.rows[0] || {};

    /* ───────────────────────────────
       FETCH PROJECT (UNCHANGED LOGIC)
    ─────────────────────────────── */
    const { rows } = await client.query(
      `
      SELECT
        p.project_name,
        p.allowed_emails,
        p.updated_timezone,
        p.magnet_event,
        d.*
      FROM projects p
      LEFT JOIN project_details d ON p.id = d.project_id
      WHERE p.id = $1
      `,
      [projectId]
    );

    const project = rows[0];
    if (!project) throw new Error("Project not found");

    /* ───────────────────────────────
       DIFF (UNCHANGED)
    ─────────────────────────────── */
    const changedFields = [];

    for (const key of FIELD_IDS) {
      if (!(key in project)) continue;

      const b = norm(before[key]);
      const a = norm(project[key]);

      if (b !== a) {
        changedFields.push(key);
      }
    }

    /* ───────────────────────────────
       STORE DIFF FOR UI / NEW PILL
    ─────────────────────────────── */
    if (changedFields.length) {
      await kv.set(`proj:changed:${projectId}`, {
        changedFields,
        ts: Date.now()
      });
    }

    /* ───────────────────────────────
       EMAIL (UNCHANGED)
    ─────────────────────────────── */
    await resend.emails.send({
      from: `Espin Medical <${FROM_EMAIL}>`,
      to: ["info@espinmedical.com", ...(project.allowed_emails || [])],
      subject: `Project Update: ${project.project_name}`,
      html: "<p>Project details updated.</p>"
    });

 
    /* ───────────────────────────────
   PROJECT EVENT + BADGE + PUSH
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
console.log("CHANGED FIELDS:", changedFields);

/* ───────── BADGE INCREMENT (ADD THIS) ───────── */

const ADMIN_EMAIL = "info@espinmedical.com";
const MASTER_KEY = `stats:total_unread:${ADMIN_EMAIL}`;

// Get recipients
const users = await client.query(
  `SELECT LOWER(user_email) AS email
   FROM project_users
   WHERE project_id = $1`,
  [projectId]
);

let recipients = users.rows.map(u => u.email);

// Ensure admin always included
if (!recipients.includes(ADMIN_EMAIL)) {
  recipients.push(ADMIN_EMAIL);
}

// Number of field changes (fallback = 1)
const incrementCount =
  Array.isArray(changedFields) && changedFields.length
    ? changedFields.length
    : 1;

for (const email of recipients) {
  const e = email.toLowerCase().trim();

  // Increment once per changed field
  for (let i = 0; i < incrementCount; i++) {
    await kv.incr(`project:unread:${projectId}:${e}`);
    await kv.incr(MASTER_KEY);
  }
}

/* ───────── PUSH (existing logic) ───────── */

await sendPushToUsers(
  "Project Updated",
  project.project_name,
  {
    type: "project_update",
    project_id: projectId,
    event_id: eventId,
    recipients
  }
);

// Ensure iOS badge updates immediately
for (const email of recipients) {
  await sendBadgeOnlyPush(email);
}

return res.status(200).json({
  success: true,
  changedFields
});

  } catch (err) {
    console.error("SAVE ERROR:", err);
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}
