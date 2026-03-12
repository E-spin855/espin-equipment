import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  const { key } = req.query;

  if (!key) return res.status(400).json({ error: "Missing key" });

  await kv.del(key);

  res.json({ deleted: key });
}