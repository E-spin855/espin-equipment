import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  // CORS
  const origin = req.headers.origin;
  if (origin && (origin.includes("vercel.app") || origin.includes("espin-medical-app"))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { key, value } = req.body;
    if (!key) return res.status(400).json({ error: "Missing key" });

    /* ───────────────────────────────
       PROTECT BADGE KEYS (CRITICAL)
       Frontend must NEVER overwrite counters
    ─────────────────────────────── */
    const protectedPrefixes = [
      "project:unread:",
      "project:unread_images:",
      "stats:total_unread:",
      "user:badge_total:",
      "app:badge:",
      "ios:badge:"
    ];

    if (protectedPrefixes.some(prefix => key.startsWith(prefix))) {
      return res.status(403).json({
        error: "Write blocked for protected badge key"
      });
    }

    // Normal KV write (non-badge keys only)
    const valToSave = isNaN(value) ? value : Number(value);
    await kv.set(key, valToSave);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("KV Set Error:", err);
    return res.status(500).json({ error: "Database write failed" });
  }
}
