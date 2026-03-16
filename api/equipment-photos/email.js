import { Pool } from "pg";
import { Resend } from "resend";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM_EMAIL = "Espin Medical <info@espinmedical.com>";
const ADMIN_EMAIL = "info@espinmedical.com";

function safeJson(body) {
  if (!body) return {};
  if (typeof body === "string") {
    try { return JSON.parse(body); }
    catch { return {}; }
  }
  return body;
}

function validUuidList(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(v =>
    typeof v === "string" &&
    /^[0-9a-fA-F-]{36}$/.test(v)
  );
}

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = safeJson(req.body);

  const projectId = body.projectId;

  const photoIds = validUuidList(body.photoIds);

  if (!projectId || !photoIds.length) {
    return res.status(400).json({ error: "Invalid request" });
  }

  const client = await pool.connect();

  try {

    const { rows: projectRows } = await client.query(
      `SELECT project_name FROM projects WHERE id=$1`,
      [projectId]
    );

    if (!projectRows.length) {
      return res.status(404).json({ error: "Project not found" });
    }

    const { rows: photos } = await client.query(
      `
      SELECT photo_title, photo_url
      FROM project_photos
      WHERE id = ANY($1::uuid[])
      `,
      [photoIds]
    );

    if (!photos.length) {
      return res.status(200).json({ sent:false });
    }

    const html = photos.map(p => `
      <div style="margin-bottom:20px">
        <div><b>${p.photo_title || ""}</b></div>
        <img src="${p.photo_url}" style="max-width:600px"/>
      </div>
    `).join("");

    await resend.emails.send({
      from: FROM_EMAIL,
      to: [ADMIN_EMAIL],
      subject: `Project Images – ${projectRows[0].project_name}`,
      html
    });

    return res.status(200).json({ sent:true });

  } catch (err) {

    console.error("EMAIL ERROR:", err);

    return res.status(500).json({
      error:"Email failed",
      detail:err.message
    });

  } finally {

    client.release();

  }

}