// FILE: /api/admin/projects-archived.js
// PATH: /api/admin/projects-archived.js

import { Pool } from "pg";
import { kv } from "@vercel/kv";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  if (req.method !== "DELETE") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userEmail =
    req.headers["x-user-email"] ||
    req.headers["x-useremail"] ||
    req.headers["x-user_email"];

  const { projectId } = req.body || {};

  if (!userEmail) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!projectId) {
    return res.status(400).json({ error: "Missing projectId" });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 🔒 Verify project exists (no project_completed dependency)
    const check = await client.query(
      `SELECT id
       FROM equipment_projects
       WHERE id = $1
       FOR UPDATE`,
      [projectId]
    );

    if (check.rowCount === 0) {
      throw new Error("NOT_FOUND");
    }

    // 🔥 HARD DELETE (equipment-only cascade)
    await client.query(
      `
      DELETE FROM equipment_photos
      WHERE equipment_unit_id IN (
        SELECT id FROM equipment_units WHERE project_id = $1
      )
      OR modality_id IN (
        SELECT id FROM equipment_modalities WHERE project_id = $1
      )
      `,
      [projectId]
    );

    await client.query(
      `
      DELETE FROM equipment_details
      WHERE modality_id IN (
        SELECT id FROM equipment_modalities WHERE project_id = $1
      )
      `,
      [projectId]
    );

    await client.query(`DELETE FROM equipment_unit_details WHERE project_id = $1`, [projectId]);
    await client.query(`DELETE FROM equipment_units WHERE project_id = $1`, [projectId]);
    await client.query(`DELETE FROM equipment_modalities WHERE project_id = $1`, [projectId]);
    await client.query(`DELETE FROM equipment_project_contacts WHERE project_id = $1`, [projectId]);
    await client.query(`DELETE FROM equipment_project_access WHERE project_id = $1`, [projectId]);

    await client.query(
      `DELETE FROM equipment_projects WHERE id = $1`,
      [projectId]
    );

    await client.query("COMMIT");

    // 🧹 KV cleanup (equipment keys only)
    const unreadKeys = await kv.keys(`equipment:unread:project:${projectId}:*`);
    if (unreadKeys.length) await kv.del(unreadKeys);

    const detailsKeys = await kv.keys(`equipment:unread:details:${projectId}:*`);
    if (detailsKeys.length) await kv.del(detailsKeys);

    const imageKeys = await kv.keys(`equipment:unread:images:${projectId}:*`);
    if (imageKeys.length) await kv.del(imageKeys);

    const changedKeys = await kv.keys(`equipment:changed:${projectId}:*`);
    if (changedKeys.length) await kv.del(changedKeys);

    return res.json({ ok: true });

  } catch (err) {
    await client.query("ROLLBACK");

    if (err.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Project not found" });
    }

    console.error("Archived delete failed:", err);
    return res.status(500).json({ error: "Delete failed" });
  } finally {
    client.release();
  }
}