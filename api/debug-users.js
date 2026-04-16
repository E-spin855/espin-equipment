import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  const keys = await kv.keys("app:badge:equipment:*");

  const users = keys.map(k => k.split(":").pop());

  res.status(200).json(users);
}