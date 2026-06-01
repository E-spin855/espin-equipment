// FILE: /api/verify-pin.js
// PATH: /api/verify-pin.js

import { kv } from "@vercel/kv";
import crypto from "crypto";

const TEST_MODE = false;

const ALLOWED_ORIGIN = "https://espin-medical-app.vercel.app";

function cleanEmail(v) {
  return String(v || "").trim().toLowerCase();
}

function cleanPin(v) {
  return String(v || "").trim();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function safeEqual(a, b) {
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));

  if (aBuf.length !== bBuf.length) return false;

  return crypto.timingSafeEqual(aBuf, bBuf);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Requested-With"
  );
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Vary", "Origin");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};

    const normalizedEmail = cleanEmail(body.email);
    const normalizedPin = cleanPin(body.pin);

    if (!normalizedEmail || !normalizedPin) {
      return res.status(400).json({ error: "Missing email or PIN" });
    }

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ error: "Invalid email" });
    }

    if (!/^\d{6}$/.test(normalizedPin)) {
      return res.status(401).json({ error: "Invalid PIN" });
    }

    if (TEST_MODE) {
      if (normalizedPin !== "123455") {
        return res.status(401).json({ error: "Invalid PIN" });
      }

      return res.status(200).json({
        success: true,
        email: normalizedEmail,
        test: true
      });
    }

    const pinKey = `pin:${normalizedEmail}`;
    const attemptsKey = `pin_attempts:${normalizedEmail}`;

    const attempts = Number(await kv.get(attemptsKey)) || 0;

    if (attempts >= 5) {
      return res.status(429).json({
        error: "Too many failed attempts. Request a new PIN."
      });
    }

    const storedPin = await kv.get(pinKey);

    if (!storedPin) {
      return res.status(401).json({ error: "PIN expired or not found" });
    }

    if (!safeEqual(storedPin, normalizedPin)) {
      await kv.set(attemptsKey, attempts + 1, { ex: 900 });

      return res.status(401).json({ error: "Invalid PIN" });
    }

    await Promise.all([
      kv.del(pinKey),
      kv.del(attemptsKey)
    ]);

    return res.status(200).json({
      success: true,
      email: normalizedEmail
    });

  } catch (err) {
    console.error("verify-pin error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}