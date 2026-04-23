// FILE: export-package.js
// PATH: /api/export-package.js

import { Pool } from "pg";
import XLSX from "xlsx";
import archiver from "archiver";
import fetch from "node-fetch";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

export default async function handler(req, res) {
  const projectId = req.query.projectId;

  if (!projectId) {
    return res.status(400).json({ error: "Missing projectId" });
  }

  const client = await pool.connect();

  try {
    // ===============================
    // EQUIPMENT
    // ===============================
    const equipmentRes = await client.query(
      `SELECT modality, data FROM equipment_details WHERE project_id = $1`,
      [projectId]
    );

    const equipmentSheet = equipmentRes.rows.map(r => ({
      Modality: r.modality,
      ...(r.data || {})
    }));

    // ===============================
    // IMAGES
    // ===============================
    const imagesRes = await client.query(
      `SELECT photo_url, photo_title FROM equipment_photos WHERE project_id = $1`,
      [projectId]
    );

    // ===============================
    // CREATE ZIP STREAM
    // ===============================
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename=export.zip`);

    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.pipe(res);

    // ===============================
    // ADD EXCEL
    // ===============================
    const workbook = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(equipmentSheet);
    XLSX.utils.book_append_sheet(workbook, ws, "Equipment");

    const excelBuffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx"
    });

    archive.append(excelBuffer, { name: "equipment.xlsx" });

    // ===============================
    // ADD IMAGES (SAFE)
    // ===============================
    let index = 1;

    for (const img of imagesRes.rows) {
      try {
        const response = await fetch(img.photo_url);

        if (!response.ok) continue;

        const buffer = await response.arrayBuffer();

        archive.append(Buffer.from(buffer), {
          name: `images/image_${index}.jpg`
        });

        index++;
      } catch (e) {
        console.error("IMAGE FAIL:", img.photo_url);
      }
    }

    await archive.finalize();

  } catch (err) {
    console.error("EXPORT PACKAGE ERROR:", err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}