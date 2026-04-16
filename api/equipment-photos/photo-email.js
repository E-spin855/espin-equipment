// FILE: /api/equipment-photos/photo-email.js

import { Pool } from "pg";
import { Resend } from "resend";
import { kv } from "@vercel/kv";
import { sendPushToUsers } from "../_lib/push-equipment.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const FROM_EMAIL = "Espin Medical <info@espinmedical.com>";
const ADMIN_EMAIL = "info@espinmedical.com";

const clean = (v) => String(v || "").toLowerCase().trim();
const cleanText = (v) => String(v || "").trim();

function isHttpUrl(value) {
  return /^https?:\/\/.+/i.test(String(value || "").trim());
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildImageSrc(photoUrl) {
  const raw = String(photoUrl || "").trim();
  return isHttpUrl(raw) ? raw : null;
}

function safeJson(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try { return JSON.parse(body); } catch { return {}; }
  }
  return body;
}

/* RECIPIENTS */
async function getRecipients() {
  return ["info@espinmedical.com"];
}

/* BADGE */
async function recomputeBadge(email) {
  const e = clean(email);

  const keys = await kv.keys(`equipment:unread:*:*:*:${e}`);
  const values = keys.length ? await kv.mget(...keys) : [];

  const total = values.reduce((sum, v) => sum + (Number(v) || 0), 0);

  await kv.set(`app:badge:equipment:${e}`, total);
  await kv.set(`ios:badge:counter:equipment:${e}`, total);

  return total;
}

/* EQUIPMENT BLOCK */
function buildEquipmentHtml(details = {}) {
  const rows = Object.entries(details)
    .filter(([_, v]) => v && typeof v !== "object")
    .map(([k, v]) => {
      const label = k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
      return `
        <tr>
          <td style="padding:8px;font-weight:600">${escapeHtml(label)}</td>
          <td style="padding:8px;text-align:right">${escapeHtml(String(v))}</td>
        </tr>
      `;
    }).join("");

  if (!rows) return "";

  return `
    <div style="margin-top:20px;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
      <div style="background:#1F7BC8;color:#fff;padding:10px 14px;font-weight:800">
        EQUIPMENT DETAILS
      </div>
      <table width="100%" style="border-collapse:collapse">${rows}</table>
    </div>
  `;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const resend = new Resend(process.env.RESEND_API_KEY);

  const body = safeJson(req.body);
  const projectId = cleanText(body.projectId);
  const modalityId = cleanText(body.modalityId);
  const photoIds = Array.isArray(body.photoIds) ? body.photoIds : [];

  if (!projectId || !photoIds.length) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const client = await pool.connect();

  try {
    /* PROJECT */
    const projectRes = await client.query(
      `SELECT * FROM equipment_projects WHERE id = $1`,
      [projectId]
    );

    const project = projectRes.rows[0];
    if (!project) return res.status(404).json({ error: "Project not found" });

    /* DETAILS */
    const detailsRes = await client.query(
      `SELECT * FROM equipment_details WHERE project_id = $1 AND modality_id = $2 LIMIT 1`,
      [projectId, modalityId]
    );

    const detailsRow = detailsRes.rows[0] || {};
    const equipmentHtml = buildEquipmentHtml(detailsRow.data || {});

    /* PHOTOS */
    const photosRes = await client.query(
      `
      SELECT id, photo_url, photo_title, photo_comment
      FROM equipment_photos
      WHERE project_id = $1
        AND modality_id = $2
        AND id = ANY($3::uuid[])
        AND hidden = false
      `,
      [projectId, modalityId, photoIds]
    );

    if (!photosRes.rows.length) {
      return res.status(400).json({ error: "No valid images" });
    }

    const prepared = photosRes.rows
      .map((p, i) => {
        const src = buildImageSrc(p.photo_url);
        if (!src) return null;

        return {
          label: p.photo_title || `Image ${i + 1}`,
          src,
          comment: p.photo_comment || ""
        };
      })
      .filter(Boolean);

    /* IMAGE BLOCKS (FRAMED) */
    const imagesHtml = prepared.map(img => `
      <div style="margin-bottom:24px;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">

        <div style="padding:10px 14px;background:#f8fafc;border-bottom:1px solid #e5e7eb">
          <div style="font-size:11px;font-weight:700;color:#1F7BC8;letter-spacing:.5px">
            IMAGE NAME
          </div>
          <div style="font-size:14px;font-weight:700;color:#0f172a">
            ${escapeHtml(img.label)}
          </div>
        </div>

        <img src="${img.src}" style="width:100%;display:block">

        ${
          img.comment
            ? `<div style="padding:10px 14px;border-top:1px solid #e5e7eb;font-size:13px;color:#334155">
                ${escapeHtml(img.comment)}
               </div>`
            : ""
        }

      </div>
    `).join("");

    /* FINAL HTML */
    const html = `
      <div style="font-family:Arial;max-width:650px;margin:auto">

        <div style="border-bottom:3px solid #1F7BC8;padding-bottom:12px;margin-bottom:16px">
          <div style="font-size:20px;font-weight:800">
            ${escapeHtml(project.project_name)}
          </div>
          <div>${escapeHtml(project.site_address || "")}</div>
          <div>${escapeHtml(project.zip_code || "")}</div>
        </div>

        ${equipmentHtml}

        <div style="margin-top:24px;border-top:3px solid #1F7BC8;padding-top:16px">
          <div style="font-size:16px;font-weight:800;color:#1F7BC8;margin-bottom:12px">
            PROJECT IMAGES
          </div>

          ${imagesHtml}
        </div>

      </div>
    `;

    const recipients = await getRecipients();

    await resend.emails.send({
      from: FROM_EMAIL,
      to: recipients,
      subject: `Equipment Images – ${project.project_name}`,
      html
    });
// 🔥 CREATE NEW PILL FOR ADMIN (CRITICAL FIX)
const key = `equipment:badges_images:${projectId}:${modalityId}:${ADMIN_EMAIL}`;

const existing = await kv.get(key);

let current = [];

if (existing) {
  try {
    const parsed = typeof existing === "string"
      ? JSON.parse(existing)
      : existing;

    if (Array.isArray(parsed)) current = parsed;
  } catch {}
}

const merged = [
  ...new Set([
    ...current.map(String),
    ...photoIds.map(String)
  ])
];

await kv.set(key, merged);

console.log("🔥 ADMIN NEW BADGE SET", {
  key,
  merged
});
    for (const email of recipients) {
      await kv.incr(`equipment:unread:images:${projectId}:${modalityId}:${email}`);
      const badge = await recomputeBadge(email);

     await sendPushToUsers(
  project.project_name,
  `Equipment and Images Update – ${prepared.length} new images`,
  {
    recipients: [email],
    projectId,
    modalityId,
    badge
  }
);
    }

    return res.json({ success: true });

  } catch (err) {
    console.error("EMAIL ERROR:", err);
    return res.status(500).json({ error: "Failed" });
  } finally {
    client.release();
  }
}