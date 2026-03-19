import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* ===============================
   HELPERS
=============================== */
const clean = (v) => String(v || "").toLowerCase().trim();

function accessClause(alias = "proj", emailParam = "$2") {
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

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");

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
       🔒 VERIFY ACCESS FIRST
    =============================== */
    const accessCheck = await client.query(
      `
      SELECT id
      FROM projects proj
      WHERE proj.id = $1
      AND proj.hidden = false
      AND ${accessClause("proj", "$2")}
      `,
      [projectId, userEmail]
    );

    if (!accessCheck.rows.length) {
      return res.status(403).json({ error: "Forbidden" });
    }

    /* ===============================
       LOAD PHOTOS
    =============================== */
   const result = await client.query(
  `
 SELECT
  p.id,
  p.project_id,
  p.photo_url,
  p.photo_title,
  p.photo_comment,
  p.created_at
FROM equipment_photos p
WHERE p.project_id = $1
AND p.hidden = false
ORDER BY p.created_at DESC, p.id DESC
  `,
  [projectId]
);

    return res.status(200).json(result.rows);

  } catch (err) {
    console.error("EQUIPMENT LIST ERROR:", err);
    return res.status(500).json({ error: "Failed to load photos" });
  } finally {
    client.release();
  }
}