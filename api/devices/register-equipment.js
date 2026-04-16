import { kv } from "@vercel/kv";

const APP_ID = "equipment";

function clean(email) {
  return String(email || "").toLowerCase().trim();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-User-Email, x-user-email");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body = req.body || {};
    const email = clean(
      body.email ||
      req.headers["x-user-email"] ||
      req.headers["X-User-Email"]
    );
    const deviceToken = String(body.deviceToken || "").trim();

    if (!email || !deviceToken) {
      console.log("REGISTER EQUIPMENT FAIL:", {
        email,
        hasDeviceToken: !!deviceToken
      });
      return res.status(400).json({ error: "Missing email or deviceToken" });
    }

    const key = `device:ios:${APP_ID}:${deviceToken}`;

    await kv.set(key, {
      app: APP_ID,
      email,
      deviceToken,
      platform: "ios",
      updatedAt: Date.now()
    });

    console.log(
      "REGISTER EQUIPMENT HIT:",
      email,
      deviceToken.slice(0, 10)
    );

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("REGISTER EQUIPMENT ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
}