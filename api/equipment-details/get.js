import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function cleanText(v) {
  return String(v || "").trim();
}

function cleanModality(v) {
  return String(v || "").toUpperCase().trim();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const projectId = cleanText(req.query.projectId);
  const modalityId = cleanText(req.query.modalityId);
  const modality = cleanModality(req.query.modality);

  if (!projectId) {
    return res.status(400).json({ error: "Missing projectId" });
  }

  const client = await pool.connect();

  try {
    let result;

    if (modalityId) {
      result = await client.query(
        `
        SELECT
          ed.project_id,
          ed.modality_id,
          ed.modality,
          ed.data,
          ed.updated_at
        FROM equipment_details ed
        WHERE ed.project_id = $1
          AND ed.modality_id = $2
        LIMIT 1
        `,
        [projectId, modalityId]
      );
    } else if (modality) {
      result = await client.query(
        `
        SELECT
          ed.project_id,
          ed.modality_id,
          ed.modality,
          ed.data,
          ed.updated_at
        FROM equipment_details ed
        WHERE ed.project_id = $1
          AND UPPER(ed.modality) = $2
        ORDER BY ed.updated_at DESC NULLS LAST, ed.modality_id DESC
        LIMIT 1
        `,
        [projectId, modality]
      );
    } else {
      result = await client.query(
        `
        SELECT
          ed.project_id,
          ed.modality_id,
          ed.modality,
          ed.data,
          ed.updated_at
        FROM equipment_details ed
        WHERE ed.project_id = $1
        ORDER BY ed.updated_at DESC NULLS LAST, ed.modality_id DESC
        LIMIT 1
        `,
        [projectId]
      );
    }

    const row = result.rows[0];

    return res.status(200).json({
      projectId,
      modalityId: row?.modality_id || modalityId || "",
      modality: row?.modality || modality || "",
      data: row?.data || {}
    });
  } catch (err) {
    console.error("GET EQUIPMENT DETAILS ERROR:", err);
    return res.status(500).json({ error: err.message || "Failed to load equipment details" });
  } finally {
    client.release();
  }
}