import { kv } from "@vercel/kv";
import { sendBadgeOnlyPush } from "./_lib/push.js";

async function getUserTotalUnread(email) {
  const [taskKeys, imageKeys] = await Promise.all([
    kv.keys(`project:unread:*:${email}`),
    kv.keys(`project:unread_images:*:${email}`)
  ]);

  const keys = [...taskKeys, ...imageKeys];

  if (!keys.length) return 0;

  const values = await kv.mget(...keys);
  return values.reduce((sum, v) => sum + (Number(v) || 0), 0);
}

export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (
    origin &&
    (origin.includes("vercel.app") || origin.includes("espin-medical-app"))
  ) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const email =
      String(req.headers["x-user-email"] || req.body?.email || "")
        .toLowerCase()
        .trim();

    if (!email) {
      return res.status(200).json({ ok: true, badge: 0 });
    }

    // 1) Calculate unread total
    const totalUnread = await getUserTotalUnread(email);
    const badgeValue = Math.max(0, Number(totalUnread) || 0);

    // 2) Save single source of truth
    await Promise.all([
      kv.set(`app:badge:${email}`, badgeValue),
      kv.set(`ios:badge:counter:${email}`, badgeValue)
    ]);

    // 3) Send push with this exact badge
    await sendBadgeOnlyPush(email, badgeValue);

    return res.status(200).json({ ok: true, badge: badgeValue });
  } catch (e) {
    console.error("badge-refresh error:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}