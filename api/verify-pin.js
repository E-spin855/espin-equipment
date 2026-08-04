import crypto from "crypto";
import { kv } from "@vercel/kv";

const MAX_VERIFY_ATTEMPTS = 5;
const VERIFY_WINDOW_SECONDS = 900;
const cleanEmail = value => String(value || "").trim().toLowerCase();
const cleanPin = value => String(value || "").trim();
const validEmail = email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const secret = () => {
  if (!process.env.SANDBOX_AUTH_HASH_SECRET) throw new Error("Sandbox authentication is not configured.");
  return process.env.SANDBOX_AUTH_HASH_SECRET;
};
const hash = value => crypto.createHmac("sha256", secret()).update(value).digest("hex");
const safeEqual = (a, b) => {
  const left = Buffer.from(String(a)); const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};
function identityFor(email) {
  let config;
  try { config = JSON.parse(process.env.SANDBOX_EVALUATOR_ASSIGNMENTS || "{}"); }
  catch { throw new Error("Sandbox evaluator assignments are not configured."); }
  const assignment = config[email];
  if (!assignment) return null;
  if (assignment.role === "manager") return { role: "manager", display_name: "Manager", allowed_views: ["manager", "vp", "rep_a", "rep_b", "rep_c"], expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() };
  const rep = String(assignment.assigned_rep_id || "").toUpperCase();
  if (assignment.role === "rep" && /^REP_[ABC]$/.test(rep)) return { role: "rep", display_name: `Rep ${rep.slice(-1)}`, assigned_rep_id: rep, allowed_views: [rep.toLowerCase()], expires_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() };
  throw new Error("Invalid sandbox evaluator assignment.");
}

export default async function handler(req, res) {
  const origin = process.env.SANDBOX_ALLOWED_ORIGIN || "https://espin-medical-app.vercel.app";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const email = cleanEmail(body.email), pin = cleanPin(body.pin);
    if (!validEmail(email) || !/^\d{6}$/.test(pin)) return res.status(400).json({ error: "Enter a valid email and 6-digit PIN." });
    const identity = identityFor(email);
    if (!identity) return res.status(403).json({ error: "This email is not approved for the sandbox." });
    const id = hash(email), attemptsKey = `sandbox:pin:attempts:${id}`;
    const attempts = Number(await kv.get(attemptsKey)) || 0;
    if (attempts >= MAX_VERIFY_ATTEMPTS) return res.status(429).json({ error: "Too many attempts. Request a new PIN." });
    const pinKey = `sandbox:pin:value:${id}`, stored = await kv.get(pinKey);
    if (!stored) return res.status(401).json({ error: "PIN expired or not found. Request a new PIN." });
    if (!safeEqual(stored, hash(`${id}:${pin}`))) {
      await kv.set(attemptsKey, attempts + 1, { ex: VERIFY_WINDOW_SECONDS });
      return res.status(401).json({ error: "Incorrect PIN." });
    }
    await Promise.all([kv.del(pinKey), kv.del(attemptsKey)]);
    return res.status(200).json({ success: true, sandbox_identity: identity });
  } catch (error) {
    console.error("Sandbox PIN verification failed:", error.message); // No email, PIN, or token is logged.
    return res.status(500).json({ error: "Unable to verify the PIN. Please try again." });
  }
}
