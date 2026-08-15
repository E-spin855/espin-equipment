import crypto from "crypto";
import { kv } from "@vercel/kv";

const SESSION_SECONDS = 4 * 60 * 60;
const h = value => crypto.createHmac("sha256", process.env.SANDBOX_AUTH_HASH_SECRET).update(value).digest("hex");
const codeHash = code => h(`rep-access-code:${code}`);
const cookie = payload => { const data = Buffer.from(JSON.stringify(payload)).toString("base64url"); return `${data}.${h(data)}`; };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.SANDBOX_AUTH_HASH_SECRET) return res.status(500).json({ error: "Missing sandbox authentication configuration" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const accessCode = String(body.access_code || "").trim().toUpperCase();
    if (!/^[A-F0-9]{10}$/.test(accessCode)) return res.status(401).json({ error: "Unable to join with that access code." });
    const key = `sandbox:rep-access:${codeHash(accessCode)}`;
    const record = await kv.get(key);
    if (!record || record.consumed || record.role !== "rep" || !/^REP_[123]$/.test(record.assigned_rep_id || "")) return res.status(401).json({ error: "Unable to join with that access code." });
    await kv.del(key);
    const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
    const sandbox_identity = { role: "rep", display_name: record.rep_name || `Rep ${record.assigned_rep_id.slice(-1)}`, assigned_rep_id: record.assigned_rep_id, allowed_views: [record.assigned_rep_id.toLowerCase()], expires_at: expiresAt };
    res.setHeader("Set-Cookie", `espin_sandbox_auth=${cookie({ ...sandbox_identity, exp: Date.now() + SESSION_SECONDS * 1000 })}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`);
    return res.status(200).json({ success: true, sandbox_identity });
  } catch (error) {
    console.error("Sandbox access-code redemption failed:", error.message);
    return res.status(500).json({ error: "Unable to join the sandbox right now." });
  }
}
