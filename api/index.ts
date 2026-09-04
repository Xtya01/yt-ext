import { Hono } from 'hono'
import { handle } from 'hono/vercel'

const app = new Hono()
const BOT = process.env.BOT_TOKEN!
const CHAT = process.env.CHANNEL_ID!

let DB_FILE_ID = process.env.DB_FILE_ID || ''

async function tg(method: string, body?: any){
  const url = `https://api.telegram.org/bot${BOT}/${method}`
  if(body instanceof FormData) return await fetch(url, {method:'POST', body}).then(r=>r.json())
  return await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)}).then(r=>r.json())
}

async function getDb(): Promise<any[]>{
  try{
    if(!DB_FILE_ID){
      const chat = await fetch(`https://api.telegram.org/bot${BOT}/getChat?chat_id=${CHAT}`).then(r=>r.json())
      if(chat?.result?.pinned_message?.document?.file_name === 'database.json'){
        DB_FILE_ID = chat.result.pinned_message.document.file_id
      } else return []
    }
    const f = await fetch(`https://api.telegram.org/bot${BOT}/getFile?file_id=${DB_FILE_ID}`).then(r=>r.json())
    if(!f.ok) return []
    const fileUrl = `https://api.telegram.org/file/bot${BOT}/${f.result.file_path}`
    return await fetch(fileUrl).then(r=>r.json()).catch(()=>[])
  }catch{ return [] }
}

async function saveDb(db:any[]){
  try{
    const blob = new Blob([JSON.stringify(db, null, 2)], {type:'application/json'})
    const fd = new FormData()
    fd.append('chat_id', CHAT)
    fd.append('document', blob, 'database.json')
    const res = await tg('sendDocument', fd)
    if(res.ok){
      DB_FILE_ID = res.result.document.file_id
      await tg('pinChatMessage', {chat_id: CHAT, message_id: res.result.message_id, disable_notification: true}).catch(()=>{})
      return DB_FILE_ID
    }
  }catch{}
  return null
}

// --- NEW SEARCH FIX - NO PIPED, USE INVIDIOUS ---
app.get('/api/search', async (c)=>{
  const q = c.req.query('q')
  if(!q) return c.json([])
  
  const INSTANCES = [
    'https://yewtu.be',
    'https://inv.tux.pizza',
    'https://invidious.privacydev.net',
    'https://inv.nadeko.net',
    'https://iv.melmac.space'
  ]

  for(const base of INSTANCES){
    try{
      const r = await fetch(`${base}/api/v1/search?q=${encodeURIComponent(q)}&type=video`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000)
      })
      if(!r.ok) continue
      const data = await r.json()
      const items = (data || []).slice(0,12).map((v:any)=>({
        id: v.videoId,
        title: v.title,
        thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
        uploader: v.author || ''
      })).filter((x:any)=>x.id)
      if(items.length) return c.json(items)
    }catch{}
  }
  return c.json([], 500)
})

app.get('/api/stats', async (c)=>{
  const db = await getDb()
  return c.json({ total: db.length, totalHits: db.reduce((a,b)=>a+(b.hits||0),0), blobUsedKB: Math.round(JSON.stringify(db).length/1024) })
})

app.get('/api/extract', async (c)=>{
  const id = c.req.query('id')?.trim()
  if(!id) return c.json({error:'id required'},400)
  let db = await getDb()
  let found = db.find(x=>x.id===id)
  if(found){
    found.hits = (found.hits||0)+1
    await saveDb(db)
    return c.json({status:'cache', telegram_file_id: found.file_id, title: found.title})
  }
  // Piped for audio extract with fallback
  try{
    const pipedBases = ['https://pipedapi.syncpundit.io','https://api.piped.private.coffee','https://pipedapi.kavin.rocks']
    let streamUrl = '', title = id
    for(const b of pipedBases){
      try{
        const r = await fetch(`${b}/streams/${id}`, {signal: AbortSignal.timeout(10000)}).then(r=>r.json())
        const audio = r.audioStreams?.find((s:any)=>s.mimeType?.includes('mp4a')) || r.audioStreams?.[0]
        if(audio?.url){ streamUrl = audio.url; title = r.title || id; break }
      }catch{}
    }
    if(!streamUrl) return c.json({error:'Extract fail'},500)
    const audioBuf = await fetch(streamUrl).then(r=>r.arrayBuffer())
    const fd = new FormData()
    fd.append('chat_id', CHAT)
    fd.append('audio', new Blob([audioBuf], {type:'audio/mp4'}), `${id}.m4a`)
    fd.append('title', title)
    const tgRes = await tg('sendAudio', fd)
    if(!tgRes.ok) return c.json({error:'Telegram upload fail'},500)
    const file_id = tgRes.result.audio?.file_id
    db.push({id, file_id, title, hits:1})
    const newId = await saveDb(db)
    return c.json({status:'fresh', telegram_file_id: file_id, newDbFileId: newId, title})
  }catch(e:any){ return c.json({error: e.message},500) }
})

app.get('/api/file', async (c)=>{
  const file_id = c.req.query('file_id')
  const f = await fetch(`https://api.telegram.org/bot${BOT}/getFile?file_id=${file_id}`).then(r=>r.json())
  if(!f.ok) return c.text('not found',404)
  return c.redirect(`https://api.telegram.org/file/bot${BOT}/${f.result.file_path}`, 302)
})

export default handle(app)