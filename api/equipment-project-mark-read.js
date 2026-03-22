import { kv } from "@vercel/kv";
import { sendBadgeOnlyPush } from "./_lib/push.js";

function clean(email) {
  return String(email || "").toLowerCase().trim();
}

async function recomputeUserBadge(email) {
  const [dataKeys, imageKeys] = await Promise.all([
    kv.keys(`project:unread:*:${email}`),
    kv.keys(`project:unread_images:*:${email}`)
  ]);

  const keys = [...dataKeys, ...imageKeys];

  if (!keys.length) return 0;

  const values = await kv.mget(...keys);
  return values.reduce((sum, v) => sum + (Number(v) || 0), 0);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const userEmail = clean(req.headers["x-user-email"]);
  const source = (req.headers["x-clear-source"] || "").toLowerCase();

  const body =
    typeof req.body === "string"
      ? JSON.parse(req.body)
      : req.body || {};

  const projectId = body.projectId;
  const type = body.type; // "tasks" | "images"

  console.log("MARK-READ", { userEmail, projectId, type, source });

  /* ───────── HARD BLOCKS (SINGLE SOURCE ONLY) ───────── */

  if (source !== "management") {
    console.log("BLOCKED: not management");
    return res.json({ ok: true });
  }

  if (!userEmail || !projectId) {
    return res.status(400).json({ error: "Missing parameters" });
  }

  if (type !== "tasks" && type !== "images") {
    console.log("BLOCKED: invalid type");
    return res.json({ ok: true });
  }

  try {
    /* ───────── CLEAR ONLY UNREAD COUNTERS (NEW pills untouched) ───────── */

    if (type === "tasks") {
      await kv.del(`project:unread:${projectId}:${userEmail}`);
    }

    if (type === "images") {
      await kv.del(`project:unread_images:${projectId}:${userEmail}`);
    }

    /* ───────── RECOMPUTE GLOBAL BADGE TOTAL ───────── */

    const total = await recomputeUserBadge(userEmail);

    await Promise.all([
      kv.set(`app:badge:${userEmail}`, total),
      kv.set(`ios:badge:counter:${userEmail}`, total)
    ]);

    /* ───────── PUSH BADGE UPDATE (EXPLICIT VALUE) ───────── */

    await sendBadgeOnlyPush(userEmail, total);

    return res.json({ ok: true, badge: total });

  } catch (e) {
    console.error("mark-read error:", e);
    return res.status(500).json({ error: e.message });
  }
}