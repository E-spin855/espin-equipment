// FILE: /api/kv-set.js
// PATH: /api/kv-set.js

import { kv } from "@vercel/kv";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email, x-useremail");
}

function clean(v) {
  return String(v || "").trim();
}

export default async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const key = clean(req.body?.key);

    if (!key) {
      return res.status(400).json({ error: "Missing key" });
    }

    const value = req.body?.value;

    await kv.set(key, value);

    return res.status(200).json({
      ok: true,
      key
    });

  } catch (err) {
    console.error("kv-set error:", err);
    return res.status(500).json({
      ok: false,
      error: "KV set failed"
    });
  }
}