import { Pool } from "pg";

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

function cleanText(v) {
  return String(v || "").trim();
}

export default async function handler(req, res) {
  /* ===============================
     CORS
  =============================== */

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  /* ===============================
     INPUT
  =============================== */

  const userEmail = clean(req.headers["x-user-email"]);
  const photoId = cleanText(req.body?.photoId);
  const projectId = cleanText(req.body?.projectId);
  const modalityId = cleanText(req.body?.modalityId);

  console.log("🔥 EQUIPMENT DELETE API HIT");
  console.log("INPUT:", { photoId, projectId, modalityId, userEmail });

  if (!photoId || !projectId || !userEmail) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const client = await pool.connect();

  try {
    /* ===============================
       PROJECT ACCESS / ARCHIVE CHECK
    =============================== */

    const access = await client.query(
      `
      SELECT project_completed, is_archived
      FROM projects
      WHERE id = $1
      `,
      [projectId]
    );

    if (access.rowCount === 0) {
      return res.status(404).json({ error: "Project not found" });
    }

    if (
      access.rows[0].is_archived === true ||
      access.rows[0].project_completed === true
    ) {
      return res.status(403).json({ error: "Project is archived" });
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

    /* ===============================
       HIDE IMAGE (SOFT DELETE)
    =============================== */

    let result;

    if (modalityId) {
      result = await client.query(
        `
        UPDATE equipment_photos
        SET hidden = true
        WHERE id = $1
          AND project_id = $2
          AND modality_id = $3
        RETURNING id
        `,
        [photoId, projectId, modalityId]
      );
    } else {
      result = await client.query(
        `
        UPDATE equipment_photos
        SET hidden = true
        WHERE id = $1
          AND project_id = $2
        RETURNING id
        `,
        [photoId, projectId]
      );
    }

    if (!result.rowCount) {
      return res.status(404).json({ error: "Photo not found" });
    }

    console.log("Image hidden:", photoId);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("DELETE ERROR:", err);

    return res.status(500).json({
      error: "Delete failed",
      details: err.message
    });
  } finally {
    client.release();
  }
}