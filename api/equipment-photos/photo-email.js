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

const clean = v => String(v || "").toLowerCase().trim();
const cleanText = v => String(v || "").trim();

function safeJson(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch {
      return {};
    }
  }
  return body;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
function fmt(v) {
  if (v === true || v === "true" || v === 1) return "Yes";
  if (v === false || v === "false" || v === 0) return "No";
  if (v == null || v === "") return "—";

  if (typeof v === "string" && /^\d{4}-\d{2}$/.test(v)) {
    const [y, m] = v.split("-");
    const monthName = new Date(`${y}-${m}-01`).toLocaleString("en-US", {
      month: "long"
    });
    return `${monthName} ${y}`;
  }

  if (Array.isArray(v)) {
    return v.map(x => String(x || "").trim()).filter(Boolean).join(", ") || "—";
  }

  if (typeof v === "object") {
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }

  return String(v);
}
function isHttpUrl(value) {
  return /^https?:\/\/.+/i.test(String(value || "").trim());
}

function buildImageSrc(photoUrl) {
  const raw = String(photoUrl || "").trim();
  return isHttpUrl(raw) ? raw : null;
}

function buildEquipmentHtml(details = {}) {
  let data = {};

  if (details && typeof details.data === "object" && details.data !== null) {
    data = details.data;
  } else if (typeof details.data === "string") {
    try {
      data = JSON.parse(details.data);
    } catch {
      data = {};
    }
  }

  const source = {
    ...data,
    ...details
  };

  const hasValue = (key) => {
    const v = source[key];
    return v !== undefined && v !== null && String(v).trim() !== "";
  };

  let activePrefix = "";

  const modalityRaw = String(
    source.modality ||
    source.tradein_equipment_modality ||
    ""
  ).trim().toLowerCase();

  const prefixMap = {
    ct: "ct_",
    mri: "mri_",
    mr: "mri_",
    xray: "xray_",
    "x-ray": "xray_",
    carm: "carm_",
    "c-arm": "carm_",
    pet: "pet_",
    petct: "pet_",
    "pet/ct": "pet_",
    "pet-ct": "pet_",
    mamo: "mamo_",
    mammo: "mamo_",
    mammography: "mamo_",
    other: "other_"
  };

  activePrefix = prefixMap[modalityRaw] || "";

  if (!activePrefix) {
    if (Object.keys(source).some(k => k.startsWith("ct_") && hasValue(k))) activePrefix = "ct_";
    else if (Object.keys(source).some(k => k.startsWith("mri_") && hasValue(k))) activePrefix = "mri_";
    else if (Object.keys(source).some(k => k.startsWith("xray_") && hasValue(k))) activePrefix = "xray_";
    else if (Object.keys(source).some(k => k.startsWith("carm_") && hasValue(k))) activePrefix = "carm_";
    else if (Object.keys(source).some(k => k.startsWith("pet_") && hasValue(k))) activePrefix = "pet_";
    else if (Object.keys(source).some(k => k.startsWith("mamo_") && hasValue(k))) activePrefix = "mamo_";
    else if (Object.keys(source).some(k => k.startsWith("other_") && hasValue(k))) activePrefix = "other_";
  }

  const getV = (...keys) => {
    for (const key of keys) {
      const v = source[key];
      if (v !== undefined && v !== null && String(v).trim() !== "") return v;
    }
    return "";
  };

  const shouldShow = (key, value) => {
    const isYes = (v) => ["y", "yes", "true", "1"].includes(String(v ?? "").trim().toLowerCase());
    const isNo = (v) => ["n", "no", "false", "0"].includes(String(v ?? "").trim().toLowerCase());

    if (key === "ct_injector_model") return isYes(getV("ct_injector"));
    if (key === "ct_upgrades_desc") return isYes(getV("ct_upgrades"));
    if (key === "ct_out_of_use_date") return isNo(getV("ct_in_use"));

    if (key === "mri_service_name") return isYes(getV("mri_service"));
    if (key === "mri_out_of_use_date") return isNo(getV("mri_in_use"));

    if (key === "xray_out_of_use_date") return isNo(getV("xray_in_use"));

    if (key === "carm_service_name") return isYes(getV("carm_servicing"));
    if (key === "carm_out_of_use_date") return isNo(getV("carm_in_use"));

    if (key === "pet_out_of_use_date") return isNo(getV("pet_in_use"));

    if (key === "mamo_out_of_use_date") return isNo(getV("mamo_in_use"));

    return value !== undefined && value !== null && String(value).trim() !== "";
  };

  const rows = [
    ["CT Model", getV("ct_model", "model", "tradein_equipment_model"), "ct_model"],
    ["CT Manufacturer", getV("ct_manufacturer", "make", "tradein_equipment_make"), "ct_manufacturer"],
    ["CT Serial", getV("ct_serial", "serial_number", "axis_serial_number", "tradein_equipment_serial_number"), "ct_serial"],
    ["CT Installed", getV("ct_installed", "installed_date"), "ct_installed"],
    ["CT Dom", getV("ct_dom", "dom", "tradein_equipment_dom"), "ct_dom"],
    ["CT Tube Dom", getV("ct_tube_dom"), "ct_tube_dom"],
    ["CT Mhu", getV("ct_mhu"), "ct_mhu"],
    ["CT Tube Mas", getV("ct_tube_mas"), "ct_tube_mas"],
    ["CT Slices", getV("ct_slices"), "ct_slices"],
    ["CT In Use", getV("ct_in_use", "in_use_status", "tradein_in_use_status"), "ct_in_use"],
    ["CT Out Of Use Date", getV("ct_out_of_use_date", "out_of_use_date", "tradein_out_of_use_date"), "ct_out_of_use_date"],
    ["CT Injector", getV("ct_injector"), "ct_injector"],
    ["CT Injector Model", getV("ct_injector_model"), "ct_injector_model"],
    ["CT Upgrades", getV("ct_upgrades"), "ct_upgrades"],
    ["CT Upgrades Description", getV("ct_upgrades_desc", "upgrade_notes", "tradein_upgrade_notes"), "ct_upgrades_desc"],
    ["CT Hard Drives Removed", getV("ct_hard_drive_removed", "hard_drive_removed", "tradein_hard_drive_removed"), "ct_hard_drive_removed"],
    ["CT Removal Pathways", getV("ct_removal_pathways", "removal_pathways", "tradein_removal_pathways"), "ct_removal_pathways"],
    ["CT Availability Time Frame", getV("ct_availability_timeframe", "availability_timeframe", "tradein_availability_timeframe"), "ct_availability_timeframe"],

    ["MRI Manufacturer", getV("mri_manufacturer", "make", "tradein_equipment_make"), "mri_manufacturer"],
    ["MRI Model", getV("mri_model", "model", "tradein_equipment_model"), "mri_model"],
    ["MRI Serial", getV("mri_serial", "serial_number", "axis_serial_number", "tradein_equipment_serial_number"), "mri_serial"],
    ["MRI Year", getV("mri_yom", "dom", "tradein_equipment_dom"), "mri_yom"],
    ["MRI Magnet Type", getV("mri_magnet_type"), "mri_magnet_type"],
    ["MRI Bore Size", getV("mri_bore_size_cm"), "mri_bore_size_cm"],
    ["MRI Channels", getV("mri_num_channels"), "mri_num_channels"],
    ["MRI Gradient", getV("mri_gradient"), "mri_gradient"],
    ["MRI Software Version", getV("mri_sw_version", "software_version", "tradein_software_version"), "mri_sw_version"],
    ["MRI Software Options", getV("mri_sw_options"), "mri_sw_options"],
    ["MRI TIM", getV("mri_tim"), "mri_tim"],
    ["MRI Coils", getV("mri_coils"), "mri_coils"],
    ["MRI Service", getV("mri_service"), "mri_service"],
    ["MRI Service Name", getV("mri_service_name"), "mri_service_name"],
    ["MRI Under Contract", getV("mri_under_contract"), "mri_under_contract"],
    ["MRI Last PM", getV("mri_last_pm"), "mri_last_pm"],
    ["MRI In Use", getV("mri_in_use", "in_use_status", "tradein_in_use_status"), "mri_in_use"],
    ["MRI Out Of Use Date", getV("mri_out_of_use_date", "out_of_use_date", "tradein_out_of_use_date"), "mri_out_of_use_date"],
    ["MRI Hard Drives Removed", getV("mri_hard_drive_removed", "hard_drive_removed", "tradein_hard_drive_removed"), "mri_hard_drive_removed"],
    ["MRI Removal Pathways", getV("mri_removal_pathways", "removal_pathways", "tradein_removal_pathways"), "mri_removal_pathways"],
    ["MRI Availability Time Frame", getV("mri_availability_timeframe", "availability_timeframe", "tradein_availability_timeframe"), "mri_availability_timeframe"],

    ["X-ray Manufacturer", getV("xray_manufacturer", "make", "tradein_equipment_make"), "xray_manufacturer"],
    ["X-ray Model", getV("xray_model", "model", "tradein_equipment_model"), "xray_model"],
    ["X-ray Serial", getV("xray_serial", "serial_number", "axis_serial_number", "tradein_equipment_serial_number"), "xray_serial"],
    ["X-ray DOM", getV("xray_dom", "dom", "tradein_equipment_dom"), "xray_dom"],
    ["X-ray Floor Mounted", getV("xray_floor_mounted"), "xray_floor_mounted"],
    ["X-ray Ceiling Mounted", getV("xray_ceiling_mounted"), "xray_ceiling_mounted"],
    ["X-ray RF", getV("xray_is_rf"), "xray_is_rf"],
    ["X-ray In Use", getV("xray_in_use", "in_use_status", "tradein_in_use_status"), "xray_in_use"],
    ["X-ray Out Of Use Date", getV("xray_out_of_use_date", "out_of_use_date", "tradein_out_of_use_date"), "xray_out_of_use_date"],
    ["X-ray Loading Dock", getV("xray_loading_dock", "loading_dock", "tradein_loading_dock"), "xray_loading_dock"],
    ["X-ray Availability Time Frame", getV("xray_availability_timeframe", "availability_timeframe", "tradein_availability_timeframe"), "xray_availability_timeframe"],

    ["C-arm Manufacturer", getV("carm_manufacturer", "make", "tradein_equipment_make"), "carm_manufacturer"],
    ["C-arm Model", getV("carm_model", "model", "tradein_equipment_model"), "carm_model"],
    ["C-arm Serial", getV("carm_serial", "serial_number", "axis_serial_number", "tradein_equipment_serial_number"), "carm_serial"],
    ["C-arm DOM", getV("carm_dom", "dom", "tradein_equipment_dom"), "carm_dom"],
    ["C-arm Monitors", getV("carm_monitors"), "carm_monitors"],
    ["C-arm Image Intensifier", getV("carm_image_intensifier"), "carm_image_intensifier"],
    ["C-arm Software Version", getV("carm_sw_version", "software_version", "tradein_software_version"), "carm_sw_version"],
    ["C-arm Servicing", getV("carm_servicing"), "carm_servicing"],
    ["C-arm Service Name", getV("carm_service_name"), "carm_service_name"],
    ["C-arm In Use", getV("carm_in_use", "in_use_status", "tradein_in_use_status"), "carm_in_use"],
    ["C-arm Out Of Use Date", getV("carm_out_of_use_date", "out_of_use_date", "tradein_out_of_use_date"), "carm_out_of_use_date"],
    ["C-arm Hard Drives Removed", getV("carm_hard_drive_removed", "hard_drive_removed", "tradein_hard_drive_removed"), "carm_hard_drive_removed"],
    ["C-arm Availability Time Frame", getV("carm_availability_timeframe", "availability_timeframe", "tradein_availability_timeframe"), "carm_availability_timeframe"],

    ["PET Manufacturer", getV("pet_manufacturer", "make", "tradein_equipment_make"), "pet_manufacturer"],
    ["PET Model", getV("pet_model", "model", "tradein_equipment_model"), "pet_model"],
    ["PET Serial", getV("pet_serial", "serial_number", "axis_serial_number", "tradein_equipment_serial_number"), "pet_serial"],
    ["PET DOM", getV("pet_dom", "dom", "tradein_equipment_dom"), "pet_dom"],
    ["PET Tube DOM", getV("pet_tube_dom"), "pet_tube_dom"],
    ["PET Tube Mas", getV("pet_tube_mas"), "pet_tube_mas"],
    ["PET CT Slices", getV("pet_ct_slices"), "pet_ct_slices"],
    ["PET In Use", getV("pet_in_use", "in_use_status", "tradein_in_use_status"), "pet_in_use"],
    ["PET Out Of Use Date", getV("pet_out_of_use_date", "out_of_use_date", "tradein_out_of_use_date"), "pet_out_of_use_date"],
    ["PET Removal Pathways", getV("pet_removal_pathways", "removal_pathways", "tradein_removal_pathways"), "pet_removal_pathways"],
    ["PET Hard Drives Removed", getV("pet_hard_drive_removed", "hard_drive_removed", "tradein_hard_drive_removed"), "pet_hard_drive_removed"],
    ["PET Loading Dock", getV("pet_loading_dock", "loading_dock", "tradein_loading_dock"), "pet_loading_dock"],
    ["PET Availability Time Frame", getV("pet_availability_timeframe", "availability_timeframe", "tradein_availability_timeframe"), "pet_availability_timeframe"],

    ["Mammo Manufacturer", getV("mamo_manufacturer", "make", "tradein_equipment_make"), "mamo_manufacturer"],
    ["Mammo Model", getV("mamo_model", "model", "tradein_equipment_model"), "mamo_model"],
    ["Mammo Serial", getV("mamo_serial", "serial_number", "axis_serial_number", "tradein_equipment_serial_number"), "mamo_serial"],
    ["Mammo DOM", getV("mamo_dom", "dom", "tradein_equipment_dom"), "mamo_dom"],
    ["Mammo 2D/3D", getV("mamo_dimensionality"), "mamo_dimensionality"],
    ["Mammo Stereotactic", getV("mamo_stereotactic_options"), "mamo_stereotactic_options"],
    ["Mammo CAD", getV("mamo_cad"), "mamo_cad"],
    ["Mammo In Use", getV("mamo_in_use", "in_use_status", "tradein_in_use_status"), "mamo_in_use"],
    ["Mammo Out Of Use Date", getV("mamo_out_of_use_date", "out_of_use_date", "tradein_out_of_use_date"), "mamo_out_of_use_date"],
    ["Mammo Removal Pathways", getV("mamo_removal_pathways", "removal_pathways", "tradein_removal_pathways"), "mamo_removal_pathways"],
    ["Mammo Hard Drives Removed", getV("mamo_hard_drive_removed", "hard_drive_removed", "tradein_hard_drive_removed"), "mamo_hard_drive_removed"],
    ["Mammo Loading Dock", getV("mamo_loading_dock", "loading_dock", "tradein_loading_dock"), "mamo_loading_dock"],
    ["Mammo Availability Time Frame", getV("mamo_availability_timeframe", "availability_timeframe", "tradein_availability_timeframe"), "mamo_availability_timeframe"],

    ["Other Manufacturer", getV("other_manufacturer", "make", "tradein_equipment_make"), "other_manufacturer"],
    ["Other Model", getV("other_model", "model", "tradein_equipment_model"), "other_model"],
    ["Other Serial", getV("other_serial", "serial_number", "axis_serial_number", "tradein_equipment_serial_number"), "other_serial"]
  ];

  const htmlRows = rows
    .filter(([, value, rawKey]) => {
      if (!activePrefix) return false;
      if (!rawKey || !rawKey.startsWith(activePrefix)) return false;
      return shouldShow(rawKey, value);
    })
    .map(([label, value]) => `
      <tr style="border-bottom:1px solid #eee;">
        <td style="padding:12px 10px;font-weight:700;width:40%;color:#333;">
          ${escapeHtml(label)}
        </td>
        <td style="padding:12px 10px;color:#111827;font-weight:500;text-align:right;">
          ${escapeHtml(fmt(value))}
        </td>
      </tr>
    `)
    .join("");

  if (!htmlRows) return "";

  return `
    <div style="margin-top:20px;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
      <div style="background:#1F7BC8;color:#fff;padding:10px 14px;font-weight:800">
        EQUIPMENT DETAILS
      </div>
      <table width="100%" style="border-collapse:collapse;font-size:15px;background:#fff;">
        ${htmlRows}
      </table>
    </div>
  `;
}
async function recomputeBadge(email) {
  const e = clean(email);
  if (!e) return 0;

  const keys = await kv.keys(`equipment:unread:*:*:*:${e}`);
  const values = keys.length ? await kv.mget(...keys) : [];
  const total = values.reduce((sum, v) => sum + (Number(v) || 0), 0);

  await kv.set(`app:badge:equipment:${e}`, total);
  await kv.set(`ios:badge:counter:equipment:${e}`, total);

  return total;
}

async function getAccessEmails(projectId) {
  const emails = new Set();

  const accessKeys = await kv.keys(`equipment_project_access:${projectId}:*`);

  for (const key of accessKeys) {
    const email = clean(key.split(":").pop());
    if (email) emails.add(email);
  }

  return emails;
}

async function getRecipients(projectId, senderEmail, project) {
  const recipients = new Set();

  const sender = clean(senderEmail);
  const ownerEmail = clean(project?.sales_rep_email);

  recipients.add(ADMIN_EMAIL);

  if (ownerEmail) {
    recipients.add(ownerEmail);
  }

  const accessEmails = await getAccessEmails(projectId);

  accessEmails.forEach(email => {
    if (email) recipients.add(email);
  });

  // Important: keep sender included.
  // If sender is admin/owner and we remove them, recipients may become empty.
  if (sender) {
    recipients.add(sender);
  }

  return [...recipients].filter(Boolean);
}

async function isAuthorized(projectId, senderEmail, project) {
  const sender = clean(senderEmail);
  const ownerEmail = clean(project?.sales_rep_email);

  if (!sender) return false;
  if (sender === ADMIN_EMAIL) return true;
  if (sender === ownerEmail) return true;

  const accessEmails = await getAccessEmails(projectId);
  return accessEmails.has(sender);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");

  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = safeJson(req.body);

  const projectId = cleanText(body.projectId);
  const modalityId = cleanText(body.modalityId);
  const photoIds = Array.isArray(body.photoIds)
    ? body.photoIds.map(String).filter(Boolean)
    : [];

  const senderEmail = clean(req.headers["x-user-email"]);

  if (!projectId || !modalityId || !photoIds.length || !senderEmail) {
    return res.status(400).json({
      error: "Invalid request",
      details: {
        hasProjectId: Boolean(projectId),
        hasModalityId: Boolean(modalityId),
        photoCount: photoIds.length,
        hasSenderEmail: Boolean(senderEmail)
      }
    });
  }

  if (!process.env.RESEND_API_KEY) {
    return res.status(500).json({ error: "Missing RESEND_API_KEY" });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const client = await pool.connect();

  try {
    const projectRes = await client.query(
      `
      SELECT *
      FROM equipment_projects
      WHERE id = $1
      LIMIT 1
      `,
      [projectId]
    );

    const project = projectRes.rows[0];

    if (!project) {
      return res.status(404).json({ error: "Project not found" });
    }

    const authorized = await isAuthorized(projectId, senderEmail, project);

    if (!authorized) {
      return res.status(403).json({
        error: "Not authorized to send images for this project"
      });
    }

   const detailsRes = await client.query(
  `
  SELECT *
  FROM equipment_details
  WHERE project_id = $1
    AND modality_id = $2
  ORDER BY updated_at DESC
  LIMIT 1
  `,
  [projectId, modalityId]
);

const equipmentHtml = buildEquipmentHtml(detailsRes.rows[0] || {});

    const photosRes = await client.query(
      `
      SELECT id, photo_url, photo_title, photo_comment
      FROM equipment_photos
      WHERE project_id = $1
        AND modality_id = $2
        AND id = ANY($3::uuid[])
      ORDER BY created_at DESC
      `,
      [projectId, modalityId, photoIds]
    );

    if (!photosRes.rows.length) {
      return res.status(400).json({
        error: "No valid images found for this project/modality"
      });
    }

    const prepared = photosRes.rows
      .map((p, i) => {
        const src = buildImageSrc(p.photo_url);
        if (!src) return null;

        return {
          id: String(p.id),
          label: cleanText(p.photo_title) || `Image ${i + 1}`,
          src,
          comment: cleanText(p.photo_comment)
        };
      })
      .filter(Boolean);

    if (!prepared.length) {
      return res.status(400).json({ error: "No valid image URLs" });
    }

    const imagesHtml = prepared
      .map(img => `
        <div style="margin-bottom:24px;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
          <div style="padding:10px 14px;background:#f8fafc;border-bottom:1px solid #e5e7eb">
            <div style="font-size:11px;font-weight:700;color:#1F7BC8;letter-spacing:.5px">
              IMAGE NAME
            </div>
            <div style="font-size:14px;font-weight:700;color:#0f172a">
              ${escapeHtml(img.label)}
            </div>
          </div>

          <img src="${escapeHtml(img.src)}" style="width:100%;display:block">

          ${
            img.comment
              ? `<div style="padding:10px 14px;border-top:1px solid #e5e7eb;font-size:13px;color:#334155">
                  ${escapeHtml(img.comment)}
                 </div>`
              : ""
          }
        </div>
      `)
      .join("");

    const html = `
      <div style="font-family:Arial;max-width:650px;margin:auto">
        <div style="border-bottom:3px solid #1F7BC8;padding-bottom:12px;margin-bottom:16px">
          <div style="font-size:20px;font-weight:800">
            ${escapeHtml(project.project_name)}
          </div>
          <div>${escapeHtml(project.site_address || "")}</div>
          <div>
            ${escapeHtml(project.city || "")}
            ${escapeHtml(project.state || "")}
            ${escapeHtml(project.zip_code || "")}
          </div>
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

    const recipients = await getRecipients(projectId, senderEmail, project);

    if (!recipients.length) {
      return res.status(400).json({ error: "No recipients found" });
    }

    const emailResult = await resend.emails.send({
      from: FROM_EMAIL,
      to: recipients,
      subject: `Equipment Images – ${project.project_name}`,
      html
    });

    if (emailResult?.error) {
      console.error("RESEND ERROR:", emailResult.error);
      return res.status(500).json({
        error: "Email send failed",
        details: emailResult.error
      });
    }

    for (const email of recipients) {
      const normalizedEmail = clean(email);

      // Do not create unread badge/push for sender's own action.
      if (!normalizedEmail || normalizedEmail === senderEmail) continue;

      const badgeKey = `equipment:badges_images:${projectId}:${modalityId}:${normalizedEmail}`;

      const existing = await kv.get(badgeKey);
      let current = [];

      if (existing) {
        try {
          const parsed =
            typeof existing === "string" ? JSON.parse(existing) : existing;

          if (Array.isArray(parsed)) {
            current = parsed;
          }
        } catch {}
      }

      const merged = [
        ...new Set([
          ...current.map(String),
          ...prepared.map(p => p.id)
        ])
      ];

      await kv.set(badgeKey, merged);
      await kv.incr(`equipment:unread:images:${projectId}:${modalityId}:${normalizedEmail}`);

      const badge = await recomputeBadge(normalizedEmail);

      await sendPushToUsers(
        project.project_name,
        `Equipment and Images Update – ${prepared.length} new images`,
        {
          recipients: [normalizedEmail],
          projectId,
          modalityId,
          badge
        }
      );
    }

    return res.status(200).json({
      success: true,
      recipients,
      imageCount: prepared.length,
      emailId: emailResult?.data?.id || null
    });

  } catch (err) {
    console.error("PHOTO EMAIL ERROR:", err);

    return res.status(500).json({
      error: "Failed",
      details: err.message || String(err)
    });
  } finally {
    client.release();
  }
}