// FILE: /api/kv-get.js
// PATH: /api/kv-get.js

import { kv } from "@vercel/kv";

export const config = {
  runtime: "nodejs",
};

const ALLOWED_ORIGINS = new Set([
  "https://your-app-domain.com",
  "https://www.your-app-domain.com"
]);

function cleanEmail(v) {
  return String(v || "").toLowerCase().trim();
}

function cleanKey(v) {
  return String(v || "").trim();
}

function setCors(req, res) {
  const origin = req.headers.origin || "";

  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function isAllowedUserKey(key, userEmail) {
  if (!key || !userEmail) return false;

  const allowedPrefixes = [
    `project:unread:${userEmail}:`,
    `project:unread_images:${userEmail}:`,
    `user:badge:${userEmail}`,
    `device:badge:${userEmail}`
  ];

  return allowedPrefixes.some(prefix => key.startsWith(prefix) || key === prefix);
}

export default async function handler(req, res) {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      value: null,
      error: "Method not allowed"
    });
  }

  try {
    const userEmail = cleanEmail(req.headers["x-user-email"]);

    if (!userEmail) {
      return res.status(401).json({
        ok: false,
        value: null,
        error: "Unauthorized"
      });
    }

    const body =
      typeof req.body === "string"
        ? JSON.parse(req.body || "{}")
        : req.body || {};

    const key = cleanKey(body.key);

    if (!key) {
      return res.status(400).json({
        ok: false,
        value: null,
        error: "No key provided"
      });
    }

    if (!isAllowedUserKey(key, userEmail)) {
      return res.status(403).json({
        ok: false,
        value: null,
        error: "Forbidden"
      });
    }

    const value = await kv.get(key);

    return res.status(200).json({
      ok: true,
      value: value ?? null
    });
  } catch (err) {
    console.error("KV Get Error:", err);

    return res.status(500).json({
      ok: false,
      value: null,
      error: "Internal error"
    });
  }
}