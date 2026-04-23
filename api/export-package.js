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
  const projectId = clean(req.query.projectId);
  const userEmail = cleanEmail(
    req.headers["x-user-email"] || req.query.email || ""
  );

  if (!projectId) {
    return res.status(400).json({ error: "Missing projectId" });
  }

  if (!userEmail) {
    return res.status(400).json({ error: "Missing user email" });
  }

  const client = await pool.connect();

  try {
    // ===============================
    // ACCESS
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
    // EQUIPMENT
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

    const equipmentSheet = equipmentRes.rows.map((r) => ({
      Modality: r.modality || "",
      ...(r.data || {})
    }));

    // ===============================
    // IMAGES (FILTER OUT USER-HIDDEN)
    // ===============================
    const imagesRes = await client.query(
  `
  SELECT 
    p.photo_url,
    p.photo_title
  FROM equipment_photos p
  LEFT JOIN equipment_photo_visibility v
    ON p.id = v.photo_id
   AND LOWER(TRIM(v.email)) = LOWER(TRIM($2))
  WHERE p.project_id = $1
    AND (v.hidden IS NULL OR v.hidden = false)
  ORDER BY p.created_at DESC
  `,
  [projectId, req.query.email || ""]
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

    const wsEquipment = XLSX.utils.json_to_sheet(
      equipmentSheet.length ? equipmentSheet : [{ Info: "No equipment data" }]
    );

    const wsImages = XLSX.utils.json_to_sheet(
      imagesRes.rows.length
        ? imagesRes.rows.map((r) => ({
            "Image URL": r.photo_url || "",
            "Image Title": r.photo_title || "",
            "Image Notes": r.photo_comment || "",
            "Uploaded": r.created_at || ""
          }))
        : [{ Info: "No visible images" }]
    );

    XLSX.utils.book_append_sheet(workbook, wsEquipment, "Equipment");
    XLSX.utils.book_append_sheet(workbook, wsImages, "Images");

    const excelBuffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx"
    });

    archive.append(excelBuffer, { name: "equipment.xlsx" });

    // ===============================
    // ADD IMAGE FILES
    // ===============================
    let index = 1;

    for (const img of imagesRes.rows) {
      try {
        const response = await fetch(img.photo_url);
        if (!response.ok) continue;

        const buffer = await response.arrayBuffer();
        const safeTitle = String(img.photo_title || `image_${index}`)
          .replace(/[^\w\-]+/g, "_")
          .replace(/^_+|_+$/g, "");

        archive.append(Buffer.from(buffer), {
          name: `images/${index}_${safeTitle || "image"}.jpg`
        });

        index++;
      } catch (e) {
        console.error("IMAGE FAIL:", img.photo_url);
      }
    }

    await archive.finalize();

  } catch (err) {
    console.error("EXPORT PACKAGE ERROR:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  } finally {
    client.release();
  }
}