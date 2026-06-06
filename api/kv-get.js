// FILE: /api/kv-get.js
// PATH: /api/kv-get.js

import { kv } from "@vercel/kv";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const key =
      req.method === "GET"
        ? clean(req.query?.key)
        : clean(req.body?.key);

    if (!key) {
      return res.status(400).json({ error: "Missing key" });
    }

    const value = await kv.get(key);

    return res.status(200).json({
      ok: true,
      key,
      value
    });

  } catch (err) {
    console.error("kv-get error:", err);
    return res.status(500).json({
      ok: false,
      error: "KV get failed"
    });
  }
}