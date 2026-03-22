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

function safeObject(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
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

  const client = await pool.connect();

  try {
    const body = req.body || {};
    const projectId = cleanText(body.projectId);
    let modalityId = cleanText(body.modalityId);
    const rawData = safeObject(body.data);
    const modality = cleanModality(body.modality || rawData.modality);

    if (!projectId) {
      return res.status(400).json({ error: "Missing projectId" });
    }

    if (!modality) {
      return res.status(400).json({ error: "Missing modality" });
    }

    const data = {
      ...rawData,
      modality
    };

    await client.query("BEGIN");

    if (!modalityId) {
      const created = await client.query(
        `
        INSERT INTO project_modalities (
          project_id,
          modality,
          label,
          sort_order
        )
        VALUES (
          $1,
          $2,
          NULL,
          COALESCE(
            (
              SELECT MAX(pm.sort_order) + 1
              FROM project_modalities pm
              WHERE pm.project_id = $1
            ),
            0
          )
        )
        RETURNING id
        `,
        [projectId, modality]
      );

      modalityId = created.rows[0]?.id || "";

      if (!modalityId) {
        throw new Error("Failed to create modality record");
      }
    } else {
      const updated = await client.query(
        `
        UPDATE project_modalities
        SET
          modality = $2,
          updated_at = NOW()
        WHERE id = $1
          AND project_id = $3
        RETURNING id
        `,
        [modalityId, modality, projectId]
      );

      if (!updated.rowCount) {
        throw new Error("modalityId not found for this project");
      }
    }

    await client.query(
      `
      INSERT INTO equipment_details (
        project_id,
        modality_id,
        modality,
        data,
        updated_at
      )
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (modality_id)
      DO UPDATE SET
        project_id = EXCLUDED.project_id,
        modality = EXCLUDED.modality,
        data = EXCLUDED.data,
        updated_at = NOW()
      `,
      [projectId, modalityId, modality, data]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      projectId,
      modalityId,
      modality
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("equipment-details/save ERROR:", err);
    return res.status(500).json({ error: err.message || "Save failed" });
  } finally {
    client.release();
  }
}