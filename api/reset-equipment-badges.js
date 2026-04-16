import { kv } from "@vercel/kv";

function clean(v) {
  return String(v || "").toLowerCase().trim();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const email = clean(
    req.query?.email ||
    req.body?.email ||
    "info@espinmedical.com"
  );

  if (!email) {
    return res.status(400).json({ error: "Missing email" });
  }

  try {
    const [projectKeys, detailsKeys, imageKeys] = await Promise.all([
      kv.keys(`equipment:unread:project:*:${email}`),
      kv.keys(`equipment:unread:details:*:*:${email}`),
      kv.keys(`equipment:unread:images:*:*:${email}`)
    ]);

    const exactKeys = [
      `app:badge:equipment:${email}`,
      `ios:badge:counter:equipment:${email}`
    ];

    const allKeys = [...exactKeys, ...projectKeys, ...detailsKeys, ...imageKeys];

    if (allKeys.length) {
      await kv.del(...allKeys);
    }

    await Promise.all([
      kv.set(`app:badge:equipment:${email}`, 0),
      kv.set(`ios:badge:counter:equipment:${email}`, 0)
    ]);

    return res.status(200).json({
      success: true,
      email,
      deletedCount: allKeys.length,
      deletedKeys: allKeys
    });
  } catch (err) {
    console.error("reset-equipment-badges error:", err);
    return res.status(500).json({
      error: err?.message || "Failed to reset equipment badges"
    });
  }
}