import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function cleanText(v) {
  return String(v || "").trim();
}

function safeObject(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
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

  if (!projectId) {
    return res.status(400).json({ error: "Missing projectId" });
  }

  const client = await pool.connect();

  try {
    const result = await client.query(
      `
      SELECT
        pm.id AS project_modality_id,
        pm.project_id,
        pm.modality AS pm_modality,
        pm.label,
        pm.sort_order,
        pm.created_at AS pm_created_at,
        pm.updated_at AS pm_updated_at,

        ed.id AS equipment_details_id,
        ed.modality_id AS equipment_modality_id,
        ed.modality AS ed_modality,
        ed.data,
        ed.updated_at AS ed_updated_at,
        ed.mri_serial,
        ed.xray_serial,
        ed.pet_serial,
        ed.carm_serial

      FROM project_modalities pm
      LEFT JOIN equipment_details ed
        ON ed.modality_id = pm.id
      WHERE pm.project_id = $1
      ORDER BY
        COALESCE(pm.sort_order, 999999) ASC,
        pm.created_at ASC,
        pm.id ASC
      `,
      [projectId]
    );

    const modalities = result.rows.map((row) => {
      const data = safeObject(row.data);

      const stableModalityId =
        row.equipment_modality_id ||
        row.project_modality_id ||
        "";

      return {
        id: stableModalityId,
        modality_id: stableModalityId,
        project_modality_id: row.project_modality_id || "",
        equipment_details_id: row.equipment_details_id || "",
        project_id: row.project_id,
        modality: row.ed_modality || row.pm_modality || data.modality || "",
        label: row.label || "",
        sort_order: row.sort_order ?? null,
        created_at: row.pm_created_at || null,
        updated_at: row.ed_updated_at || row.pm_updated_at || null,
        data,
        mri_serial: row.mri_serial || data.mri_serial || "",
        xray_serial: row.xray_serial || data.xray_serial || "",
        pet_serial: row.pet_serial || data.pet_serial || "",
        carm_serial: row.carm_serial || data.carm_serial || "",
        ct_serial: data.ct_serial || "",
        serial_number:
          row.mri_serial ||
          row.xray_serial ||
          row.pet_serial ||
          row.carm_serial ||
          data.ct_serial ||
          data.mri_serial ||
          data.xray_serial ||
          data.pet_serial ||
          data.carm_serial ||
          data.serial_number ||
          "",
        additional_identifier:
          data.additional_identifier ||
          data.asset_tag ||
          data.unit_number ||
          ""
      };
    });

    return res.status(200).json({
      success: true,
      projectId,
      modalities
    });
  } catch (err) {
    console.error("equipment-modalities GET ERROR:", err);
    return res.status(500).json({
      error: err.message || "Failed to load equipment modalities"
    });
  } finally {
    client.release();
  }
}