// FILE: /api/projects.js
// PATH: /api/projects.js

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
    "Content-Type, x-user-email, x-useremail"
  );
}

/* ===============================
   HELPERS
=============================== */
function getProjectId(req) {
  return req.query?.id || req.body?.projectId || req.body?.id || null;
}

function clean(email) {
  return String(email || "").toLowerCase().trim();
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

    /* ===============================
       GET — SINGLE PROJECT
    =============================== */
    if (req.method === "GET" && req.query.id) {
      const email = clean(
        req.headers["x-user-email"] ||
        req.headers["x-useremail"]
      );

      if (!email) {
        return res.status(401).json({ error: "Missing email" });
      }

      const { rows } = await client.query(
        `
        SELECT *
        FROM projects p
        WHERE p.id = $1
          AND (
            EXISTS (
              SELECT 1 FROM admins a
              WHERE LOWER(a.email) = $2
            )
            OR LOWER(p.admin_email) = $2
            OR EXISTS (
              SELECT 1
              FROM project_contacts pc
              WHERE pc.project_id = p.id
                AND LOWER(pc.email) = $2
            )
          )
        `,
        [req.query.id, email]
      );

      if (!rows.length) {
        return res.status(403).json({ error: "Access denied" });
      }

      return res.status(200).json(rows[0]);
    }

    /* ===============================
       GET — LIST PROJECTS (ADMIN FULL ACCESS)
    =============================== */
    if (req.method === "GET") {
      const email = clean(
        req.headers["x-user-email"] ||
        req.headers["x-useremail"]
      );

      if (!email) {
        return res.status(401).json({ error: "Missing email" });
      }

      const { rows } = await client.query(
        `
        SELECT *
        FROM projects p
        WHERE
          (
            /* ADMIN → sees EVERYTHING (including archived + hidden) */
            EXISTS (
              SELECT 1 FROM admins a
              WHERE LOWER(a.email) = LOWER($1)
            )

            /* NON-ADMIN → restricted */
            OR (
              (p.is_archived IS NULL OR p.is_archived = false)
              AND (p.hidden IS NULL OR p.hidden = false)

              AND (
                LOWER(p.admin_email) = LOWER($1)
                OR EXISTS (
                  SELECT 1
                  FROM project_contacts pc
                  WHERE pc.project_id = p.id
                    AND LOWER(pc.email) = LOWER($1)
                )
              )
            )
          )
        ORDER BY p.created_at DESC
        `,
        [email]
      );

      return res.status(200).json(rows);
    }

    /* ===============================
       POST — ACTIONS + CREATE
    =============================== */
    if (req.method === "POST") {
      const body = req.body || {};

      /* ---------- DELETE ---------- */
      if (body.action === "delete") {
        const projectId = body.projectId || body.id;

        if (!projectId) {
          return res.status(400).json({ error: "Missing projectId" });
        }

        await client.query(`DELETE FROM project_photos WHERE project_id=$1`, [projectId]);
        await client.query(`DELETE FROM project_details WHERE project_id=$1`, [projectId]);
        await client.query(`DELETE FROM project_contacts WHERE project_id=$1`, [projectId]);
        await client.query(`DELETE FROM project_events WHERE project_id=$1`, [projectId]);
        await client.query(`DELETE FROM projects WHERE id=$1`, [projectId]);

        return res.status(200).json({ ok: true });
      }

      /* ---------- SET HIDDEN ---------- */
      if (body.action === "setHidden") {
        const { id, hidden } = body;

        if (!id) {
          return res.status(400).json({ error: "Missing id" });
        }

        await client.query(
          `UPDATE projects SET hidden = $2 WHERE id = $1`,
          [id, !!hidden]
        );

        return res.status(200).json({ ok: true });
      }

     /* ---------- CREATE ---------- */
const {
  project_name,
  site_address,
  zip_code,
  equipment,
  modality,
  magnet_event,
  disposal_required,
  sales_rep_first,
  sales_rep_last,
  sales_rep_company,
  sales_rep_phone,
  sales_rep_email,
  contact_name,
  contact_title,
  contact_phone,
  contact_email,
  source
} = body;

if (!project_name || !modality) {
  return res.status(400).json({ error: "Missing required fields" });
}

 const tz = getTzFromZip();

console.log("🔥 BODY:", body);

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
    hidden,
    sales_rep_first,
    sales_rep_last,
    sales_rep_company,
    sales_rep_phone,
    sales_rep_email,
    contact_name,
    contact_title,
    contact_phone,
    contact_email,
    source
  )
  VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
    $15,$16,$17,$18,$19,
    $20,$21,$22,$23,
    $24
  )
  RETURNING *
  `,
  [
    project_name?.trim() || null,
    site_address || null,
    zip_code?.trim() || null,
    equipment || null,
    modality || null,
    magnet_event || null,
    !!disposal_required,
    "system",
    tz,
    tz,
    false,
    false,
    null,
    false,
    sales_rep_first || null,
    sales_rep_last || null,
    sales_rep_company || null,
    sales_rep_phone || null,
    sales_rep_email || null,

    // 🔥 NEW
    contact_name || null,
    contact_title || null,
    contact_phone || null,
    contact_email || null,

    source || "lifecycle"
  ]
);
return res.status(201).json(rows[0]);
    }

    /* ===============================
       PUT — UPDATE
    =============================== */
    if (req.method === "PUT") {
      const projectId = getProjectId(req);

      if (!projectId) {
        return res.status(400).json({ error: "Missing projectId" });
      }

      const {
        project_name,
        site_address,
        zip_code,
        equipment,
        modality,
        magnet_event,
        disposal_required
      } = req.body || {};

      const { rows } = await client.query(
        `
        UPDATE projects
        SET
          project_name = $2,
          site_address = $3,
          zip_code = $4,
          equipment = $5,
          modality = $6,
          magnet_event = $7,
          disposal_required = $8
        WHERE id = $1
        RETURNING *
        `,
        [
          projectId,
          project_name,
          site_address,
          zip_code,
          equipment,
          modality,
          magnet_event,
          !!disposal_required
        ]
      );

      if (!rows.length) {
        return res.status(404).json({ error: "Project not found" });
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