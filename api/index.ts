import { Hono } from 'hono'
import { handle } from 'hono/vercel'

const app = new Hono()
const BOT = process.env.BOT_TOKEN!
const CHAT = process.env.CHANNEL_ID!
let DB_FILE_ID = process.env.DB_FILE_ID || ''

async function tg(m: string, b?: any){
  const u = `https://api.telegram.org/bot${BOT}/${m}`
  if(b instanceof FormData) return await fetch(u,{method:'POST',body:b}).then(r=>r.json())
  return await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json())
}
async function getDb(): Promise<any[]>{
  try{
    if(!DB_FILE_ID){
      const ch = await fetch(`https://api.telegram.org/bot${BOT}/getChat?chat_id=${CHAT}`).then(r=>r.json())
      if(ch?.result?.pinned_message?.document?.file_name==='database.json') DB_FILE_ID = ch.result.pinned_message.document.file_id
      else return []
    }
    const f = await fetch(`https://api.telegram.org/bot${BOT}/getFile?file_id=${DB_FILE_ID}`).then(r=>r.json())
    if(!f.ok) return []
    return await fetch(`https://api.telegram.org/file/bot${BOT}/${f.result.file_path}`).then(r=>r.json()).catch(()=>[])
  }catch{return []}
}
async function saveDb(db:any[]){
  try{
    const fd = new FormData()
    fd.append('chat_id', CHAT)
    fd.append('document', new Blob([JSON.stringify(db,null,2)],{type:'application/json'}), 'database.json')
    const r = await tg('sendDocument', fd)
    if(r.ok){
      DB_FILE_ID = r.result.document.file_id
      await tg('pinChatMessage',{chat_id:CHAT,message_id:r.result.message_id,disable_notification:true}).catch(()=>{})
    }
    return DB_FILE_ID
  }catch{return null}
}

// --- DIRECT YOUTUBE SEARCH - NO INV, NO PIPED - WORKS ON VERCEL ---
async function ytSearch(q: string){
  const key = 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w'
  const url = `https://www.youtube.com/youtubei/v1/search?key=${key}`
  const body = {
    context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, hl: 'en', gl: 'US' } },
    query: q
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000)
  })
  if(!res.ok) throw 'yt fail'
  const json: any = await res.json()
  const out: any[] = []
  try{
    const sections = json.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || []
    for(const sec of sections){
      const items = sec.itemSectionRenderer?.contents || []
      for(const it of items){
        const v = it.videoRenderer
        if(v?.videoId){
          out.push({
            id: v.videoId,
            title: v.title?.runs?.[0]?.text || v.title?.simpleText || v.videoId,
            thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
            uploader: v.ownerText?.runs?.[0]?.text || v.longBylineText?.runs?.[0]?.text || ''
          })
        }
      }
    }
  }catch{}
  return out.slice(0,10)
}

app.get('/api/search', async (c)=>{
  const q = c.req.query('q')?.trim()
  if(!q) return c.json([])
  try{
    const r = await ytSearch(q)
    return c.json(r)
  }catch(e){ return c.json([]) }
})

app.get('/api/stats', async (c)=>{
  const db = await getDb()
  return c.json({total:db.length, totalHits:db.reduce((a,b)=>a+(b.hits||0),0), blobUsedKB:Math.round(JSON.stringify(db).length/1024)})
})

app.get('/api/extract', async (c)=>{
  const id = c.req.query('id')?.trim()
  if(!id) return c.json({error:'id required'},400)
  let db = await getDb()
  const found = db.find(x=>x.id===id)
  if(found){ found.hits=(found.hits||0)+1; await saveDb(db); return c.json({status:'cache',telegram_file_id:found.file_id,title:found.title}) }
  try{
    const r = await fetch(`https://pipedapi.syncpundit.io/streams/${id}`,{signal:AbortSignal.timeout(8000)}).then(r=>r.json())
    const audio = r.audioStreams?.find((s:any)=>s.mimeType?.includes('mp4a')) || r.audioStreams?.[0]
    if(!audio?.url) return c.json({error:'Extract fail'},500)
    const buf = await fetch(audio.url).then(r=>r.arrayBuffer())
    const fd = new FormData()
    fd.append('chat_id', CHAT)
    fd.append('audio', new Blob([buf],{type:'audio/mp4'}), `${id}.m4a`)
    fd.append('title', r.title || id)
    const tr = await tg('sendAudio', fd)
    if(!tr.ok) return c.json({error:'tg upload fail'},500)
    const file_id = tr.result.audio?.file_id
    db.push({id,file_id,title:r.title||id,hits:1})
    const newId = await saveDb(db)
    return c.json({status:'fresh',telegram_file_id:file_id,newDbFileId:newId,title:r.title||id})
  }catch(e:any){ return c.json({error:e.message},500) }
})

app.get('/api/file', async (c)=>{
  const fid = c.req.query('file_id')
  const f = await fetch(`https://api.telegram.org/bot${BOT}/getFile?file_id=${fid}`).then(r=>r.json())
  if(!f.ok) return c.text('not found',404)
  return c.redirect(`https://api.telegram.org/file/bot${BOT}/${f.result.file_path}`,302)
})

export default handle(app)