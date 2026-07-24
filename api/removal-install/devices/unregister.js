// FILE: /api/devices/unregister.js
// PATH: /api/devices/unregister.js

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const ALLOWED_ORIGIN = "https://espin-equipment.vercel.app";

function cleanEmail(v) {
  return String(v || "").toLowerCase().trim();
}

function cleanToken(v) {
  return String(v || "").trim();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};

    const email = cleanEmail(body.email);
    const token = cleanToken(body.deviceToken || body.token);

    if (!email || !token) {
      return res.status(400).json({ error: "Missing email or token" });
    }

    await pool.query(
      `DELETE FROM device_tokens
       WHERE email = $1
       AND token = $2`,
      [email, token]
    );

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("UNREGISTER ERROR:", err);
    return res.status(500).json({ error: "server error" });
  }
}
