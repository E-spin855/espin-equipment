// FILE: /api/equipment-project-contacts/list.js
// PATH: /api/equipment-project-contacts/list.js

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* ===============================
   HELPERS
=============================== */
function clean(email) {
  return String(email || "").toLowerCase().trim();
}

/* ===============================
   HANDLER
=============================== */
export default async function handler(req, res) {

  /* CORS */
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const projectId = String(req.query.projectId || "").trim();
  const userEmail = clean(req.headers["x-user-email"]);

  if (!userEmail) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!projectId) {
    return res.status(400).json({ error: "Missing projectId" });
  }

  const client = await pool.connect();

  try {

    /* ===============================
       🔒 VERIFY ACCESS (equipment only)
    =============================== */
    const accessCheck = await client.query(
      `
      SELECT 1
      FROM equipment_project_access
      WHERE project_id = $1
        AND LOWER(email) = LOWER($2)
      LIMIT 1
      `,
      [projectId, userEmail]
    );

    if (!accessCheck.rows.length) {
      return res.status(403).json({ error: "Forbidden" });
    }

    /* ===============================
       CONTACTS
    =============================== */
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
      FROM equipment_project_contacts
      WHERE project_id = $1
      ORDER BY role, full_name
      `,
      [projectId]
    );

    /* ===============================
       EXTRA EMAIL RECIPIENTS
    =============================== */
    const extraResult = await client.query(
      `
      SELECT email
      FROM equipment_project_email_recipients
      WHERE project_id = $1
      `,
      [projectId]
    );

    return res.status(200).json({
      contacts: contactsResult.rows,
      extraEmails: extraResult.rows.map(r => clean(r.email))
    });

  } catch (err) {
    console.error("equipment contacts error:", err);
    return res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
}