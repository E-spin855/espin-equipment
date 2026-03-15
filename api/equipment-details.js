import { Pool } from "pg";
import { kv } from "@vercel/kv";

/* ─────────────────────────────────────────────
   DATABASE
───────────────────────────────────────────── */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* ─────────────────────────────────────────────
   TRACKED FIELDS (AUTHORITATIVE)
───────────────────────────────────────────── */
const ALLOWED_FIELDS = [
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

  "disposal_date",
  "disposal_completed",

  "project_completion",

  "projected_completed_by",
  "project_completion_accepted_by",

  "project_completed",

  "notes"
];

/* ─────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────── */
function norm(v) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 19);
  if (typeof v === "boolean") return v ? "1" : "0";
  return String(v).trim();
}

function isDatetimeLocalString(v) {
  return typeof v === "string" && v.includes("T");
}

/* ─────────────────────────────────────────────
   HANDLER
───────────────────────────────────────────── */
export default async function handler(req, res) {
  const projectId = req.body?.projectId || req.query?.projectId;
  if (!projectId) {
    return res.status(400).json({ error: "Missing projectId" });
  }

  let client;
  try {
    client = await pool.connect();

    /* ───────────── GET ───────────── */
    if (req.method === "GET") {
      const { rows } = await client.query(
        `
        SELECT
          pd.*,
          p.magnet_event,
          p.disposal_required,
          p.project_completed
        FROM projects p
        LEFT JOIN project_details pd
          ON pd.project_id = p.id
        WHERE p.id = $1
        `,
        [projectId]
      );

      let changedFields = [];
      try {
        const rec = await kv.get(`proj:changed:${projectId}`);
        if (Array.isArray(rec?.changedFields)) {
          changedFields = rec.changedFields;
        }
      } catch {}

      return res.json({
        ...(rows[0] || {}),
        changedFields
      });
    }

    /* ───────────── POST ───────────── */
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const payload = req.body?.data || {};

    /* ─────────────────────────────────────────────
       🔒 ARCHIVE GUARD (AUTHORITATIVE)
       Once projects.project_completed is true, no more edits.
    ────────────────────────────────────────────── */
    const projState = await client.query(
      `SELECT project_completed FROM projects WHERE id = $1`,
      [projectId]
    );

    if (projState.rows[0]?.project_completed === true) {
      return res.status(403).json({
        error: "Project is archived and read-only"
      });
    }

    // ensure row exists
    await client.query(
      `
      INSERT INTO project_details (project_id)
      VALUES ($1)
      ON CONFLICT (project_id) DO NOTHING
      `,
      [projectId]
    );

    // BEFORE snapshot
    const before =
      (
        await client.query(
          `SELECT * FROM project_details WHERE project_id = $1`,
          [projectId]
        )
      ).rows[0] || {};

    /* ───────────── UPDATE ───────────── */
    const sets = [];
    const values = [];
    let idx = 1;

    for (const key of ALLOWED_FIELDS) {
      if (!(key in payload)) continue;

      let v = payload[key];
      if (v === "") v = null;

      if (isDatetimeLocalString(v)) {
        sets.push(`${key} = $${idx++}::timestamp`);
        values.push(v.replace("T", " "));
      } else {
        sets.push(`${key} = $${idx++}`);
        values.push(v);
      }
    }

    if (sets.length) {
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
    }

    /* ───────────── DIFF ───────────── */
    const changedFields = [];

    for (const key of ALLOWED_FIELDS) {
      if (!(key in payload)) continue;

      const beforeVal = norm(before[key]);
      const incomingVal = norm(payload[key]);

      if (beforeVal === incomingVal) continue;

      if (
        typeof payload[key] === "string" &&
        isDatetimeLocalString(payload[key]) &&
        beforeVal.startsWith(incomingVal.slice(0, 16))
      ) {
        continue;
      }

      changedFields.push(key);

      await client.query(
        `
        INSERT INTO project_updates
          (project_id, update_type, field_key, before_value, after_value)
        VALUES ($1, 'details', $2, $3, $4)
        `,
        [projectId, key, beforeVal || null, incomingVal || null]
      );
    }
    /* ───────────── STORE DIFF + NEW PILLS ───────────── */
if (changedFields.length) {

  await kv.set(`proj:changed:${projectId}`, {
    changedFields,
    ts: Date.now()
  });

  const sender =
    String(req.headers["x-user-email"] || "")
      .toLowerCase()
      .trim();

  const recipientsRes = await client.query(
    `
    SELECT email
    FROM project_contacts
    WHERE project_id = $1
      AND can_login = true
    `,
    [projectId]
  );

  const ADMIN_EMAIL = "info@espinmedical.com";

  const recipients = [
    ...recipientsRes.rows.map(r =>
      String(r.email || "").toLowerCase().trim()
    ),
    ADMIN_EMAIL
  ];

  const uniqueRecipients = Array.from(new Set(recipients));

  for (const email of uniqueRecipients) {

  if (!email) continue;

  const badgeKey = `project:badges_details:${projectId}:${email}`;

  let existing = await kv.get(badgeKey);
  if (!Array.isArray(existing)) existing = [];

  const merged = Array.from(new Set([...existing, ...changedFields]));

  await kv.set(badgeKey, merged);
}
}
    /* ─────────────────────────────────────────────
       ✅ PROMOTE COMPLETION TO PROJECTS (ONE-WAY)
       This restores your original "archive + notify" flow.
    ────────────────────────────────────────────── */
    if (payload.project_completed === true) {
      await client.query(
        `
        UPDATE projects
        SET
          project_completed = true,
          is_archived = true,
          archived_at = COALESCE(archived_at, NOW())
        WHERE id = $1
        `,
        [projectId]
      );
    }

    return res.json({
      success: true,
      changedFields
    });
  } catch (err) {
    console.error("❌ project-details error:", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client?.release();
  }
}
