import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { email, deviceToken, platform } = req.body;
    if (!email) return res.status(400).json({ error: "Missing email" });

    const normalizedEmail = email.trim().toLowerCase();

    // REGISTER DEVICE
    if (deviceToken && platform === "ios") {
      await kv.set(`device:ios:${deviceToken}`, {
        deviceToken,
        platform: "ios",
        email: normalizedEmail,
        updatedAt: Date.now()
      });
    }

    // APP REVIEW PIN
    const pinKey = `pin:${normalizedEmail}`;
    await kv.set(pinKey, "123456", { ex: 600 });

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("PIN Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}