import { kv } from "@vercel/kv";

const APP_ID = "equipment";

function cleanEmail(v) {
  return String(v || "").toLowerCase().trim();
}

async function sumKeys(keys) {
  if (!Array.isArray(keys) || !keys.length) return 0;
  const values = await kv.mget(...keys);
  return values.reduce((sum, v) => sum + (Number(v) || 0), 0);
}

async function getUserTotalUnread(email) {
  const userEmail = cleanEmail(email);
  if (!userEmail) return 0;

  const [projectKeys, imageKeys] = await Promise.all([
    kv.keys(`equipment:unread:project:*:${userEmail}`),
    kv.keys(`equipment:unread:images:*:${userEmail}`)
  ]);

  const [projectTotal, imageTotal] = await Promise.all([
    sumKeys(projectKeys),
    sumKeys(imageKeys)
  ]);

  return projectTotal + imageTotal;
}

export default async function handler(req, res) {
  const origin = req.headers.origin;

  if (
    origin &&
    (origin.includes("vercel.app") || origin.includes("espin-equipment"))
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
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
    const email = cleanEmail(req.headers["x-user-email"] || req.body?.email);

    if (!email) {
      return res.status(200).json({ ok: true, badge: 0 });
    }

    const badgeValue = await getUserTotalUnread(email);

    await Promise.all([
      kv.set(`app:badge:${APP_ID}:${email}`, badgeValue),
      kv.set(`ios:badge:counter:${email}`, badgeValue)
    ]);

    return res.status(200).json({
      ok: true,
      badge: badgeValue
    });
  } catch (e) {
    console.error("badge-refresh-equipment error:", e);
    return res.status(500).json({
      ok: false,
      error: e.message || "Failed to refresh badge"
    });
  }
}