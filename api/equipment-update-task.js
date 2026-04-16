import { Pool } from "pg";
import { kv } from "@vercel/kv";
import { sendPushToUsers } from "./_lib/push-equipment.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const ADMIN_EMAIL = "info@espinmedical.com";

function clean(email) {
  return String(email || "").toLowerCase().trim();
}

async function recomputeUserBadge(email) {
  const e = clean(email);

  const keys = await kv.keys(`equipment:unread:*:*:*:${e}`);
  const values = keys.length ? await kv.mget(...keys) : [];

  const total = values.reduce((sum, v) => sum + (Number(v) || 0), 0);

  await Promise.all([
    kv.set(`app:badge:equipment:${e}`, total),
    kv.set(`ios:badge:counter:equipment:${e}`, total)
  ]);

  return total;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const actorEmail = clean(req.headers["x-user-email"]);
  const projectId = String(req.body?.projectId || "").trim();
  const modalityId = String(req.body?.modalityId || "").trim();

  if (!projectId || !modalityId) {
    return res.status(400).json({ error: "Missing projectId or modalityId" });
  }

  const client = await pool.connect();

  try {
    // ✅ ensure project exists
    const projectRes = await client.query(
      `SELECT project_name FROM equipment_projects WHERE id = $1`,
      [projectId]
    );

    if (!projectRes.rows.length) {
      return res.status(404).json({ error: "Project not found" });
    }

    const projectName = projectRes.rows[0].project_name || "Equipment Updated";
const modalityRes = await client.query(
  `SELECT modality FROM equipment_modalities WHERE id = $1`,
  [modalityId]
);

const modalityName =
  modalityRes.rows[0]?.modality || "Equipment";

    // ✅ ONLY ADMIN (NO ACTOR, NO OTHER USERS)
    const recipients = [clean(ADMIN_EMAIL)];

    // ✅ changed fields
    let rec = await kv.get(`equipment:changed:${projectId}:${modalityId}`);

if (typeof rec === "string") {
  try { rec = JSON.parse(rec); } catch { rec = null; }
}

// 🔥 HANDLE BOTH FORMATS
let changedFields = [];

if (Array.isArray(rec)) {
  changedFields = rec;
} else if (rec && Array.isArray(rec.changedFields)) {
  changedFields = rec.changedFields;
}

// ✅ DEFINE FIRST
const admin = clean(ADMIN_EMAIL);

// ✅ THEN STORE
// ✅ STORE PER MODALITY (YOU ALREADY HAVE)
await kv.set(
  `equipment:changed:${projectId}:${modalityId}:${admin}`,
  JSON.stringify({
    changedFields,
    ts: Date.now(),
    modality: modalityId
  })
);

// 🔥 ADD THIS (PROJECT LEVEL — DRIVES YOUR UI)
await kv.set(
  `equipment:changed:${projectId}`,
  JSON.stringify({
    changedFields,
    hasImages: true,
    ts: Date.now()
  })
);
const pushBody = `${modalityName.toUpperCase()} updated`;

    await kv.incr(`equipment:unread:details:${projectId}:${modalityId}:${admin}`);

    const badge = await recomputeUserBadge(admin);

    await sendPushToUsers(
      projectName,
      pushBody,
      {
        recipients: [admin],
        projectId,
        modalityId,
        type: "equipment-details",
        badge
      }
    );

    return res.json({ success: true });

  } catch (err) {
    console.error("equipment-details-tasks error:", err);
    return res.status(500).json({ error: "Failed to process update" });
  } finally {
    client.release();
  }
}