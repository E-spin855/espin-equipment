import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email, x-useremail");
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
}

function clean(v) {
  return String(v || "").trim();
}

export default async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const projectId = clean(req.query.projectId);
  const modalityId = clean(req.query.modalityId);

  if (!projectId) {
    return res.status(400).json({ error: "Missing projectId" });
  }

  const client = await pool.connect();

  try {
    let q;

    if (modalityId) {
      q = await client.query(
        `
        SELECT
          p.id,
          p.project_id,
          p.modality_id,
          p.photo_url,
          p.photo_title,
          p.photo_comment,
          p.uploaded_by,
          p.created_at
        FROM equipment_photos p
        WHERE p.project_id = $1
          AND p.modality_id = $2
          AND COALESCE(p.hidden, false) = false
        ORDER BY p.created_at DESC, p.id DESC
        `,
        [projectId, modalityId]
      );
    } else {
      q = await client.query(
        `
        SELECT
          p.id,
          p.project_id,
          p.modality_id,
          p.photo_url,
          p.photo_title,
          p.photo_comment,
          p.uploaded_by,
          p.created_at
        FROM equipment_photos p
        WHERE p.project_id = $1
          AND COALESCE(p.hidden, false) = false
        ORDER BY p.created_at DESC, p.id DESC
        `,
        [projectId]
      );
    }

    return res.status(200).json({
      ok: true,
      photos: q.rows
    });
  } catch (err) {
    console.error("equipment-photos/list error:", err);
    return res.status(500).json({
      error: "Failed to load photos",
      details: err.message
    });
  } finally {
    client.release();
  }
}