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
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-user-email, x-useremail, x-user_email"
  );
}

/* ===============================
   GET PROJECT ID
=============================== */
function getProjectId(req) {
  return (
    req.query?.projectId ||
    req.query?.id ||
    req.body?.projectId ||
    req.body?.id ||
    null
  );
}

/* ===============================
   HANDLER
=============================== */
export default async function handler(req, res) {

  cors(res);

  /* PRE-FLIGHT */
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  /* ONLY ALLOW GET */
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userEmail = String(
    req.headers["x-user-email"] ||
    req.headers["x-useremail"] ||
    req.headers["x-user_email"] ||
    ""
  ).toLowerCase().trim();

  if (!userEmail) {
    return res.status(401).json({ error: "Missing user email" });
  }

  const projectId = getProjectId(req);

  if (!projectId) {
    return res.status(400).json({ error: "Missing projectId" });
  }

  const client = await pool.connect();

  try {

    const q = await client.query(
      `
      SELECT
        id,
        project_id,
        photo_url,
        photo_title,
        photo_comment,
        created_at
      FROM equipment_photos
      WHERE project_id = $1
      ORDER BY created_at DESC
      `,
      [projectId]
    );

    return res.status(200).json(q.rows);

  } catch (err) {
    console.error("equipment-photos list error:", err);
    return res.status(500).json({ error: "Server error" });

  } finally {
    client.release();
  }
}