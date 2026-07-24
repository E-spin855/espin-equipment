import { Pool } from "pg";
import { kv } from "@vercel/kv";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// RESTORED: Query the database instead of checking the email string
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

export default async function handler(req, res) {
  // CORS is usually handled by a middleware or common function, 
  // but we'll stick to the DELETE logic here.
  if (req.method !== "DELETE") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userEmail = cleanHeaderEmail(req);
  const { projectId } = req.body || {};

  if (!projectId) {
    return res.status(400).json({ error: "Missing projectId" });
  }

  const client = await pool.connect();

  try {
    // --- THE SECURITY GATE ---
    const ok = await isAdmin(client, userEmail);
    if (!ok) {
      console.warn(`Unauthorized archive-delete attempt: ${userEmail}`);
      return res.status(403).json({ error: "Admin only" });
    }

    await client.query("BEGIN");

    // 🔒 Lock + verify project is actually archived before hard deleting
    const check = await client.query(
      `SELECT project_completed FROM projects WHERE id = $1 FOR UPDATE`,
      [projectId]
    );

    if (check.rowCount === 0) throw new Error("NOT_FOUND");
    if (check.rows[0].project_completed !== true) throw new Error("NOT_ARCHIVED");

    // 🔥 HARD DELETE (Cascading order)
    await client.query(`DELETE FROM project_contacts WHERE project_id = $1`, [projectId]);
    await client.query(`DELETE FROM project_events   WHERE project_id = $1`, [projectId]);
    await client.query(`DELETE FROM project_photos   WHERE project_id = $1`, [projectId]);
    await client.query(`DELETE FROM projects         WHERE id = $1`, [projectId]);

    await client.query("COMMIT");

    // 🧹 KV cleanup — delete all unread markers
    const dataKeys = await kv.keys(`project:unread:${projectId}:*`);
    if (dataKeys.length) await kv.del(dataKeys);

    const imageKeys = await kv.keys(`project:unread_images:${projectId}:*`);
    if (imageKeys.length) await kv.del(imageKeys);

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