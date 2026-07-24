import http2 from "node:http2";
import crypto from "node:crypto";
import admin from "firebase-admin";
import { kv } from "@vercel/kv";
import { Pool } from "pg";

const BUNDLE_ID = "com.espinmedical.app";
const APNS_HOST = "https://api.push.apple.com";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/* FIREBASE INIT */
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert(
        JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
      )
    });

    console.log("🔥 FCM INITIALIZED");
  } catch (e) {
    console.error("❌ FCM INIT FAILED:", e?.message || e);
  }
}

/* HELPERS */
function clean(email) {
  return String(email || "").toLowerCase().trim();
}

function base64Url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function createApnsJwt() {
  const key = process.env.APN_KEY_P8?.replace(/\\n/g, "\n");
  const keyId = process.env.APN_KEY_ID;
  const teamId = process.env.APPLE_TEAM_ID;

  if (!key || !keyId || !teamId) {
    throw new Error("Missing APNs environment variables");
  }

  const header = {
    alg: "ES256",
    kid: keyId
  };

  const payload = {
    iss: teamId,
    iat: Math.floor(Date.now() / 1000)
  };

  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto.sign("sha256", Buffer.from(signingInput), {
    key,
    dsaEncoding: "ieee-p1363"
  });

  return `${signingInput}.${base64Url(signature)}`;
}

function splitTokens(tokens = []) {
  const ios = [];
  const android = [];

  for (const raw of tokens) {
    const token = String(raw || "").trim();
    if (!token) continue;

    if (token.startsWith("android:")) {
      android.push(token.replace("android:", ""));
    } else {
      ios.push(token);
    }
  }

  return { ios, android };
}

async function getUserDevices() {
  const result = await pool.query(`SELECT email, token FROM device_tokens`);

  const users = {};

  for (const row of result.rows) {
    const email = clean(row.email);
    if (!email) continue;

    if (!users[email]) users[email] = [];
    users[email].push(row.token);
  }

  return users;
}

async function sendAPN(payload, tokens) {
  if (!tokens?.length) return;

  let jwt;

  try {
    jwt = createApnsJwt();
  } catch (e) {
    console.error("❌ APNs JWT ERROR:", e?.message || e);
    return;
  }

  const client = http2.connect(APNS_HOST);

  client.on("error", (err) => {
    console.error("❌ APNs CLIENT ERROR:", err?.message || err);
  });

  await Promise.all(
    tokens.map((token) => {
      return new Promise((resolve) => {
        const isAlert = Boolean(payload?.aps?.alert);

        const req = client.request({
          ":method": "POST",
          ":path": `/3/device/${token}`,
          authorization: `bearer ${jwt}`,
          "apns-topic": BUNDLE_ID,
          "apns-push-type": isAlert ? "alert" : "background",
          "apns-priority": isAlert ? "10" : "5"
        });

        let responseBody = "";
        let status = null;

        req.setEncoding("utf8");

        req.on("response", (headers) => {
          status = headers[":status"];
        });

        req.on("data", (chunk) => {
          responseBody += chunk;
        });

        req.on("end", () => {
          if (status >= 400) {
            console.error("❌ APNs FAILED:", {
              status,
              tokenTail: String(token).slice(-8),
              response: responseBody || null
            });
          } else {
            console.log("✅ APNs SENT:", {
              status,
              tokenTail: String(token).slice(-8)
            });
          }

          resolve();
        });

        req.on("error", (err) => {
          console.error("❌ APNs REQUEST ERROR:", err?.message || err);
          resolve();
        });

        req.write(JSON.stringify(payload));
        req.end();
      });
    })
  );

  client.close();
}

/* MAIN PUSH */
async function sendPushToUsers(title, body, data = {}) {
  console.log("🚀 PUSH START", { title, body, data });

  const recipients = (data.recipients || []).map(clean);
  const projectId = data.projectId;

  if (!recipients.length || !projectId) return;

  const { rows } = await pool.query(
    `SELECT DISTINCT LOWER(email) AS email FROM project_contacts WHERE project_id = $1`,
    [projectId]
  );

  const allowed = rows.map((row) => clean(row.email));
  const users = await getUserDevices();

  for (const email of recipients) {
    const targetEmail = clean(email);
    const ADMIN = "info@espinmedical.com";

    if (!allowed.includes(targetEmail) && targetEmail !== ADMIN) continue;

    const tokens = users[targetEmail];
    if (!tokens?.length) continue;

    const { ios, android } = splitTokens(tokens);

    const badgeKey = `ios:badge:counter:${targetEmail}`;
    const before = Number(await kv.get(badgeKey)) || 0;
    const nextBadge = before + 1;

    await kv.set(badgeKey, nextBadge);

    /* iOS */
    await sendAPN(
      {
        aps: {
          alert: {
            title: String(title),
            body: String(body)
          },
          sound: "default",
          badge: nextBadge
        }
      },
      ios
    );

    /* ANDROID */
    if (android.length) {
      console.log("📲 ANDROID PUSH:", targetEmail);

      try {
        const result = await admin.messaging().sendEachForMulticast({
          tokens: android,
          data: {
            title: String(title),
            body: String(body),
            badge: String(nextBadge)
          },
          android: {
            priority: "high"
          }
        });

        console.log("✅ FCM RESULT:", JSON.stringify(result, null, 2));
      } catch (err) {
        console.error("❌ FCM ERROR:", err);
      }
    }
  }
}

/* BADGE ONLY */
async function sendBadgeOnlyPush(targetEmail = null) {
  const users = await getUserDevices();

  for (const email of Object.keys(users)) {
    const currentEmail = clean(email);

    if (targetEmail && clean(targetEmail) !== currentEmail) continue;

    const tokens = users[currentEmail];
    if (!tokens?.length) continue;

    const { ios, android } = splitTokens(tokens);

    const badgeKey = `ios:badge:counter:${currentEmail}`;
    const badge = Number(await kv.get(badgeKey)) || 0;

    /* iOS badge sync */
    await sendAPN(
      {
        aps: {
          "content-available": 1,
          badge
        }
      },
      ios
    );

    /* Android badge sync */
    if (android.length) {
      try {
        await admin.messaging().sendEachForMulticast({
          tokens: android,
          data: {
            badge: String(badge)
          },
          android: {
            priority: "high"
          }
        });
      } catch (err) {
        console.error("❌ FCM BADGE ERROR:", err);
      }
    }
  }
}

export { sendPushToUsers, sendBadgeOnlyPush };