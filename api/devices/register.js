import { kv } from "@vercel/kv";

function clean(email) {
  return String(email || "").toLowerCase().trim();
}

export default async function handler(req, res) {
  /* CORS */
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-User-Email");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = req.body || {};
    const email = clean(body.email || req.headers["x-user-email"]);
    const deviceToken = body.deviceToken;

    if (!email || !deviceToken) {
      console.log("REGISTER FAIL:", { email, deviceToken });
      return res.status(400).json({ error: "Missing email or deviceToken" });
    }

    const key = `device:ios:${deviceToken}`;

    await kv.set(key, {
      email,
      deviceToken,
      platform: "ios",
      updatedAt: Date.now()
    });

    console.log("REGISTER HIT:", email, deviceToken.substring(0, 10));

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("REGISTER ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
}