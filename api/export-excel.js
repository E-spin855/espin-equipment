// FILE: export-excel.js
// PATH: /api/export-excel.js

import { Pool } from "pg";
import XLSX from "xlsx";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function clean(v) {
  return String(v || "").trim();
}

function cleanEmail(v) {
  return String(v || "")
    .replace(/\s+/g, "")   // 🔥 remove hidden chars
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
  const ADMIN_EMAIL = "info@espinmedical.com";

  // 🔒 ACCESS CONTROL
  let hasAccess = false;

  if (userEmail === ADMIN_EMAIL) {
    // ✅ ADMIN → full access
    hasAccess = true;
  } else {
    // ✅ REP → must match project
    const accessCheck = await client.query(
      `
      SELECT id
      FROM projects
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
    const projectName = access.rows[0].project_name || "Project";

    // ✅ GET EQUIPMENT DATA
    const { rows } = await client.query(
      `
      SELECT modality, data
      FROM equipment_details
      WHERE project_id = $1
      ORDER BY updated_at DESC NULLS LAST
      `,
      [projectId]
    );

    // 🔄 FLATTEN
    const flat = rows.map((r) => {
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

    // 📊 EXCEL
    const worksheet = XLSX.utils.json_to_sheet(flat);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Equipment");

    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx"
    });

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${projectName.replace(/\s+/g, "_")}_equipment.xlsx`
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    return res.status(200).send(buffer);

  } catch (err) {
    console.error("EXPORT EXCEL ERROR:", err);
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}