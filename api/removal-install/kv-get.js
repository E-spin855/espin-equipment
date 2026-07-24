// FILE: /api/kv-get.js
// PATH: /api/kv-get.js

import { kv } from "@vercel/kv";

function clean(v) {
  return String(v || "").toLowerCase().trim();
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");
}

export default async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const email = clean(req.headers["x-user-email"]);
  const body =
    typeof req.body === "string"
      ? JSON.parse(req.body || "{}")
      : req.body || {};
  const key = String(req.query.key || body.key || "").trim();

  if (!email) {
    return res.status(401).json({ error: "Missing user email" });
  }

  if (!key) {
    return res.status(400).json({ error: "Missing key" });
  }

  /*
    Basic safety:
    Only allow project unread-style keys from the current app.
    This prevents this endpoint from becoming a general KV reader.
  */
  const allowedPrefixes = [
    "project:unread:",
    "project:unread_images:",
    "project:last_seen:",
    "project:last_seen_images:",
    "project:badges_details:",
    "project:badges_images:"
  ];

  const allowed = allowedPrefixes.some(prefix => key.startsWith(prefix));

  if (!allowed) {
    return res.status(403).json({ error: "KV key not allowed" });
  }

  /*
    Optional user-key check:
    Your current unread keys end with :email
    project:unread:${projectId}:${email}
  */
  if (!key.endsWith(`:${email}`)) {
    return res.status(403).json({ error: "KV key does not belong to user" });
  }

  try {
    const value = await kv.get(key);
    return res.status(200).json({ ok: true, key, value });
  } catch (err) {
    console.error("kv-get error:", err);
    return res.status(500).json({ error: "KV read failed" });
  }
}
