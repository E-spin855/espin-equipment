// FILE: /api/equipment-photos/photo-update.js

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
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { photoId, photo_title, photo_comment } = req.body;

  if (!photoId) {
    return res.status(400).json({ error: "Missing photoId" });
  }

  const client = await pool.connect();

  try {
    await client.query(
      `
      UPDATE equipment_photos
      SET
        photo_title = COALESCE($2, photo_title),
        photo_comment = COALESCE($3, photo_comment)
      WHERE id = $1
      `,
      [photoId, photo_title, photo_comment]
    );

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("PHOTO UPDATE ERROR:", err);
    return res.status(500).json({ error: "Update failed" });
  } finally {
    client.release();
  }
}