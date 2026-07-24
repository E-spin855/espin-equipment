// FILE: /api/kv-set.js
// PATH: /api/kv-set.js

import { kv } from "@vercel/kv";

function clean(v) {
  return String(v || "").toLowerCase().trim();
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");
}

export default async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const email = clean(req.headers["x-user-email"]);

  if (!email) {
    return res.status(401).json({ error: "Missing user email" });
  }

  const body =
    typeof req.body === "string"
      ? JSON.parse(req.body || "{}")
      : req.body || {};

  const key = String(body.key || "").trim();
  const value = body.value;

  if (!key) {
    return res.status(400).json({ error: "Missing key" });
  }

  const allowedPrefixes = [
    "project:unread:",
    "project:unread_images:",
    "project:last_seen:",
    "project:last_seen_images:",
    "project:badges_details:",
    "project:badges_images:",
    "ios:badge:counter:"
  ];

  const allowed = allowedPrefixes.some(prefix => key.startsWith(prefix));

  if (!allowed) {
    return res.status(403).json({ error: "KV key not allowed" });
  }

  if (!key.endsWith(`:${email}`)) {
    return res.status(403).json({ error: "KV key does not belong to user" });
  }

  try {
    await kv.set(key, value);
    return res.status(200).json({ ok: true, key, value });
  } catch (err) {
    console.error("kv-set error:", err);
    return res.status(500).json({ error: "KV write failed" });
  }
}
