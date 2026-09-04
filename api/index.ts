import { Hono } from 'hono'
import { handle } from 'hono/vercel'

const app = new Hono()
const BOT_TOKEN = process.env.BOT_TOKEN!
const CHANNEL_ID = process.env.CHANNEL_ID!
const ADMIN_KEY = process.env.ADMIN_KEY!

// Telegram se database.json padhna
async function getDb(){
  const fileId = process.env.DB_FILE_ID!
  const f = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`).then(r=>r.json())
  if(!f.ok) return []
  const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${f.result.file_path}`
  return await fetch(url).then(r=>r.json())
}

async function saveDb(db:any){
  const blob = new Blob([JSON.stringify(db, null, 2)], {type:'application/json'})
  const fd = new FormData()
  fd.append('chat_id', CHANNEL_ID)
  fd.append('document', blob, 'database.json')
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, {method:'POST', body: fd}).then(r=>r.json())
  // naya file_id .env me update karna padega manually ya tu DB_FILE_ID ko dynamic bana sakta hai
  return res.result.document.file_id
}

// User Search
app.get('/api/extract', async (c)=>{
  const id = c.req.query('id')
  let db = await getDb()
  let found = db.find((x:any)=>x.id===id)
  if(found){
    found.hits = (found.hits||0)+1
    await saveDb(db)
    return c.json({ telegram_file_id: found.file_id, from: 'telegram-cache' })
  }

  // --- YAHAN TERA YOUTUBE EXTRACT LOGIC AYEGA ---
  // piped api se m4a link nikal ke Telegram pe bhejo
  const m4a_url = `https://example.com/${id}.m4a` // placeholder
  
  const fd = new FormData()
  fd.append('chat_id', CHANNEL_ID)
  fd.append('audio', await fetch(m4a_url).then(r=>r.blob()), `${id}.m4a`)
  fd.append('caption', id)
  const tg = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendAudio`, {method:'POST', body: fd}).then(r=>r.json())
  
  db.push({id, file_id: tg.result.audio.file_id, hits:1})
  const newDbFileId = await saveDb(db)
  
  return c.json({ telegram_file_id: tg.result.audio.file_id, newDbFileId })
})

// Admin APIs
app.get('/api/admin/list', async (c)=>{
  if(c.req.query('key')!==ADMIN_KEY) return c.text('unauthorized', 401)
  return c.json(await getDb())
})

app.get('/api/stats', async (c)=>{
  const db = await getDb()
  return c.json({ total: db.length, totalHits: db.reduce((a:any,b:any)=>a+(b.hits||0),0) })
})

export default handle(app)