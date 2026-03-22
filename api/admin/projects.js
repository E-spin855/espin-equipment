import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const ADMIN_EMAIL = "info@espinmedical.com";

function cors(res) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-user-email, x-useremail, x-user_email"
  );
}

function getProjectId(req) {
  return req.query?.id || req.body?.projectId || req.body?.id || null;
}

function clean(v) {
  return String(v || "").toLowerCase().trim();
}

function cleanText(v) {
  return String(v || "").trim();
}

function getTzFromZip() {
  return "UTC";
}

function accessClause(alias = "p", emailParam = "$1") {
  return `
    (
      LOWER(${alias}.admin_email) = LOWER(${emailParam})
      OR EXISTS (
        SELECT 1
        FROM project_contacts pc
        WHERE pc.project_id = ${alias}.id
          AND LOWER(pc.email) = LOWER(${emailParam})
      )
      OR EXISTS (
        SELECT 1
        FROM equipment_project_access epa
        WHERE epa.project_id = ${alias}.id
          AND LOWER(epa.email) = LOWER(${emailParam})
      )
    )
  `;
}

async function deleteByProjectId(client, table, projectId) {
  console.log(`[DELETE] deleting from ${table} by project_id for project ${projectId}`);
  await client.query(`DELETE FROM ${table} WHERE project_id = $1`, [projectId]);
  console.log(`[DELETE] success ${table}`);
}

async function deleteEquipmentDetailsByProject(client, projectId) {
  console.log(`[DELETE] deleting from equipment_details via project_modalities for project ${projectId}`);
  await client.query(
    `
    DELETE FROM equipment_details
    WHERE modality_id IN (
      SELECT id
      FROM project_modalities
      WHERE project_id = $1
    )
    `,
    [projectId]
  );
  console.log("[DELETE] success equipment_details");
}

async function deleteEquipmentPhotosByProject(client, projectId) {
  console.log(`[DELETE] deleting from equipment_photos via equipment_units/project_modalities for project ${projectId}`);
  await client.query(
    `
    DELETE FROM equipment_photos
    WHERE equipment_unit_id IN (
      SELECT id
      FROM equipment_units
      WHERE project_id = $1
    )
    OR modality_id IN (
      SELECT id
      FROM project_modalities
      WHERE project_id = $1
    )
    `,
    [projectId]
  );
  console.log("[DELETE] success equipment_photos");
}

async function deleteNotificationsByProject(client, projectId) {
  console.log(`[DELETE] deleting from notifications via project_events for project ${projectId}`);
  await client.query(
    `
    DELETE FROM notifications
    WHERE event_id IN (
      SELECT id
      FROM project_events
      WHERE project_id = $1
    )
    `,
    [projectId]
  );
  console.log("[DELETE] success notifications");
}

async function ensureEquipmentAccess(client, projectId, email) {
  const normalizedEmail = clean(email);
  if (!projectId || !normalizedEmail) return;

  await client.query(
    `
    INSERT INTO equipment_project_access (project_id, email)
    VALUES ($1, $2)
    ON CONFLICT (project_id, email) DO NOTHING
    `,
    [projectId, normalizedEmail]
  );
}

export default async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const userEmail = clean(
    req.headers["x-user-email"] ||
    req.headers["x-useremail"] ||
    req.headers["x-user_email"]
  );

  console.log("[API] method:", req.method);
  console.log("[API] query:", req.query);
  console.log("[API] body:", req.body);
  console.log("[API] userEmail:", userEmail);

  if (!userEmail) {
    return res.status(401).json({ error: "Unauthorized: missing user email header" });
  }

  const client = await pool.connect();

  try {
    if (req.method === "GET" && req.query.id) {
      const { rows } = await client.query(
        `
        SELECT *
        FROM projects p
        WHERE p.id = $2
          AND COALESCE(p.hidden, false) = false
          AND ${accessClause("p", "$1")}
        `,
        [userEmail, req.query.id]
      );

      if (!rows.length) {
        return res.status(404).json({ error: "Project not found or access denied" });
      }

      return res.status(200).json(rows[0]);
    }

    if (req.method === "GET") {
      const { rows } = await client.query(
        `
        SELECT
          id,
          project_name,
          site_address,
          zip_code,
          sales_rep_first,
          sales_rep_last,
          sales_rep_phone,
          sales_rep_email,
          project_completed,
          is_archived,
          archived_at,
          hidden,
          timezone,
          created_at
        FROM projects p
        WHERE COALESCE(p.hidden, false) = false
          AND ${accessClause("p", "$1")}
        ORDER BY created_at DESC
        `,
        [userEmail]
      );

      return res.status(200).json(rows);
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const action = String(body.action || "").trim().toLowerCase();

      console.log("[POST] action:", action);

      if (action === "delete" && body.id) {
        const projectId = String(body.id).trim();

        console.log("[DELETE] requested projectId:", projectId);

        const check = await client.query(
          `
          SELECT id
          FROM projects
          WHERE id = $1
            AND ${accessClause("projects", "$2")}
          `,
          [projectId, userEmail]
        );

        console.log("[DELETE] project lookup:", check.rows);

        if (!check.rows.length) {
          return res.status(404).json({ error: "Project not found or access denied" });
        }

        await client.query("BEGIN");

        try {
          await deleteEquipmentPhotosByProject(client, projectId);
          await deleteEquipmentDetailsByProject(client, projectId);

          await deleteByProjectId(client, "equipment_unit_details", projectId);
          await deleteByProjectId(client, "equipment_project_access", projectId);
          await deleteByProjectId(client, "equipment_units", projectId);

          await deleteNotificationsByProject(client, projectId);
          await deleteByProjectId(client, "project_events", projectId);

          await deleteByProjectId(client, "project_photos", projectId);
          await deleteByProjectId(client, "project_tasks", projectId);
          await deleteByProjectId(client, "project_updates", projectId);
          await deleteByProjectId(client, "project_users", projectId);
          await deleteByProjectId(client, "project_email_recipients", projectId);
          await deleteByProjectId(client, "project_contacts", projectId);
          await deleteByProjectId(client, "project_details", projectId);
          await deleteByProjectId(client, "project_modalities", projectId);

          console.log("[DELETE] deleting root project row");

          const deleted = await client.query(
            `
            DELETE FROM projects
            WHERE id = $1
            RETURNING id
            `,
            [projectId]
          );

          console.log("[DELETE] root delete result:", deleted.rows);

          await client.query("COMMIT");

          return res.status(200).json({
            success: true,
            deleted: true,
            id: projectId
          });
        } catch (err) {
          try {
            await client.query("ROLLBACK");
          } catch (rollbackErr) {
            console.error("[DELETE] rollback error:", rollbackErr);
          }

          console.error("[DELETE] failed:", err);

          return res.status(500).json({
            error: "Delete failed",
            detail: String(err?.message || err)
          });
        }
      }

      const projectName = cleanText(body.project_name);

      if (!projectName) {
        return res.status(400).json({ error: "Missing project name" });
      }

      const tz = getTzFromZip();
      const salesRepEmail = clean(body.sales_rep_email || userEmail);

      await client.query("BEGIN");

      try {
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
            hidden
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,false,false,false)
          RETURNING *
          `,
          [
            projectName,
            body.site_address ?? null,
            body.zip_code ?? null,
            body.sales_rep_first ?? null,
            body.sales_rep_last ?? null,
            body.sales_rep_phone ?? null,
            salesRepEmail || null,
            ADMIN_EMAIL,
            tz
          ]
        );

        const project = rows[0];

        await ensureEquipmentAccess(client, project.id, userEmail);

        if (salesRepEmail && salesRepEmail !== userEmail) {
          await ensureEquipmentAccess(client, project.id, salesRepEmail);
        }

        await client.query("COMMIT");
        return res.status(201).json(project);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      }
    }

    if (req.method === "PUT") {
      const projectId = getProjectId(req);
      const body = req.body || {};
      const tz = getTzFromZip();

      const salesRepEmail = clean(body.sales_rep_email || userEmail);

      const { rows } = await client.query(
        `
        UPDATE projects p
        SET
          project_name = $2,
          site_address = $3,
          zip_code = $4,
          sales_rep_first = $5,
          sales_rep_last = $6,
          sales_rep_phone = $7,
          sales_rep_email = $8,
          project_completed = $9,
          timezone = $10,
          updated_timezone = $10
        WHERE p.id = $1
          AND ${accessClause("p", "$11")}
        RETURNING *
        `,
        [
          projectId,
          body.project_name,
          body.site_address,
          body.zip_code ?? null,
          body.sales_rep_first,
          body.sales_rep_last,
          body.sales_rep_phone,
          salesRepEmail || null,
          !!body.project_completed,
          tz,
          userEmail
        ]
      );

      if (!rows.length) {
        return res.status(403).json({ error: "Forbidden" });
      }

      await ensureEquipmentAccess(client, projectId, userEmail);

      if (salesRepEmail && salesRepEmail !== userEmail) {
        await ensureEquipmentAccess(client, projectId, salesRepEmail);
      }

      return res.status(200).json(rows[0]);
    }

    if (req.method === "DELETE") {
      return res.status(405).json({
        error: "Use POST with action=delete"
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("Projects API error:", err);
    return res.status(500).json({
      error: "Internal server error",
      detail: String(err?.message || err)
    });
  } finally {
    client.release();
  }
}