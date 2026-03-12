import { Pool } from "pg";
import { kv } from "@vercel/kv";
import { sendBadgeOnlyPush } from "./_lib/push.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const ADMIN_EMAIL = "info@espinmedical.com";

function clean(email) {
  return String(email || "").toLowerCase().trim();
}

function uniq(list) {
  return Array.from(
    new Set((list || []).map(e => clean(e)).filter(Boolean))
  );
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
  if (req.method !== "POST" && req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const actorEmail = clean(req.headers["x-user-email"]);

  const projectId =
    (req.body && req.body.projectId) ||
    (req.query && req.query.projectId);

  const photoIds =
    (req.body && req.body.photoIds) || [];

  if (!projectId) {
    return res.status(400).json({ error: "Missing projectId" });
  }

  const client = await pool.connect();

  try {
    /* ARCHIVE GUARD */
    const state = await client.query(
      `SELECT project_completed FROM projects WHERE id = $1`,
      [projectId]
    );

    if (state.rows[0]?.project_completed === true) {
      return res.status(403).json({
        error: "Project is archived and read-only"
      });
    }

    /* RECIPIENTS (PROJECT-STYLE) */
    const { rows } = await client.query(
      `SELECT LOWER(email) AS email
       FROM project_contacts
       WHERE project_id = $1
       AND can_receive_email = true`,
      [projectId]
    );

    let recipients = uniq(rows.map(r => r.email));

    /* Include actor (matches project NEW behavior) */
    if (actorEmail && !recipients.includes(actorEmail)) {
      recipients.push(actorEmail);
    }

    /* Always include admin */
    const admin = clean(ADMIN_EMAIL);
    if (!recipients.includes(admin)) {
      recipients.push(admin);
    }

    recipients = uniq(recipients);

    /* PROCESS USERS */
/* PROCESS USERS */
for (const email of recipients) {
  const e = clean(email);

  console.log("IMAGE NEW FOR:", e);

  /* 1. Increment image unread (SKIP ACTOR) */
  if (e !== actorEmail) {
    await kv.incr(`project:unread_images:${projectId}:${e}`);
  }

  /* 2. NEW pill tracking (independent per user) */
  if (photoIds.length > 0) {
    const key = `project:badges_images:${projectId}:${e}`;

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

  /* 3. Recompute TOTAL badge */
  const total = await recomputeUserBadge(e);

  await Promise.all([
    kv.set(`app:badge:${e}`, total),
    kv.set(`ios:badge:counter:${e}`, total)
  ]);

  /* 4. Push badge update (EXPLICIT VALUE) */
  await sendBadgeOnlyPush(e, total);
}

    return res.status(200).json({
      success: true,
      projectId,
      recipientsUpdated: recipients.length
    });

  } catch (err) {
    console.error("image-tasks error:", err);
    return res.status(500).json({ error: "KV update failed" });
  } finally {
    client.release();
  }
}