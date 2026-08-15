import crypto from "crypto";
import { kv } from "@vercel/kv";

const CODE_SECONDS = 30 * 24 * 60 * 60;
const h = value => crypto.createHmac("sha256", process.env.SANDBOX_AUTH_HASH_SECRET).update(value).digest("hex");
const codeHash = code => h(`rep-access-code:${code}`);
const clean = value => String(value || "").trim();

function session(req) {
  const raw = (req.headers.cookie || "").match(/(?:^|; )espin_sandbox_auth=([^;]+)/)?.[1];
  if (!raw) return null;
  const [data, sig] = raw.split(".");
  const expected = h(data || "");
  if (!data || !sig || sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try { const value = JSON.parse(Buffer.from(data, "base64url")); return value.exp > Date.now() ? value : null; } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.SANDBOX_AUTH_HASH_SECRET) return res.status(500).json({ error: "Missing sandbox authentication configuration" });
  const actor = session(req);
  if (!actor || !["manager", "sandbox_admin"].includes(actor.role)) return res.status(401).json({ error: "Sign in is required." });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (body.action !== "create_rep_access") return res.status(400).json({ error: "Unsupported request." });
    const workspaceId = clean(body.workspace_id || body.role).toUpperCase();
    const repId = clean(body.rep_id);
    const repName = clean(body.rep_name).slice(0, 80);
    if (!/^REP_[123]$/.test(workspaceId)) return res.status(400).json({ error: "Choose Rep 1, 2, or 3." });
    if (!repId || !repName) return res.status(400).json({ error: "A representative name and workspace are required." });
    const accessCode = crypto.randomBytes(5).toString("hex").toUpperCase();
    await kv.set(`sandbox:rep-access:${codeHash(accessCode)}`, { role: "rep", rep_id: repId, rep_name: repName, assigned_rep_id: workspaceId, created_by: actor.role, created_at: new Date().toISOString(), consumed: false }, { ex: CODE_SECONDS });
    return res.status(200).json({ message: "One-time Rep Access Code created.", access_code: accessCode, workspace_id: workspaceId, expires_at: new Date(Date.now() + CODE_SECONDS * 1000).toISOString() });
  } catch (error) {
    console.error("Sandbox access-code creation failed:", error.message);
    return res.status(500).json({ error: "Unable to create Rep Access Code." });
  }
}
