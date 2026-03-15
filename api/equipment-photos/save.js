import { Pool } from "pg";
import { kv } from "@vercel/kv";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function normalizeUploadcareUrl(url) {
  if (!url) return null;
  const match = url.match(/[a-f0-9-]{36}/i);
  return match ? `https://ucarecdn.com/${match[0]}/` : url;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userEmail =
    req.headers["x-user-email"] ||
    req.headers["x-useremail"];

  if (!userEmail) {
    return res.status(401).json({ error: "Missing user email" });
  }

  const rawBody = req.body;
  const body =
    typeof req.body === "string"
      ? JSON.parse(req.body)
      : req.body || {};

  let {
    projectId,
    photoId,
    photo_url,
    photo_title,
    photo_comment
  } = body;

  const client = await pool.connect();

  try {
    const normalizedUrl = normalizeUploadcareUrl(photo_url);

    /* ===============================
       RESOLVE photoId IF MISSING
    =============================== */
    if (!photoId && normalizedUrl) {
      const existing = await client.query(
        `
        SELECT id, project_id
        FROM project_photos
        WHERE photo_url = $1
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [normalizedUrl]
      );

      if (existing.rows.length) {
        photoId = existing.rows[0].id;
        projectId = existing.rows[0].project_id;
      }
    }

    if (!projectId) {
      return res.status(400).json({ error: "Missing projectId" });
    }

    /* ===============================
       ARCHIVE GUARD
    =============================== */
    const arch = await client.query(
      `SELECT project_completed FROM projects WHERE id = $1`,
      [projectId]
    );

    if (arch.rows[0]?.project_completed === true) {
      return res.status(403).json({ error: "Project is archived and read-only" });
    }

    /* ===============================
       FLOW A — CREATE
    =============================== */
    if (!photoId) {
      const insert = await client.query(
        `
        INSERT INTO project_photos (
          project_id,
          photo_url,
          photo_title,
          photo_comment,
          queued_for_email,
          uploaded_by_email,
          created_at
        )
        VALUES ($1, $2, $3, $4, true, $5, NOW())
        RETURNING id
        `,
        [
          projectId,
          normalizedUrl,
          photo_title || null,
          photo_comment || null,
          userEmail
        ]
      );

      /* ===============================
         ✅ IMAGE BADGE WRITE (THE FIX)
      =============================== */
      const BADGE_KEY = `project:badges_images:${projectId}`;
      const existing = (await kv.get(BADGE_KEY)) || [];

      existing.push({
        photoId: insert.rows[0].id,
        ts: Date.now()
      });

      await kv.set(BADGE_KEY, existing);

      return res.status(200).json({
        success: true,
        photoId: insert.rows[0].id
      });
    }

    /* ===============================
       FLOW B — UPDATE META (NO BADGE)
    =============================== */
    const update = await client.query(
      `
      UPDATE project_photos
      SET
        photo_title   = COALESCE($1, photo_title),
        photo_comment = COALESCE($2, photo_comment)
      WHERE id = $3
      RETURNING id, photo_title, photo_comment
      `,
      [
        photo_title ?? null,
        photo_comment ?? null,
        photoId
      ]
    );

    return res.status(200).json({
      success: true,
      updated: update.rows[0] || null
    });

  } catch (err) {
    console.error("SAVE ERROR:", err);
    return res.status(500).json({ error: "Save failed" });
  } finally {
    client.release();
  }
}
