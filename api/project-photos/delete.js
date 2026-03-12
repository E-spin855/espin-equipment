import { Pool } from "pg";

export const config = {
  api: { bodyParser: true }
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  // ===============================
  // CORS / PREFLIGHT (REQUIRED)
  // ===============================
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // ===============================
  // INPUT
  // ===============================
  const userEmail = req.headers["x-user-email"];
  const { photoId, projectId } = req.body || {};

  console.log("🔥 DELETE API HIT");
  console.log("📥 INPUT:", { photoId, projectId, userEmail });

  if (!photoId || !projectId || !userEmail) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const client = await pool.connect();

  try {
    // ===============================
    // PROJECT ACCESS / ARCHIVE CHECK
    // ===============================
    const access = await client.query(
      `SELECT project_completed, is_archived
       FROM projects
       WHERE id::text = $1`,
      [projectId]
    );

    if (access.rowCount === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (access.rows[0].is_archived) {
      return res.status(403).json({ error: "Project is archived" });
    }

    // ===============================
    // HARD DELETE PHOTO
    // ===============================
    // ===============================
// USER-ONLY HIDE (NO HARD DELETE)
// ===============================
const cleanEmail = String(userEmail).toLowerCase().trim();

await client.query(
  `INSERT INTO project_image_hidden (project_id, image_id, user_email)
   VALUES ($1::uuid, $2::uuid, $3)
   ON CONFLICT DO NOTHING`,
  [projectId, photoId, cleanEmail]
);

console.log("👤 Image hidden for:", cleanEmail);

return res.status(200).json({ success: true });
  } catch (err) {
    console.error("❌ DELETE ERROR:", err);
    return res.status(500).json({
      error: "Delete failed",
      details: err.message
    });
  } finally {
    client.release();
  }
}
