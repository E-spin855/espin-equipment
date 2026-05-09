// File: add.js
// Path: /api/equipment-access/add.js

import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

export default async function handler(req, res) {

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type,x-user-email"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {

    const {
      projectId,
      users = []
    } = req.body || {};

    if (!projectId) {
      return res.status(400).json({
        error: "Missing projectId"
      });
    }

    if (!Array.isArray(users) || !users.length) {
      return res.status(400).json({
        error: "Users array required"
      });
    }

    const added = [];

    for (const user of users) {

      const email = String(user.email || "")
        .trim()
        .toLowerCase();

      const role = String(user.role || "viewer")
        .trim()
        .toLowerCase();

      if (!email) continue;

      await pool.query(
        `
        INSERT INTO project_access (
          project_id,
          user_email,
          role
        )
        VALUES ($1,$2,$3)
        ON CONFLICT (project_id, user_email)
        DO UPDATE SET
          role = EXCLUDED.role
        `,
        [
          projectId,
          email,
          role
        ]
      );

      added.push({
        email,
        role
      });
    }

    return res.status(200).json({
      success: true,
      added
    });

  } catch (err) {

    console.error(
      "PROJECT ACCESS ADD ERROR:",
      err
    );

    return res.status(500).json({
      error: "Internal server error"
    });
  }
}