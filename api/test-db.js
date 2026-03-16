import { Pool } from "pg";

export default async function handler(req, res) {

  try {

    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });

    const result = await pool.query("SELECT NOW()");

    return res.status(200).json({
      ok: true,
      time: result.rows[0]
    });

  } catch (err) {

    return res.status(500).json({
      error: err.message
    });

  }

}