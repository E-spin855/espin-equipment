import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function clean(v) {
  return String(v || "").trim();
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

  const projectId = clean(req.query.projectId);
  const modalityId = clean(req.query.modalityId);

  if (!projectId) {
    return res.status(400).json({ error: "Missing projectId" });
  }

  const client = await pool.connect();

  try {
    // 🔴 HARD REQUIREMENT: modalityId required
    if (!modalityId) {
      return res.status(200).json({
        projectId,
        modalityId: "",
        modality: "",
        data: {}
      });
    }

    const result = await client.query(
      `
      SELECT
        id,
        project_id,
        modality_id,
        modality,
        data,
        updated_at
      FROM equipment_details
      WHERE project_id = $1
        AND modality_id = $2
      LIMIT 1
      `,
      [projectId, modalityId]
    );

    const row = result.rows[0];

    if (!row) {
      return res.status(200).json({
        projectId,
        modalityId,
        modality: "",
        data: {}
      });
    }

    return res.status(200).json({
      projectId: row.project_id,
      modalityId: row.modality_id,
      modality: row.modality,
      data: row.data || {}
    });

  } catch (err) {
    console.error("GET EQUIPMENT DETAILS ERROR:", err);
    return res.status(500).json({
      error: err.message || "Failed to load equipment details"
    });
  } finally {
    client.release();
  }
}