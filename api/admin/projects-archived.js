// FILE: /api/admin/projects-archived.js
// PATH: /api/admin/projects-archived.js

import { Pool } from "pg";
import { kv } from "@vercel/kv";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function isAdmin(email) {
  // 🔒 Adjust ONLY if your admin logic changes
  return email && email.endsWith("@espinmedical.com");
}

export default async function handler(req, res) {
  if (req.method !== "DELETE") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userEmail = req.headers["x-user-email"];
  const { projectId } = req.body || {};

  if (!userEmail || !isAdmin(userEmail)) {
    return res.status(403).json({ error: "Admin only" });
  }

  if (!projectId) {
    return res.status(400).json({ error: "Missing projectId" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 🔒 Lock + verify archived
    const check = await client.query(
      `SELECT project_completed
       FROM projects
       WHERE id = $1
       FOR UPDATE`,
      [projectId]
    );

    if (check.rowCount === 0) {
      throw new Error("NOT_FOUND");
    }

    if (check.rows[0].project_completed !== true) {
      throw new Error("NOT_ARCHIVED");
    }

    // 🔥 HARD DELETE (order matters)
    await client.query(`DELETE FROM project_contacts WHERE project_id = $1`, [projectId]);
    await client.query(`DELETE FROM project_events   WHERE project_id = $1`, [projectId]);
    await client.query(`DELETE FROM project_photos   WHERE project_id = $1`, [projectId]);
    await client.query(`DELETE FROM projects         WHERE id = $1`, [projectId]);

    await client.query("COMMIT");

    // 🧹 KV cleanup — delete ALL per-user unread for this project
const dataKeys = await kv.keys(`project:unread:${projectId}:*`);
if (dataKeys.length) {
  await kv.del(dataKeys);
}

const imageKeys = await kv.keys(`project:unread_images:${projectId}:*`);
if (imageKeys.length) {
  await kv.del(imageKeys);
}

    return res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");

    if (err.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Project not found" });
    }

    if (err.message === "NOT_ARCHIVED") {
      return res.status(400).json({ error: "Only archived projects can be deleted here" });
    }

    console.error("Archived delete failed:", err);
    return res.status(500).json({ error: "Delete failed" });
  } finally {
    client.release();
  }
}
