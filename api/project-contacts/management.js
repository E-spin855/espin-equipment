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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const projectId = req.query.projectId;
    if (!projectId) {
      return res.status(400).json({ error: "Missing projectId" });
    }

    /* PROJECT CONTACTS (primary) */
    const contactsResult = await pool.query(
      `SELECT
          id,
          role,
          full_name,
          email,
          phone,
          can_receive_email,
          can_login
       FROM project_contacts
       WHERE project_id = $1
       ORDER BY role, full_name`,
      [projectId]
    );

    /* EXTRA EMAIL RECIPIENTS (replaces allowed_emails) */
    const extraResult = await pool.query(
      `SELECT email
       FROM project_email_recipients
       WHERE project_id = $1`,
      [projectId]
    );

    /* ADMIN EMAIL */
    const projectResult = await pool.query(
      `SELECT admin_email
       FROM projects
       WHERE id = $1`,
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
  }
}
