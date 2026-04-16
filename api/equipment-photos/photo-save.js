import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { projectId, modalityId, url } = req.body;
  const userEmail = String(req.headers["x-user-email"] || "").toLowerCase().trim();

  if (!projectId || !modalityId || !url) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const client = await pool.connect();

  try {
    const result = await client.query(
      `
      INSERT INTO equipment_photos (
        project_id,
        modality_id,
        photo_url,
        photo_title,
        photo_comment,
        uploaded_by_email
      )
      VALUES ($1, $2, $3, '', '', $4)
      RETURNING id
      `,
      [projectId, modalityId, url, userEmail]
    );

    return res.status(200).json({
      success: true,
      id: result.rows[0].id
    });

  } catch (err) {
    console.error("PHOTO SAVE ERROR:", err);
    return res.status(500).json({ error: "Save failed" });
  } finally {
    client.release();
  }
}