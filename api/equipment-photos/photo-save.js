import { Pool } from "pg";
import { kv } from "@vercel/kv";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function clean(v) {
  return String(v || "").toLowerCase().trim();
}

function safe(v) {
  return String(v || "").trim();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const projectId = safe(req.body?.projectId);
  const modalityId = safe(req.body?.modalityId);
  const url = safe(req.body?.url);
  const userEmail = clean(req.headers["x-user-email"]);

  if (!userEmail) {
    return res.status(401).json({ error: "Missing user email" });
  }

  if (!projectId || !modalityId || !url) {
    return res.status(400).json({ error: "Missing fields" });
  }

  const client = await pool.connect();

  try {
    const access = await client.query(
      `
      SELECT
        ep.id,
        LOWER(TRIM(ep.sales_rep_email)) AS sales_rep_email,
        EXISTS (
          SELECT 1
          FROM equipment_project_access epa
          WHERE epa.project_id = ep.id
            AND LOWER(TRIM(epa.email)) = $3
        ) AS has_database_access,
        EXISTS (
          SELECT 1
          FROM equipment_project_contacts epc
          WHERE epc.project_id = ep.id
            AND LOWER(TRIM(epc.email)) = $3
            AND epc.can_login = true
        ) AS has_contact_access
      FROM equipment_projects ep
      JOIN equipment_modalities em
        ON em.project_id = ep.id
      WHERE ep.id = $1
        AND em.id = $2
      LIMIT 1
      `,
      [projectId, modalityId, userEmail]
    );

    if (!access.rowCount) {
      return res.status(403).json({ error: "Not authorized to save photo for this project" });
    }

    const project = access.rows[0];
    const hasProjectAccess =
      project.sales_rep_email === userEmail ||
      userEmail === "info@espinmedical.com" ||
      project.has_database_access === true ||
      project.has_contact_access === true ||
      await kv.get(`equipment_project_access:${projectId}:${userEmail}`);

    if (!hasProjectAccess) {
      return res.status(403).json({ error: "Not authorized to save photo for this project" });
    }

    const result = await client.query(
      `
      INSERT INTO equipment_photos (
        project_id,
        modality_id,
        photo_url,
        photo_title,
        photo_comment,
        uploaded_by_email
      )
      VALUES ($1, $2, $3, '', '', $4)
      RETURNING id
      `,
      [projectId, modalityId, url, userEmail]
    );

    return res.status(200).json({
      success: true,
      id: result.rows[0].id
    });

  } catch (err) {
    console.error("PHOTO SAVE ERROR:", err);
    return res.status(500).json({ error: "Save failed" });
  } finally {
    client.release();
  }
}
