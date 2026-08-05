import crypto from "crypto";
import { kv } from "@vercel/kv";
import { Resend } from "resend";

const email = value => String(value || "").trim().toLowerCase();
const h = value => crypto.createHmac("sha256", process.env.SANDBOX_AUTH_HASH_SECRET).update(value).digest("hex");

async function hasSandboxInvitation(address) {
  if (address === email(process.env.SANDBOX_ADMIN_EMAIL)) return true;
  const invitation = await kv.get(`sandbox:role:${h(address)}`);
  return invitation?.role === "manager" ||
    (invitation?.role === "rep" && /^REP_[ABC]$/.test(invitation.assigned_rep_id || ""));
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const to = email(req.body?.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(400).json({ error: "Enter a valid work email." });
    }
    if (!(await hasSandboxInvitation(to))) {
      return res.status(403).json({ error: "This email has not been invited to the sandbox yet." });
    }

    const id = h(to);
    const cooldownKey = `sandbox:pin:cooldown:${id}`;
    if (await kv.get(cooldownKey)) {
      return res.status(429).json({ error: "Please wait one minute before requesting another PIN." });
    }

    const pin = crypto.randomInt(100000, 1000000).toString();
    await kv.set(`sandbox:pin:value:${id}`, h(`${id}:${pin}`), { ex: 600 });
    const result = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: process.env.SANDBOX_FROM_EMAIL,
      to,
      subject: "Your ESPIN LINK Sandbox access code",
      html: `<p>Your one-time access code is <strong>${pin}</strong>. It expires in 10 minutes.</p>`
    });
    if (result.error) throw new Error("Delivery failed");

    await kv.set(cooldownKey, "1", { ex: 60 });
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error("Sandbox PIN delivery failed:", error.message);
    return res.status(500).json({ error: "Unable to send PIN." });
  }
}
