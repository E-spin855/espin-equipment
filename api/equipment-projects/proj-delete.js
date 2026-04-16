import { Pool } from "pg";
import { kv } from "@vercel/kv";

export const config = {
  api: { bodyParser: true }
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function clean(v) {
  return String(v || "").toLowerCase().trim();
}

function cleanText(v) {
  return String(v || "").trim();
}

// 🔥 DELETE ALL KV RELATED TO PROJECT
async function wipeProjectKV(projectId) {
  const patterns = [
    `equipment:unread:project:${projectId}:*`,
    `equipment:unread:details:${projectId}:*`,
    `equipment:unread:details:${projectId}:*:*`,
    `equipment:unread:images:${projectId}:*`,
    `equipment:unread:images:${projectId}:*:*`,
    `equipment:changed:${projectId}`,
    `equipment:changed:${projectId}:*`
  ];

  for (const pattern of patterns) {
    const keys = await kv.keys(pattern);
    if (keys.length) {
      await kv.del(...keys);
      console.log("🗑️ PROJECT KV DELETED", pattern, keys.length);
    }
  }
}

// 🔥 DELETE ALL BADGE KEYS (this is what you were missing)
async function wipeAllBadgeKV() {
  const badgeKeys = await kv.keys("app:badge:equipment:*");
  if (badgeKeys.length) {
    await kv.del(...badgeKeys);
    console.log("🗑️ badge keys deleted", badgeKeys.length);
  }

  const iosKeys = await kv.keys("ios:badge:counter:equipment:*");
  if (iosKeys.length) {
    await kv.del(...iosKeys);
    console.log("🗑️ ios badge keys deleted", iosKeys.length);
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }

  const userEmail = clean(req.headers["x-user-email"]);
  const projectId = cleanText(body.projectId);

  if (!projectId || !userEmail) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 🔥 HIDE PHOTOS
    await client.query(
      `UPDATE equipment_photos
       SET hidden = true
       WHERE project_id = $1`,
      [projectId]
    );

    // 🔥 DELETE DETAILS
    await client.query(
      `DELETE FROM equipment_details
       WHERE project_id = $1`,
      [projectId]
    );

    // 🔥 DELETE MODALITIES
    await client.query(
      `DELETE FROM equipment_modalities
       WHERE project_id = $1`,
      [projectId]
    );

    // 🔥 DELETE PROJECT
    const result = await client.query(
      `DELETE FROM equipment_projects
       WHERE id = $1
       RETURNING id`,
      [projectId]
    );

    await client.query("COMMIT");

    // 🔥 CLEAN PROJECT KV
    await wipeProjectKV(projectId);

    // 🔥 CLEAN BADGE KV (CRITICAL — removes ghost users)
    await wipeAllBadgeKV();

    console.log("🔥 PROJECT DELETE COMPLETE", { projectId });

    return res.status(200).json({
      success: true,
      deleted: result.rowCount
    });

  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}

    console.error("❌ DELETE ERROR", err);

    return res.status(500).json({
      error: "Delete failed",
      details: err.message
    });
  } finally {
    client.release();
  }
}