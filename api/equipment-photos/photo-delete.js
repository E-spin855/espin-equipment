import { Pool } from "pg";
import { kv } from "@vercel/kv";

export const config = {
  api: { bodyParser: true }
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function clean(email) {
  return String(email || "").toLowerCase().trim();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "POST") {
    return res.status(405).end();
  }

  const client = await pool.connect();

  try {
    const { photoId, projectId, modalityId } =
      typeof req.body === "string"
        ? JSON.parse(req.body)
        : req.body || {};

    const email = clean(req.headers["x-user-email"]);

    if (!photoId || !email || !projectId || !modalityId) {
      return res.status(400).json({ error: "Missing fields" });
    }

    // 🔥 PER-USER HIDE (NOT GLOBAL)
    await client.query(
      `
      INSERT INTO equipment_photo_visibility (photo_id, email, hidden)
      VALUES ($1, $2, true)
      ON CONFLICT (photo_id, email)
      DO UPDATE SET hidden = true
      `,
      [photoId, email]
    );

    // 🔥 REMOVE BADGE ONLY FOR THIS USER
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