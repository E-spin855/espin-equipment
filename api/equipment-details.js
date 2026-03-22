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

function getSerialForModality(modality, data) {
  switch (modality) {
    case "CT":
      return cleanText(data.ct_serial || data.serial_number);
    case "MRI":
      return cleanText(data.mri_serial || data.serial_number);
    case "XRAY":
      return cleanText(data.xray_serial || data.serial_number);
    case "CARM":
      return cleanText(data.carm_serial || data.serial_number);
    case "PETCT":
      return cleanText(data.pet_serial || data.serial_number);
    default:
      return cleanText(data.serial_number);
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const client = await pool.connect();

  try {
    if (req.method === "GET") {
      const projectId = cleanText(req.query.projectId);
      const modalityId = cleanText(req.query.modalityId);
      const modality = cleanModality(req.query.modality);

      if (!projectId) {
        return res.status(400).json({ error: "Missing projectId" });
      }

      if (!modalityId) {
        return res.status(200).json({
          projectId,
          modalityId: "",
          modality,
          data: modality ? { modality } : {}
        });
      }

      const result = await client.query(
        `
        SELECT
          ed.project_id,
          ed.modality_id,
          ed.modality,
          ed.data,
          ed.mri_serial,
          ed.xray_serial,
          ed.pet_serial,
          ed.carm_serial,
          ed.updated_at
        FROM equipment_details ed
        WHERE ed.project_id = $1
          AND ed.modality_id = $2
        LIMIT 1
        `,
        [projectId, modalityId]
      );

      const row = result.rows[0];
      const data = safeObject(row?.data);

      if (row?.mri_serial && !data.mri_serial) data.mri_serial = row.mri_serial;
      if (row?.xray_serial && !data.xray_serial) data.xray_serial = row.xray_serial;
      if (row?.pet_serial && !data.pet_serial) data.pet_serial = row.pet_serial;
      if (row?.carm_serial && !data.carm_serial) data.carm_serial = row.carm_serial;

      return res.status(200).json({
        projectId,
        modalityId: row?.modality_id || "",
        modality: row?.modality || modality || "",
        data
      });
    }

    if (req.method === "POST") {
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

      const additionalIdentifier = cleanText(data.additional_identifier);
      const effectiveSerial = getSerialForModality(modality, data);

      if (!effectiveSerial && !additionalIdentifier) {
        return res.status(400).json({
          error: "Either serial number or additional identifier is required"
        });
      }

      const mriSerial = cleanText(data.mri_serial);
      const xraySerial = cleanText(data.xray_serial);
      const petSerial = cleanText(data.pet_serial);
      const carmSerial = cleanText(data.carm_serial);

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
          mri_serial,
          xray_serial,
          pet_serial,
          carm_serial,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (modality_id)
        DO UPDATE SET
          project_id = EXCLUDED.project_id,
          modality = EXCLUDED.modality,
          data = EXCLUDED.data,
          mri_serial = EXCLUDED.mri_serial,
          xray_serial = EXCLUDED.xray_serial,
          pet_serial = EXCLUDED.pet_serial,
          carm_serial = EXCLUDED.carm_serial,
          updated_at = NOW()
        `,
        [
          projectId,
          modalityId,
          modality,
          data,
          mriSerial || null,
          xraySerial || null,
          petSerial || null,
          carmSerial || null
        ]
      );

      await client.query("COMMIT");

      return res.status(200).json({
        success: true,
        projectId,
        modalityId,
        modality
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("equipment-details ERROR:", err);
    return res.status(500).json({ error: err.message || "Request failed" });
  } finally {
    client.release();
  }
}