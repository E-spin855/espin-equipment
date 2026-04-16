import apn from "apn";
import { kv } from "@vercel/kv";

const APP_ID = "equipment";
const BUNDLE_ID = String(process.env.APN_BUNDLE_ID_EQUIPMENT || "").trim();
const APN_KEY_ID = String(process.env.APN_KEY_ID_EQUIPMENT || "").trim();
const APPLE_TEAM_ID = String(process.env.APPLE_TEAM_ID || "").trim();
const IS_PRODUCTION =
  String(process.env.APN_PRODUCTION_EQUIPMENT || "false").toLowerCase() === "true";

const DEVICE_KEY_PREFIX = `device:ios:${APP_ID}:`;
const BADGE_KEY_PREFIX = `ios:badge:counter:${APP_ID}:`;

function clean(email) {
  return String(email || "").toLowerCase().trim();
}

function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

/* ✅ FIXED P8 HANDLING (NO REBUILDING) */
function getRawP8() {
  let raw = process.env.APN_KEY_P8_EQUIPMENT;
  if (!raw) return "";

  return raw
    .replace(/^"(.*)"$/, "$1")
    .replace(/\\n/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

const APN_KEY_P8 = getRawP8();
const keyLines = APN_KEY_P8 ? APN_KEY_P8.split("\n") : [];

let provider = null;

/* ✅ SINGLE CLEAN INIT (NO DUPLICATES) */
try {
  console.log("[APNs] key diagnostics", {
    topic: BUNDLE_ID,
    production: IS_PRODUCTION,
    keyId: APN_KEY_ID,
    teamId: APPLE_TEAM_ID,
    keyLength: APN_KEY_P8.length,
    lineCount: keyLines.length,
    firstLine: keyLines[0] || "",
    lastLine: keyLines[keyLines.length - 1] || ""
  });

  const missing = [];
  if (!APN_KEY_P8) missing.push("APN_KEY_P8_EQUIPMENT");
  if (!APN_KEY_ID) missing.push("APN_KEY_ID_EQUIPMENT");
  if (!APPLE_TEAM_ID) missing.push("APPLE_TEAM_ID");
  if (!BUNDLE_ID) missing.push("APN_BUNDLE_ID_EQUIPMENT");

  if (missing.length) {
    console.error("[APNs] missing env vars:", missing.join(", "));
  } else {
    provider = new apn.Provider({
      token: {
        key: APN_KEY_P8,
        keyId: APN_KEY_ID,
        teamId: APPLE_TEAM_ID
      },
      production: IS_PRODUCTION,
      connectionRetryLimit: 3
    });

    console.log("✅ APN PROVIDER CREATED", {
      topic: BUNDLE_ID,
      production: IS_PRODUCTION
    });
  }
} catch (e) {
  console.error("❌ APNs init failed:", e?.message || e);
  provider = null;
}

/* ---------------- BADGE ---------------- */

async function computeUserBadge(email) {
  const e = clean(email);
  if (!e) return 0;

  try {
    const count = await kv.get(`${BADGE_KEY_PREFIX}${e}`);
    return Math.max(0, Number(count) || 0);
  } catch {
    return 0;
  }
}

function normalizeBadge(explicitBadge) {
  return Math.max(0, Number(explicitBadge) || 0);
}

/* ---------------- DEVICES ---------------- */

async function getUserDevices() {
  try {
    const keys = await kv.keys(`${DEVICE_KEY_PREFIX}*`);
    if (!keys.length) return {};

    const records = await kv.mget(...keys);
    const users = {};

    for (let i = 0; i < keys.length; i++) {
      const rec = records[i];
      if (!rec?.deviceToken || !rec?.email) continue;

      const email = clean(rec.email);
      const token = String(rec.deviceToken || "").trim();

      if (!users[email]) users[email] = [];
      users[email].push(token);
    }

    for (const email of Object.keys(users)) {
      users[email] = uniq(users[email]);
    }

    return users;
  } catch {
    return {};
  }
}

async function removeDeadToken(token) {
  try {
    await kv.del(`${DEVICE_KEY_PREFIX}${token}`);
  } catch {}
}

/* ---------------- SEND ---------------- */

async function send(note, tokens, email) {
  if (!provider) {
    console.error("❌ APN provider missing");
    return;
  }

  const deduped = uniq(tokens);
  if (!deduped.length) return;

  try {
    const result = await provider.send(note, deduped);

    for (const f of result.failed || []) {
      const reason =
        f?.response?.reason ||
        f?.error?.message ||
        "";

      if (reason === "Unregistered" || reason === "BadDeviceToken") {
        await removeDeadToken(f?.device);
      }
    }
  } catch (err) {
    console.error("❌ APN send error:", err?.message || err);
  }
}

/* ---------------- MAIN PUSH ---------------- */

export async function sendPushToUsers(title, body, data = {}) {
  const recipients = (data.recipients || []).map(clean).filter(Boolean);
  if (!recipients.length) return;

  const users = await getUserDevices();

  for (const email of uniq(recipients)) {
    const tokens = users[email];
    if (!tokens?.length) continue;

    const badge =
      data.badge == null
        ? await computeUserBadge(email)
        : normalizeBadge(data.badge);

    const note = new apn.Notification();
    note.topic = BUNDLE_ID;
    note.alert = { title, body };
    note.sound = "default";
    note.badge = badge;
    note.pushType = "alert";
    note.priority = 10;
    note.payload = { app: APP_ID, ...data, badge };

    await send(note, tokens, email);
  }
}

/* ---------------- BADGE ONLY ---------------- */

export async function sendBadgeOnlyPush(targetEmail = null, explicitBadge = null) {
  const users = await getUserDevices();
  const emails = targetEmail ? [clean(targetEmail)] : Object.keys(users);

  for (const email of uniq(emails)) {
    const tokens = users[email];
    if (!tokens?.length) continue;

    const badge =
      explicitBadge == null
        ? await computeUserBadge(email)
        : normalizeBadge(explicitBadge);

    const note = new apn.Notification();
    note.topic = BUNDLE_ID;
    note.badge = badge;
    note.sound = "default";
    note.pushType = "alert";
    note.priority = 10;
    note.alert = {
      title: "Espin Equipment",
      body: badge > 0 ? "Update available" : "All caught up"
    };

    await send(note, tokens, email);
  }
}