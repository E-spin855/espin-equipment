// FILE: /api/send-project-email.js
// PATH: /api/send-project-email.js

import { Pool } from "pg";
import { Resend } from "resend";
import { kv } from "@vercel/kv";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = "Espin Medical <info@espinmedical.com>";

const clean = e => String(e || "").toLowerCase().trim();

/* ───────── FORMAT ───────── */
const fmt = v => {
  if (v === true || v === "true" || v === 1) return "Yes";
  if (v === false || v === "false" || v === 0) return "No";
  if (!v) return "—";

  try {
    const d = new Date(
      String(v).includes("T")
        ? v
        : String(v).replace(" ", "T") + "Z"
    );
    if (isNaN(d.getTime())) return String(v);

    return d.toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "UTC"
    });
  } catch {
    return String(v);
  }
};

/* ───────── HANDLER ───────── */
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const actorEmail = clean(req.headers["x-user-email"]); // 🔥 FIX

  const { projectId, changedFields: bodyFields } = req.body || {};

  if (!projectId) {
    return res.status(400).json({ error: "Missing projectId" });
  }

  const client = await pool.connect();

  try {
    /* ───────── CHANGED FIELDS ───────── */
    let changedFields = [];

    if (Array.isArray(bodyFields) && bodyFields.length) {
      changedFields = bodyFields;
    } else {
      const rec = await kv.get(`proj:changed:${projectId}`);
      if (Array.isArray(rec?.changedFields)) {
        changedFields = rec.changedFields;
      }
    }

    if (changedFields.includes("project_completed")) {
      return res.json({ success: true, skipped: "completion" });
    }

    /* ───────── LOAD DATA ───────── */
    const detailsRes = await client.query(
      `SELECT * FROM project_details WHERE project_id = $1`,
      [projectId]
    );
    const d = detailsRes.rows[0] || {};

    const projectRes = await client.query(
      `SELECT * FROM projects WHERE id = $1`,
      [projectId]
    );

    const p = projectRes.rows[0];
    if (!p) {
      return res.status(404).json({ error: "Project not found" });
    }

    /* ───────── BUILD HTML (unchanged) ───────── */
    const row = (label, key, value) => {
      const updated = changedFields.includes(key);
      const color = updated ? "#0066B2" : "#000";
      const weight = updated ? "800" : "400";

      return `
<tr>
<td style="padding:8px;border-bottom:1px solid #eee">
<b style="color:${color}">${label}</b>
</td>
<td style="padding:8px;border-bottom:1px solid #eee;color:${color};font-weight:${weight}">
${fmt(value)}
</td>
</tr>`;
    };

    const section = (title, rows) => {
      if (!rows || !rows.trim()) return "";
      return `
<h3 style="background:#0066B2;color:#fff;padding:10px;margin:20px 0 0 0;font-family:Arial;font-size:15px">
${title}
</h3>
<table width="100%" style="border:1px solid #eee;border-top:none;border-collapse:collapse;margin-bottom:20px">
${rows}
</table>`;
    };

    let timelineRows = "";
    let powerRows = "";
    let magnetRows = "";
    let removalRows = "";
    let disposalRows = "";
    let notesRows = "";

    timelineRows += row("Project Start", "project_start", d.project_start);
    timelineRows += row("Pathways Opening Start", "pathways_opening_start", d.pathways_opening_start);
    timelineRows += row("Pathways Opened", "pathways_opened", d.pathways_opened);
    timelineRows += row("Inspection Date", "inspection_date", d.inspection_date);
    timelineRows += row("Inspection Completed", "inspection_completed", d.inspection_completed);

    powerRows += row("Power Shut Down Date", "power_shutdown", d.power_shutdown);
    powerRows += row("Power Completed", "power_shutdown_completed", d.power_shutdown_completed);

    if (d.magnet_ramp_down || d.magnet_ramp_completed) {
      magnetRows += row("Ramp Down Date", "magnet_ramp_down", d.magnet_ramp_down);
      magnetRows += row("Ramp Down Completed", "magnet_ramp_completed", d.magnet_ramp_completed);
    }

    if (d.magnet_quench_date || d.magnet_quench_completed) {
      magnetRows += row("Quench Date", "magnet_quench_date", d.magnet_quench_date);
      magnetRows += row("Quench Completed", "magnet_quench_completed", d.magnet_quench_completed);
    }

    removalRows += row("De-Install Start Date", "deinstall_start", d.deinstall_start);
    removalRows += row("De-Install Completed", "deinstall_completed", d.deinstall_completed);
    removalRows += row("Rig-Out Date", "rigout_date", d.rigout_date);
    removalRows += row("Rig-Out Completed", "rigout_completed", d.rigout_completed);

    if (d.disposal_date || d.disposal_completed) {
      disposalRows += row("Disposal Date", "disposal_date", d.disposal_date);
      disposalRows += row("Disposal Completed", "disposal_completed", d.disposal_completed);
    }

    if (d.notes && String(d.notes).trim()) {
      notesRows += row("Notes", "notes", d.notes);
    }

    const html = `
<div style="font-family:Arial;max-width:650px;margin:auto">
<h2>Project Name: ${p?.project_name || "—"}</h2>
<p>
Address: ${p?.site_address || "—"}<br>
Zip Code: ${p?.zip_code || "—"}<br>
Modality: ${p?.modality || "—"}
</p>
${section("Project Timeline", timelineRows)}
${section("Power", powerRows)}
${section("Magnet", magnetRows)}
${section("Removal", removalRows)}
${section("Disposal", disposalRows)}
${section("Notes", notesRows)}
</div>
`;

   /* ───────── ACCESS FILTER ───────── */
const { rows: accessRows } = await client.query(
  `
  SELECT DISTINCT LOWER(email) AS email
  FROM project_contacts
  WHERE project_id = $1
  `,
  [projectId]
);

const allowedUsers = accessRows.map(r => clean(r.email));

const ADMIN = "info@espinmedical.com";

/* ───────── RECIPIENTS ───────── */
let recipients = allowedUsers.filter(Boolean);

/* REMOVE ACTOR */
recipients = recipients.filter(e => e !== actorEmail);

/* 🔥 HARD FILTER + ADMIN OVERRIDE */
recipients = recipients.filter(
  e => allowedUsers.includes(e) || e === ADMIN
);

/* ALWAYS INCLUDE ADMIN */
if (!recipients.includes(ADMIN)) {
  recipients.push(ADMIN);
}

console.log("📧 Actor:", actorEmail);
console.log("📧 Allowed Users:", allowedUsers);
console.log("📧 Final Recipients:", recipients);

    /* ───────── SEND ───────── */
    if (recipients.length || ADMIN) {
      await resend.emails.send({
        from: FROM_EMAIL,
        to: [ADMIN],
        bcc: recipients.filter(e => e !== ADMIN)
      ,
        subject: `Project Update: ${p?.project_name || "Project"}`,
        html
      });
    }

    await kv.del(`proj:changed:${projectId}`);

    return res.json({ success: true });

  } catch (err) {
    console.error("❌ EMAIL ERROR:", err);
    return res.status(500).json({ error: "Failed" });
  } finally {
    client.release();
  }
}