import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const projectId = req.query.projectId;

  if (!projectId) {
    return res.status(400).json({ error: "Missing projectId" });
  }

  const client = await pool.connect();

  try {
    const result = await client.query(
      `SELECT data FROM equipment_details WHERE project_id = $1 LIMIT 1`,
      [projectId]
    );

    return res.status(200).json({
      data: result.rows[0]?.data || {}
    });
  } catch (err) {
    console.error("GET EQUIPMENT DETAILS ERROR:", err);
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}