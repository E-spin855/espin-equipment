import { kv } from "@vercel/kv";

function clean(email) {
  return String(email || "").toLowerCase().trim();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-User-Email");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    console.log("🔥 BODY:", req.body);
    console.log("🔥 HEADER EMAIL:", req.headers["x-user-email"]);
    console.log("🔥 KV URL:", process.env.KV_REST_API_URL);

    const body = req.body || {};

    const email = clean(body.email || req.headers["x-user-email"]);
    const deviceToken = String(body.deviceToken || "").trim();
    const platform = String(body.platform || "").toLowerCase();

    if (!email || !deviceToken || !platform) {
      console.log("❌ REGISTER FAIL:", { email, deviceToken, platform });
      return res.status(400).json({ error: "Missing email, deviceToken, or platform" });
    }

    const prefix =
      platform === "android"
        ? "device:android:"
        : "device:ios:";

    const key = prefix + deviceToken;

    console.log("🔥 KV KEY:", key);

    await kv.set(key, {
      email,
      deviceToken,
      platform,
      updatedAt: Date.now()
    });

    // 🔥 THIS IS THE ONLY LINE THAT MATTERS
    const verify = await kv.get(key);
    console.log("🔥 KV VERIFY:", verify);

    console.log("✅ REGISTER HIT:", {
      email,
      platform,
      token: deviceToken.slice(0, 12)
    });

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("💥 REGISTER ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
}