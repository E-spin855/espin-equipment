import { kv } from "@vercel/kv";

function clean(v) {
  return String(v || "").toLowerCase().trim();
}

async function readCounts(keys) {
  if (!Array.isArray(keys) || !keys.length) return [];
  return kv.mget(...keys);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userEmail = clean(req.headers["x-user-email"] || req.query?.email);
  const projectId = String(req.query?.projectId || "").trim();

  if (!userEmail) {
    return res.status(400).json({ error: "Missing user email" });
  }

  try {
    const projectPattern = projectId
      ? `equipment:unread:project:${projectId}:${userEmail}`
      : `equipment:unread:project:*:${userEmail}`;

    const imagePattern = projectId
      ? `equipment:unread:images:${projectId}:*:${userEmail}`
      : `equipment:unread:images:*:${userEmail}`;

    const [projectKeys, imageKeys] = await Promise.all([
      kv.keys(projectPattern),
      kv.keys(imagePattern)
    ]);

    const [projectValues, imageValues] = await Promise.all([
      readCounts(projectKeys),
      readCounts(imageKeys)
    ]);

    const projects = {};
    const images = {};
    let total = 0;

    projectKeys.forEach((key, i) => {
      const count = Number(projectValues[i]) || 0;
      if (count <= 0) return;

      const parts = String(key).split(":");
      const pid = parts[3];
      if (!pid) return;

      projects[pid] = count;
      total += count;
    });

    imageKeys.forEach((key, i) => {
      const count = Number(imageValues[i]) || 0;
      if (count <= 0) return;

      const parts = String(key).split(":");
      const pid = parts[3];
      const modalityId = parts[4];
      if (!pid || !modalityId) return;

      const compound = `${pid}:${modalityId}`;
      images[compound] = count;
      total += count;
    });

    return res.status(200).json({
      ok: true,
      total,
      projects,
      images
    });
  } catch (err) {
    console.error("equipment-updates error:", err);
    return res.status(500).json({ error: "Failed to load equipment updates" });
  }
}