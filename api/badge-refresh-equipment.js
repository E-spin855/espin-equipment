import { kv } from "@vercel/kv";

function clean(v) {
  return String(v || "").toLowerCase().trim();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).end();

  try {
    const email = clean(req.headers["x-user-email"] || req.body?.email);
    if (!email) return res.status(400).json({ error: "Missing email" });

    const [projectKeys, detailsKeys, imageKeys] = await Promise.all([
      kv.keys(`equipment:unread:project:*:${email}`),
      kv.keys(`equipment:unread:details:*:*:${email}`),
      kv.keys(`equipment:unread:images:*:*:${email}`)
    ]);

    const allKeys = [
      ...projectKeys,
      ...detailsKeys,
      ...imageKeys
    ];

    // ✅ clear ALL unread counters
    if (allKeys.length) {
      await kv.del(...allKeys);
    }

    // ✅ reset app + iOS badge
    await kv.set(`app:badge:equipment:${email}`, 0);
    await kv.set(`ios:badge:counter:equipment:${email}`, 0);

    return res.status(200).json({
      ok: true,
      cleared: allKeys.length
    });

  } catch (e) {
    console.error("badge-reset-equipment error:", e);
    return res.status(500).json({ ok: false });
  }
}