import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  const origin = req.headers.origin || "";

  if (
    origin &&
    (
      origin.includes("vercel.app") ||
      origin.includes("espin-medical-app") ||
      origin.includes("espin-equipment") ||
      origin.includes("espinmedical.com")
    )
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "*");
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : (req.body || {});

    const key = String(body.key || "").trim();
    const value = body.value;

    if (!key) {
      return res.status(400).json({ error: "Missing key" });
    }

    const protectedPrefixes = [
      "project:unread:",
      "project:unread_images:",
      "stats:total_unread:",
      "user:badge_total:",
      "app:badge:",
      "ios:badge:",
      "equipment:unread:project:",
      "equipment:unread:details:",
      "equipment:unread:images:",
      "app:badge:equipment:",
      "ios:badge:counter:equipment:"
    ];

    if (protectedPrefixes.some(prefix => key.startsWith(prefix))) {
      return res.status(403).json({
        error: "Write blocked for protected badge key"
      });
    }

    let valToSave = value;

    if (typeof value === "string") {
      const trimmed = value.trim();

      if (trimmed === "") {
        await kv.del(key);
        return res.status(200).json({ ok: true, deleted: true });
      }

      if (!Number.isNaN(Number(trimmed)) && trimmed !== "") {
        valToSave = Number(trimmed);
      }
    } else if (typeof value === "number") {
      valToSave = value;
    }

    await kv.set(key, valToSave);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("KV Set Error:", err);
    return res.status(500).json({ error: "Database write failed" });
  }
}