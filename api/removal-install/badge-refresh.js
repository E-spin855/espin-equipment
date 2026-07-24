import { kv } from "@vercel/kv";
import { sendBadgeOnlyPush } from "./_lib/push.js";

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
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const email =
      String(req.headers["x-user-email"] || req.body?.email || "")
        .toLowerCase()
        .trim();

    if (!email) {
      return res.status(200).json({ ok: true, badge: 0 });
    }

    console.log("🔥 RESET HIT:", email);

    const userKey = `ios:badge:counter:${email}`;
    const globalKey = `ios:badge:counter:global:${email}`;
    const appKey = `app:badge:${email}`;

    // 🔍 BEFORE STATE
    const beforeUser = await kv.get(userKey);
    const beforeGlobal = await kv.get(globalKey);
    const beforeApp = await kv.get(appKey);

    console.log("BEFORE RESET:", {
      userKey,
      beforeUser,
      globalKey,
      beforeGlobal,
      appKey,
      beforeApp
    });

    // 🔥 HARD RESET (ALL POSSIBLE SOURCES)
    await kv.set(userKey, 0);
    await kv.set(globalKey, 0);
    await kv.set(appKey, 0);

    // 🔍 AFTER STATE
    const afterUser = await kv.get(userKey);
    const afterGlobal = await kv.get(globalKey);
    const afterApp = await kv.get(appKey);

    console.log("AFTER RESET:", {
      userKey,
      afterUser,
      globalKey,
      afterGlobal,
      appKey,
      afterApp
    });

    // 🔥 FORCE DEVICE UPDATE
    await sendBadgeOnlyPush(email, 0);

    return res.status(200).json({
      ok: true,
      badge: 0
    });

  } catch (e) {
    console.error("badge-refresh error:", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
}