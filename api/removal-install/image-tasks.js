// FILE: /api/project-photos/tasks.js
// FULL REPLACEMENT (FIXED — ACCESS CONTROL + BADGES SAFE)

import { Pool } from "pg";
import { kv } from "@vercel/kv";

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

/* ✅ PROJECT ACCESS FILTER */
async function getProjectUsers(client, projectId) {
  const { rows } = await client.query(
    `
    SELECT DISTINCT LOWER(email) AS email
    FROM project_contacts
    WHERE project_id = $1
    `,
    [projectId]
  );

  return rows.map(r => r.email);
}

export default async function handler(req, res) {
  console.log("🔥 IMAGE TASKS HIT", Date.now());

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

    /* ✅ ONLY USERS WITH ACCESS */
    const allowedUsers = await getProjectUsers(client, projectId);

    if (!allowedUsers.length) {
      console.log("⚠️ NO ALLOWED USERS — EXIT");
      return res.status(200).json({ success: true, skipped: true });
    }

    /* RECIPIENTS (EMAIL-ENABLED ONLY) */
    const { rows } = await client.query(
      `SELECT LOWER(TRIM(email)) AS email
       FROM project_contacts
       WHERE project_id = $1
       AND can_receive_email = true`,
      [projectId]
    );

    let recipients = uniq(rows.map(r => r.email));

    /* INCLUDE ACTOR ONLY IF ALLOWED */
    if (actorEmail && allowedUsers.includes(actorEmail)) {
      if (!recipients.includes(actorEmail)) {
        recipients.push(actorEmail);
      }
    }

    /* INCLUDE ADMIN ONLY IF PART OF PROJECT */
    const admin = clean(ADMIN_EMAIL);
    if (allowedUsers.includes(admin) && !recipients.includes(admin)) {
      recipients.push(admin);
    }

    recipients = uniq(recipients);

    const processed = new Set();

    for (const email of recipients) {
      const e = clean(email);

      /* 🔥 HARD FILTER — FINAL GUARD */
      if (!allowedUsers.includes(e)) continue;

      if (!e || processed.has(e)) continue;
      processed.add(e);

      console.log("🖼 IMAGE BADGE FOR:", e);

      const key = `project:unread_images:${projectId}:${e}`;

      const before = Number(await kv.get(key)) || 0;
      console.log("BEFORE IMAGE BADGE:", key, before);

      /* 🔥 IMAGE BADGE COUNTER */
      if (e !== actorEmail) {
        const next = before + 1;
        await kv.set(key, next);
      }

      const after = Number(await kv.get(key)) || 0;
      console.log("AFTER IMAGE BADGE:", key, after);

      /* 🔥 NEW PILL */
      if (photoIds.length > 0) {
        const badgeKey = `project:badges_images:${projectId}:${e}`;

        let existing = await kv.get(badgeKey);
        if (!Array.isArray(existing)) existing = [];

        const updated = Array.from(
          new Set([...existing, ...photoIds.map(id => String(id))])
        );

        await kv.set(badgeKey, updated);

        console.log("NEW PILLS SET:", badgeKey, updated);
      }
    }

    return res.status(200).json({
      success: true,
      projectId,
      recipientsUpdated: recipients.length
    });

  } catch (err) {
    console.error("❌ image-tasks error:", err);
    return res.status(500).json({ error: "KV update failed" });
  } finally {
    client.release();
  }
}