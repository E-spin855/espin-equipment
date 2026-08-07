import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const clean = value => String(value || "").trim().toLowerCase();

function cors(res) {
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-user-email");
  res.setHeader("Access-Control-Allow-Origin", "*");
}

async function prepare(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS espin_link_projects (
      id TEXT PRIMARY KEY,
      owner_email TEXT NOT NULL,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS espin_link_snapshots (
      snapshot_key TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_by TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function isAdmin(client, email) {
  const result = await client.query(
    "SELECT 1 FROM admins WHERE LOWER(email) = $1 LIMIT 1",
    [email]
  );
  return result.rowCount > 0;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const actor = clean(req.headers["x-user-email"]);
  if (!actor) return res.status(401).json({ error: "Sign in is required." });

  let client;
  try {
    client = await pool.connect();
    await prepare(client);
    const admin = await isAdmin(client, actor);

    if (req.method === "GET") {
      if (req.query?.view === "today") {
        if (!admin) return res.status(403).json({ error: "Manager access required." });
        const result = await client.query(
          "SELECT payload, updated_at FROM espin_link_snapshots WHERE snapshot_key = 'today-summary'"
        );
        return res.status(200).json(result.rows[0]?.payload || { events: [], local_day: "" });
      }

      const result = await client.query(
        admin
          ? "SELECT payload FROM espin_link_projects ORDER BY updated_at DESC"
          : "SELECT payload FROM espin_link_projects WHERE owner_email = $1 ORDER BY updated_at DESC",
        admin ? [] : [actor]
      );
      return res.status(200).json(result.rows.map(row => row.payload));
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

    if (body.action === "save_today_summary") {
      if (!admin) return res.status(403).json({ error: "Manager access required." });
      const snapshot = body.snapshot && typeof body.snapshot === "object" ? body.snapshot : null;
      if (!snapshot || !Array.isArray(snapshot.events)) return res.status(400).json({ error: "Invalid summary." });
      await client.query(
        `INSERT INTO espin_link_snapshots (snapshot_key, payload, updated_by)
         VALUES ('today-summary', $1, $2)
         ON CONFLICT (snapshot_key) DO UPDATE
         SET payload = EXCLUDED.payload, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [JSON.stringify(snapshot), actor]
      );
      return res.status(200).json({ ok: true });
    }

    const project = body.project && typeof body.project === "object" ? body.project : null;
    const id = clean(project?.active_project_id || project?.operation_id || project?.project_id);
    const owner = clean(project?.rep_email || project?.sales_rep_email || actor);
    if (!project || !id) return res.status(400).json({ error: "A project identity is required." });
    if (!admin && owner !== actor) return res.status(403).json({ error: "You can only update your own projects." });

    const existing = await client.query("SELECT owner_email FROM espin_link_projects WHERE id = $1", [id]);
    if (existing.rowCount && !admin && existing.rows[0].owner_email !== actor) {
      return res.status(403).json({ error: "You do not have access to this project." });
    }

    await client.query(
      `INSERT INTO espin_link_projects (id, owner_email, payload)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE
       SET payload = EXCLUDED.payload, updated_at = NOW()`,
      [id, owner, JSON.stringify({ ...project, rep_email: owner, synced_at: new Date().toISOString() })]
    );
    return res.status(200).json({ ok: true, id });
  } catch (error) {
    console.error("ESPIN LINK project sync failed", error);
    return res.status(500).json({ error: "Project synchronization failed." });
  } finally {
    client?.release();
  }
}
