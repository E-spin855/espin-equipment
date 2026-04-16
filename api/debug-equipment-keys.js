import { kv } from "@vercel/kv";

function clean(v) {
  return String(v || "").toLowerCase().trim();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const email = clean(req.query.email || req.headers["x-user-email"]);
  const projectId = String(req.query.projectId || "").trim();

  if (!email || !projectId) {
    return res.status(400).json({ error: "Missing email or projectId" });
  }

  try {
    const [changedKeys, projectUnreadKeys, detailsUnreadKeys, imageUnreadKeys] = await Promise.all([
      kv.keys(`equipment:changed:${projectId}:*`),
      kv.keys(`equipment:unread:project:${projectId}:${email}`),
      kv.keys(`equipment:unread:details:${projectId}:*:${email}`),
      kv.keys(`equipment:unread:images:${projectId}:*:${email}`)
    ]);

    const allKeys = [
      ...changedKeys,
      ...projectUnreadKeys,
      ...detailsUnreadKeys,
      ...imageUnreadKeys
    ];

    const values = allKeys.length ? await kv.mget(...allKeys) : [];

    const mapped = allKeys.map((key, i) => ({
      key,
      value: values[i]
    }));

    return res.status(200).json({
      ok: true,
      changedKeys,
      projectUnreadKeys,
      detailsUnreadKeys,
      imageUnreadKeys,
      mapped
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message || "Debug failed"
    });
  }
}