import { Pool } from "pg"

const pool = new Pool({
connectionString: process.env.DATABASE_URL,
ssl:{rejectUnauthorized:false}
})

function cors(res){
res.setHeader("Access-Control-Allow-Credentials","true")
res.setHeader("Access-Control-Allow-Origin","*")
res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS")
res.setHeader("Access-Control-Allow-Headers","Content-Type,x-user-email")
}

export default async function handler(req,res){

cors(res)

if(req.method==="OPTIONS"){
return res.status(200).end()
}

const projectId = req.query.projectId || req.body.projectId
const modality = req.query.modality || req.body.modality
const userEmail = req.headers["x-user-email"]

if(!projectId){
return res.status(400).json({error:"missing project"})
}

const client = await pool.connect()

try{

if(req.method==="GET"){

const q = await client.query(
`
SELECT data
FROM equipment_details
WHERE project_id=$1
AND modality=$2
LIMIT 1
`,
[projectId,modality]
)

return res.json(q.rows[0]?.data || {})

}

if(req.method==="POST"){

const {data} = req.body

await client.query(
`
INSERT INTO equipment_details
(project_id,modality,data,updated_by)
VALUES ($1,$2,$3,$4)
ON CONFLICT (project_id,modality)
DO UPDATE SET
data = equipment_details.data || $3,
updated_by=$4,
updated_at=NOW()
`,
[
projectId,
modality,
JSON.stringify(data),
userEmail
]
)

return res.json({ok:true})

}

}catch(e){

console.error(e)
res.status(500).json({error:"server"})

}finally{
client.release()
}

}