// FILE: /api/projects.js
// PATH: /api/projects.js

import { Pool } from "pg";
import { kv } from "@vercel/kv";
import crypto from "crypto";

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

function hasManagerSandboxRole(req) {
  const raw = String(req.headers.cookie || "").match(/(?:^|; )espin_sandbox_auth=([^;]+)/)?.[1];
  if (!raw || !process.env.SANDBOX_AUTH_HASH_SECRET) return false;
  try {
    const [encoded, signature] = raw.split(".");
    if (!encoded || !signature) return false;
    const expected = crypto.createHmac("sha256", process.env.SANDBOX_AUTH_HASH_SECRET).update(encoded).digest("hex");
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(signature);
    if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) return false;
    const session = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    return Number(session?.exp || 0) > Date.now() && ["manager", "sandbox_admin"].includes(String(session?.role || "").toLowerCase());
  } catch (_) { return false; }
}

async function canManageProjects(client, req, email) {
  if (hasManagerSandboxRole(req)) return true;
  const { rowCount } = await client.query("SELECT 1 FROM admins WHERE LOWER(email) = $1 LIMIT 1", [email]);
  return rowCount > 0;
}

function getTzFromZip() {
  return "UTC";
}

const OPERATION_FIELDS = [
  "operation_id",
  "operation_type",
  "project_group_id",
  "facility_id",
  "facility_name",
  "facility",
  "asset_id",
  "serial_number",
  "source_record_id",
  "make",
  "model",
  "modality",
  "equipment_model",
  "equipment_source",
  "equipment_verified",
  "created_at",
  "created_by"
];

function operationMetadata(body = {}) {
  return Object.fromEntries(
    OPERATION_FIELDS
      .map(field => [field, String(body[field] ?? "").trim()])
      .filter(([, value]) => value)
  );
}

function operationIdentityKey(body = {}) {
  const type = String(body.operation_type || "").trim().toLowerCase();
  const value =
    String(body.source_record_id || "").trim().toLowerCase() ||
    String(body.asset_id || "").trim().toLowerCase() ||
    String(body.serial_number || "").trim().toLowerCase();
  return type && value
    ? `espin:active-equipment-operation:${type}:${encodeURIComponent(value)}`
    : "";
}

async function addOperationMetadata(project) {
  if (!project?.id) return project;
  try {
    const metadata =
      await kv.get(`espin:operation:${project.id}`) || {};
    return { ...project, ...metadata };
  } catch {
    return project;
  }
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
    if (req.method === "GET" && (req.query.id || req.query.operation_id)) {
      const email = clean(
        req.headers["x-user-email"] ||
        req.headers["x-useremail"]
      );

      if (!email) {
        return res.status(401).json({ error: "Missing email" });
      }

      let requestedProjectId = req.query.id;
      if (!requestedProjectId && req.query.operation_id) {
        requestedProjectId = await kv.get(
          `espin:operation-project:${String(req.query.operation_id).trim()}`
        );
      }
      if (!requestedProjectId) {
        return res.status(404).json({ error: "Equipment operation not found" });
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
        [requestedProjectId, email]
      );

      if (!rows.length) {
        return res.status(403).json({ error: "Access denied" });
      }

      return res.status(200).json(await addOperationMetadata(rows[0]));
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

      const manager = await canManageProjects(client, req, email);
      const { rows } = await client.query(
        `
        SELECT *
        FROM projects p
        WHERE
          (
            /* ADMIN → sees EVERYTHING (including archived + hidden) */
            $2::boolean

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
        [email, manager]
      );

      return res.status(200).json(
        await Promise.all(rows.map(addOperationMetadata))
      );
    }

    /* ===============================
       POST — ACTIONS + CREATE
    =============================== */
    if (req.method === "POST") {
      const body = req.body || {};
      const actor = clean(req.headers["x-user-email"] || req.headers["x-useremail"]);
      if (!actor || !(await canManageProjects(client, req, actor))) {
        return res.status(403).json({ error: "Manager access required." });
      }

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
        try {
          const metadata = await kv.get(`espin:operation:${projectId}`) || {};
          if (metadata.operation_id) {
            await kv.del(`espin:operation-project:${metadata.operation_id}`);
          }
          const identityKey = operationIdentityKey(metadata);
          if (identityKey) await kv.del(identityKey);
          await kv.del(`espin:operation:${projectId}`);
        } catch {}

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
if (!body.operation_id) {
  return res.status(400).json({ error: "Equipment confirmation and operation_id are required" });
}
if (!body.source_record_id && !body.asset_id && !body.serial_number) {
  return res.status(400).json({ error: "A source record, asset ID, serial number, or temporary equipment ID is required" });
}
const activeIdentityKey = operationIdentityKey(body);
if (activeIdentityKey) {
  const existing = await kv.get(activeIdentityKey);
  if (existing?.project_id) {
    return res.status(409).json({
      error: "An active operation already exists for this equipment and operation type",
      existing
    });
  }
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
const createdProject = rows[0];
const createdMetadata = operationMetadata(body);
if (createdProject?.id && Object.keys(createdMetadata).length) {
  await kv.set(`espin:operation:${createdProject.id}`, createdMetadata);
  await kv.set(
    `espin:operation-project:${createdMetadata.operation_id}`,
    createdProject.id
  );
  if (activeIdentityKey) {
    await kv.set(activeIdentityKey, {
      ...createdMetadata,
      project_id: createdProject.id
    });
  }
}
return res.status(201).json({ ...createdProject, ...createdMetadata });
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

      const existingMetadata =
        await kv.get(`espin:operation:${projectId}`) || {};
      const updatedMetadata = {
        ...existingMetadata,
        ...operationMetadata(req.body || {})
      };
      if (Object.keys(updatedMetadata).length) {
        await kv.set(`espin:operation:${projectId}`, updatedMetadata);
      }

      return res.status(200).json({
        ...rows[0],
        ...updatedMetadata
      });
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (err) {
    console.error("Projects API error:", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}
