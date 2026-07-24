// FILE: /api/projects/send-welcome.js
// PATH: /api/projects/send-welcome.js

import { Pool } from "pg";
import { Resend } from "resend";
console.log("🔥 SEND-WELCOME HIT", Date.now());
const resend = new Resend(process.env.RESEND_API_KEY);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const FROM_EMAIL = "Espin Medical <info@espinmedical.com>";
const ADMIN_EMAIL = "info@espinmedical.com";

function clean(email) {
  return String(email || "").toLowerCase().trim();
}

function uniq(list) {
  return Array.from(new Set((list || []).map(clean).filter(Boolean)));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const client = await pool.connect();

  try {
    const { projectId, existingEmails = [] } = req.body || {};

    if (!projectId) {
      return res.status(400).json({ error: "Missing projectId" });
    }

    const existingSet = new Set(
      (existingEmails || []).map(clean).filter(Boolean)
    );

    const projectRes = await client.query(
      `SELECT project_name, site_address, zip_code, modality FROM projects WHERE id = $1`,
      [projectId]
    );

    const p = projectRes.rows[0] || {};

    const contactsRes = await client.query(
      `SELECT email FROM project_contacts WHERE project_id = $1`,
      [projectId]
    );

    const allContacts = uniq(
      contactsRes.rows.map(r => r.email)
    );

    const targetEmail = clean(req.body.email);

    let recipients = [];

    if (targetEmail) {
      recipients = [targetEmail];
    }

    recipients = uniq([
      ...recipients,
      ADMIN_EMAIL
    ]);

    if (!recipients.length) {
      return res.json({ success: true, skipped: true });
    }

    console.log("📧 FINAL RECIPIENTS:", recipients);

    const html = `
      <div style="font-family:Arial;max-width:650px;margin:auto">

        <h2 style="margin-bottom:6px">
          Project Name: ${p?.project_name || "—"}
        </h2>

        <p style="margin:0;font-size:14px;color:#444">
          Address: ${p?.site_address || "—"}<br>
          Zip Code: ${p?.zip_code || "—"}<br>
          Modality: ${p?.modality || "—"}
        </p>

        <div style="margin-top:18px;font-size:14px;">
          Welcome to Espin Connect.<br><br>
          You’ve been added to this project and can now access updates, photos, and key details in real time.
        </div>

        <div style="margin-top:18px;display:flex;gap:16px;flex-wrap:wrap;">
          
         <a href="https://apps.apple.com/app/id6756586742"
   style="display:inline-block;padding:10px 14px;background:#000;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;margin-right:14px;">
  Download on App Store
</a>

          <a href="https://play.google.com/store/apps/details?id=com.espinmedical.official"
             style="display:inline-block;padding:10px 14px;background:#34A853;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;">
            Get it on Google Play
          </a>

        </div>

        <div style="margin-top:20px;font-size:12px;color:#666;">
          — Espin Connect
        </div>

      </div>
    `;

    if (!process.env.RESEND_API_KEY) {
      console.warn("⚠️ Missing RESEND_API_KEY");
      return res.json({ success: true, noEmail: true });
    }

    await resend.emails.send({
      from: FROM_EMAIL,
      to: recipients,
      subject: `Welcome to Espin Connect – ${p?.project_name || "Project"}`,
      html
    });

    return res.json({
      success: true,
      sent: recipients
    });

  } catch (err) {
    console.error("❌ send-welcome error:", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
}