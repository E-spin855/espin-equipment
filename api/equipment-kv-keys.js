import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const pattern = String(req.query.pattern || "").trim();

    if (!pattern) {
      return res.status(400).json({ error: "Missing pattern" });
    }

    const keys = await kv.keys(pattern);

    return res.status(200).json(keys);
  } catch (err) {
    console.error("equipment-kv-keys error:", err);
    return res.status(500).json({ error: "Failed to fetch keys" });
  }
}