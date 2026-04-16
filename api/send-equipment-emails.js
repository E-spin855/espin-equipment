// FILE: /api/equipment-details/send.js
// PATH: /api/equipment-details/send.js

import { Pool } from "pg";
import { Resend } from "resend";
import { kv } from "@vercel/kv";
import { sendPushToUsers } from "./_lib/push-equipment.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = "Espin Medical <info@espinmedical.com>";

function clean(v) {
  return String(v || "").toLowerCase().trim();
}

function esc(v) {
  return String(v || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(v) {
  if (v === true || v === "true" || v === 1) return "Yes";
  if (v === false || v === "false" || v === 0) return "No";
  if (v == null || v === "") return "—";

// ✅ DATE FORMAT (Month YYYY)
if (typeof v === "string" && /^\d{4}-\d{2}$/.test(v)) {
  const [y, m] = v.split("-");
  const monthName = new Date(`${y}-${m}-01`).toLocaleString("en-US", { month: "long" });
  return `${monthName} ${y}`;
}
  if (Array.isArray(v)) return v.map(x => String(x || "").trim()).filter(Boolean).join(", ") || "—";

  if (typeof v === "object") {
    try { return JSON.stringify(v, null, 2); } catch { return String(v); }
  }

  return String(v);
}

async function getRecipients(client, projectId) {
  const { rows } = await client.query(
    `
    SELECT LOWER(email) AS email
    FROM equipment_project_access
    WHERE project_id = $1
    `,
    [projectId]
  );
  return rows.map(r => r.email).filter(Boolean);
}

async function recomputeBadge(email) {
  const e = clean(email);
  const keys = await kv.keys(`equipment:unread:*:*:*:${e}`);
  const values = keys.length ? await kv.mget(...keys) : [];
  const total = values.reduce((sum, v) => sum + (Number(v) || 0), 0);

  await kv.set(`app:badge:equipment:${e}`, total);
  await kv.set(`ios:badge:counter:equipment:${e}`, total);
  return total;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email, x-useremail, x-user_email");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const actorEmail = clean(
    req.headers["x-user-email"] ||
    req.headers["x-useremail"] ||
    req.headers["x-user_email"] ||
    req.body?.email ||
    req.body?.actorEmail
  );

  const projectId = String(req.body?.projectId || "").trim();
  const requestedModalityId = String(req.body?.modalityId || "").trim();

  if (!projectId) return res.status(400).json({ error: "Missing projectId" });

  const client = await pool.connect();

  try {
    const projectRes = await client.query(
      `SELECT id, project_name, site_address, city, state, zip_code FROM equipment_projects WHERE id = $1 LIMIT 1`,
      [projectId]
    );

    const project = projectRes.rows[0];
    if (!project) return res.status(404).json({ error: "Project not found" });

    const detailsRes = await client.query(
      `SELECT * FROM equipment_details WHERE project_id = $1 AND modality_id = $2 ORDER BY updated_at DESC LIMIT 1`,
      [projectId, requestedModalityId]
    );

    const details = detailsRes.rows[0] || {};
    const data = typeof details.data === "object" ? details.data : {};
    const modalityId = requestedModalityId;

    const changedFields = Array.isArray(req.body?.changedFields)
      ? req.body.changedFields.map(v => String(v || "").trim()).filter(Boolean)
      : [];

    const recipients = await getRecipients(client, projectId);
    const ADMIN_EMAIL = "info@espinmedical.com";
    if (!recipients.includes(ADMIN_EMAIL)) recipients.push(ADMIN_EMAIL);
// ✅ NEW SMART ROW MAPPING
    // This looks in details.field, details.data.field, and handles ct_ prefixes
  // ===== MODALITY =====
const modality = String(details.modality || data.modality || "").toLowerCase();

const prefixMap = {
  ct: "ct_",
  mri: "mri_",
  xray: "xray_",
  carm: "carm_",
  pet: "pet_",
  petct: "pet_",
  mamo: "mamo_",
  other: "other_"
};

const activePrefix = prefixMap[modality] || "";

// ===== VALUE GETTER (CT LOGIC EXPANDED) =====
const getV = (key) => {
  const prefixes = ["ct_", "mri_", "xray_", "carm_", "pet_", "mamo_", "other_"];

  const keys = [
    key,
    key.replace(/^(ct_|mri_|xray_|carm_|pet_|mamo_|other_)/, "")
  ];

  prefixes.forEach(p => {
    if (!key.startsWith(p)) keys.push(p + key);
  });

  prefixes.forEach(p => {
    keys.push(key.replace("date_removed_from_service", p + "out_of_use_date"));
    keys.push(key.replace("upgrades_description", p + "upgrades_desc"));
  });

  for (const k of keys) {
    const v = details[k] ?? data[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }

  return "";
};

// ===== CONDITIONS (CT LOGIC APPLIED TO ALL) =====
const shouldShow = (key, value) => {
  const isYes = (v) => {
    const s = String(v ?? "").trim().toLowerCase();
    return ["y","yes","true","1"].includes(s);
  };

  const isNo = (v) => {
    const s = String(v ?? "").trim().toLowerCase();
    return ["n","no","false","0"].includes(s);
  };

  // ===== CT (ORIGINAL — DO NOT TOUCH) =====
  if (key === "ct_injector_model") return isYes(getV("ct_injector"));
  if (key === "ct_upgrades_desc") return isYes(getV("ct_upgrades"));
  if (key === "ct_out_of_use_date") return isNo(getV("ct_in_use"));

  // ===== MRI =====
  if (key === "mri_service_name") return isYes(getV("mri_service"));
  if (key === "mri_out_of_use_date") return isNo(getV("mri_in_use"));

  // ===== XRAY =====
  if (key === "xray_out_of_use_date") return isNo(getV("xray_in_use"));

  // ===== CARM =====
  if (key === "carm_service_name") return isYes(getV("carm_servicing"));
  if (key === "carm_out_of_use_date") return isNo(getV("carm_in_use"));

  // ===== PET =====
  if (key === "pet_out_of_use_date") return isNo(getV("pet_in_use"));

  // ===== MAMMO (ADD) =====
  if (key === "mamo_out_of_use_date") return isNo(getV("mamo_in_use"));

  return value !== undefined && value !== null && value !== "";
};
// ===== ROWS (CT FORMAT FOR ALL MODALITIES) =====
const rows = [
  ["CT Model", getV("ct_model"), "ct_model"],
  ["CT Manufacturer", getV("ct_manufacturer"), "ct_manufacturer"],
  ["CT Serial", getV("ct_serial"), "ct_serial"],
  ["CT Installed", getV("ct_installed"), "ct_installed"],
  ["CT Dom", getV("ct_dom"), "ct_dom"],
  ["CT Tube Dom", getV("ct_tube_dom"), "ct_tube_dom"],
  ["CT Mhu", getV("ct_mhu"), "ct_mhu"],
  ["CT Tube Mas", getV("ct_tube_mas"), "ct_tube_mas"],
  ["CT Slices", getV("ct_slices"), "ct_slices"],
  ["CT In Use", getV("ct_in_use"), "ct_in_use"],
  ["CT Out Of Use Date", getV("ct_out_of_use_date"), "ct_out_of_use_date"],
  ["CT Injector", getV("ct_injector"), "ct_injector"],
  ["CT Injector Model", getV("ct_injector_model"), "ct_injector_model"],
  ["CT Upgrades", getV("ct_upgrades"), "ct_upgrades"],
  ["CT Upgrades Description", getV("ct_upgrades_desc"), "ct_upgrades_desc"],
["CT Hard Drives Removed", fmt(getV("ct_hard_drive_removed")), "ct_hard_drive_removed"],
["CT Removal Pathways", getV("ct_removal_pathways"), "ct_removal_pathways"],
["CT Availability Time Frame", getV("ct_availability_timeframe"), "ct_availability_timeframe"],


  ["MRI Manufacturer", getV("mri_manufacturer"), "mri_manufacturer"],
  ["MRI Model", getV("mri_model"), "mri_model"],
  ["MRI Serial", getV("mri_serial"), "mri_serial"],
  ["MRI Year", getV("mri_yom"), "mri_yom"],
  ["MRI Magnet Type", getV("mri_magnet_type"), "mri_magnet_type"],
  ["MRI Bore Size", getV("mri_bore_size_cm"), "mri_bore_size_cm"],
  ["MRI Channels", getV("mri_num_channels"), "mri_num_channels"],
  ["MRI Gradient", getV("mri_gradient"), "mri_gradient"],
  ["MRI Software Version", getV("mri_sw_version"), "mri_sw_version"],
  ["MRI Software Options", getV("mri_sw_options"), "mri_sw_options"],
  ["MRI TIM", getV("mri_tim"), "mri_tim"],
  ["MRI Coils", getV("mri_coils"), "mri_coils"],
  ["MRI Service", getV("mri_service"), "mri_service"],
  ["MRI Service Name", getV("mri_service_name"), "mri_service_name"],
  ["MRI Under Contract", getV("mri_under_contract"), "mri_under_contract"],
  ["MRI Last PM", getV("mri_last_pm"), "mri_last_pm"],
  ["MRI In Use", getV("mri_in_use"), "mri_in_use"],
  ["MRI Out Of Use Date", getV("mri_out_of_use_date"), "mri_out_of_use_date"],
["MRI Hard Drives Removed", fmt(getV("mri_hard_drive_removed")), "mri_hard_drive_removed"],
["MRI Removal Pathways", getV("mri_removal_pathways"), "mri_removal_pathways"],
["MRI Availability Time Frame", getV("mri_availability_timeframe"), "mri_availability_timeframe"],


  ["X-ray Manufacturer", getV("xray_manufacturer"), "xray_manufacturer"],
  ["X-ray Model", getV("xray_model"), "xray_model"],
  ["X-ray Serial", getV("xray_serial"), "xray_serial"],
  ["X-ray DOM", getV("xray_dom"), "xray_dom"],
  ["X-ray Floor Mounted", getV("xray_floor_mounted"), "xray_floor_mounted"],
  ["X-ray Ceiling Mounted", getV("xray_ceiling_mounted"), "xray_ceiling_mounted"],
  ["X-ray RF", getV("xray_is_rf"), "xray_is_rf"],
  ["X-ray In Use", getV("xray_in_use"), "xray_in_use"],
  ["X-ray Out Of Use Date", getV("xray_out_of_use_date"), "xray_out_of_use_date"],
["X-ray Loading Dock", getV("xray_loading_dock"), "xray_loading_dock"],
["X-ray Availability Time Frame", getV("xray_availability_timeframe"), "xray_availability_timeframe"],


  ["C-arm Manufacturer", getV("carm_manufacturer"), "carm_manufacturer"],
  ["C-arm Model", getV("carm_model"), "carm_model"],
  ["C-arm Serial", getV("carm_serial"), "carm_serial"],
  ["C-arm DOM", getV("carm_dom"), "carm_dom"],
  ["C-arm Monitors", getV("carm_monitors"), "carm_monitors"],
  ["C-arm Image Intensifier", getV("carm_image_intensifier"), "carm_image_intensifier"],
  ["C-arm Software Version", getV("carm_sw_version"), "carm_sw_version"],
  ["C-arm Servicing", getV("carm_servicing"), "carm_servicing"],
  ["C-arm Service Name", getV("carm_service_name"), "carm_service_name"],
  ["C-arm In Use", getV("carm_in_use"), "carm_in_use"],
  ["C-arm Out Of Use Date", getV("carm_out_of_use_date"), "carm_out_of_use_date"],
["C-arm Hard Drives Removed", fmt(getV("carm_hard_drive_removed")), "carm_hard_drive_removed"],
["C-arm Availability Time Frame", getV("carm_availability_timeframe"), "carm_availability_timeframe"],


  ["PET Manufacturer", getV("pet_manufacturer"), "pet_manufacturer"],
  ["PET Model", getV("pet_model"), "pet_model"],
  ["PET Serial", getV("pet_serial"), "pet_serial"],
  ["PET DOM", getV("pet_dom"), "pet_dom"],
  ["PET Tube DOM", getV("pet_tube_dom"), "pet_tube_dom"],
  ["PET Out Of Use Date", getV("pet_out_of_use_date"), "pet_out_of_use_date"],
["PET Hard Drives Removed", fmt(getV("pet_hard_drive_removed")), "pet_hard_drive_removed"],
["PET Loading Dock", getV("pet_loading_dock"), "pet_loading_dock"],
["PET Availability Time Frame", getV("pet_availability_timeframe"), "pet_availability_timeframe"],

  ["Mammo Manufacturer", getV("mamo_manufacturer"), "mamo_manufacturer"],
["Mammo Model", getV("mamo_model"), "mamo_model"],
["Mammo Serial", getV("mamo_serial"), "mamo_serial"],
["Mammo DOM", getV("mamo_dom"), "mamo_dom"],
["Mammo 2D/3D", getV("mamo_dimensionality"), "mamo_dimensionality"],
["Mammo Stereotactic", getV("mamo_stereotactic_options"), "mamo_stereotactic_options"],
["Mammo CAD", getV("mamo_cad"), "mamo_cad"],
["Mammo In Use", getV("mamo_in_use"), "mamo_in_use"],
["Mammo Out Of Use Date", getV("mamo_out_of_use_date"), "mamo_out_of_use_date"],
["Mammo Removal Pathways", getV("mamo_removal_pathways"), "mamo_removal_pathways"],
["Mammo Hard Drives Removed", fmt(getV("mamo_hard_drive_removed")), "mamo_hard_drive_removed"],
["Mammo Loading Dock", getV("mamo_loading_dock"), "mamo_loading_dock"],
["Mammo Availability Time Frame", getV("mamo_availability_timeframe"), "mamo_availability_timeframe"],

  ["Other Manufacturer", getV("other_manufacturer"), "other_manufacturer"],
  ["Other Model", getV("other_model"), "other_model"],
  ["Other Serial", getV("other_serial"), "other_serial"]
];

// ===== FINAL RENDER (ONLY SELECTED MODALITY) =====
const htmlRows = rows
  .filter(([, value, rawKey]) => {
    if (!rawKey || !rawKey.startsWith(activePrefix)) return false;
    return shouldShow(rawKey, value);
  })
  .map(([label, value, rawKey]) => {
    const updated = rawKey && Array.isArray(changedFields) && changedFields.includes(rawKey);
    const color = updated ? "#1F7BC8" : "#111827";
    const weight = updated ? "800" : "500";

    return `
    <tr style="border-bottom:1px solid #eee;">
      <td style="padding:12px 10px; font-weight:700; width:40%; color:#333;">${esc(label)}</td>
      <td style="padding:12px 10px; color:${color}; font-weight:${weight};">${esc(fmt(value))}</td>
    </tr>`;
  })
  .join("");

    const addressLine = [
      project.site_address,
      [project.city, project.state].filter(Boolean).join(", "),
      project.zip_code
    ].filter(Boolean).join("<br>");

    const html = `
      <div style="font-family:Arial;max-width:700px;margin:auto">
        <h2 style="margin-bottom:6px;">Equipment Update: ${esc(project.project_name)}</h2>
        <div style="margin-bottom:14px; color:#444; font-size:15px; line-height:1.4;">${addressLine}</div>
        <div style="background:#1665A3;color:#fff;padding:10px 14px;font-weight:bold;margin-top:10px;">Equipment Details</div>
        <table width="100%" style="border-collapse:collapse; font-size:15px; background:#fff;">${htmlRows}</table>
      </div>`;

    await resend.emails.send({
      from: FROM_EMAIL,
      to: recipients,
      subject: `Equipment Update: ${project.project_name}`,
      html
    });

    for (const email of recipients) {
      if (email === actorEmail) continue;
      await kv.incr(`equipment:unread:details:${projectId}:${modalityId}:${email}`);
      const badge = await recomputeBadge(email);
      await sendPushToUsers("Equipment Update", `${project.project_name} updated`, { recipients: [email], projectId, modalityId, badge });
    }

    await kv.del(`equipment:changed:${projectId}`);
    await kv.del(`equipment:changed:${projectId}:${modalityId}`);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("equipment-details-send error:", err);
    return res.status(500).json({ error: "Failed" });
  } finally {
    client.release();
  }
}