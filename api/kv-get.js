import { kv } from "@vercel/kv";

export const config = {
  runtime: "nodejs",
};

export default async function handler(req, res) {
  /* ───── RELAXED CORS HEADERS ───── */
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400"); // Tells browser to cache this "permission" for 24hrs

  /* ───── 1. HANDLE PREFLIGHT ───── */
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    /* ───── 2. GET KEY FROM ANYWHERE ───── */
    // Checks URL params first (?key=...), then the JSON body
    let key = req.query.key;

    if (!key && req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      key = body?.key;
    }

    /* ───── 3. VALIDATION ───── */
    if (!key) {
      return res.status(200).json({ value: 0, error: "No key provided" });
    }

    /* ───── 4. KV READ ───── */
    const value = await kv.get(key);

    return res.status(200).json({
      value: value ?? 0
    });

  } catch (err) {
    console.error("KV Error:", err);
    return res.status(200).json({ value: 0, error: "Internal error" });
  }
}