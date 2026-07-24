// FILE: /api/admin/projects.js
// PATH: /api/admin/projects.js

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function cors(res) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-user-email, x-useremail"
  );
}

function clean(email) {
  return String(email || "").toLowerCase().trim();
}

async function isAdmin(client, email) {
  if (!email) return false;
  const { rows } = await client.query(
    `SELECT 1 FROM admins WHERE email = $1 LIMIT 1`,
    [clean(email)]
  );
  return rows.length > 0;
}

function cleanStr(v) {
  return (v == null ? "" : String(v)).trim();
}

function cleanZip(v) {
  return cleanStr(v).replace(/\D/g, "").slice(0, 5);
}

export default async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const userEmail =
    req.headers["x-user-email"] ||
    req.headers["x-useremail"] ||
    null;

  const email = clean(userEmail);

  if (!email) {
    return res.status(401).json({ error: "Missing user email" });
  }

  const client = await pool.connect();

  try {
    const isAdminUser = await isAdmin(client, email);

    /* ===============================
       DELETE
    =============================== */
    if (req.method === "POST" && req.body?.action === "delete") {
      if (!isAdminUser) {
        return res.status(403).json({ error: "Admin only" });
      }

      const id = cleanStr(req.body?.id);
      if (!id) return res.status(400).json({ error: "Missing project id" });

      await client.query(`DELETE FROM projects WHERE id = $1`, [id]);
      return res.status(200).json({ ok: true });
    }

    /* ===============================
   CREATE
=============================== */
if (req.method === "POST") {
  if (!isAdminUser) {
    return res.status(403).json({ error: "Admin only" });
  }

  const body = req.body || {};

  const project_name = cleanStr(body.project_name);
  const site_address = cleanStr(body.site_address);
  const zip_code = cleanZip(body.zip_code);
  const modality = cleanStr(body.modality);

  const magnet_event =
    body.magnet_event == null
      ? null
      : cleanStr(body.magnet_event) || null;

  const disposal_required = !!body.disposal_required;

  if (!project_name) {
    return res.status(400).json({ error: "Missing project_name" });
  }

  const { rows } = await client.query(
  `
  INSERT INTO projects (
    project_name,
    site_address,
    zip_code,
    modality,
    magnet_event,
    disposal_required,
    admin_email,

    sales_rep_first,
    sales_rep_last,
    sales_rep_company,
    sales_rep_phone,
    sales_rep_email,

    -- 🔥 ADD THESE
    contact_name,
    contact_title,
    contact_phone,
    contact_email,

    source
  )
  VALUES (
    $1,$2,$3,$4,$5,$6,$7,
    $8,$9,$10,$11,$12,
    $13,$14,$15,$16,
    $17
  )
  RETURNING *
  `,
  [
    project_name,
    site_address || null,
    zip_code || null,
    modality || null,
    magnet_event,
    disposal_required,
    email,

    body.sales_rep_first || null,
    body.sales_rep_last || null,
    body.sales_rep_company || null,
    body.sales_rep_phone || null,
    body.sales_rep_email || null,

    // 🔥 NEW
    body.contact_name || null,
    body.contact_title || null,
    body.contact_phone || null,
    body.contact_email || null,

    body.source || "lifecycle"
  ]
);

  return res.status(200).json(rows[0]);
}
    /* ===============================
       UPDATE
    =============================== */
    if (req.method === "PUT") {
      if (!isAdminUser) {
        return res.status(403).json({ error: "Admin only" });
      }

      const id = cleanStr(req.query?.id);
      if (!id) return res.status(400).json({ error: "Missing project id" });

      const project_name = cleanStr(req.body?.project_name);
      const site_address = cleanStr(req.body?.site_address);
      const zip_code = cleanZip(req.body?.zip_code);
      const modality = cleanStr(req.body?.modality);
      const magnet_event =
        req.body?.magnet_event == null
          ? null
          : cleanStr(req.body?.magnet_event) || null;
      const disposal_required = !!req.body?.disposal_required;

      const { rows } = await client.query(
        `UPDATE projects
         SET
           project_name = COALESCE(NULLIF($2,''), project_name),
           site_address = $3,
           zip_code = $4,
           modality = $5,
           magnet_event = $6,
           disposal_required = $7
         WHERE id = $1
         RETURNING id, project_name, site_address, zip_code, modality, magnet_event, disposal_required, project_completed, hidden, created_at`,
        [
          id,
          project_name,
          site_address,
          zip_code,
          modality,
          magnet_event,
          disposal_required
        ]
      );

      if (!rows.length) {
        return res.status(404).json({ error: "Project not found" });
      }

      return res.status(200).json(rows[0]);
    }

    /* ===============================
       LIST (SECURE)
    =============================== */
    if (req.method === "GET") {
      const { rows } = await client.query(
        `
        SELECT 
  id,
  project_name,
  site_address,
  zip_code,
  modality,
  magnet_event,
  disposal_required,
  project_completed,
  hidden,
  created_at,

  -- 🔥 ADD THESE
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

FROM projects p
        WHERE
          $2 = true

          OR LOWER(p.admin_email) = LOWER($1)

          OR EXISTS (
            SELECT 1
            FROM project_contacts pc
            WHERE pc.project_id = p.id
            AND LOWER(pc.email) = LOWER($1)
          )
        ORDER BY p.created_at DESC
        `,
        [email, isAdminUser]
      );

      return res.status(200).json(rows);
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (e) {
    console.error("ADMIN PROJECTS ERROR:", e);
    return res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
}