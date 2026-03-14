import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* ===============================
   CORS
=============================== */
function cors(res) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-user-email, x-useremail, x-user_email"
  );
}

/* ===============================
   HELPERS
=============================== */
function getProjectId(req) {
  return req.query?.id || req.body?.projectId || req.body?.id || null;
}

function getTzFromZip() {
  return "UTC";
}

/* ===============================
   HANDLER
=============================== */
export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const client = await pool.connect();
  try {
    // This fallback ensures that ANY request proceeds, even without a valid email header
    const userEmail = String(
      req.headers["x-user-email"] ||
      req.headers["x-useremail"] ||
      "guest@espin-medical.com"
    ).toLowerCase().trim();

    /* ===============================
       GET SINGLE PROJECT
    =============================== */
    if (req.method === "GET" && req.query.id) {
      const { rows } = await client.query(
        `SELECT * FROM projects WHERE id = $1 AND hidden = false`,
        [req.query.id]
      );

      if (!rows.length) {
        return res.status(404).json({ error: "Project not found" });
      }
      return res.status(200).json(rows[0]);
    }

    /* ===============================
       GET PROJECT LIST
    =============================== */
    if (req.method === "GET") {
      const { rows } = await client.query(
        `SELECT
          id, project_name, site_address, zip_code,
          sales_rep_first, sales_rep_last, sales_rep_phone, sales_rep_email,
          project_completed, is_archived, archived_at, hidden,
          timezone, created_at
        FROM projects
        WHERE hidden = false
        ORDER BY created_at DESC`
      );
      return res.status(200).json(rows);
    }

    /* ===============================
       CREATE / DELETE PROJECT
    =============================== */
    if (req.method === "POST") {
      const body = req.body || {};

      // DELETE ACTION
      if (body.action === "delete" && body.id) {
        const projectId = body.id;
        await client.query(`DELETE FROM project_photos WHERE project_id = $1`, [projectId]);
        await client.query(`DELETE FROM project_details WHERE project_id = $1`, [projectId]);
        await client.query(`DELETE FROM project_contacts WHERE project_id = $1`, [projectId]);
        await client.query(`DELETE FROM project_events WHERE project_id = $1`, [projectId]);
        await client.query(`DELETE FROM projects WHERE id = $1`, [projectId]);

        return res.status(200).json({ ok: true });
      }

      // CREATE ACTION
      const project_name = body.project_name;
      if (!project_name) {
        return res.status(400).json({ error: "Missing project name" });
      }

      const tz = getTzFromZip();
      const { rows } = await client.query(
        `INSERT INTO projects (
          project_name, site_address, zip_code,
          sales_rep_first, sales_rep_last, sales_rep_phone, sales_rep_email,
          admin_email, timezone, updated_timezone,
          project_completed, is_archived, hidden
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,false,false,false)
        RETURNING *`,
        [
          project_name.trim(),
          body.site_address ?? null,
          body.zip_code ?? null,
          body.sales_rep_first ?? null,
          body.sales_rep_last ?? null,
          body.sales_rep_phone ?? null,
          body.sales_rep_email ?? null,
          userEmail,
          tz
        ]
      );
      return res.status(201).json(rows[0]);
    }

    /* ===============================
       UPDATE PROJECT
    =============================== */
    if (req.method === "PUT") {
      const projectId = getProjectId(req);
      const body = req.body || {};
      const tz = getTzFromZip();

      const { rows } = await client.query(
        `UPDATE projects
        SET
          project_name = $1, site_address = $2, zip_code = $3,
          sales_rep_first = $4, sales_rep_last = $5, sales_rep_phone = $6,
          sales_rep_email = $7, project_completed = $8,
          timezone = $9, updated_timezone = $9
        WHERE id = $10
        RETURNING *`,
        [
          body.project_name,
          body.site_address,
          body.zip_code ?? null,
          body.sales_rep_first,
          body.sales_rep_last,
          body.sales_rep_phone,
          body.sales_rep_email,
          !!body.project_completed,
          tz,
          projectId
        ]
      );
      return res.status(200).json(rows[0]);
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (err) {
    console.error("Projects API error:", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}