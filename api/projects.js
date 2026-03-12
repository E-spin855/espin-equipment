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
       GET — SINGLE PROJECT
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
       GET — LIST PROJECTS
    =============================== */
    if (req.method === "GET") {
      const { rows } = await client.query(
        `
        SELECT
          p.id,
          p.project_name,
          p.site_address,
          p.zip_code,
          p.modality,
          p.magnet_event,
          p.disposal_required,
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
       POST — ADMIN ACTIONS + CREATE
    =============================== */
    if (req.method === "POST") {
      const body = req.body || {};

      /* ---------- ADMIN: DELETE ---------- */
      if (body.action === "delete") {
        if (!isAdminOverride) {
          return res.status(403).json({ error: "Admin only" });
        }

        const projectId = body.id;
        if (!projectId) {
          return res.status(400).json({ error: "Missing id" });
        }

        const exists = await client.query(
          `SELECT id FROM projects WHERE id = $1`,
          [projectId]
        );

        if (!exists.rows.length) {
          return res.status(404).json({ error: "Project not found" });
        }

        /* ---- CLEAN DEPENDENCIES FIRST ---- */
        await client.query(`DELETE FROM project_photos WHERE project_id = $1`, [projectId]);
        await client.query(`DELETE FROM project_details WHERE project_id = $1`, [projectId]);
        await client.query(`DELETE FROM project_contacts WHERE project_id = $1`, [projectId]);
        await client.query(`DELETE FROM project_events WHERE project_id = $1`, [projectId]);

        /* ---- DELETE PROJECT ---- */
        await client.query(
          `DELETE FROM projects WHERE id = $1`,
          [projectId]
        );

        return res.status(200).json({ ok: true });
      }

      /* ---------- CREATE PROJECT ---------- */
      const project_name = body.project_name;
const site_address = body.site_address || null;
const zip_code = body.zip_code || null;
const equipment = body.equipment || null;
const modality = body.modality;
const magnet_event = body.magnet_event || null;
const disposal_required = !!body.disposal_required;

      if (!project_name || !modality) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      const tz = getTzFromZip();

      const { rows } = await client.query(
        `
        INSERT INTO projects (
          project_name,
          site_address,
          zip_code,
          equipment,
          modality,
          magnet_event,
          disposal_required,
          admin_email,
          timezone,
          updated_timezone,
          project_completed,
          is_archived,
          archived_at,
          hidden
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,
          $8,
          $9,$9,
          false,false,NULL,false
        )
        RETURNING *
        `,
        [
          project_name.trim(),
          site_address || null,
          zip_code?.trim() || null,
          equipment || null,
          modality,
          magnet_event || null,
          !!disposal_required,
          userEmail,
          tz
        ]
      );

      const newProject = rows[0];
      const newProjectId = newProject.id;

      /* AUTO-ADD UNIVERSAL USERS */
      await client.query(
        `
        INSERT INTO project_contacts
        (project_id, role, full_name, email, can_login, can_receive_email)
        SELECT
            $1,
            role,
            full_name,
            email,
            can_login,
            can_receive_email
        FROM (
            SELECT DISTINCT email, role, full_name, can_login, can_receive_email
            FROM project_contacts
        ) u
        ON CONFLICT (project_id, email) DO NOTHING
        `,
        [newProjectId]
      );

      return res.status(201).json(newProject);
    }

    /* ===============================
       PUT — UPDATE PROJECT
    =============================== */
    if (req.method === "PUT") {
      const projectId = getProjectId(req);
      if (!projectId) {
        return res.status(400).json({ error: "Missing projectId" });
      }

      const stateRes = await client.query(
        `
        SELECT project_completed
        FROM projects p
        WHERE p.id = $2
          AND ${accessClause("p")}
        `,
        [userEmail, projectId]
      );

      if (!stateRes.rows.length) {
        return res.status(404).json({ error: "Not found or not authorized" });
      }

      const isArchived = stateRes.rows[0].project_completed === true;
      const keys = Object.keys(req.body || {});
      const allowedOnArchived = ["hidden"];

      if (isArchived) {
        const illegal = keys.filter(k => !allowedOnArchived.includes(k));
        if (illegal.length) {
          return res.status(403).json({
            error: "Project is archived and read-only"
          });
        }
      }

      const {
        project_name,
        site_address,
        zip_code,
        equipment,
        modality,
        magnet_event,
        disposal_required,
        project_completed
      } = req.body || {};

      if (project_completed === false) {
        return res.status(400).json({
          error: "project_completed is one-way"
        });
      }

      const tz = getTzFromZip();
      const willComplete = project_completed === true;

      const { rowCount, rows } = await client.query(
        `
        UPDATE projects p SET
          project_name      = $1,
          site_address      = $2,
          zip_code          = COALESCE($3, zip_code),
          equipment         = $4,
          modality          = $5,
          magnet_event      = $6,
          disposal_required = $7,
          project_completed = $8,
          is_archived = CASE WHEN $8 = true THEN true ELSE is_archived END,
          archived_at = CASE
            WHEN $8 = true AND archived_at IS NULL THEN NOW()
            ELSE archived_at
          END,
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
          equipment,
          modality,
          magnet_event || null,
          !!disposal_required,
          !!willComplete,
          tz,
          projectId,
          userEmail
        ]
      );

      if (!rowCount) {
        return res.status(404).json({ error: "Not found or not authorized" });
      }

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