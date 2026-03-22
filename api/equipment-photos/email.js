import { Pool } from "pg";
import { Resend } from "resend";
import { sendPushToUsers } from "../_lib/push.js";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const FROM_EMAIL = "Espin Medical <info@espinmedical.com>";
const ADMIN_EMAIL = "info@espinmedical.com";

/* ───────── HELPERS ───────── */
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
  if (isHttpUrl(raw)) return raw;
  return null;
}

function safeJson(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try { return JSON.parse(body); }
    catch { return {}; }
  }
  return body;
}

/* ───────── FORMATTER ───────── */
const fmt = (key, v) => {
  if (v === true || v === "true" || v === 1) return "Yes";
  if (v === false || v === "false" || v === 0) return "No";
  if (v === null || v === undefined || v === "") return "—";

  const str = String(v).trim();
  const isDateField = /date|dom|installed|start|completed/i.test(key);

  if (isDateField) {
    try {
      const d = new Date(
        str.includes("T") ? str : str.replace(" ", "T") + "Z"
      );
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString("en-US", {
          month: "short",
          day: "2-digit",
          year: "numeric",
          timeZone: "UTC"
        });
      }
    } catch {}
  }

  return str;
};

/* ───────── ORDER SYSTEM ───────── */

const ORDER = {
  CT: [
    "ct_manufacturer","ct_model","ct_serial","ct_dom","ct_installed",
    "ct_slices","ct_tube_mas","ct_mhu","ct_tube_dom",
    "ct_tube_installation_date","ct_sw_version","ct_goc_version",
    "ct_upgrades","ct_upgrades_desc",
    "ct_injector","ct_injector_model",
    "ct_chiller","ct_in_use","ct_out_of_use_date"
  ],
  MRI: [
    "mri_manufacturer","mri_model","mri_serial","mri_yom","mri_magnet_type",
    "mri_bore_size_cm","mri_num_channels","mri_gradient",
    "mri_sw_version","mri_coils","mri_service",
    "mri_service_name","mri_in_use","mri_out_of_use_date"
  ],
  XRAY: [
    "xray_manufacturer","xray_model","xray_serial",
    "xray_floor_mounted","xray_ceiling_mounted"
  ],
  CARM: [
    "carm_manufacturer","carm_model","carm_serial",
    "carm_monitors","carm_image_intensifier"
  ],
  PETCT: [
    "pet_manufacturer","pet_model","pet_serial","pet_ct_slices",
    "pet_tube_dom","pet_tube_mas"
  ]
};

function detectModality(details, fallback) {
  if (fallback) return fallback;

  const keys = Object.keys(details || {});
  if (keys.some(k => k.startsWith("ct_"))) return "CT";
  if (keys.some(k => k.startsWith("mri_"))) return "MRI";
  if (keys.some(k => k.startsWith("xray_"))) return "XRAY";
  if (keys.some(k => k.startsWith("carm_"))) return "CARM";
  if (keys.some(k => k.startsWith("pet_"))) return "PETCT";
  return null;
}

function getSerialForHeader(row) {
  return cleanText(
    row?.mri_serial ||
    row?.xray_serial ||
    row?.pet_serial ||
    row?.carm_serial ||
    row?.data?.ct_serial ||
    row?.data?.mri_serial ||
    row?.data?.xray_serial ||
    row?.data?.pet_serial ||
    row?.data?.carm_serial ||
    row?.data?.serial_number ||
    ""
  );
}

function getIdentifierForHeader(row) {
  return cleanText(
    row?.data?.additional_identifier ||
    row?.data?.asset_tag ||
    row?.data?.unit_number ||
    ""
  );
}

/* ───────── BUILD EQUIPMENT DETAILS HTML ───────── */
function buildEquipmentHtml(details, projectModality) {
  if (!details || typeof details !== "object") return "";

  const modality = detectModality(details, projectModality);
  const order = ORDER[modality] || [];

  if (!order.length) {
    const rows = Object.entries(details)
      .filter(([k, v]) => k && v !== null && v !== "" && typeof v !== "object")
      .map(([k, v]) => {
        const label = k
          .replace(/^(ct_|mri_|xray_|carm_|pet_)/, "")
          .replace(/_/g, " ")
          .replace(/\b\w/g, c => c.toUpperCase());

        return `
<tr>
<td style="padding:8px;border-bottom:1px solid #eee"><b>${escapeHtml(label)}</b></td>
<td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${escapeHtml(fmt(k, v))}</td>
</tr>`;
      }).join("");

    return rows ? `
<h3 style="background:#0066B2;color:#fff;padding:10px;margin:20px 0 0 0;font-family:Arial;font-size:15px">
Equipment Details
</h3>
<table width="100%" style="border:1px solid #eee;border-top:none;border-collapse:collapse;margin-bottom:20px">
${rows}
</table>` : "";
  }

  const rows = order
    .filter(k => details[k] !== undefined && details[k] !== null && details[k] !== "")
    .map(k => {
      const label = k
        .replace(/^(ct_|mri_|xray_|carm_|pet_)/, "")
        .replace(/_/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase());

      return `
<tr>
<td style="padding:8px;border-bottom:1px solid #eee"><b>${escapeHtml(label)}</b></td>
<td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${escapeHtml(fmt(k, details[k]))}</td>
</tr>`;
    })
    .join("");

  if (!rows) return "";

  return `
<h3 style="background:#0066B2;color:#fff;padding:10px;margin:20px 0 0 0;font-family:Arial;font-size:15px">
Equipment Details
</h3>
<table width="100%" style="border:1px solid #eee;border-top:none;border-collapse:collapse;margin-bottom:20px">
${rows}
</table>`;
}

/* ───────── HANDLER ───────── */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    console.error("❌ RESEND_API_KEY missing");
    return res.status(500).json({ error: "Email service not configured" });
  }

  const resend = new Resend(RESEND_API_KEY);

  const body = safeJson(req.body);
  const projectId = cleanText(body.projectId);
  const modalityId = cleanText(body.modalityId);
  const originalIds = Array.isArray(body.photoIds) ? body.photoIds : [];

  const actorEmail = clean(
    req.headers["x-user-email"] ||
    req.headers["x-useremail"] ||
    req.headers["x-user_email"]
  );

  if (!projectId || !actorEmail || !originalIds.length) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const client = await pool.connect();

  try {
    const projectResult = await client.query(
      `
      SELECT id, project_name, site_address, zip_code, modality
      FROM projects p
      WHERE p.id = $1
        AND p.hidden = false
      LIMIT 1
      `,
      [projectId]
    );

    if (!projectResult.rows.length) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const project = projectResult.rows[0];

    if (modalityId) {
      const modalityRes = await client.query(
        `
        SELECT id, modality
        FROM project_modalities
        WHERE id = $1
          AND project_id = $2
        LIMIT 1
        `,
        [modalityId, projectId]
      );

      if (!modalityRes.rows.length) {
        return res.status(404).json({ error: "Modality not found for this project" });
      }
    }

    let detailsRes;

    if (modalityId) {
      detailsRes = await client.query(
        `
        SELECT
          data,
          modality,
          mri_serial,
          xray_serial,
          pet_serial,
          carm_serial
        FROM equipment_details
        WHERE project_id = $1
          AND modality_id = $2
        LIMIT 1
        `,
        [projectId, modalityId]
      );
    } else {
      detailsRes = await client.query(
        `
        SELECT
          data,
          modality,
          mri_serial,
          xray_serial,
          pet_serial,
          carm_serial
        FROM equipment_details
        WHERE project_id = $1
        ORDER BY updated_at DESC NULLS LAST, id DESC NULLS LAST
        LIMIT 1
        `,
        [projectId]
      );
    }

    const detailsRow = detailsRes.rows[0] || {};
    const equipmentHtml = buildEquipmentHtml(
      detailsRow.data || {},
      detailsRow.modality || project.modality
    );

    const serialForHeader = getSerialForHeader(detailsRow);
    const identifierForHeader = getIdentifierForHeader(detailsRow);

    let validResult;

    if (modalityId) {
      validResult = await client.query(
        `
        SELECT id, photo_url, photo_title, photo_comment, modality_id
        FROM equipment_photos
        WHERE project_id = $1
          AND modality_id = $2
          AND hidden = false
          AND id = ANY($3::uuid[])
        ORDER BY created_at DESC
        `,
        [projectId, modalityId, originalIds]
      );
    } else {
      validResult = await client.query(
        `
        SELECT id, photo_url, photo_title, photo_comment, modality_id
        FROM equipment_photos
        WHERE project_id = $1
          AND hidden = false
          AND id = ANY($2::uuid[])
        ORDER BY created_at DESC
        `,
        [projectId, originalIds]
      );
    }

    if (!validResult.rows.length) {
      return res.status(400).json({ error: "No valid images" });
    }

    const prepared = validResult.rows
      .map((p, i) => {
        const src = buildImageSrc(p.photo_url);
        if (!src) return null;

        return {
          label: p.photo_title?.trim() || `Image ${i + 1}`,
          src,
          comment: String(p.photo_comment || "").trim()
        };
      })
      .filter(Boolean);

    if (!prepared.length) {
      return res.json({ sent: false });
    }

    const imagesHtml = prepared.map(img => `
<div style="margin-bottom:32px;max-width:640px">
<div style="font-weight:800;margin-bottom:10px">${escapeHtml(img.label)}</div>
<img src="${img.src}" style="width:100%;max-width:640px;border-radius:14px;border:1px solid #ddd"/>
${img.comment ? `<div style="margin-top:10px;padding:12px;border-radius:12px;border:2px solid #1F7BC8;color:#1F7BC8">${escapeHtml(img.comment)}</div>` : ""}
</div>`).join("");

    const html = `
<div style="font-family:Arial,sans-serif;max-width:650px;margin:0 auto">
<div style="margin-bottom:24px;padding:20px;border:1px solid #e6e6e6;border-radius:14px">
<div style="font-size:18px;font-weight:800">${escapeHtml(project.project_name || "Project")}</div>
<div>${escapeHtml(project.site_address || "—")}</div>
<div>Zip: ${escapeHtml(project.zip_code || "—")}</div>
<div>Modality: ${escapeHtml(detailsRow.modality || project.modality || "—")}</div>
${serialForHeader ? `<div>Serial Number: ${escapeHtml(serialForHeader)}</div>` : ""}
${identifierForHeader ? `<div>Additional Identifier: ${escapeHtml(identifierForHeader)}</div>` : ""}
<div style="margin-top:10px;font-weight:700">Images: ${prepared.length}</div>
</div>
${equipmentHtml}
${imagesHtml}
</div>`;

    const result = await resend.emails.send({
      from: FROM_EMAIL,
      to: [ADMIN_EMAIL],
      subject: `Equipment Images – ${project.project_name} (${prepared.length})`,
      html
    });

    if (result?.error) {
      console.error("RESEND ERROR:", result.error);
      return res.status(500).json({ error: "Email failed" });
    }

    await sendPushToUsers(
      "Equipment Images Sent",
      `${prepared.length} images sent for ${project.project_name}`,
      { project_id: projectId, modality_id: modalityId || null }
    );

    return res.json({ success: true });
  } catch (err) {
    console.error("EMAIL API ERROR:", err);
    return res.status(500).json({ error: "Failed" });
  } finally {
    client.release();
  }
}