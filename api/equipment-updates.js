import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userEmail = req.headers["x-user-email"];
  const { projectId } = req.query;

  if (!userEmail || !projectId) {
    return res.status(400).json({ error: "Missing parameters" });
  }

  try {
    /**
     * Return ALL unread update keys for this project
     * Unread = events created after last_seen_at
     */
    const { rows } = await pool.query(
      `
      SELECT
        e.event_key,
        e.created_at
      FROM project_events e
      LEFT JOIN project_event_reads r
        ON r.project_id = e.project_id
       AND r.user_email = $1
      WHERE e.project_id = $2
        AND e.created_at > COALESCE(r.last_seen_at, '1970-01-01')
      ORDER BY e.created_at ASC
      `,
      [userEmail, projectId]
    );

    res.status(200).json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
