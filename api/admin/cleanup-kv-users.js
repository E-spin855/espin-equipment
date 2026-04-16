import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { keep = [] } = req.body || {};

    const keepSet = new Set(
      (keep || []).map(e => String(e).toLowerCase().trim())
    );

    const patterns = [
      "app:badge:equipment:*",
      "ios:badge:counter:equipment:*",
      "equipment:unread:project:*",
      "equipment:unread:details:*:*",
      "equipment:unread:images:*:*"
    ];

    let deleted = [];

    for (const pattern of patterns) {
      const keys = await kv.keys(pattern);

      for (const key of keys) {
        const email = key.split(":").pop();

        if (!keepSet.has(email)) {
          await kv.del(key);
          deleted.push(key);
        }
      }
    }

    return res.status(200).json({
      success: true,
      deletedCount: deleted.length,
      deleted
    });

  } catch (e) {
    console.error("cleanup error:", e);
    return res.status(500).json({ error: "Cleanup failed" });
  }
}