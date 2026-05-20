// FILE: /api/_lib/push-equipment.js
// PATH: /api/_lib/push-equipment.js

import http2 from "http2";
import crypto from "crypto";
import { kv } from "@vercel/kv";

const APP_ID = "equipment";

const BUNDLE_ID = String(process.env.APN_BUNDLE_ID_EQUIPMENT || "").trim();
const APN_KEY_ID = String(process.env.APN_KEY_ID_EQUIPMENT || "").trim();
const APPLE_TEAM_ID = String(process.env.APPLE_TEAM_ID || "").trim();

const IS_PRODUCTION =
  String(process.env.APN_PRODUCTION_EQUIPMENT || "false").toLowerCase() === "true";

const APNS_HOST = IS_PRODUCTION
  ? "https://api.push.apple.com"
  : "https://api.sandbox.push.apple.com";

const DEVICE_KEY_PREFIX = `device:ios:${APP_ID}:`;
const BADGE_KEY_PREFIX = `ios:badge:counter:${APP_ID}:`;

let cachedJwt = "";
let cachedJwtCreatedAt = 0;

function clean(email) {
  return String(email || "").toLowerCase().trim();
}

function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

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

function getApnsJwt() {
  const now = Math.floor(Date.now() / 1000);

  if (cachedJwt && cachedJwtCreatedAt && now - cachedJwtCreatedAt < 50 * 60) {
    return cachedJwt;
  }

  const key = getRawP8();

  if (!key || !APN_KEY_ID || !APPLE_TEAM_ID) {
    throw new Error("Missing APNs credentials");
  }

  const header = {
    alg: "ES256",
    kid: APN_KEY_ID
  };

  const payload = {
    iss: APPLE_TEAM_ID,
    iat: now
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createSign("sha256")
    .update(signingInput)
    .end()
    .sign(key);

  cachedJwt = `${signingInput}.${base64url(signature)}`;
  cachedJwtCreatedAt = now;

  return cachedJwt;
}

function validateApnsConfig() {
  const missing = [];

  if (!BUNDLE_ID) missing.push("APN_BUNDLE_ID_EQUIPMENT");
  if (!APN_KEY_ID) missing.push("APN_KEY_ID_EQUIPMENT");
  if (!APPLE_TEAM_ID) missing.push("APPLE_TEAM_ID");
  if (!getRawP8()) missing.push("APN_KEY_P8_EQUIPMENT");

  if (missing.length) {
    console.error("[APNs] Missing env vars:", missing.join(", "));
    return false;
  }

  return true;
}

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

      if (!email || !token) continue;

      if (!users[email]) users[email] = [];
      users[email].push(token);
    }

    for (const email of Object.keys(users)) {
      users[email] = uniq(users[email]);
    }

    return users;
  } catch (err) {
    console.error("[APNs] Failed loading device tokens:", err?.message || err);
    return {};
  }
}

async function removeDeadToken(token) {
  const t = String(token || "").trim();
  if (!t) return;

  try {
    await kv.del(`${DEVICE_KEY_PREFIX}${t}`);
  } catch {}
}

function sendApnsRequest(token, payload, headers) {
  return new Promise((resolve) => {
    const client = http2.connect(APNS_HOST);

    client.on("error", (err) => {
      console.error("[APNs] HTTP/2 connection error:", err?.message || err);
      try {
        client.close();
      } catch {}
      resolve({ ok: false, status: 0, reason: "ConnectionError" });
    });

    const req = client.request({
      ":method": "POST",
      ":path": `/3/device/${token}`,
      authorization: `bearer ${getApnsJwt()}`,
      "apns-topic": BUNDLE_ID,
      "apns-push-type": headers.pushType,
      "apns-priority": String(headers.priority),
      "content-type": "application/json"
    });

    let responseBody = "";
    let statusCode = 0;

    req.setEncoding("utf8");

    req.on("response", (resHeaders) => {
      statusCode = Number(resHeaders[":status"] || 0);
    });

    req.on("data", (chunk) => {
      responseBody += chunk;
    });

    req.on("end", () => {
      try {
        client.close();
      } catch {}

      let parsed = {};
      try {
        parsed = responseBody ? JSON.parse(responseBody) : {};
      } catch {}

      resolve({
        ok: statusCode >= 200 && statusCode < 300,
        status: statusCode,
        reason: parsed.reason || ""
      });
    });

    req.on("error", (err) => {
      console.error("[APNs] Request error:", err?.message || err);
      try {
        client.close();
      } catch {}
      resolve({ ok: false, status: 0, reason: "RequestError" });
    });

    req.write(JSON.stringify(payload));
    req.end();
  });
}

async function sendPushPayload(tokens, email, payload, headers) {
  if (!validateApnsConfig()) {
    console.error("[APNs] Provider unavailable — skipping push");
    return;
  }

  const deduped = uniq(tokens);
  if (!deduped.length) return;

  for (const token of deduped) {
    try {
      const result = await sendApnsRequest(token, payload, headers);

      if (!result.ok) {
        console.error("[APNs] Failed:", {
          email,
          status: result.status,
          reason: result.reason
        });

        if (
          result.reason === "Unregistered" ||
          result.reason === "BadDeviceToken" ||
          result.status === 410
        ) {
          await removeDeadToken(token);
        }
      }
    } catch (err) {
      console.error("[APNs] Send error:", err?.message || err);
    }
  }
}

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

    const payload = {
      aps: {
        alert: { title, body },
        sound: "default",
        badge
      },
      app: APP_ID,
      ...data,
      badge
    };

    await sendPushPayload(tokens, email, payload, {
      pushType: "alert",
      priority: 10
    });
  }
}

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

    const payload = {
      aps: {
        alert: {
          title: "Espin Equipment",
          body: badge > 0 ? "Update available" : "All caught up"
        },
        sound: "default",
        badge
      },
      app: APP_ID,
      type: "badge_update",
      badge
    };

    await sendPushPayload(tokens, email, payload, {
      pushType: "alert",
      priority: 10
    });
  }
}