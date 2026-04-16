import { kv } from "@vercel/kv";

function clean(v) {
  return String(v || "").toLowerCase().trim();
}

async function sumKeys(keys) {
  if (!Array.isArray(keys) || !keys.length) return 0;
  const values = await kv.mget(...keys);
  return values.reduce((sum, v) => sum + (Number(v) || 0), 0);
}

async function recomputeTotal(userEmail) {
  const email = clean(userEmail);

  const [projectKeys, detailsKeys, imageKeys] = await Promise.all([
    kv.keys(`equipment:unread:project:*:${email}`),
    kv.keys(`equipment:unread:details:*:*:${email}`),
    kv.keys(`equipment:unread:images:*:*:${email}`)
  ]);

  const [projectTotal, detailsTotal, imageTotal] = await Promise.all([
    sumKeys(projectKeys),
    sumKeys(detailsKeys),
    sumKeys(imageKeys)
  ]);

  const total = projectTotal + detailsTotal + imageTotal;

  await Promise.all([
    kv.set(`app:badge:equipment:${email}`, total),
    kv.set(`ios:badge:counter:equipment:${email}`, total)
  ]);

  return {
    total,
    projectTotal,
    detailsTotal,
    imageTotal
  };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-user-email, x-useremail, x-user_email"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const userEmail = clean(
      req.headers["x-user-email"] ||
      req.headers["x-useremail"] ||
      req.headers["x-user_email"] ||
      req.body?.email
    );

    const projectId = String(req.body?.projectId || "").trim();
    const type = String(req.body?.type || "all").toLowerCase().trim();

    if (!userEmail || !projectId) {
      return res.status(400).json({ error: "Missing email or projectId" });
    }

    let projectKeys = [];
    let detailsKeys = [];
    let imageKeys = [];

    if (type === "project" || type === "all") {
      projectKeys = await kv.keys(`equipment:unread:project:${projectId}:${userEmail}`);
    }

    if (type === "details" || type === "all") {
      detailsKeys = await kv.keys(`equipment:unread:details:${projectId}:*:${userEmail}`);
    }

    if (type === "images" || type === "all") {
      imageKeys = await kv.keys(`equipment:unread:images:${projectId}:*:${userEmail}`);
    }

    const keysToDelete = [...projectKeys, ...detailsKeys, ...imageKeys];

    if (keysToDelete.length) {
      await kv.del(...keysToDelete);
    }

    const totals = await recomputeTotal(userEmail);

    return res.status(200).json({
      ok: true,
      projectId,
      type,
      cleared: keysToDelete.length,
      deletedKeys: keysToDelete,
      ...totals
    });
  } catch (e) {
    console.error("equipment-project-mark-read error:", e);
    return res.status(500).json({
      ok: false,
      error: e.message || "Failed to mark equipment project read"
    });
  }
}