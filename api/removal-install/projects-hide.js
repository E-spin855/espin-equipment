import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  if (req.method !== "PUT") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userEmail = req.headers["x-user-email"];
  if (userEmail !== "info@espinmedical.com") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { projectId, hidden } = req.body || {};

  if (!projectId || typeof hidden !== "boolean") {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const client = await pool.connect();

  try {
    const { rowCount, rows } = await client.query(
      `
      UPDATE projects
      SET hidden = $1
      WHERE id = $2
      RETURNING id, project_name, hidden
      `,
      [hidden, projectId]
    );

    if (!rowCount) {
      return res.status(404).json({ error: "Project not found" });
    }

    return res.status(200).json({
      success: true,
      project: rows[0]
    });
  } catch (err) {
    console.error("projects-hide error:", err);
    return res.status(500).json({ error: "Internal error" });
  } finally {
    client.release();
  }
}
