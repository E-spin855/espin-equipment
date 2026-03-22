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
  const match = String(url).match(/[a-f0-9-]{36}/i);
  return match ? `https://ucarecdn.com/${match[0]}/` : url;
}

function clean(v) {
  return String(v || "").toLowerCase().trim();
}

function cleanText(v) {
  return String(v || "").trim();
}

/* ===============================
   HANDLER
=============================== */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email, x-useremail");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userEmail = clean(
    req.headers["x-user-email"] ||
    req.headers["x-useremail"]
  );

  const body =
    typeof req.body === "string"
      ? JSON.parse(req.body)
      : (req.body || {});

  let {
    projectId,
    modalityId,
    photoId,
    photo_url,
    photo_title,
    photo_comment
  } = body;

  projectId = cleanText(projectId);
  modalityId = cleanText(modalityId);
  photoId = cleanText(photoId);

  if (!projectId) {
    return res.status(400).json({ error: "Missing projectId" });
  }

  const client = await pool.connect();

  try {
    /* ===============================
       VERIFY PROJECT EXISTS
    =============================== */
    const projectRes = await client.query(
      `
      SELECT id, project_completed
      FROM projects
      WHERE id = $1
        AND hidden = false
      LIMIT 1
      `,
      [projectId]
    );

    const project = projectRes.rows[0];

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (project.project_completed === true) {
      return res.status(403).json({
        error: "Project is archived and read-only"
      });
    }

    if (modalityId) {
      const modalityRes = await client.query(
        `
        SELECT id
        FROM project_modalities
        WHERE id = $1
          AND project_id = $2
        LIMIT 1
        `,
        [modalityId, projectId]
      );

      if (!modalityRes.rows[0]) {
        return res.status(404).json({ error: "Modality not found for this project" });
      }
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
          modality_id,
          photo_url,
          uploaded_by,
          photo_title,
          photo_comment,
          created_at,
          hidden
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), false)
        RETURNING id, modality_id
        `,
        [
          projectId,
          modalityId || null,
          normalizedUrl,
          userEmail || null,
          photo_title || null,
          photo_comment || null
        ]
      );

      const newPhotoId = insert.rows[0]?.id;

      if (!newPhotoId) {
        throw new Error("Failed to create photo");
      }

      if (userEmail) {
        const BADGE_KEY = modalityId
          ? `new_images_${projectId}_${modalityId}`
          : `new_images_${projectId}`;

        const existingRaw = await kv.get(BADGE_KEY);
        const existing = Array.isArray(existingRaw) ? existingRaw : [];
        const next = [...new Set([...existing, newPhotoId])];
        await kv.set(BADGE_KEY, next);
      }

      return res.status(200).json({
        success: true,
        photo: {
          id: newPhotoId,
          modality_id: insert.rows[0]?.modality_id || null
        }
      });
    }

    /* ===============================
       UPDATE META
    =============================== */
    let update;

    if (modalityId) {
      update = await client.query(
        `
        UPDATE equipment_photos
        SET
          modality_id = $1,
          photo_title = $2,
          photo_comment = $3
        WHERE id = $4
          AND project_id = $5
        RETURNING id, modality_id
        `,
        [
          modalityId,
          photo_title || null,
          photo_comment || null,
          photoId,
          projectId
        ]
      );
    } else {
      update = await client.query(
        `
        UPDATE equipment_photos
        SET
          photo_title = $1,
          photo_comment = $2
        WHERE id = $3
          AND project_id = $4
        RETURNING id, modality_id
        `,
        [
          photo_title || null,
          photo_comment || null,
          photoId,
          projectId
        ]
      );
    }

    if (!update.rowCount) {
      return res.status(404).json({ error: "Photo not found" });
    }

    return res.status(200).json({
      success: true,
      photo: {
        id: update.rows[0].id,
        modality_id: update.rows[0].modality_id || null
      }
    });
  } catch (err) {
    console.error("EQUIPMENT SAVE ERROR:", err);
    return res.status(500).json({
      error: err.message || "Save failed"
    });
  } finally {
    client.release();
  }
}