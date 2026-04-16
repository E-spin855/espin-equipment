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
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userEmail = clean(req.headers["x-user-email"]);
  const projectId = cleanText(req.body?.projectId);
  const modalityId = cleanText(req.body?.modalityId);

  console.log("🔥 EQUIPMENT RECORD DELETE API HIT");
  console.log("INPUT:", { projectId, modalityId, userEmail });

  if (!projectId || !modalityId || !userEmail) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const client = await pool.connect();

  try {
    /* ✅ ONLY CHECK PROJECT EXISTS */
    const projectRes = await client.query(
      `
      SELECT id
      FROM equipment_projects
      WHERE id = $1
      `,
      [projectId]
    );

    if (!projectRes.rowCount) {
      return res.status(404).json({ error: "Project not found" });
    }

    /* ✅ CHECK MODALITY EXISTS */
    const modalityRes = await client.query(
      `
      SELECT id
      FROM equipment_modalities
      WHERE id = $1
        AND project_id = $2
      LIMIT 1
      `,
      [modalityId, projectId]
    );

    if (!modalityRes.rowCount) {
      return res.status(404).json({
        error: "Equipment record not found for this project"
      });
    }

    await client.query("BEGIN");

    /* ✅ HIDE PHOTOS */
    await client.query(
      `
      UPDATE equipment_photos
      SET hidden = true
      WHERE modality_id = $1
      `,
      [modalityId]
    );

    /* ✅ DELETE DETAILS */
    await client.query(
      `
      DELETE FROM equipment_details
      WHERE modality_id = $1
      `,
      [modalityId]
    );

    /* ✅ DELETE MODALITY */
    const deleted = await client.query(
      `
      DELETE FROM equipment_modalities
      WHERE id = $1
        AND project_id = $2
      RETURNING id
      `,
      [modalityId, projectId]
    );

    if (!deleted.rowCount) {
      throw new Error("Failed to delete equipment record");
    }

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      deletedId: modalityId
    });

  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    console.error("RECORD DELETE ERROR:", err);

    return res.status(500).json({
      error: "Delete failed",
      details: err.message
    });
  } finally {
    client.release();
  }
}