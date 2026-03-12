import { Pool } from "pg";
import { kv } from "@vercel/kv";
import { sendPushToUsers } from "./_lib/push.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const ADMIN_EMAIL = "info@espinmedical.com";

const FIELD_LABELS = {
  project_start: "Project Start Date",
  pathways_opening_start: "Pathways Opening Date",
  pathways_opened: "Pathways Opened",
  inspection_date: "Inspection Date",
  inspection_completed: "Inspection Completed",
  power_shutdown: "Power Shut Down Date",
  power_shutdown_completed: "Power Shutdown Completed",
  magnet_ramp_down: "Ramp Down Date",
  magnet_ramp_completed: "Ramp Down Completed",
  magnet_quench_date: "Quench Date",
  magnet_quench_completed: "Quench Completed",
  disposal_date: "Disposal Date",
  disposal_completed: "Disposal Completed",
  deinstall_start: "De-Install Start Date",
  deinstall_completed: "De-Install Completed",
  rigout_date: "Rig-Out Date",
  rigout_completed: "Rig-Out Completed",
  project_completion: "Project Completion Date",
  project_completed: "Project Completed",
  notes: "Notes Updated"
};

const TRACKED_FIELDS = new Set(Object.keys(FIELD_LABELS));

function clean(email) {
  return String(email || "").toLowerCase().trim();
}

function uniq(list) {
  return Array.from(
    new Set((list || []).map(e => clean(e)).filter(Boolean))
  );
}

function buildPushBody(changedFields) {
  const labels = changedFields.map(f => FIELD_LABELS[f]).filter(Boolean);
  if (!labels.length) return "Project details updated.";
  return labels.slice(0, 4).join(", ");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const actorEmail = clean(req.headers["x-user-email"]);
  const projectId = req.body?.projectId;

  if (!projectId) {
    return res.status(400).json({ error: "Missing projectId" });
  }

  const client = await pool.connect();

  try {
    /* PROJECT */
    const projectRes = await client.query(
      `SELECT project_name FROM projects WHERE id = $1::uuid`,
      [projectId]
    );

    if (!projectRes.rows.length) {
      return res.status(404).json({ error: "Project not found" });
    }

    const projectName = projectRes.rows[0].project_name || "Project Updated";

    /* RECIPIENTS */
/* RECIPIENTS — include actor */
const contactsRes = await client.query(
  `SELECT LOWER(email) AS email
   FROM project_contacts
   WHERE project_id = $1::uuid
   AND can_receive_email = true`,
  [projectId]
);

let recipients = uniq(contactsRes.rows.map(r => r.email));

// Always include admin
const admin = clean(ADMIN_EMAIL);
if (!recipients.includes(admin)) {
  recipients.push(admin);
}

recipients = uniq(recipients);

console.log("Actor:", actorEmail);
console.log("Recipients:", recipients);

    /* CHANGED FIELDS */
    let rec = await kv.get(`proj:changed:${projectId}`);
    if (typeof rec === "string") {
      try { rec = JSON.parse(rec); } catch { rec = null; }
    }

    let changedFields = Array.isArray(rec)
      ? rec
      : (rec?.changedFields || []);

    changedFields = changedFields.filter(f => TRACKED_FIELDS.has(f));
    if (!changedFields.length) changedFields = ["notes"];

    const pushBody = buildPushBody(changedFields);

    /* EVENT */
    await client.query(
      `INSERT INTO project_events
       (project_id, actor_email, event_type, entity_type, entity_id, payload, created_at)
       VALUES ($1::uuid, $2, 'update', 'project', $1::uuid, $3::jsonb, NOW())`,
      [projectId, actorEmail, JSON.stringify({ changedFields })]
    );

/* ───────── UNREAD + BADGE (STABLE) ───────── */
await Promise.all(
  recipients.map(async (email) => {
    const e = clean(email);
    if (!e) return;

    console.log("INCREMENT BADGE FOR:", e);

    await kv.incr(`project:unread:${projectId}:${e}`);
    await kv.incr(`ios:badge:counter:${e}`);
  })
);
    /* PUSH */
    await sendPushToUsers(projectName, pushBody, {
      type: "project_update",
      project_id: projectId,
      recipients
    });

    /* CLEANUP */
    await kv.del(`proj:changed:${projectId}`);

    return res.json({ success: true });

  } catch (err) {
    console.error("update-task error:", err);
    return res.status(500).json({ error: "Failed to process update" });
  } finally {
    client.release();
  }
}