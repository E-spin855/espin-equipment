import crypto from "crypto";
import { kv } from "@vercel/kv";

const SESSION_SECONDS = 4 * 60 * 60;
const PASSWORD_KEY_LENGTH = 64;
const MANAGER_VIEWS = ["manager", "vp", "rep_1", "rep_2", "rep_3"];
const genericLoginError = "Unable to sign in with those credentials.";

const username = value => String(value || "").trim().toLowerCase();
const hmac = value => crypto.createHmac("sha256", process.env.SANDBOX_AUTH_HASH_SECRET).update(value).digest("hex");
const equal = (left, right) => {
  const a = Buffer.from(String(left), "hex");
  const b = Buffer.from(String(right), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const passwordHash = (password, salt) => crypto.scryptSync(String(password), String(salt), PASSWORD_KEY_LENGTH).toString("hex");
const cookie = payload => {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${hmac(data)}`;
};

function sandboxIdentity(record) {
  if (record?.role === "sandbox_admin") {
    return { role: "sandbox_admin", display_name: "Sandbox Admin", allowed_views: MANAGER_VIEWS };
  }
  if (record?.role === "manager") {
    return { role: "manager", display_name: "Manager", allowed_views: MANAGER_VIEWS };
  }
  if (record?.role === "rep" && /^REP_[123]$/.test(record.assigned_rep_id || "")) {
    return {
      role: "rep",
      display_name: `Rep ${record.assigned_rep_id.slice(-1)}`,
      assigned_rep_id: record.assigned_rep_id,
      allowed_views: [record.assigned_rep_id.toLowerCase()]
    };
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    if (!process.env.SANDBOX_AUTH_HASH_SECRET) throw new Error("Missing sandbox authentication configuration");
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const loginName = username(body.username);
    const password = String(body.password || "");
    if (!loginName || !password) return res.status(401).json({ error: genericLoginError });

    const id = hmac(loginName);
    const record = await kv.get(`sandbox:credential:${id}`);
    // Hash every submitted password, including for an unknown username, so the
    // generic response is not accompanied by a fast unknown-user code path.
    const candidateHash = passwordHash(password, record?.password_salt || hmac("sandbox-password-dummy-salt"));
    const authenticated = Boolean(
      record &&
      typeof record.password_hash === "string" &&
      record.password_hash.length === PASSWORD_KEY_LENGTH * 2 &&
      equal(record.password_hash, candidateHash)
    );
    const approvedIdentity = authenticated ? sandboxIdentity(record) : null;
    if (!approvedIdentity) return res.status(401).json({ error: genericLoginError });

    const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
    const sandbox_identity = { ...approvedIdentity, expires_at: expiresAt };
    res.setHeader(
      "Set-Cookie",
      `espin_sandbox_auth=${cookie({ ...sandbox_identity, exp: Date.now() + SESSION_SECONDS * 1000 })}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`
    );
    return res.status(200).json({ success: true, sandbox_identity });
  } catch (error) {
    console.error("Sandbox login failed:", error.message);
    return res.status(500).json({ error: "Unable to sign in right now." });
  }
}
