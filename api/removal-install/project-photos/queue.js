import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function normalizeBool(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { photoId } = req.body || {};
  let { queued } = req.body || {};

  if (!photoId) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  queued = normalizeBool(queued);

  const client = await pool.connect();

  try {
    /* ===============================
       OPTIONAL: CHECK PROJECT EXISTS
    =============================== */
    const check = await client.query(
      `
      SELECT pp.project_id
      FROM project_photos pp
      WHERE pp.id = $1
      `,
      [photoId]
    );

    if (!check.rows.length) {
      return res.status(404).json({ error: "Photo not found" });
    }

    /* ===============================
       UPDATE QUEUE FLAG
    =============================== */
    await client.query(
      `
      UPDATE project_photos
      SET queued_for_email = $2
      WHERE id = $1
      `,
      [photoId, queued]
    );

    return res.status(200).json({
      ok: true,
      photoIds: [photoId]
    });

  } catch (err) {
    console.error("QUEUE ERROR:", err);
    return res.status(500).json({ error: "Queue update failed" });
  } finally {
    client.release();
  }
}