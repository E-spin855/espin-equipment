import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { projectId } = req.body || {};
  if (!projectId) {
    return res.status(400).json({ error: "Missing projectId" });
  }

  try {
    await kv.del(`proj:changed:${projectId}`);
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: "Failed to clear changes" });
  }
}
