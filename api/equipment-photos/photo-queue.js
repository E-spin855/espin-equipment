import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const ADMIN_EMAIL = "info@espinmedical.com";

const clean = (v) => String(v || "").toLowerCase().trim();

function normalizeBool(v) {
  return v === true || v === "true" || v === 1 || v === "1";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { photoId } = req.body || {};
  let { queued } = req.body || {};

  const userEmail = clean(
    req.headers["x-user-email"] || req.headers["x-useremail"]
  );

  if (!photoId) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  if (!userEmail) {
    return res.status(401).json({ error: "Missing user email" });
  }

  queued = normalizeBool(queued);

  const client = await pool.connect();

  try {
    /* ACCESS CHECK */
    const { rows } = await client.query(
      `
      SELECT
        ep.project_id,
        p.project_completed
      FROM equipment_photos ep
      JOIN projects p ON p.id = ep.project_id
      LEFT JOIN project_contacts pc
        ON pc.project_id = ep.project_id
        AND LOWER(pc.email) = $2
      WHERE ep.id = $1
        AND (
          LOWER($2) = $3
          OR pc.email IS NOT NULL
        )
      `,
      [photoId, userEmail, ADMIN_EMAIL]
    );

    if (!rows.length) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (rows[0].project_completed === true) {
      return res.status(403).json({
        error: "Project is archived and read-only"
      });
    }

    /* QUEUE FLAG (NO CLONING) */
    if (queued) {
      await client.query(
        `
        UPDATE equipment_photos
        SET hidden = false
        WHERE id = $1
        `,
        [photoId]
      );

      return res.status(200).json({
        ok: true,
        photoIds: [photoId]
      });
    }

    /* UNQUEUE */
    await client.query(
      `
      UPDATE equipment_photos
      SET hidden = true
      WHERE id = $1
      `,
      [photoId]
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