// FILE: export-full.js
// PATH: /api/export-full.js

import { Pool } from "pg";
import XLSX from "xlsx";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const ADMIN_EMAIL = "info@espinmedical.com";

function clean(v) {
  return String(v || "").trim();
}

function cleanEmail(v) {
  return String(v || "")
    .replace(/\s+/g, "")
    .toLowerCase()
    .trim();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const projectId = clean(req.query.projectId);
  const userEmail = cleanEmail(
    req.headers["x-user-email"] || req.query.email || ""
  );

  if (!projectId) return res.status(400).json({ error: "Missing projectId" });
  if (!userEmail) return res.status(400).json({ error: "Missing user email" });

  const client = await pool.connect();

  try {
    // ===============================
    // 🔒 ACCESS (EQUIPMENT SAFE)
    // ===============================
    let hasAccess = false;

    if (userEmail === ADMIN_EMAIL) {
      hasAccess = true;
    } else {
      const accessCheck = await client.query(
        `
        SELECT id
        FROM equipment_projects
        WHERE id = $1
        AND LOWER(TRIM(sales_rep_email)) = $2
        LIMIT 1
        `,
        [projectId, userEmail]
      );

      hasAccess = accessCheck.rowCount > 0;
    }

    if (!hasAccess) {
      return res.status(403).json({ error: "Access denied" });
    }

    // ===============================
    // 📌 PROJECT NAME
    // ===============================
    const projectRes = await client.query(
      `SELECT project_name FROM equipment_projects WHERE id = $1 LIMIT 1`,
      [projectId]
    );

    const projectName = projectRes.rows[0]?.project_name || "Project";

    // ===============================
    // 🔹 EQUIPMENT
    // ===============================
    const equipmentRes = await client.query(
      `
      SELECT modality, data
      FROM equipment_details
      WHERE project_id = $1
      ORDER BY updated_at DESC NULLS LAST
      `,
      [projectId]
    );

    const equipmentSheet = equipmentRes.rows.map((r) => {
      const d = r.data || {};

      return {
        Modality: r.modality || "",
        Manufacturer: d.manufacturer || "",
        Model: d.model || "",
        Serial: d.serial || d.serial_number || "",
        Condition: d.condition || "",
        "System In Use": d.system_in_use || d.systemInUse || "",
        "Date Removed": d.date_removed_from_service || d.dateRemovedFromService || "",
        "Injector Model": d.injector_model || d.injectorModel || "",
        "Upgrades": d.upgrades_description || d.upgradesDescription || "",
        Notes: d.notes || ""
      };
    });

    // ===============================
    // 🔹 IMAGES (FIXED 🔥)
    // ===============================
    const imagesRes = await client.query(
      `
      SELECT 
        COALESCE(photo_url, url) AS photo_url,
        photo_title,
        photo_comment,
        created_at
      FROM equipment_photos
      WHERE project_id = $1
      ORDER BY created_at DESC
      `,
      [projectId]
    );

    const imagesSheet = imagesRes.rows.map((r) => ({
      "Image URL": r.photo_url || "",
      "Image Title": r.photo_title || "",
      "Image Notes": r.photo_comment || "",
      "Uploaded": r.created_at
        ? new Date(r.created_at).toISOString()
        : ""
    }));

    // ===============================
    // 📊 WORKBOOK
    // ===============================
    const workbook = XLSX.utils.book_new();

    const ws1 = XLSX.utils.json_to_sheet(
      equipmentSheet.length ? equipmentSheet : [{ Info: "No equipment data" }]
    );

    const ws2 = XLSX.utils.json_to_sheet(
      imagesSheet.length ? imagesSheet : [{ Info: "No images found" }]
    );

    XLSX.utils.book_append_sheet(workbook, ws1, "Equipment");
    XLSX.utils.book_append_sheet(workbook, ws2, "Images");

    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx"
    });

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${projectName.replace(/\s+/g, "_")}_full_export.xlsx`
    );

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    return res.status(200).send(buffer);

  } catch (err) {
    console.error("FULL EXPORT ERROR:", err);
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}