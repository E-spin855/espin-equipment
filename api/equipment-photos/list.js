import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function cors(res) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-user-email, x-useremail, x-user_email"
  );
}

export default async function handler(req, res) {

  cors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const projectId =
    req.query?.projectId ||
    req.query?.id ||
    null;

  if (!projectId) {
    return res.status(400).json([]);
  }

  try {

    const { rows } = await pool.query(
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

    return res.status(200).json(rows);

  } catch (err) {

    console.error(err);

    return res.status(200).json([]);

  }

}