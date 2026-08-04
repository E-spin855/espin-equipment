import crypto from "crypto";
import { kv } from "@vercel/kv";
import { Resend } from "resend";

const PIN_TTL_SECONDS = 600;
const COOLDOWN_SECONDS = 60;
const MAX_SENDS = 5;
const WINDOW_SECONDS = 900;
const resend = new Resend(process.env.RESEND_API_KEY);

const cleanEmail = value => String(value || "").trim().toLowerCase();
const validEmail = email => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const secret = () => {
  if (!process.env.SANDBOX_AUTH_HASH_SECRET) throw new Error("Sandbox authentication is not configured.");
  return process.env.SANDBOX_AUTH_HASH_SECRET;
};
const hash = value => crypto.createHmac("sha256", secret()).update(value).digest("hex");
const assignments = () => {
  try { return JSON.parse(process.env.SANDBOX_EVALUATOR_ASSIGNMENTS || "{}"); }
  catch { throw new Error("Sandbox evaluator assignments are not configured."); }
};
const assigned = email => Object.prototype.hasOwnProperty.call(assignments(), email);

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
    const email = cleanEmail(body.email);
    if (!validEmail(email) || !assigned(email)) return res.status(403).json({ error: "This email is not approved for the sandbox." });
    const id = hash(email);
    const cooldownKey = `sandbox:pin:cooldown:${id}`;
    const sendCountKey = `sandbox:pin:sends:${id}`;
    if (await kv.get(cooldownKey)) return res.status(429).json({ error: "Please wait one minute before requesting another PIN." });
    const sends = Number(await kv.get(sendCountKey)) || 0;
    if (sends >= MAX_SENDS) return res.status(429).json({ error: "Too many PIN requests. Try again later." });

    const pin = crypto.randomInt(100000, 1000000).toString();
    await kv.set(`sandbox:pin:value:${id}`, hash(`${id}:${pin}`), { ex: PIN_TTL_SECONDS });
    const { error } = await resend.emails.send({
      from: process.env.SANDBOX_FROM_EMAIL || "ESPIN LINK Sandbox <info@espinmedical.com>",
      to: email,
      subject: "Your ESPIN LINK Sandbox access code",
      html: `<p>Your one-time ESPIN LINK Sandbox access code is:</p><p style="font-size:32px;font-weight:700;letter-spacing:4px">${pin}</p><p>This code expires in 10 minutes. Do not share it.</p>`
    });
    if (error) throw new Error("Unable to send the PIN.");
    await Promise.all([
      kv.set(cooldownKey, "1", { ex: COOLDOWN_SECONDS }),
      kv.set(sendCountKey, sends + 1, { ex: WINDOW_SECONDS })
    ]);
    return res.status(200).json({ success: true, expires_in_seconds: PIN_TTL_SECONDS });
  } catch (error) {
    console.error("Sandbox PIN delivery failed:", error.message); // No email, PIN, or token is logged.
    return res.status(500).json({ error: "Unable to send the PIN. Please try again." });
  }
}
