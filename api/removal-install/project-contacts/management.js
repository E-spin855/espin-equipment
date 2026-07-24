// FILE: /api/project-contacts/management.js
// PATH: /api/project-contacts/management.js

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function clean(email) {
  return String(email || "").toLowerCase().trim();
}

export default async function handler(req, res) {
  /* CORS */
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-user-email, x-useremail"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  /* USER EMAIL (STRICT — HEADER ONLY) */
  let userEmail =
    req.headers["x-user-email"] ||
    req.headers["x-useremail"];

  userEmail = clean(userEmail);

  if (!userEmail) {
    console.error("❌ Missing user email header");
    return res.status(400).json({ error: "Missing user email" });
  }

  const projectId = req.query.projectId;

  if (!projectId) {
    return res.status(400).json({ error: "Missing projectId" });
  }

  const client = await pool.connect();

  try {
    /* ACCESS CHECK */
    const access = await client.query(
      `
      SELECT 1
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
      LIMIT 1
      `,
      [projectId, userEmail]
    );

    if (!access.rows.length) {
      return res.status(403).json({ error: "Access denied" });
    }

    /* PROJECT CONTACTS */
    const contactsResult = await client.query(
      `
      SELECT
        id,
        role,
        full_name,
        email,
        phone,
        can_receive_email,
        can_login
      FROM project_contacts
      WHERE project_id = $1
      ORDER BY role, full_name
      `,
      [projectId]
    );

    /* EXTRA EMAIL RECIPIENTS */
    const extraResult = await client.query(
      `
      SELECT email
      FROM project_email_recipients
      WHERE project_id = $1
      `,
      [projectId]
    );

    /* PROJECT ADMIN EMAIL */
    const projectResult = await client.query(
      `
      SELECT admin_email
      FROM projects
      WHERE id = $1
      `,
      [projectId]
    );

    const adminEmail = clean(projectResult.rows[0]?.admin_email);

    return res.status(200).json({
      contacts: contactsResult.rows,
      extraEmails: extraResult.rows.map(r => clean(r.email)),
      adminEmail
    });

  } catch (err) {
    console.error("management contacts error:", err);
    return res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
}