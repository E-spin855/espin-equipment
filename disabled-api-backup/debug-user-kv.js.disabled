import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  try {
    const deviceKeys = await kv.keys("device:ios:*");

    const devices = [];
    for (const key of deviceKeys) {
      const value = await kv.get(key);
      devices.push({ key, value });
    }

    const badgeKeys = await kv.keys("ios:badge:counter:*");

    res.status(200).json({
      deviceCount: deviceKeys.length,
      devices,
      badgeKeys
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}