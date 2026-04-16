// FILE: /api/project-contacts.js
// PATH: /api/project-contacts.js

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function cors(res) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email, x-useremail");
}

function cleanHeaderEmail(req) {
  let email =
    req.headers["x-user-email"] ||
    req.headers["x-useremail"] ||
    "";

  if (Array.isArray(email)) email = email[0];
  return String(email).toLowerCase().trim();
}

function normalizeRole(role) {
  const r = String(role || "").trim();
  if (r === "project_manager" || r === "team_leader" || r === "authorized") return r;
  return null;
}

function pgErrorToHttp(e) {
  if (e && e.code === "23505") {
    return { status: 409, error: "Duplicate role for project" };
  }
  return { status: 500, error: "Server error" };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const userEmail = cleanHeaderEmail(req);
  if (!userEmail) return res.status(401).json({ error: "Unauthorized" });

  const client = await pool.connect();

  try {
    // ================= GET =================
    if (req.method === "GET") {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const projectId = url.searchParams.get("projectId");

      if (!projectId) return res.status(400).json({ error: "Missing projectId" });

      const { rows } = await client.query(
        `
        SELECT id, project_id, role, full_name, email, phone, can_login, can_receive_email
        FROM equipment_project_contacts
        WHERE project_id = $1
        ORDER BY role, created_at
        `,
        [projectId]
      );

      return res.status(200).json(rows);
    }

    // ================= POST =================
    if (req.method === "POST") {
      const body = req.body || {};

      const id = body.id || null;
      const projectId = body.project_id || body.projectId || null;
      const role = normalizeRole(body.role);

      if (!projectId) return res.status(400).json({ error: "Missing project_id" });
      if (!role) return res.status(400).json({ error: "Invalid role" });

      const fullName = (body.full_name ?? "").toString().trim() || null;
      const email = (body.email ?? "").toString().trim().toLowerCase() || null;
      const phone = (body.phone ?? "").toString().trim() || null;

      const canLogin = typeof body.can_login === "boolean" ? body.can_login : true;
      const canReceive = typeof body.can_receive_email === "boolean" ? body.can_receive_email : true;

      // ===== UPDATE =====
      if (id) {
        try {
          const { rows } = await client.query(
            `
            UPDATE equipment_project_contacts
            SET full_name = $1,
                email = $2,
                phone = $3,
                can_login = $4,
                can_receive_email = $5
            WHERE id = $6 AND project_id = $7
            RETURNING *
            `,
            [fullName, email, phone, canLogin, canReceive, id, projectId]
          );

          if (!rows.length) return res.status(404).json({ error: "Not found" });
          return res.status(200).json(rows[0]);
        } catch (e) {
          const out = pgErrorToHttp(e);
          return res.status(out.status).json({ error: out.error });
        }
      }

      // ===== UPSERT PM / TL =====
      if (role === "project_manager" || role === "team_leader") {
        try {
          const up = await client.query(
            `
            UPDATE equipment_project_contacts
            SET full_name = $1,
                email = $2,
                phone = $3,
                can_login = $4,
                can_receive_email = $5
            WHERE project_id = $6 AND role = $7
            RETURNING *
            `,
            [fullName, email, phone, canLogin, canReceive, projectId, role]
          );

          if (up.rows.length > 0) return res.status(200).json(up.rows[0]);

          const ins = await client.query(
            `
            INSERT INTO equipment_project_contacts
            (project_id, role, full_name, email, phone, can_login, can_receive_email)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            RETURNING *
            `,
            [projectId, role, fullName, email, phone, canLogin, canReceive]
          );

          return res.status(200).json(ins.rows[0]);
        } catch (e) {
          const out = pgErrorToHttp(e);
          return res.status(out.status).json({ error: out.error });
        }
      }

      // ===== AUTHORIZED =====
      try {
        const { rows } = await client.query(
          `
          INSERT INTO equipment_project_contacts
          (project_id, role, full_name, email, phone, can_login, can_receive_email)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          RETURNING *
          `,
          [projectId, role, fullName, email, phone, canLogin, canReceive]
        );

        return res.status(200).json(rows[0]);
      } catch (e) {
        const out = pgErrorToHttp(e);
        return res.status(out.status).json({ error: out.error });
      }
    }

    // ================= DELETE =================
    if (req.method === "DELETE") {
      const body = req.body || {};
      const id = body.id;
      const projectId = body.project_id || body.projectId;

      if (!id || !projectId) {
        return res.status(400).json({ error: "Missing id or project_id" });
      }

      const { rowCount } = await client.query(
        `
        DELETE FROM equipment_project_contacts
        WHERE id = $1 AND project_id = $2
        `,
        [id, projectId]
      );

      if (!rowCount) return res.status(404).json({ error: "Not found" });

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (e) {
    const out = pgErrorToHttp(e);
    return res.status(out.status).json({ error: out.error });
  } finally {
    client.release();
  }
}