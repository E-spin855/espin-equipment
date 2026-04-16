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

    console.log("🧹 EQUIPMENT UNREGISTER START:", email);

    if (!email) {
      return res.status(400).json({ error: "Missing email" });
    }

    // 🔥 GET ALL TOKENS (ANDROID + IOS)
    const androidKeys = await kv.keys("device:android:*");
    const iosKeys = await kv.keys("device:ios:*");

    const allKeys = [...androidKeys, ...iosKeys];

    let deleted = 0;

    if (allKeys.length) {
      const records = await kv.mget(...allKeys);

      const toDelete = [];

      for (let i = 0; i < allKeys.length; i++) {
        const rec = records[i];

        if (
          rec &&
          typeof rec === "object" &&
          clean(rec.email) === email
        ) {
          toDelete.push(allKeys[i]);
        }
      }

      if (toDelete.length) {
        await kv.del(...toDelete);
        deleted = toDelete.length;
      }
    }

    console.log("🗑️ KV TOKENS CLEARED:", deleted);
    console.log("✅ EQUIPMENT UNREGISTER COMPLETE:", email);

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("UNREGISTER ERROR:", err);
    return res.status(500).json({ error: "Server error" });
  }
}