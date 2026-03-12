import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const email = req.headers["x-user-email"];
  if (!email) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { projectId } = req.body || {};
  if (!projectId) {
    return res.status(400).json({ error: "Missing projectId" });
  }

  try {
    await pool.query(
      `UPDATE projects
       SET project_completed = false,
           hidden = false
       WHERE id = $1`,
      [projectId]
    );

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("RESTORE FAILED", err);
    return res.status(500).json({ error: "Restore failed" });
  }
}
