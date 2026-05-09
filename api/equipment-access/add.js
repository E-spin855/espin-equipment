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
    const skipped = [];

    for (const user of users) {

      const email = String(user.email || "")
        .trim()
        .toLowerCase();

      let role = String(user.role || "viewer")
        .trim()
        .toLowerCase();

      // 🔥 STRICT EMAIL VALIDATION
      const validEmail =
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

      if (!validEmail) {

        skipped.push({
          email,
          role,
          reason: "Invalid email"
        });

        continue;
      }

      // 🔥 ALLOWED ROLES
      const allowedRoles = [
        "admin",
        "rep",
        "hospital",
        "viewer"
      ];

      if (!allowedRoles.includes(role)) {
        role = "viewer";
      }

      try {

        await pool.query(
          `
          INSERT INTO equipment_project_access (
            project_id,
            email,
            role
          )
          VALUES ($1,$2,$3)
          ON CONFLICT (project_id, email)
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

      } catch (dbErr) {

        console.error(
          "ACCESS INSERT ERROR:",
          dbErr
        );

        skipped.push({
          email,
          role,
          reason: dbErr.message || "DB insert failed"
        });
      }
    }

    return res.status(200).json({
      success: true,
      projectId,
      added,
      skipped
    });

  } catch (err) {

    console.error(
      "EQUIPMENT ACCESS ADD ERROR:",
      err
    );

    return res.status(500).json({
      error: err.message || "Internal server error"
    });
  }
}