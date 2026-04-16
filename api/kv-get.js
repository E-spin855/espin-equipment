import { kv } from "@vercel/kv";

export const config = {
  runtime: "nodejs",
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    let key = req.query.key;

    if (!key && req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
      key = body?.key;
    }

    key = String(key || "").trim();

    if (!key) {
      return res.status(400).json({
        ok: false,
        value: null,
        error: "No key provided"
      });
    }

    const value = await kv.get(key);

    return res.status(200).json({
      ok: true,
      value: value === undefined ? null : value
    });
  } catch (err) {
    console.error("KV Error:", err);
    return res.status(500).json({
      ok: false,
      value: null,
      error: err?.message || "Internal error"
    });
  }
}