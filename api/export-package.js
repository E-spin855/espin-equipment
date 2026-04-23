import { Pool } from "pg";
import XLSX from "xlsx";
import archiver from "archiver";
import fetch from "node-fetch";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const ADMIN_EMAIL = "info@espinmedical.com";

const clean = (v) => String(v || "").trim();
const cleanEmail = (v) =>
  String(v || "").replace(/\s+/g, "").toLowerCase().trim();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const projectId = clean(req.query.projectId);
  const userEmail = cleanEmail(
    req.headers["x-user-email"] || req.query.email || ""
  );

  if (!projectId) return res.status(400).json({ error: "Missing projectId" });
  if (!userEmail) return res.status(400).json({ error: "Missing user email" });

  const client = await pool.connect();

  try {
    // 🔒 ACCESS
    let hasAccess = false;
    if (userEmail === ADMIN_EMAIL) {
      hasAccess = true;
    } else {
      const check = await client.query(
        `SELECT id FROM equipment_projects
         WHERE id = $1
         AND LOWER(TRIM(sales_rep_email)) = $2
         LIMIT 1`,
        [projectId, userEmail]
      );
      hasAccess = check.rowCount > 0;
    }
    if (!hasAccess) return res.status(403).json({ error: "Access denied" });

    // 📌 PROJECT NAME
    const pRes = await client.query(
      `SELECT project_name FROM equipment_projects WHERE id = $1 LIMIT 1`,
      [projectId]
    );
    const projectName =
      (pRes.rows[0]?.project_name || "Project").replace(/[^\w]/g, "_");

    // 🔹 EQUIPMENT
    const equipmentRes = await client.query(
      `SELECT modality, data
       FROM equipment_details
       WHERE project_id = $1
       ORDER BY updated_at DESC NULLS LAST`,
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
        "System In Use": d.system_in_use || "",
        "Date Removed": d.date_removed_from_service || "",
        "Injector Model": d.injector_model || "",
        "Upgrades": d.upgrades_description || "",
        Notes: d.notes || ""
      };
    });

    // 🔹 IMAGES (handles both paths)
    const imagesRes = await client.query(
      `
      SELECT 
        ep.photo_url,
        ep.photo_title,
        ep.photo_comment,
        ep.created_at
      FROM equipment_photos ep
      WHERE ep.project_id = $1

      UNION

      SELECT 
        ep.photo_url,
        ep.photo_title,
        ep.photo_comment,
        ep.created_at
      FROM equipment_photos ep
      WHERE ep.modality_id IN (
        SELECT id FROM equipment_modalities WHERE project_id = $1
      )

      ORDER BY created_at DESC
      `,
      [projectId]
    );

    const images = imagesRes.rows;

    const imagesSheet = images.map((r) => ({
      "Image URL": r.photo_url || "",
      "Image Title": r.photo_title || "",
      "Image Notes": r.photo_comment || "",
      "Uploaded": r.created_at
        ? new Date(r.created_at).toISOString()
        : ""
    }));

    // 📊 BUILD EXCEL
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(
      equipmentSheet.length ? equipmentSheet : [{ Info: "No equipment data" }]
    );
    const ws2 = XLSX.utils.json_to_sheet(
      imagesSheet.length ? imagesSheet : [{ Info: "No images found" }]
    );

    XLSX.utils.book_append_sheet(wb, ws1, "Equipment");
    XLSX.utils.book_append_sheet(wb, ws2, "Images");

    const excelBuffer = XLSX.write(wb, {
      type: "buffer",
      bookType: "xlsx"
    });

    // 📦 ZIP RESPONSE
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${projectName}_package.zip`
    );

    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.pipe(res);

    // ➜ add excel
    archive.append(excelBuffer, {
      name: `${projectName}/project_export.xlsx`
    });

    // ➜ add images
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      try {
        const response = await fetch(img.photo_url);
        const buffer = await response.buffer();

        const name =
          `${i + 1}_` +
          (img.photo_title || "image").replace(/[^\w]/g, "_") +
          ".png";

        archive.append(buffer, {
          name: `${projectName}/images/${name}`
        });
      } catch (e) {
        console.error("IMAGE FAIL:", img.photo_url);
      }
    }

    await archive.finalize();

  } catch (err) {
    console.error("PACKAGE EXPORT ERROR:", err);
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}