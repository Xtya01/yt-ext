import { Hono } from 'hono'
import { handle } from 'hono/vercel'

const app = new Hono()
const BOT = process.env.BOT_TOKEN!
const CHAT = process.env.CHANNEL_ID!
const ADMIN = process.env.ADMIN_KEY!

let DB_FILE_ID = process.env.DB_FILE_ID || ''

async function tg(method: string, body?: any){
  const url = `https://api.telegram.org/bot${BOT}/${method}`
  if(body instanceof FormData) return await fetch(url, {method:'POST', body}).then(r=>r.json())
  return await fetch(url, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)}).then(r=>r.json())
}

async function getDb(): Promise<any[]>{
  try{
    if(!DB_FILE_ID){
      // try to get from pinned message
      const chat = await fetch(`https://api.telegram.org/bot${BOT}/getChat?chat_id=${CHAT}`).then(r=>r.json())
      if(chat?.result?.pinned_message?.document?.file_name === 'database.json'){
        DB_FILE_ID = chat.result.pinned_message.document.file_id
      } else return []
    }
    const f = await fetch(`https://api.telegram.org/bot${BOT}/getFile?file_id=${DB_FILE_ID}`).then(r=>r.json())
    if(!f.ok) return []
    const fileUrl = `https://api.telegram.org/file/bot${BOT}/${f.result.file_path}`
    const data = await fetch(fileUrl).then(r=>r.json()).catch(()=>[])
    return Array.isArray(data) ? data : []
  }catch{ return [] }
}

async function saveDb(db:any[]){
  try{
    const blob = new Blob([JSON.stringify(db, null, 2)], {type:'application/json'})
    const fd = new FormData()
    fd.append('chat_id', CHAT)
    fd.append('document', blob, 'database.json')
    fd.append('caption', `db ${new Date().toISOString()}`)
    const res = await tg('sendDocument', fd)
    if(res.ok){
      DB_FILE_ID = res.result.document.file_id
      // try to pin new db
      await tg('pinChatMessage', {chat_id: CHAT, message_id: res.result.message_id, disable_notification: true}).catch(()=>{})
      return DB_FILE_ID
    }
  }catch(e){ console.log(e) }
  return null
}

async function getM4a(videoId:string){
  try{
    // Using Piped - you can replace with any compliant extractor you own rights to
    const r = await fetch(`https://pipedapi.kavin.rocks/streams/${videoId}`).then(r=>r.json())
    if(r.error) throw r.error
    const audio = r.audioStreams?.find((s:any)=>s.mimeType?.includes('mp4a') || s.mimeType?.includes('mp4')) || r.audioStreams?.[0]
    return { url: audio?.url, title: r.title || videoId }
  }catch{ return null }
}

app.get('/api/stats', async (c)=>{
  const db = await getDb()
  return c.json({ total: db.length, totalHits: db.reduce((a,b)=>a+(b.hits||0),0), blobUsedKB: Math.round(JSON.stringify(db).length/1024) })
})

app.get('/api/search', async (c)=>{
  const q = c.req.query('q')
  if(!q) return c.json([])
  try{
    const r = await fetch(`https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(q)}&filter=videos`).then(r=>r.json())
    const items = (r.items || r || []).slice(0,12).map((v:any)=>({
      id: (v.url?.split('v=')[1] || v.url?.split('/')[3] || v.id || '').split('&')[0],
      title: v.title,
      thumbnail: v.thumbnail || `https://i.ytimg.com/vi/${v.url?.split('v=')[1]}/hqdefault.jpg`,
      uploader: v.uploaderName || v.uploader || ''
    })).filter((x:any)=>x.id)
    return c.json(items)
  }catch(e){ return c.json([]) }
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
  const info = await getM4a(id)
  if(!info?.url) return c.json({error:'Extract fail, try another ID or Piped instance down'},500)

  try{
    const audioBuf = await fetch(info.url).then(r=>r.arrayBuffer())
    const fd = new FormData()
    fd.append('chat_id', CHAT)
    fd.append('audio', new Blob([audioBuf], {type:'audio/mp4'}), `${id}.m4a`)
    fd.append('caption', id)
    fd.append('title', info.title)
    const tgRes = await tg('sendAudio', fd)
    if(!tgRes.ok) return c.json({error:'Telegram upload fail', details: tgRes},500)

    const file_id = tgRes.result.audio?.file_id || tgRes.result.document?.file_id
    db.push({id, file_id, title: info.title, hits:1})
    const newId = await saveDb(db)
    return c.json({status:'fresh', telegram_file_id: file_id, newDbFileId: newId, title: info.title})
  }catch(e:any){ return c.json({error: e.message || 'download fail'},500) }
})

app.get('/api/admin/list', async (c)=>{
  if(c.req.query('key')!==ADMIN) return c.text('unauthorized',401)
  return c.json(await getDb())
})

app.get('/api/admin/delete', async (c)=>{
  if(c.req.query('key')!==ADMIN) return c.text('unauthorized',401)
  const id = c.req.query('id') 
  let db = await getDb()
  db = db.filter(x=>x.id!==id)
  await saveDb(db)
  return c.json({ok:true})
})

app.get('/api/file', async (c)=>{
  const file_id = c.req.query('file_id')
  if(!file_id) return c.text('file_id required',400)
  const f = await fetch(`https://api.telegram.org/bot${BOT}/getFile?file_id=${file_id}`).then(r=>r.json())
  if(!f.ok) return c.text('not found',404)
  return c.redirect(`https://api.telegram.org/file/bot${BOT}/${f.result.file_path}`, 302)
})

export default handle(app)