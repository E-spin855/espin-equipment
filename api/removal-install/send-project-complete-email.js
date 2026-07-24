// FILE: /api/send-project-complete-email.js
// PATH: /api/send-project-complete-email.js

import { Pool } from "pg";
import { Resend } from "resend";
import { kv } from "@vercel/kv";
import { sendBadgeOnlyPush } from "./_lib/push.js";

const resend = new Resend(process.env.RESEND_API_KEY);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const FROM_EMAIL = "Espin Medical <info@espinmedical.com>";

function clean(email) {
  return String(email || "").toLowerCase().trim();
}

function uniq(list) {
  return Array.from(new Set((list || []).map(clean).filter(Boolean)));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const client = await pool.connect();

  try {
    const { projectId, completedBy, completionDate } = req.body || {};
    const userEmail = clean(req.headers["x-user-email"]);

    if (!projectId) {
      return res.status(400).json({ error: "Missing projectId" });
    }

    /* ───────── PROJECT ───────── */
    const projectRes = await client.query(
      `SELECT project_name, site_address FROM projects WHERE id = $1`,
      [projectId]
    );

    const project = projectRes.rows[0] || {};

    /* ───────── USERS (PM + AUTHORIZED ONLY) ───────── */
    const contactsRes = await client.query(
      `SELECT email, role FROM project_contacts WHERE project_id = $1`,
      [projectId]
    );

    const users = contactsRes.rows
      .filter(r => {
        const role = String(r.role || "").toLowerCase().trim();
        return (
          role === "project_manager" ||
          role === "authorized"
        );
      })
      .map(r => clean(r.email))
      .filter(Boolean);

    console.log("📧 USERS AFTER FILTER:", users);

    /* ───────── FINAL RECIPIENTS (FORCE ADMIN) ───────── */
    const recipients = uniq([
      ...users,
      "info@espinmedical.com"
    ]).map(clean);

    console.log("📧 FINAL RECIPIENTS:", recipients);

    if (!recipients.length) {
      console.log("⚠️ NO RECIPIENTS — SKIPPING EMAIL");
      return res.json({ success: true, skipped: true });
    }

    /* ───────── 🔥 GLOBAL BADGE RESET (ALL USERS) ───────── */
const allUsers = contactsRes.rows
  .map(r => clean(r.email))
  .filter(Boolean);

for (const email of allUsers) {
  try {
    await kv.set(`project:unread:${projectId}:${email}`, 0);
    await kv.set(`project:unread_images:${projectId}:${email}`, 0);
    await kv.set(`project:badges_details:${projectId}:${email}`, "[]");
    await kv.set(`ios:badge:counter:${email}`, 0);

    await sendBadgeOnlyPush(email, 0);
  } catch (e) {
    console.error("❌ badge reset error:", email, e);
  }
}
    /* ───────── FORMAT ───────── */
    const formattedDate = completionDate
      ? new Date(completionDate).toLocaleString()
      : "";

    const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;padding:20px;color:#000;max-width:650px;margin:auto;">
  
  <h2 style="color:#0066B2;margin-bottom:10px;">Project Successfully Completed</h2>

  <p style="font-size:14px;line-height:1.6;margin-bottom:16px;">
    We’re pleased to inform you that the project has been successfully completed. 
    Thank you for the opportunity to support your team — we appreciate your partnership.
  </p>

  <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:16px;">
    <tr>
      <td style="padding:6px 0;"><b>Project</b></td>
      <td style="padding:6px 0;">${project.project_name || ""}</td>
    </tr>
    <tr>
      <td style="padding:6px 0;"><b>Site Address</b></td>
      <td style="padding:6px 0;">${project.site_address || ""}</td>
    </tr>
    <tr>
      <td style="padding:6px 0;"><b>Completed By</b></td>
      <td style="padding:6px 0;">${completedBy || ""}</td>
    </tr>
    <tr>
      <td style="padding:6px 0;"><b>Completion Date</b></td>
      <td style="padding:6px 0;">${formattedDate}</td>
    </tr>
  </table>

  <p style="font-size:14px;line-height:1.6;margin-bottom:16px;">
    If you need any additional documentation, support, or have upcoming projects, 
    our team is ready to assist.
  </p>

  <div style="margin-top:20px;font-size:12px;color:#666;">
    Espin Medical<br/>
    Imaging Equipment Specialists
  </div>

</div>
`;

    /* ───────── EMAIL ───────── */
    if (!process.env.RESEND_API_KEY) {
      console.warn("⚠️ Missing RESEND_API_KEY");
      return res.json({ success: true, noEmail: true });
    }

    await resend.emails.send({
      from: FROM_EMAIL,
      to: recipients,
      subject: `Project Completed: ${project.project_name || "Project"}`,
      html
    });

    return res.json({ success: true });

  } catch (err) {
    console.error("❌ send-project-complete-email error:", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}