import { Pool } from "pg";
import { kv } from "@vercel/kv";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* ===============================
   HELPERS
=============================== */
function normalizeUploadcareUrl(url) {
  if (!url) return null;
  const match = url.match(/[a-f0-9-]{36}/i);
  return match ? `https://ucarecdn.com/${match[0]}/` : url;
}

function clean(v) {
  return String(v || "").toLowerCase().trim();
}

function accessClause(alias = "p", emailParam = "$2") {
  return `
    (
      LOWER(${alias}.admin_email) = LOWER(${emailParam})
      OR EXISTS (
        SELECT 1
        FROM project_contacts pc
        WHERE pc.project_id = ${alias}.id
          AND LOWER(pc.email) = LOWER(${emailParam})
      )
    )
  `;
}

/* ===============================
   HANDLER
=============================== */
export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userEmail = clean(
    req.headers["x-user-email"] ||
    req.headers["x-useremail"]
  );

  if (!userEmail) {
    return res.status(401).json({ error: "Unauthorized" });
  }

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

  if (!projectId) {
    return res.status(400).json({ error: "Missing projectId" });
  }

  const client = await pool.connect();

  try {

    /* ===============================
       🔒 VERIFY ACCESS
    =============================== */
    const projectRes = await client.query(
      `
      SELECT id, project_completed
      FROM projects p
      WHERE p.id = $1
      AND p.hidden = false
      AND ${accessClause("p", "$2")}
      `,
      [projectId, userEmail]
    );

    const project = projectRes.rows[0];

    if (!project) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (project.project_completed === true) {
      return res.status(403).json({
        error: "Project is archived and read-only"
      });
    }

    const normalizedUrl = normalizeUploadcareUrl(photo_url);

    /* ===============================
       CREATE IMAGE
    =============================== */
    if (!photoId) {

      const insert = await client.query(
        `
        INSERT INTO equipment_photos (
          project_id,
          photo_url,
          photo_title,
          photo_comment,
          created_at,
          hidden
        )
        VALUES ($1,$2,$3,$4,NOW(),false)
        RETURNING id
        `,
        [
          projectId,
          normalizedUrl,
          photo_title || null,
          photo_comment || null
        ]
      );

      const newPhotoId = insert.rows[0].id;

      const BADGE_KEY = `project:badges_images:${projectId}:${userEmail}`;
      const existing = (await kv.get(BADGE_KEY)) || [];

      existing.push({
        photoId: newPhotoId,
        ts: Date.now()
      });

      await kv.set(BADGE_KEY, existing);

      return res.status(200).json({
        success: true,
        photo: { id: newPhotoId }
      });
    }

    /* ===============================
       UPDATE META
    =============================== */
    if (photoId) {

      await client.query(
        `
        UPDATE equipment_photos
        SET
          photo_title = $1,
          photo_comment = $2
        WHERE id = $3
        AND project_id = $4
        `,
        [
          photo_title || null,
          photo_comment || null,
          photoId,
          projectId
        ]
      );

      return res.status(200).json({
        success: true,
        photo: { id: photoId }
      });
    }

    return res.status(200).json({
      success: true
    });

  } catch (err) {
    console.error("EQUIPMENT SAVE ERROR:", err);
    return res.status(500).json({
      error: "Save failed"
    });

  } finally {
    client.release();
  }
}