import crypto from "crypto";
import { kv } from "@vercel/kv";

const EMAIL = v => String(v || "").trim().toLowerCase();
const hmac = v => crypto.createHmac("sha256", process.env.SANDBOX_AUTH_HASH_SECRET).update(v).digest("hex");
const equal = (a,b) => { const x=Buffer.from(String(a)), y=Buffer.from(String(b)); return x.length===y.length && crypto.timingSafeEqual(x,y); };
const views = ["manager","vp","rep_a","rep_b","rep_c"];
const identity = async email => {
  if (email === EMAIL(process.env.SANDBOX_ADMIN_EMAIL)) return { role:"sandbox_admin", display_name:"Sandbox Admin", allowed_views:views };
  const saved = await kv.get(`sandbox:role:${hmac(email)}`);
  if (saved?.role === "revoked") throw new Error("Sandbox access has been revoked.");
  if (saved?.role === "rep" && /^REP_[ABC]$/.test(saved.assigned_rep_id || "")) return { role:"rep", display_name:`Rep ${saved.assigned_rep_id.slice(-1)}`, assigned_rep_id:saved.assigned_rep_id, allowed_views:[saved.assigned_rep_id.toLowerCase()] };
  if (saved?.role === "manager") return { role:"manager", display_name:"Manager", allowed_views:views };
  // Emails have no sandbox privileges until an administrator or manager
  // explicitly assigns them a sandbox role through the invitation flow.
  return null;
};
const cookie = payload => { const data=Buffer.from(JSON.stringify(payload)).toString("base64url"); return `${data}.${hmac(data)}`; };
export default async function handler(req,res) {
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
  try {
    const b=typeof req.body==="string"?JSON.parse(req.body||"{}"):req.body||{}, email=EMAIL(b.email), pin=String(b.pin||"").trim();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!/^\d{6}$/.test(pin)) return res.status(400).json({error:"Enter a valid email and PIN."});
    const id=hmac(email), key=`sandbox:pin:value:${id}`, stored=await kv.get(key);
    if(!stored || !equal(stored,hmac(`${id}:${pin}`))) return res.status(401).json({error:"Invalid or expired PIN."});
    await kv.del(key);
    const approvedIdentity = await identity(email);
    if (!approvedIdentity) {
      return res.status(403).json({ error:"This email has not been invited to the sandbox yet." });
    }
    const sandbox_identity={...approvedIdentity,expires_at:new Date(Date.now()+4*60*60*1000).toISOString()};
    res.setHeader("Set-Cookie",`espin_sandbox_auth=${cookie({...sandbox_identity,exp:Date.now()+4*60*60*1000})}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=14400`);
    return res.status(200).json({success:true,sandbox_identity});
  } catch(e) { console.error("Sandbox verification failed:",e.message); return res.status(500).json({error:"Unable to verify PIN."}); }
}
