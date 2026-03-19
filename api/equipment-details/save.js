import { Pool } from "pg";
import { Resend } from "resend";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const client = await pool.connect();

  try {

    const { projectId, data } = req.body;

    console.log("BODY:", req.body);

    if (!projectId || !data) {
      return res.status(400).json({ error: "Missing projectId or data" });
    }

    // ✅ SAVE JSONB
    await client.query(`
      INSERT INTO equipment_details (project_id, data)
      VALUES ($1, $2)
      ON CONFLICT (project_id)
      DO UPDATE SET data = $2, updated_at = NOW()
    `, [projectId, data]);

    // 🔴 TEMP: DISABLE EMAIL FOR NOW
    // (we isolate DB first)
    /*
    await resend.emails.send({
      from: "Espin Medical <info@espinmedical.com>",
      to: "info@espinmedical.com",
      subject: "Equipment Details",
      html: "<p>Test</p>"
    });
    */

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error("ERROR:", err);
    return res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}