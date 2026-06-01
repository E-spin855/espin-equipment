// FILE: /api/kv-set.js
// PATH: /api/kv-set.js

import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  const origin = req.headers.origin || "";

  const allowedOrigins = new Set([
    "https://espinmedical.com",
    "https://www.espinmedical.com",
    "https://espin-medical-app.vercel.app",
    "https://espin-equipment.vercel.app"
  ]);

  if (allowedOrigins.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (!allowedOrigins.has(origin)) {
    return res.status(403).json({ error: "Origin not allowed" });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const userEmail = String(req.headers["x-user-email"] || "")
      .toLowerCase()
      .trim();

    if (!userEmail || !userEmail.includes("@")) {
      return res.status(401).json({ error: "Unauthorized" });
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

    function allowedWriteKey(key, email) {
      const allowedExact = [
        `user:settings:${email}`,
        `user:last_seen:${email}`
      ];

      const allowedPrefixes = [
        `project:draft:${email}:`,
        `equipment:draft:${email}:`,
        `user:local_state:${email}:`
      ];

      return (
        allowedExact.includes(key) ||
        allowedPrefixes.some(prefix => key.startsWith(prefix))
      );
    }

    if (!allowedWriteKey(key, userEmail)) {
      return res.status(403).json({ error: "Forbidden key" });
    }

    let valToSave = value;

    if (typeof value === "string") {
      const trimmed = value.trim();

      if (trimmed === "") {
        await kv.del(key);
        return res.status(200).json({ ok: true, deleted: true });
      }

      if (!Number.isNaN(Number(trimmed))) {
        valToSave = Number(trimmed);
      } else {
        valToSave = trimmed;
      }
    }

    await kv.set(key, valToSave);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("KV Set Error:", err);
    return res.status(500).json({ error: "Database write failed" });
  }
}