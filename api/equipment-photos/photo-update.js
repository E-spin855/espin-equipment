// FILE: /api/equipment-photos/photo-update.js

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function clean(v) {
  return String(v || "").toLowerCase().trim();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userEmail = clean(req.headers["x-user-email"]);
  const { photoId, photo_title, photo_comment, queued_for_email } = req.body || {};

  if (!userEmail) {
    return res.status(401).json({ error: "Missing user email" });
  }

  if (!photoId) {
    return res.status(400).json({ error: "Missing photoId" });
  }

  const client = await pool.connect();

  try {
    const result = await client.query(
      `
      UPDATE equipment_photos p
      SET
        photo_title = COALESCE($2, p.photo_title),
        photo_comment = COALESCE($3, p.photo_comment),
        queued_for_email = COALESCE($4, p.queued_for_email)
      FROM equipment_projects ep
      WHERE p.id = $1
        AND ep.id = p.project_id
        AND LOWER(TRIM(ep.sales_rep_email)) = $5
      RETURNING p.id
      `,
      [
        photoId,
        photo_title ?? null,
        photo_comment ?? null,
        typeof queued_for_email === "boolean" ? queued_for_email : null,
        userEmail
      ]
    );

    if (!result.rowCount) {
      return res.status(403).json({ error: "Not authorized to update this photo" });
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("PHOTO UPDATE ERROR:", err);
    return res.status(500).json({ error: "Update failed" });
  } finally {
    client.release();
  }
}