import { Pool } from "pg";
import { Resend } from "resend";
import { kv } from "@vercel/kv";

/* ───────────────────────── DATABASE ───────────────────────── */
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = "Espin Medical <info@espinmedical.com>";

const clean = e => String(e || "").toLowerCase().trim();

/* ───────────────────────── FORMATTER ───────────────────────── */
const fmt = v => {
  if (v === true || v === "true" || v === 1) return "Yes";
  if (v === false || v === "false" || v === 0) return "No";
  if (v === null || v === undefined || v === "") return "—";

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

/* ───────────────────────── HANDLER ───────────────────────── */
export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

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
    if (!p) return res.json({ skipped: true });

    /* ───────── ROW RENDER ───────── */
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
</tr>
`;
    };

    /* ───────── SECTION HELPER ───────── */
    const section = (title, rows) => {
      if (!rows) return "";

      return `
<h3 style="background:#0066B2;color:#fff;padding:10px;margin:20px 0 0 0;font-family:Arial;font-size:15px">
${title}
</h3>

<table width="100%" style="border:1px solid #eee;border-top:none;border-collapse:collapse;margin-bottom:20px">
${rows}
</table>
`;
    };

    /* ───────── BUILD ROW GROUPS ───────── */

    let timelineRows = "";
    let powerRows = "";
    let magnetRows = "";
    let removalRows = "";
    let completionRows = "";
    let notesRows = "";

    /* TIMELINE */
    timelineRows += row("Project Start", "project_start", d.project_start);
    timelineRows += row("Pathways Opening Start", "pathways_opening_start", d.pathways_opening_start);
    timelineRows += row("Pathways Opened", "pathways_opened", d.pathways_opened);
    timelineRows += row("Inspection Date", "inspection_date", d.inspection_date);
    timelineRows += row("Inspection Completed", "inspection_completed", d.inspection_completed);

    /* POWER */
    powerRows += row("Power Shut Down Date", "power_shutdown", d.power_shutdown);
    powerRows += row("Power Completed", "power_shutdown_completed", d.power_shutdown_completed);

    /* MAGNET */
    magnetRows += row("Ramp Down Date", "magnet_ramp_down", d.magnet_ramp_down);
    magnetRows += row("Ramp Down Completed", "magnet_ramp_completed", d.magnet_ramp_completed);
    magnetRows += row("Quench Date", "magnet_quench_date", d.magnet_quench_date);
    magnetRows += row("Quench Completed", "magnet_quench_completed", d.magnet_quench_completed);

    /* REMOVAL */
    removalRows += row("De-Install Start Date", "deinstall_start", d.deinstall_start);
    removalRows += row("De-Install Completed", "deinstall_completed", d.deinstall_completed);
    removalRows += row("Rig-Out Date", "rigout_date", d.rigout_date);
    removalRows += row("Rig-Out Completed", "rigout_completed", d.rigout_completed);

    /* COMPLETION */
    completionRows += row("Project Completion Date", "project_completion", d.project_completion);
    completionRows += row("Project Completed", "project_completed", d.project_completed);

    /* NOTES */
    notesRows += `
<tr>
<td colspan="2" style="padding:15px;white-space:pre-wrap">
${d.notes || "—"}
</td>
</tr>
`;

    /* ───────── EMAIL HTML ───────── */

    let html = `
<div style="font-family:Arial;max-width:650px;margin:auto">
<h2 style="margin-bottom:6px">Project Name: ${p.project_name || "—"}</h2>

<p style="margin:0;font-size:14px;color:#444">
Address: ${p.site_address || "—"}<br>
Zip Code: ${p.zip_code || "—"}<br>
Modality: ${p.modality || "—"}
</p>
${section("Project Timeline", timelineRows)}
${section("Power Utility", powerRows)}
${section("MRI Magnet", magnetRows)}
${section("Equipment Removal", removalRows)}
${section("Project Completion", completionRows)}
${section("Notes", notesRows)}

</div>
`;

    /* ───────── RECIPIENTS ───────── */

    const contactsRes = await client.query(
      `SELECT LOWER(email) AS email
       FROM project_contacts
       WHERE project_id = $1 AND can_login = true`,
      [projectId]
    );

    let recipients = contactsRes.rows.map(r => clean(r.email));

    const ADMIN = "info@espinmedical.com";
    if (!recipients.includes(ADMIN)) recipients.push(ADMIN);

    recipients = Array.from(new Set(recipients.filter(Boolean)));

    console.log("📧 Recipients:", recipients);

    if (recipients.length) {

      await resend.emails.send({
        from: FROM_EMAIL,
        to: ["info@espinmedical.com"],
        bcc: recipients,
        subject: `Project Update: ${p.project_name}`,
        html
      });

    }

    /* CLEANUP */

    await kv.del(`proj:changed:${projectId}`);

    return res.json({ success: true });

  } catch (err) {

    console.error("❌ send-project-emails error:", err);
    return res.status(500).json({ error: "Failed" });

  } finally {

    client.release();

  }
}