import { Pool } from "pg";

/**
 * DB connection (Neon pooled)
 */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/**
 * Admin emails (global override)
 */
const ADMIN_EMAILS = process.env.ADMIN_EMAILS
  ? process.env.ADMIN_EMAILS.split(",").map(e => e.trim().toLowerCase())
  : [];

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { email } = req.body || {};

  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Email required" });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    /**
     * 1️⃣ Admin always allowed
     */
    if (ADMIN_EMAILS.includes(normalizedEmail)) {
      return res.status(200).json({
        ok: true,
        email: normalizedEmail,
        role: "admin"
      });
    }

    /**
     * 2️⃣ Check if email exists on ANY project
     */
    const { rows } = await pool.query(
      `
      SELECT 1
      FROM projects
      WHERE $1 = ANY(authorized_emails)
      LIMIT 1
      `,
      [normalizedEmail]
    );

    if (!rows.length) {
      return res.status(401).json({
        ok: false,
        error: "Not authorized for any projects"
      });
    }

    /**
     * 3️⃣ Authorized user
     */
    return res.status(200).json({
      ok: true,
      email: normalizedEmail,
      role: "user"
    });

  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
}
