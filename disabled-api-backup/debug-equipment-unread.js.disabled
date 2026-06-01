import { kv } from "@vercel/kv";

function clean(v) {
  return String(v || "").toLowerCase().trim();
}

async function withValues(keys) {
  if (!keys.length) return [];
  const values = await kv.mget(...keys);
  return keys.map((key, i) => ({
    key,
    value: Number(values[i]) || 0
  }));
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

  if (!email) {
    return res.status(400).json({ error: "Missing email" });
  }

  try {
    const projectPattern = projectId
      ? `equipment:unread:project:${projectId}:${email}`
      : `equipment:unread:project:*:${email}`;

    const detailsPattern = projectId
      ? `equipment:unread:details:${projectId}:*:${email}`
      : `equipment:unread:details:*:*:${email}`;

    const imagePattern = projectId
      ? `equipment:unread:images:${projectId}:*:${email}`
      : `equipment:unread:images:*:*:${email}`;

    const [projectKeys, detailsKeys, imageKeys] = await Promise.all([
      kv.keys(projectPattern),
      kv.keys(detailsPattern),
      kv.keys(imagePattern)
    ]);

    const [projects, details, images] = await Promise.all([
      withValues(projectKeys),
      withValues(detailsKeys),
      withValues(imageKeys)
    ]);

    const appBadge = Number(await kv.get(`app:badge:equipment:${email}`)) || 0;
    const iosBadge = Number(await kv.get(`ios:badge:counter:equipment:${email}`)) || 0;

    return res.status(200).json({
      ok: true,
      email,
      projectId: projectId || null,
      appBadge,
      iosBadge,
      projects,
      details,
      images
    });
  } catch (err) {
    console.error("debug-equipment-unread error:", err);
    return res.status(500).json({
      ok: false,
      error: err.message || "Failed to inspect unread keys"
    });
  }
}