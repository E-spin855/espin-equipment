import { kv } from "@vercel/kv";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const TEST_MODE = true; // 🔥 TOGGLE

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  let pin;

  try {
    const { email, deviceToken, platform } = req.body;
    if (!email) return res.status(400).json({ error: "Missing email" });

    const normalizedEmail = email.trim().toLowerCase();

    // ===============================
    // REGISTER DEVICE
    // ===============================
    if (deviceToken && (platform === "ios" || platform === "android")) {
      const prefix = platform === "android"
        ? "device:android:equipment:"
        : "device:ios:equipment:";

      const existingKeys = await kv.keys(prefix + "*");

      if (existingKeys.length) {
        const records = await kv.mget(...existingKeys);
        const keysToDelete = [];

        for (let i = 0; i < existingKeys.length; i++) {
          const rec = records[i];
          if (
            rec &&
            typeof rec === "object" &&
            String(rec.email || "").trim().toLowerCase() === normalizedEmail
          ) {
            keysToDelete.push(existingKeys[i]);
          }
        }

        if (keysToDelete.length) {
          await kv.del(...keysToDelete);
        }
      }

      await kv.set(prefix + deviceToken, {
        deviceToken,
        platform,
        email: normalizedEmail,
        updatedAt: Date.now()
      });
    }

    // ===============================
    // TEST MODE PIN (BYPASS)
    // ===============================
    if (TEST_MODE) {
      pin = "123456";

      await kv.set(`pin:${normalizedEmail}`, pin, { ex: 600 });

      return res.status(200).json({
        success: true,
        test: true,
        pin // optional, remove if you don’t want it exposed
      });
    }

    // ===============================
    // NORMAL PIN LOGIC
    // ===============================
    const pinKey = `pin:${normalizedEmail}`;
    pin = await kv.get(pinKey);

    if (!pin) {
      pin = Math.floor(100000 + Math.random() * 900000).toString();
      await kv.set(pinKey, pin, { ex: 600 });
    }

    // ===============================
    // SEND EMAIL
    // ===============================
    const { error } = await resend.emails.send({
      from: "Espin Medical <info@espinmedical.com>",
      to: normalizedEmail,
      subject: "Your Espin Medical Login PIN",
      html: `
        <div style="font-family: sans-serif; text-align: center; padding: 20px;">
          <h2>Login Verification</h2>
          <div style="font-size: 32px; font-weight: bold; color: #0066B2;">${pin}</div>
          <p>This code expires in 10 minutes.</p>
        </div>
      `
    });

    if (error) throw error;

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("PIN Error:", err);

    if (err?.name === "daily_quota_exceeded") {
      return res.status(200).json({
        success: true,
        debug_pin: pin
      });
    }

    return res.status(500).json({
      error: err.message || "Internal server error"
    });
  }
}