// FILE: /api/equipment-photos/photo-delete.js

import { Pool } from "pg";
import { kv } from "@vercel/kv";

export const config = {
  api: { bodyParser: true }
};

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

  const client = await pool.connect();

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};

    const { photoId, projectId, modalityId } = body;
    const email = clean(req.headers["x-user-email"]);

    if (!photoId || !email || !projectId || !modalityId) {
      return res.status(400).json({ error: "Missing fields" });
    }

    const access = await client.query(
      `
      SELECT p.id
      FROM equipment_photos p
      JOIN equipment_projects ep ON ep.id = p.project_id
      WHERE p.id = $1
        AND p.project_id = $2
        AND p.modality_id = $3
        AND LOWER(TRIM(ep.sales_rep_email)) = $4
      LIMIT 1
      `,
      [photoId, projectId, modalityId, email]
    );

    if (!access.rowCount) {
      return res.status(403).json({ error: "Not authorized to delete this photo" });
    }

    await client.query(
      `
      INSERT INTO equipment_photo_visibility (photo_id, email, hidden)
      VALUES ($1, $2, true)
      ON CONFLICT (photo_id, email)
      DO UPDATE SET hidden = true
      `,
      [photoId, email]
    );

    const key = `equipment:badges_images:${projectId}:${modalityId}:${email}`;
    const existing = await kv.get(key);

    let list = [];

    if (existing) {
      try {
        const parsed = typeof existing === "string"
          ? JSON.parse(existing)
          : existing;

        if (Array.isArray(parsed)) list = parsed;
      } catch {}
    }

    const updated = list.filter(id => String(id) !== String(photoId));
    await kv.set(key, updated);

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("PHOTO DELETE ERROR:", err);
    return res.status(500).json({ error: "Delete failed" });
  } finally {
    client.release();
  }
}