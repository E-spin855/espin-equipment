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

function accessClause(alias = "p", emailParam = "$2") {
  return `
    (
      LOWER(${alias}.admin_email) = LOWER(${emailParam})
      OR EXISTS (
        SELECT 1
        FROM project_contacts pc
        WHERE pc.project_id = ${alias}.id
          AND LOWER(pc.email) = LOWER(${emailParam})
      )
    )
  `;
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

  const projectId = req.query.projectId;
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
       🔒 VERIFY ACCESS FIRST
    =============================== */
    const accessCheck = await client.query(
      `
      SELECT id
      FROM projects p
      WHERE p.id = $1
      AND p.hidden = false
      AND ${accessClause("p", "$2")}
      `,
      [projectId, userEmail]
    );

    if (!accessCheck.rows.length) {
      return res.status(403).json({ error: "Forbidden" });
    }

    /* ===============================
       PROJECT CONTACTS
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
      FROM project_contacts
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
      FROM project_email_recipients
      WHERE project_id = $1
      `,
      [projectId]
    );

    /* ===============================
       ADMIN EMAIL
    =============================== */
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