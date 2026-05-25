import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function clean(email) {
  return String(email || "").toLowerCase().trim();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const modalityId = String(req.query.modalityId || "").trim();
  const email = clean(req.headers["x-user-email"]);

  if (!modalityId || !email) {
    return res.status(400).json({ error: "Missing modalityId or email" });
  }

  try {
    const { rows } = await pool.query(
      `
      SELECT p.*
      FROM equipment_photos p
      JOIN equipment_modalities m
        ON m.id = p.modality_id
      JOIN equipment_projects ep
        ON ep.id = m.project_id
      WHERE p.modality_id = $1
        AND LOWER(TRIM(ep.sales_rep_email)) = $2
        AND NOT EXISTS (
          SELECT 1
          FROM equipment_photo_visibility v
          WHERE v.photo_id = p.id
            AND LOWER(TRIM(v.email)) = $2
            AND v.hidden = true
        )
      ORDER BY p.created_at DESC
      `,
      [modalityId, email]
    );

    return res.status(200).json(rows);
  } catch (err) {
    console.error("PHOTO LIST ERROR:", err);
    return res.status(500).json({ error: "Failed" });
  }
}