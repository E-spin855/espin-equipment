// FILE: equipment-list.js
// PATH: /api/equipment-details/list.js

import { Pool } from "pg";

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
 const userEmail = cleanEmail(
  req.headers["x-user-email"] || req.query.email
);

  if (!projectId) {
    return res.status(400).json({ error: "Missing projectId" });
  }

  if (!userEmail) {
    return res.status(400).json({ error: "Missing user email" });
  }

  const client = await pool.connect();

  try {
    // 🔒 VERIFY ACCESS (CRITICAL)
   const ADMIN_EMAIL = "info@espinmedical.com";

const accessCheck = await client.query(
  `
  SELECT id
  FROM projects
  WHERE id = $1
  AND (
    LOWER(TRIM(sales_rep_email)) = $2
    OR LOWER(TRIM($2)) = LOWER(TRIM($3))
  )
  LIMIT 1
  `,
  [projectId, userEmail, ADMIN_EMAIL]
);
    if (!accessCheck.rowCount) {
      return res.status(403).json({ error: "Access denied" });
    }

    // ✅ PROJECT DATA
    const projectRes = await client.query(
      `
      SELECT
        project_name,
        site_address,
        city,
        zip_code,
        sales_rep_first,
        sales_rep_last,
        sales_rep_company
      FROM projects
      WHERE id = $1
      LIMIT 1
      `,
      [projectId]
    );

    const project = projectRes.rows[0] || {};

    // ✅ EQUIPMENT DATA (NOW SAFE)
    const { rows } = await client.query(
      `
      SELECT
        project_id,
        modality_id,
        modality,
        data,
        created_at,
        updated_at
      FROM equipment_details
      WHERE project_id = $1
      ORDER BY updated_at DESC NULLS LAST, created_at DESC
      `,
      [projectId]
    );

    return res.status(200).json({
      project: {
        project_name: project.project_name || "",
        site_address: project.site_address || "",
        city: project.city || "",
        zip_code: project.zip_code || "",
        sales_rep_first: project.sales_rep_first || "",
        sales_rep_last: project.sales_rep_last || "",
        sales_rep_company: project.sales_rep_company || ""
      },
      modalities: rows
    });

  } catch (err) {
    console.error("LIST EQUIPMENT ERROR:", err);
    return res.status(500).json({
      error: err.message || "Failed to load equipment list"
    });
  } finally {
    client.release();
  }
}