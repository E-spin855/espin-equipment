// FILE: export-images.js
// PATH: /api/export-images.js

import { Pool } from "pg";
import JSZip from "jszip";
import fetch from "node-fetch";
import * as XLSX from "xlsx";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function clean(v) {
  return String(v || "").trim();
}

function cleanEmail(v) {
  return String(v || "").toLowerCase().trim();
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
  const userEmail = cleanEmail(req.headers["x-user-email"]);

  if (!projectId) return res.status(400).json({ error: "Missing projectId" });
  if (!userEmail) return res.status(400).json({ error: "Missing user email" });

  const client = await pool.connect();

  try {
    // 🔒 VERIFY ACCESS
    const access = await client.query(
      `
      SELECT project_name
      FROM projects
      WHERE id = $1
      AND LOWER(TRIM(sales_rep_email)) = $2
      LIMIT 1
      `,
      [projectId, userEmail]
    );

    if (!access.rowCount) {
      return res.status(403).json({ error: "Access denied" });
    }

    const projectName = access.rows[0].project_name || "Project";

    // ✅ GET EQUIPMENT DATA
    const equipmentRes = await client.query(
      `
      SELECT modality, data
      FROM equipment_details
      WHERE project_id = $1
      ORDER BY updated_at DESC NULLS LAST
      `,
      [projectId]
    );

    // 🔄 FLATTEN FOR EXCEL
    const flat = equipmentRes.rows.map((r) => {
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

    // 📊 CREATE EXCEL
    const worksheet = XLSX.utils.json_to_sheet(flat);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Equipment");

    const excelBuffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx"
    });

    // 🖼️ GET IMAGES
    const photosRes = await client.query(
      `
      SELECT photo_url, modality_id, id
      FROM equipment_photos
      WHERE project_id = $1
      AND (hidden IS NULL OR hidden = false)
      ORDER BY created_at ASC
      `,
      [projectId]
    );

    const zip = new JSZip();

    // 📄 ADD EXCEL
    zip.file(
      `${projectName.replace(/\s+/g, "_")}_equipment.xlsx`,
      excelBuffer
    );

    // 📸 ADD IMAGES
    let index = 1;

    for (const photo of photosRes.rows) {
      try {
        const response = await fetch(photo.photo_url);
        const buffer = await response.buffer();

        const ext = photo.photo_url.split(".").pop().split("?")[0] || "jpg";

        zip.file(
          `images/${projectName.replace(/\s+/g, "_")}_${index}.${ext}`,
          buffer
        );

        index++;
      } catch (err) {
        console.error("IMAGE DOWNLOAD FAIL:", photo.photo_url);
      }
    }

    // 📦 GENERATE ZIP
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${projectName.replace(/\s+/g, "_")}_package.zip`
    );
    res.setHeader("Content-Type", "application/zip");

    return res.status(200).send(zipBuffer);

  } catch (err) {
    console.error("EXPORT IMAGES ERROR:", err);
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}