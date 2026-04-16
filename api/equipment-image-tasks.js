// FILE: /api/equipment-photos/tasks.js
// PATH: /api/equipment-photos/tasks.js

import { Pool } from "pg";
import { kv } from "@vercel/kv";
import { sendBadgeOnlyPush } from "./_lib/push-equipment.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function clean(email) {
  return String(email || "").toLowerCase().trim();
}

function uniq(list) {
  return Array.from(
    new Set((list || []).map(e => clean(e)).filter(Boolean))
  );
}

async function recomputeUserBadge(email) {
  const e = clean(email);

  const keys = await kv.keys(`equipment:unread:*:*:*:${e}`);
  const values = keys.length ? await kv.mget(...keys) : [];

  const total = values.reduce((sum, v) => sum + (Number(v) || 0), 0);

  await Promise.all([
    kv.set(`app:badge:equipment:${e}`, total),
    kv.set(`ios:badge:counter:equipment:${e}`, total)
  ]);

  return total;
}

async function getRecipients(projectId) {
  const keys = await kv.keys(`equipment_project_access:${projectId}:*`);
  return keys.map(k => k.split(":").pop()).filter(Boolean);
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const actorEmail = clean(req.headers["x-user-email"]);

  const projectId =
    (req.body && req.body.projectId) ||
    (req.query && req.query.projectId);

  const modalityId =
    (req.body && req.body.modalityId) ||
    (req.query && req.query.modalityId);

  const photoIds =
    (req.body && req.body.photoIds) || [];

  if (!projectId || !modalityId) {
    return res.status(400).json({ error: "Missing projectId or modalityId" });
  }

  const client = await pool.connect();

  try {
    // ✅ ensure project exists (equipment only)
    const check = await client.query(
      `SELECT id FROM equipment_projects WHERE id = $1`,
      [projectId]
    );

    if (!check.rows.length) {
      return res.status(404).json({ error: "Project not found" });
    }

    let recipients = await getRecipients(projectId);

    // include actor
    if (actorEmail && !recipients.includes(actorEmail)) {
      recipients.push(actorEmail);
    }

    recipients = uniq(recipients);

    for (const email of recipients) {
      const e = clean(email);

      // 1. increment unread (skip actor)
      if (e !== actorEmail) {
        await kv.incr(`equipment:unread:images:${projectId}:${modalityId}:${e}`);
      }

      // 2. NEW pill tracking
      if (photoIds.length > 0) {
        const key = `equipment:changed:${projectId}:${modalityId}`;

        let existing = [];
        try {
          existing = JSON.parse((await kv.get(key)) || "[]");
        } catch {
          existing = [];
        }

        const updated = Array.from(
          new Set([
            ...existing,
            ...photoIds.map(id => String(id))
          ])
        );

        await kv.set(key, JSON.stringify(updated));
      }

      // 3. recompute badge
      const total = await recomputeUserBadge(e);

      // 4. push update
      await sendBadgeOnlyPush(e, total);
    }

    return res.status(200).json({
      success: true,
      projectId,
      modalityId,
      recipientsUpdated: recipients.length
    });

  } catch (err) {
    console.error("equipment-image-tasks error:", err);
    return res.status(500).json({ error: "KV update failed" });
  } finally {
    client.release();
  }
}