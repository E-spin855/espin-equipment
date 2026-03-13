import { Pool } from "pg";

console.log("ENV DATABASE_URL:", process.env.DATABASE_URL);

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

function accessClause(alias = "p") {
  return `
    (
      ${alias}.admin_email = $1
      OR EXISTS (
        SELECT 1
        FROM project_contacts pc
        WHERE pc.project_id = ${alias}.id
          AND LOWER(pc.email) = LOWER($1)
          AND pc.can_login = true
      )
    )
  `;
}

/* ===============================
   HANDLER
=============================== */

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const client = await pool.connect();

  try {

    const userEmail = String(req.headers["x-user-email"] || "")
      .toLowerCase()
      .trim();

    if (!userEmail) {
      return res.status(401).json({ error: "Missing user email" });
    }

    const isAdminOverride = userEmail === "info@espinmedical.com";

    /* ===============================
       GET SINGLE PROJECT
    =============================== */

    if (req.method === "GET" && req.query.id) {

      const { rows } = await client.query(
        `
        SELECT *
        FROM projects p
        WHERE p.id = $2
        AND (
          $3 = true
          OR ${accessClause("p")}
        )
        `,
        [userEmail, req.query.id, isAdminOverride]
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
        `
        SELECT
          p.id,
          p.project_name,
          p.site_address,
          p.zip_code,
          p.sales_rep_first,
          p.sales_rep_last,
          p.sales_rep_phone,
          p.sales_rep_email,
          p.project_completed,
          p.is_archived,
          p.archived_at,
          p.hidden,
          p.timezone,
          p.created_at
        FROM projects p
        WHERE ${accessClause("p")}
        AND p.hidden = false
        ORDER BY p.created_at DESC
        `,
        [userEmail]
      );

      return res.status(200).json(rows);
    }

    /* ===============================
       POST CREATE / DELETE
    =============================== */

    if (req.method === "POST") {

      const body = req.body || {};

      /* ADMIN DELETE */

      if (body.action === "delete") {

        if (!isAdminOverride) {
          return res.status(403).json({ error: "Admin only" });
        }

        const projectId = body.id;

        await client.query(`DELETE FROM project_photos WHERE project_id = $1`, [projectId]);
        await client.query(`DELETE FROM project_details WHERE project_id = $1`, [projectId]);
        await client.query(`DELETE FROM project_contacts WHERE project_id = $1`, [projectId]);
        await client.query(`DELETE FROM project_events WHERE project_id = $1`, [projectId]);

        await client.query(
          `DELETE FROM projects WHERE id = $1`,
          [projectId]
        );

        return res.status(200).json({ ok: true });
      }

      /* CREATE PROJECT */

      const project_name = body.project_name;
      const site_address = body.site_address || null;
      const zip_code = body.zip_code || null;

      const sales_rep_first = body.sales_rep_first || null;
      const sales_rep_last = body.sales_rep_last || null;
      const sales_rep_phone = body.sales_rep_phone || null;
      const sales_rep_email = body.sales_rep_email || null;

      if (!project_name) {
        return res.status(400).json({ error: "Missing project name" });
      }

      const tz = getTzFromZip();

      const { rows } = await client.query(
        `
        INSERT INTO projects (
          project_name,
          site_address,
          zip_code,
          sales_rep_first,
          sales_rep_last,
          sales_rep_phone,
          sales_rep_email,
          admin_email,
          timezone,
          updated_timezone,
          project_completed,
          is_archived,
          archived_at,
          hidden
        )
        VALUES (
          $1,$2,$3,
          $4,$5,$6,$7,
          $8,
          $9,$9,
          false,false,NULL,false
        )
        RETURNING *
        `,
        [
          project_name.trim(),
          site_address ?? null,
          typeof zip_code === "string" ? zip_code.trim() : (zip_code ?? null),
          sales_rep_first,
          sales_rep_last,
          sales_rep_phone,
          sales_rep_email,
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

      const {
        project_name,
        site_address,
        zip_code,
        sales_rep_first,
        sales_rep_last,
        sales_rep_phone,
        sales_rep_email,
        project_completed
      } = req.body || {};

      const tz = getTzFromZip();

      const { rows } = await client.query(
        `
        UPDATE projects p SET
          project_name      = $1,
          site_address      = $2,
          zip_code          = COALESCE($3, zip_code),
          sales_rep_first   = $4,
          sales_rep_last    = $5,
          sales_rep_phone   = $6,
          sales_rep_email   = $7,
          project_completed = $8,
          timezone          = $9,
          updated_timezone  = $9
        WHERE id = $10
        AND ${accessClause("p")}
        RETURNING *
        `,
        [
          project_name,
          site_address,
          zip_code ?? null,
          sales_rep_first,
          sales_rep_last,
          sales_rep_phone,
          sales_rep_email,
          !!project_completed,
          tz,
          projectId,
          userEmail
        ]
      );

      return res.status(200).json(rows[0]);
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (err) {

    console.error("Projects API error:", err);

    return res.status(500).json({
      error: "Internal server error"
    });

  } finally {
    client.release();
  }
}