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

function safe(v) {
  return String(v || "").trim();
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

  let client;

  try {
    client = await pool.connect();

    if (req.method === "GET") {
      const { rows } = await client.query(
        `
        SELECT *
        FROM equipment_projects
        WHERE LOWER(TRIM(sales_rep_email)) = $1
        ORDER BY created_at DESC
        `,
        [userEmail]
      );

      return res.status(200).json(rows);
    }

    let body = req.body;

    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        body = {};
      }
    }

    body = body && typeof body === "object" ? body : {};

    const id = safe(body.id);
    const project_name = safe(body.project_name);
    const site_address = safe(body.site_address);
    const city = safe(body.city);
    const state = safe(body.state);
    const zip_code = safe(body.zip_code);
    const sales_rep_first = safe(body.sales_rep_first);
    const sales_rep_last = safe(body.sales_rep_last);
    const sales_rep_company = safe(body.sales_rep_company);
    const sales_rep_phone = safe(body.sales_rep_phone);

    // 🔒 Force project ownership to logged-in user
    const sales_rep_email = userEmail;

    if (!project_name) {
      return res.status(400).json({ error: "Project name required" });
    }

    if (req.method === "POST") {
      const result = await client.query(
        `
        INSERT INTO equipment_projects (
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
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING id
        `,
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

    if (req.method === "PUT") {
      if (!id) {
        return res.status(400).json({ error: "Missing id for update" });
      }

      const result = await client.query(
        `
        UPDATE equipment_projects SET
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
        WHERE id = $11
        AND LOWER(TRIM(sales_rep_email)) = $12
        `,
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
          id,
          userEmail
        ]
      );

      if (result.rowCount === 0) {
        return res.status(403).json({ error: "Not authorized to update this project" });
      }

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });

  } catch (err) {
    console.error("ADMIN EQUIPMENT ERROR:", {
      message: err.message,
      code: err.code,
      detail: err.detail,
      stack: err.stack
    });

    return res.status(500).json({
      error: "Failed",
      message: err.message,
      code: err.code || ""
    });

  } finally {
    if (client) client.release();
  }
}