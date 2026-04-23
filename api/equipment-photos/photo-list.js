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
  LEFT JOIN equipment_photo_visibility v
    ON p.id = v.photo_id
   AND LOWER(TRIM(v.email)) = LOWER(TRIM($2))
  WHERE p.modality_id = $1
    AND (v.hidden IS NULL OR v.hidden = false)
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