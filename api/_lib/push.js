import apn from "apn";
import { kv } from "@vercel/kv";

const BUNDLE_ID = process.env.APN_BUNDLE_ID || "com.espinmedical.MyApp";

/* ─────────────────────────────────────────────
   SAFE APNs PROVIDER (never crashes function)
───────────────────────────────────────────── */
let provider = null;

try {
  if (
    process.env.APN_KEY_P8 &&
    process.env.APN_KEY_ID &&
    process.env.APPLE_TEAM_ID
  ) {
    provider = new apn.Provider({
      token: {
        key: process.env.APN_KEY_P8.replace(/\\n/g, "\n"),
        keyId: process.env.APN_KEY_ID,
        teamId: process.env.APPLE_TEAM_ID
      },
      production: false,
      connectionRetryLimit: 3
    });

    console.log("APNs initialized");
  } else {
    console.error("APNs missing env vars");
  }
} catch (e) {
  console.error("APNs init failed:", e.message);
  provider = null;
}

/* ───────────────────────────────────────────── */
function clean(email) {
  return String(email || "").toLowerCase().trim();
}

/* ─────────────────────────────────────────────
   BADGE VALUE (single source of truth)
───────────────────────────────────────────── */
async function computeUserBadge(email) {
  const e = clean(email);
  if (!e) return 0;

  const count = await kv.get(`ios:badge:counter:${e}`);
  return Number(count) || 0;
}

/* ─────────────────────────────────────────────
   GET DEVICES
   (kept as-is for your current structure)
───────────────────────────────────────────── */
async function getUserDevices() {
  const keys = await kv.keys("device:ios:*");
  if (!keys.length) return {};

  const users = {};

  const records = await kv.mget(keys);

  for (let i = 0; i < keys.length; i++) {
    const rec = records[i];
    if (!rec?.deviceToken || !rec?.email) continue;

    const email = clean(rec.email);

    if (!users[email]) users[email] = [];
    users[email].push(rec.deviceToken);
  }

  return users;
}

/* ─────────────────────────────────────────────
   INTERNAL SEND (safe)
───────────────────────────────────────────── */
async function send(note, tokens, email) {
  if (!provider) {
    console.error("APNs not available — skipping push");
    return;
  }

  try {
    const result = await provider.send(note, tokens);

    console.log("APNs sent:", result.sent.length);

    for (const f of result.failed) {
      if (f.status === "410" || f.response?.reason === "Unregistered") {
        console.log("Removing dead token:", f.device);
        await kv.del(`device:ios:${f.device}`);
      }
    }
  } catch (err) {
    console.error("APNs error for", email, err.message);
  }
}

/* ─────────────────────────────────────────────
   ALERT PUSH
───────────────────────────────────────────── */
export async function sendPushToUsers(title, body, data = {}) {
  const recipients = (data.recipients || []).map(clean);
  if (!recipients.length) return;

  const users = await getUserDevices();
  if (!Object.keys(users).length) return;

  for (const email of recipients) {
    const tokens = users[email];
    if (!tokens?.length) continue;

    const badge = await computeUserBadge(email);

    const note = new apn.Notification();
    note.topic = BUNDLE_ID;
    note.alert = { title, body };
    note.sound = "default";
    note.badge = badge;
    note.pushType = "alert";
    note.priority = 10;
    note.payload = data;

    await send(note, tokens, email);
  }
}

/* ─────────────────────────────────────────────
   BADGE ONLY PUSH
───────────────────────────────────────────── */
export async function sendBadgeOnlyPush(targetEmail = null) {
  const users = await getUserDevices();
  if (!Object.keys(users).length) return;

  const emails = targetEmail
    ? [clean(targetEmail)]
    : Object.keys(users);

  for (const email of emails) {
    const tokens = users[email];
    if (!tokens?.length) continue;

    const badge = await computeUserBadge(email);

    const note = new apn.Notification();
    note.topic = BUNDLE_ID;
    note.badge = badge;
    note.pushType = "background";
    note.priority = 5;
    note.payload = { type: "badge_update" };

    await send(note, tokens, email);
  }
}