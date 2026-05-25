import { kv } from "@vercel/kv";

function clean(email) {
  return String(email || "").toLowerCase().trim();
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "POST") {
    return res.status(405).end();
  }

  try {
    const email = clean(req.body?.email);
    const deviceToken = String(req.body?.deviceToken || "").trim();

    console.log("🧹 EQUIPMENT UNREGISTER START:", { email, deviceToken });

    if (!email && !deviceToken) {
      return res.status(400).json({ error: "Missing email or deviceToken" });
    }

    const androidKeys = await kv.keys("device:android:*");
    const iosKeys = await kv.keys("device:ios:*");

    const allKeys = [...androidKeys, ...iosKeys];

    let deleted = 0;
    const toDelete = [];

    if (allKeys.length) {
      const records = await kv.mget(...allKeys);

      for (let i = 0; i < allKeys.length; i++) {
        const key = allKeys[i];
        const rec = records[i];

        const tokenFromKey = key.split(":").pop();

        const matchesEmail =
          email &&
          rec &&
          typeof rec === "object" &&
          clean(rec.email) === email;

        const matchesToken =
          deviceToken &&
          tokenFromKey === deviceToken;

        if (matchesEmail || matchesToken) {
          toDelete.push(key);
        }
      }

      if (toDelete.length) {
        await kv.del(...toDelete);
        deleted = toDelete.length;
      }
    }

    console.log("🗑️ KV TOKENS CLEARED:", deleted);

    return res.status(200).json({
      success: true,
      deleted
    });

  } catch (err) {
    console.error("UNREGISTER ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
}