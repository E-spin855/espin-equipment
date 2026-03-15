const { Pool } = require("pg")

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
})

function cors(res){
  res.setHeader("Access-Control-Allow-Origin","*")
  res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS")
  res.setHeader("Access-Control-Allow-Headers","Content-Type,x-user-email")
}

module.exports = async function handler(req,res){

  cors(res)

  if(req.method==="OPTIONS"){
    return res.status(200).end()
  }

  try{

    const projectId =
      req.query.projectId ||
      req.body?.projectId

    if(!projectId){
      return res.json({error:"missing project"})
    }

    const client = await pool.connect()

    try{

      if(req.method==="GET"){

        const q = await client.query(
          "SELECT * FROM equipment_details WHERE project_id=$1 LIMIT 1",
          [projectId]
        )

        return res.json(q.rows[0] || {})
      }

      if(req.method==="POST"){

        const { data } = req.body || {}

        const fields = Object.keys(data || {})

        if(!fields.length){
          return res.json({ok:true})
        }

        const set = fields
          .map((f,i)=>`${f}=$${i+2}`)
          .join(",")

        const values = [
          projectId,
          ...fields.map(f=>data[f])
        ]

        await client.query(
          "INSERT INTO equipment_details(project_id) VALUES($1) ON CONFLICT DO NOTHING",
          [projectId]
        )

        await client.query(
          `UPDATE equipment_details SET ${set}, updated_at=NOW() WHERE project_id=$1`,
          values
        )

        return res.json({ok:true})
      }

    } finally {
      client.release()
    }

  } catch(e){

    console.error(e)

    return res.status(500).json({
      error:"server",
      message:e.message
    })

  }

}