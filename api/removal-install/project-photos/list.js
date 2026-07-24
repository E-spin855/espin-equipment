import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

  const projectId = req.query.projectId;
  const userEmail = req.headers["x-user-email"];

  if (!projectId) {
    return res.status(400).json({ error: "Missing projectId" });
  }

  const cleanEmail = String(userEmail || "").toLowerCase().trim();

  const client = await pool.connect();

  try {
    const { rows } = await client.query(
      `
SELECT
  p.id,
  p.project_id,
  p.photo_url,
  p.photo_title,
  p.photo_comment,
  p.queued_for_email,
  p.created_at
FROM project_photos p
WHERE p.project_id = $1
AND (
      p.uploaded_by_email = $2
      OR p.queued_for_email = false
)
AND NOT EXISTS (
  SELECT 1
  FROM project_image_hidden h
  WHERE h.image_id = p.id
  AND lower(h.user_email) = lower($2)
)
ORDER BY p.created_at DESC, p.id DESC
      `,
      [projectId, cleanEmail]
    );

    return res.status(200).json(rows);

  } catch (err) {
    console.error("LIST ERROR:", err);
    return res.status(500).json({ error: "Failed to load photos" });
  } finally {
    client.release();
  }
}