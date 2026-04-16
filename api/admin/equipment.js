import { Pool } from "pg";

export const config = {
  api: { bodyParser: true }
};

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function clean(v) {
  return String(v || "").toLowerCase().trim();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");

  if (req.method === "OPTIONS") return res.status(200).end();

  const userEmail = clean(req.headers["x-user-email"]);
  if (!userEmail) {
    return res.status(400).json({ error: "Missing user email" });
  }

  const client = await pool.connect();

  try {
    /* =========================
       🟦 GET PROJECTS
    ========================= */
    if (req.method === "GET") {
      const { rows } = await client.query(`
        SELECT *
        FROM equipment_projects
        ORDER BY created_at DESC
      `);

      return res.status(200).json(rows);
    }

    /* =========================
       🔥 SAFE BODY PARSE
    ========================= */
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch { body = {}; }
    }

    const {
      id,
      project_name,
      site_address,
      city,
      state,
      zip_code,
      sales_rep_first,
      sales_rep_last,
      sales_rep_company,
      sales_rep_phone,
      sales_rep_email
    } = body;

    /* =========================
       ❗ VALIDATION
    ========================= */
    if (!project_name) {
      return res.status(400).json({ error: "Project name required" });
    }

    /* =========================
       🔵 UPDATE PROJECT
    ========================= */
    if (req.method === "PUT") {
      if (!id) {
        return res.status(400).json({ error: "Missing id for update" });
      }

      await client.query(
  `UPDATE equipment_projects SET
    project_name = $1,
    site_address = $2,
    city = $3,
    state = $4,
    zip_code = $5,
    sales_rep_first = $6,
    sales_rep_last = $7,
    sales_rep_phone = $8,
    sales_rep_email = $9,
    sales_rep_company = $10
   WHERE id = $11`,
  [
    project_name,
    site_address,
    city,
    state,
    zip_code,
    sales_rep_first,
    sales_rep_last,
    sales_rep_phone,
    sales_rep_email,
    sales_rep_company,
    id
  ]
);
      return res.status(200).json({ ok: true });
    }

    /* =========================
       🟢 CREATE PROJECT
    ========================= */
    if (req.method === "POST") {
      const result = await client.query(
        `INSERT INTO equipment_projects (
          project_name,
          site_address,
          city,
          state,
          zip_code,
          sales_rep_first,
          sales_rep_last,
          sales_rep_company,
          sales_rep_phone,
          sales_rep_email
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING id`,
        [
          project_name,
          site_address,
          city,
          state,
          zip_code,
          sales_rep_first,
          sales_rep_last,
          sales_rep_company,
          sales_rep_phone,
          sales_rep_email
        ]
      );

      return res.status(200).json({ id: result.rows[0].id });
    }

    /* =========================
       ❌ FALLBACK
    ========================= */
    return res.status(405).json({ error: "Method not allowed" });

  } catch (err) {
    console.error("ADMIN EQUIPMENT ERROR:", err);
    return res.status(500).json({ error: "Failed" });
  } finally {
    client.release();
  }
}