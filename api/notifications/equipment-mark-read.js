import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  // 🔓 CORS
  res.setHeader(
    "Access-Control-Allow-Origin",
    "https://espin-medical-app.vercel.app"
  );
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-User-Email"
  );
  res.setHeader("Access-Control-Allow-Credentials", "true");

  // ✅ Preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userEmail = req.headers["x-user-email"];
  if (!userEmail) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const { project_id } = body;

  if (!project_id) {
    return res.status(400).json({ error: "project_id is required" });
  }

  try {
    // 🔹 Mark unread notifications for this project as read
    const result = await pool.query(
      `
      UPDATE notifications
      SET read_at = NOW()
      WHERE user_email = $1
        AND project_id = $2
        AND read_at IS NULL
      RETURNING id
      `,
      [userEmail, project_id]
    );

    return res.status(200).json({
      success: true,
      markedRead: result.rowCount
    });
  } catch (err) {
    console.error("❌ mark-read error:", err);
    return res.status(500).json({ error: "Failed to mark notifications read" });
  }
}
