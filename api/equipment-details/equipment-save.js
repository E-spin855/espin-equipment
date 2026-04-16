import { Pool } from "pg";
import { kv } from "@vercel/kv";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function cleanText(v) {
  return String(v || "").trim();
}

function cleanModality(v) {
  return String(v || "").toUpperCase().trim();
}

function cleanEmail(v) {
  return String(v || "").toLowerCase().trim();
}

function safeObject(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

function norm(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v.trim();
  return JSON.stringify(v);
}

function getChangedFields(before, after) {
  const oldData = safeObject(before);
  const newData = safeObject(after);

  const keys = Array.from(
    new Set([...Object.keys(oldData), ...Object.keys(newData)])
  );

  return keys.filter((key) => norm(oldData[key]) !== norm(newData[key]));
}

async function sumKeys(keys) {
  if (!Array.isArray(keys) || !keys.length) return 0;
  const values = await kv.mget(...keys);
  return values.reduce((sum, v) => sum + (Number(v) || 0), 0);
}

async function recomputeTotalBadge(userEmail) {
  const email = cleanEmail(userEmail);

  const [projectKeys, detailsKeys, imageKeys] = await Promise.all([
    kv.keys(`equipment:unread:project:*:${email}`),
    kv.keys(`equipment:unread:details:*:*:${email}`),
    kv.keys(`equipment:unread:images:*:*:${email}`)
  ]);

  const [projectTotal, detailsTotal, imageTotal] = await Promise.all([
    sumKeys(projectKeys),
    sumKeys(detailsKeys),
    sumKeys(imageKeys)
  ]);

  const total = projectTotal + detailsTotal + imageTotal;

  await Promise.all([
    kv.set(`app:badge:equipment:${email}`, total),
    kv.set(`ios:badge:counter:equipment:${email}`, total)
  ]);

  return total;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const client = await pool.connect();

  try {
    const body = req.body || {};
    const projectId = cleanText(body.projectId);
    let modalityId = cleanText(body.modalityId);
    const rawData = safeObject(body.data);
    const modality = cleanModality(body.modality || rawData.modality);
    const actorEmail = cleanEmail(
      req.headers["x-user-email"] ||
      body.userEmail ||
      ""
    );

    const adminEmail = "info@espinmedical.com";

    if (!projectId) {
      return res.status(400).json({ error: "Missing projectId" });
    }

    if (!modality) {
      return res.status(400).json({ error: "Missing modality" });
    }

    if (!actorEmail) {
      return res.status(400).json({ error: "Missing user email" });
    }

   const incomingData = {
  ...rawData,

  // 🔥 FORCE BOTH FORMATS
  injector_model: rawData.injector_model ?? rawData.injectorModel,
  injectorModel: rawData.injector_model ?? rawData.injectorModel,

  upgrades_description: rawData.upgrades_description ?? rawData.upgradesDescription,
  upgradesDescription: rawData.upgrades_description ?? rawData.upgradesDescription,

  date_removed_from_service: rawData.date_removed_from_service ?? rawData.dateRemovedFromService,
  dateRemovedFromService: rawData.date_removed_from_service ?? rawData.dateRemovedFromService,

  system_in_use: rawData.system_in_use ?? rawData.systemInUse,
  systemInUse: rawData.system_in_use ?? rawData.systemInUse,

  ct_in_use: rawData.ct_in_use ?? rawData.ctInUse,
  ctInUse: rawData.ct_in_use ?? rawData.ctInUse,

  modality
};

    let beforeData = {};
    let finalData = {};
    let isNewRecord = false;

    await client.query("BEGIN");

    if (!modalityId) {
      isNewRecord = true;

      const created = await client.query(
        `
        INSERT INTO equipment_modalities (
          project_id,
          modality,
          label,
          sort_order
        )
        VALUES (
          $1,
          $2,
          NULL,
          COALESCE(
            (
              SELECT MAX(pm.sort_order) + 1
              FROM equipment_modalities pm
              WHERE pm.project_id = $1
            ),
            0
          )
        )
        RETURNING id
        `,
        [projectId, modality]
      );

      modalityId = created.rows[0]?.id || "";

      if (!modalityId) {
        throw new Error("Failed to create modality record");
      }

      finalData = incomingData;
    } else {
      const existing = await client.query(
  `
  SELECT ed.data
  FROM equipment_details ed
  WHERE ed.modality_id = $1
    AND ed.project_id = $2
  LIMIT 1
  `,
  [modalityId, projectId]
);
      beforeData = safeObject(existing.rows[0]?.data);

      const updated = await client.query(
        `
        UPDATE equipment_modalities
        SET
          modality = $2,
          updated_at = NOW()
        WHERE id = $1
          AND project_id = $3
        RETURNING id
        `,
        [modalityId, modality, projectId]
      );

      if (!updated.rowCount) {
        throw new Error("modalityId not found for this project");
      }

      finalData = {
        ...beforeData,
        ...incomingData,
        modality
      };
    }

    await client.query(
      `
      INSERT INTO equipment_details (
        project_id,
        modality_id,
        modality,
        data,
        updated_at
      )
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (modality_id)
      DO UPDATE SET
        project_id = EXCLUDED.project_id,
        modality = EXCLUDED.modality,
        data = EXCLUDED.data,
        updated_at = NOW()
      `,
      [projectId, modalityId, modality, finalData]
    );

    const savedRow = await client.query(
      `
      SELECT
        ed.modality_id,
        ed.project_id,
        ed.modality,
        ed.data,
        ed.updated_at
      FROM equipment_details ed
      WHERE ed.project_id = $1
        AND ed.modality_id = $2
      LIMIT 1
      `,
      [projectId, modalityId]
    );

    const realModalityId = cleanText(savedRow.rows[0]?.modality_id || modalityId);
    const persistedData = safeObject(savedRow.rows[0]?.data);

    if (!realModalityId) {
      throw new Error("Failed to resolve saved modalityId");
    }

    await client.query("COMMIT");

    const changedFields = isNewRecord
      ? Object.keys(persistedData).filter(Boolean)
      : getChangedFields(beforeData, persistedData);

    console.log("[equipment-details/save] change-debug", {
      projectId,
      requestedModalityId: modalityId,
      realModalityId,
      modality,
      isNewRecord,
      incomingKeys: Object.keys(incomingData || {}),
      beforeKeys: Object.keys(beforeData || {}),
      persistedKeys: Object.keys(persistedData || {}),
      changedFields
    });

    if (changedFields.length) {
      const changedPayload = {
  changedFields,
  ts: Date.now(),
  modality
};
const ADMIN_EMAIL = "info@espinmedical.com";

// 🔥 GLOBAL (legacy / fallback)
await kv.set(
  `equipment:changed:${projectId}:${realModalityId}`,
  changedPayload
);

// 🔥 ADMIN METADATA
await kv.set(
  `equipment:changed:${projectId}:${realModalityId}:${ADMIN_EMAIL}`,
  changedPayload
);

// 🔥 ADMIN FIELDS (THIS FIXES YOUR ISSUE)
await kv.set(
  `equipment:changed:${projectId}:${realModalityId}:${ADMIN_EMAIL}:fields`,
  changedFields
);

// 🔥 (OPTIONAL BUT SMART) ACTOR FIELDS
await kv.set(
  `equipment:changed:${projectId}:${realModalityId}:${actorEmail}:fields`,
  changedFields
);
      console.log("[equipment-details/save] kv-write", {
        key: `equipment:changed:${projectId}:${realModalityId}`,
        changedFields
      });

  // 🔥 NO BADGE / UNREAD IN SAVE
// handled ONLY in send-equipment-emails
    } else {
      console.log("[equipment-details/save] no changed fields detected", {
        projectId,
        realModalityId,
        modality
      });
    }

    return res.status(200).json({
      success: true,
      projectId,
      modalityId: realModalityId,
      modality,
      changedFields
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("equipment-details/save ERROR:", err);
    return res.status(500).json({ error: err.message || "Save failed" });
  } finally {
    client.release();
  }
}