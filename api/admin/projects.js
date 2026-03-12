import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function cors(res) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, x-user-email, x-useremail"
  );
}

async function isAdmin(client, email) {
  if (!email) return false;
  const { rows } = await client.query(
    `SELECT 1 FROM admins WHERE email = $1 LIMIT 1`,
    [String(email).toLowerCase()]
  );
  return rows.length > 0;
}

function cleanStr(v) {
  const s = (v == null ? "" : String(v)).trim();
  return s;
}

function cleanZip(v) {
  const s = cleanStr(v);
  // keep your original behavior: allow empty; if present, keep only digits and max 5
  const digits = s.replace(/\D/g, "").slice(0, 5);
  return digits;
}

export default async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const userEmail =
    req.headers["x-user-email"] ||
    req.headers["x-useremail"] ||
    null;

  const client = await pool.connect();
  try {
    const ok = await isAdmin(client, userEmail);
    if (!ok) return res.status(403).json({ error: "Admin only" });

    /* ===============================
       DELETE (POST action)
       Body: { action: "delete", id: "<uuid>" }
    =============================== */
    if (req.method === "POST" && req.body?.action === "delete") {
      const id = cleanStr(req.body?.id);
      if (!id) return res.status(400).json({ error: "Missing project id" });

      await client.query(`DELETE FROM projects WHERE id = $1`, [id]);
      return res.status(200).json({ ok: true });
    }

    /* ===============================
       CREATE (POST)
       Body: { project_name, site_address, zip_code, modality, magnet_event, disposal_required }
    =============================== */
    if (req.method === "POST") {
      const project_name = cleanStr(req.body?.project_name);
      const site_address = cleanStr(req.body?.site_address);
      const zip_code = cleanZip(req.body?.zip_code);
      const modality = cleanStr(req.body?.modality);
      const magnet_event = req.body?.magnet_event == null ? null : cleanStr(req.body?.magnet_event) || null;
      const disposal_required = !!req.body?.disposal_required;

      if (!project_name) {
        return res.status(400).json({ error: "Missing project_name" });
      }

      const { rows } = await client.query(
        `INSERT INTO projects (
           project_name,
           site_address,
           zip_code,
           modality,
           magnet_event,
           disposal_required
         )
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, project_name, site_address, zip_code, modality, magnet_event, disposal_required, project_completed, hidden, created_at`,
        [project_name, site_address, zip_code, modality, magnet_event, disposal_required]
      );

      return res.status(200).json(rows[0]);
    }

    /* ===============================
       UPDATE (PUT)
       Query: ?id=<uuid>
       Body: { project_name, site_address, zip_code, modality, magnet_event, disposal_required }
    =============================== */
    if (req.method === "PUT") {
      const id = cleanStr(req.query?.id);
      if (!id) return res.status(400).json({ error: "Missing project id" });

      const project_name = cleanStr(req.body?.project_name);
      const site_address = cleanStr(req.body?.site_address);
      const zip_code = cleanZip(req.body?.zip_code);
      const modality = cleanStr(req.body?.modality);
      const magnet_event = req.body?.magnet_event == null ? null : cleanStr(req.body?.magnet_event) || null;
      const disposal_required = !!req.body?.disposal_required;

      // Keep it permissive, but if name is provided empty, block (matches typical behavior)
      if (req.body?.project_name !== undefined && !project_name) {
        return res.status(400).json({ error: "project_name cannot be empty" });
      }

      const { rows } = await client.query(
        `UPDATE projects
         SET
           project_name = COALESCE(NULLIF($2,''), project_name),
           site_address = $3,
           zip_code = $4,
           modality = $5,
           magnet_event = $6,
           disposal_required = $7
         WHERE id = $1
         RETURNING id, project_name, site_address, zip_code, modality, magnet_event, disposal_required, project_completed, hidden, created_at`,
        [id, project_name, site_address, zip_code, modality, magnet_event, disposal_required]
      );

      if (!rows.length) return res.status(404).json({ error: "Project not found" });
      return res.status(200).json(rows[0]);
    }

    /* ===============================
       LIST (GET)
    =============================== */
    if (req.method === "GET") {
      const { rows } = await client.query(
        `SELECT
           id,
           project_name,
           site_address,
           zip_code,
           modality,
           magnet_event,
           disposal_required,
           project_completed,
           hidden,
           created_at
         FROM projects
         ORDER BY created_at DESC`
      );

      return res.status(200).json(rows);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e) {
    console.error("ADMIN PROJECTS ERROR:", e);
    return res.status(500).json({ error: "Server error" });
  } finally {
    client.release();
  }
}
