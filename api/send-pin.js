import { kv } from "@vercel/kv";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

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

    // ===============================
    // REGISTER DEVICE (Safety Net)
    // ===============================
    if (deviceToken && platform === "ios") {
      // Cleanup old registrations for this token
      const existingKeys = await kv.keys(`device:ios:${deviceToken}*`);
      if (existingKeys.length > 0) {
        await kv.del(...existingKeys);
      }

      await kv.set(`device:ios:${deviceToken}`, {
        deviceToken,
        platform: "ios",
        email: normalizedEmail,
        updatedAt: Date.now()
      });
    }

    // ===============================
    // PIN LOGIC
    // ===============================
    const pinKey = `pin:${normalizedEmail}`;
    let pin = await kv.get(pinKey);

    if (!pin) {
      pin = Math.floor(100000 + Math.random() * 900000).toString();
      await kv.set(pinKey, pin, { ex: 600 }); // 10 minute expiry
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
    return res.status(500).json({ error: "Internal server error" });
  }
}