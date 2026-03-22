import apn from "apn";
import { kv } from "@vercel/kv";

const BUNDLE_ID = process.env.APN_BUNDLE_ID_EQUIPMENT || "";
const DEVICE_KEY_PREFIX = `device:ios:equipment:`;

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

    console.log("APNs initialized for equipment");
  } else {
    console.error("APNs missing env vars for equipment");
  }
} catch (e) {
  console.error("APNs init failed:", e.message);
  provider = null;
}

function clean(email) {
  return String(email || "").toLowerCase().trim();
}

async function computeUserBadge(email) {
  const e = clean(email);
  if (!e) return 0;

  const count = await kv.get(`ios:badge:counter:${e}`);
  return Number(count) || 0;
}

async function getUserDevices() {
  const keys = await kv.keys(`${DEVICE_KEY_PREFIX}*`);
  if (!keys.length) return {};

  const users = {};
  const records = await kv.mget(...keys);

  for (let i = 0; i < keys.length; i++) {
    const rec = records[i];
    if (!rec?.deviceToken || !rec?.email) continue;

    const email = clean(rec.email);

    if (!users[email]) users[email] = [];
    users[email].push(rec.deviceToken);
  }

  return users;
}

async function send(note, tokens, email) {
  if (!provider) {
    console.error("APNs not available — skipping push");
    return;
  }

  try {
    const result = await provider.send(note, tokens);

    console.log("APNs sent:", result.sent.length);

    for (const f of result.failed) {
      if (
        String(f.status) === "410" ||
        f.response?.reason === "Unregistered" ||
        f.response?.reason === "BadDeviceToken" ||
        f.response?.reason === "DeviceTokenNotForTopic"
      ) {
        console.log("Removing dead token:", f.device);
        await kv.del(`${DEVICE_KEY_PREFIX}${f.device}`);
      }
    }
  } catch (err) {
    console.error("APNs error for", email, err.message);
  }
}

export async function sendPushToUsers(title, body, data = {}) {
  const recipients = [...new Set((data.recipients || []).map(clean).filter(Boolean))];
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

export async function sendBadgeOnlyPush(targetEmail = null, explicitBadge = null) {
  const users = await getUserDevices();
  if (!Object.keys(users).length) return;

  const emails = targetEmail
    ? [clean(targetEmail)]
    : Object.keys(users);

  for (const email of emails) {
    const tokens = users[email];
    if (!tokens?.length) continue;

    const badge =
      explicitBadge == null
        ? await computeUserBadge(email)
        : Math.max(0, Number(explicitBadge) || 0);

    const note = new apn.Notification();
    note.topic = BUNDLE_ID;
    note.badge = badge;
    note.pushType = "background";
    note.priority = 5;
    note.contentAvailable = 1;
    note.payload = { type: "badge_update" };

    await send(note, tokens, email);
  }
}