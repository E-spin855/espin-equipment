import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT
        id,
        task_label,
        requires_date,
        requires_datetime,
        requires_checkmark,
        sort_order
      FROM task_templates
      WHERE is_optional = true
      ORDER BY sort_order ASC
      `
    );

    return res.status(200).json({ templates: rows });
  } catch (err) {
    console.error("optional-task-templates error:", err);
    return res.status(500).json({ error: "Failed to load optional tasks" });
  }
}
