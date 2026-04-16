import { kv } from "@vercel/kv";

function clean(v) {
  return String(v || "").toLowerCase().trim();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email, x-useremail, x-user_email");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const email = clean(
      req.headers["x-user-email"] ||
      req.headers["x-useremail"] ||
      req.headers["x-user_email"] ||
      req.body?.email
    );

    if (!email) {
      return res.status(400).json({ error: "Missing email" });
    }

    await kv.set(`ios:badge:counter:equipment:${email}`, 0);

    return res.status(200).json({
      ok: true,
      email,
      iosBadge: 0
    });
  } catch (err) {
    console.error("ios-clear-badge-equipment error:", err);
    return res.status(500).json({
      ok: false,
      error: err?.message || "Failed to clear iOS badge"
    });
  }
}