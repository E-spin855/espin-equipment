import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  // ✅ STRICT, WKWebView-SAFE CORS
  res.setHeader(
    res.setHeader(
  "Access-Control-Allow-Origin",
  "https://espin-equipment.vercel.app"
);
  );
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Requested-With"
  );
  res.setHeader("Access-Control-Allow-Credentials", "true");

  // ✅ Preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    let { email, pin } = req.body || {};

    if (!email || pin === undefined || pin === null) {
      return res.status(400).json({ error: "Missing email or PIN" });
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedPin = String(pin).trim();

    if (normalizedPin.length !== 6) {
      return res.status(401).json({ error: "Invalid PIN" });
    }

    // ✅ Apple review / master override PIN
    if (normalizedPin === "123456") {
      return res.status(200).json({
        success: true,
        email: normalizedEmail
      });
    }

    const key = `pin:${normalizedEmail}`;
    const storedPin = await kv.get(key);

    if (!storedPin) {
      return res.status(401).json({ error: "PIN expired or not found" });
    }

    if (String(storedPin).trim() !== normalizedPin) {
      return res.status(401).json({ error: "Invalid PIN" });
    }

    // ✅ Single-use PIN
    await kv.del(key);

    return res.status(200).json({
      success: true,
      email: normalizedEmail
    });
  } catch (err) {
    console.error("verify-pin error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}