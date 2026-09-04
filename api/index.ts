import { Hono } from 'hono'
import { handle } from 'hono/vercel'
const app = new Hono()
const BOT = process.env.BOT_TOKEN!
const CHAT = process.env.CHANNEL_ID!
let DB_FILE_ID = process.env.DB_FILE_ID || ''

async function tg(m:string,b?:any){
  const u=`https://api.telegram.org/bot${BOT}/${m}`
  if(b instanceof FormData) return await fetch(u,{method:'POST',body:b}).then(r=>r.json())
  return await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json())
}
async function getDb():Promise<any[]>{
  try{
    if(!DB_FILE_ID) return []
    const f=await fetch(`https://api.telegram.org/bot${BOT}/getFile?file_id=${DB_FILE_ID}`).then(r=>r.json())
    if(!f.ok) return []
    return await fetch(`https://api.telegram.org/file/bot${BOT}/${f.result.file_path}`).then(r=>r.json()).catch(()=>[])
  }catch{return []}
}
async function saveDb(db:any[]){
  try{
    const fd=new FormData()
    fd.append('chat_id',CHAT)
    fd.append('document',new Blob([JSON.stringify(db,null,2)],{type:'application/json'}),'database.json')
    const r=await tg('sendDocument',fd)
    if(r.ok){DB_FILE_ID=r.result.document.file_id; await tg('pinChatMessage',{chat_id:CHAT,message_id:r.result.message_id,disable_notification:true}).catch(()=>{})}
    return DB_FILE_ID
  }catch{return null}
}

// FASTEST SEARCH - YouTube HTML scrape - never 504 on Vercel
async function ytSearchFast(q:string){
  const url=`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%253D%253D`
  const res=await fetch(url,{
    headers:{'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36','Accept-Language':'en-US,en;q=0.9'},
    signal:AbortSignal.timeout(4000)
  })
  const html=await res.text()
  const idMatches=[...html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)].map(m=>m[1])
  const titleMatches=[...html.matchAll(/"title":\{"runs":\[\{"text":"([^"]{3,100})"/g)].map(m=>m[1])
  const uniq=[...new Set(idMatches)].slice(0,10)
  return uniq.map((id,i)=>({id,title:titleMatches[i]||id,thumbnail:`https://i.ytimg.com/vi/${id}/hqdefault.jpg`,uploader:''}))
}

app.get('/api/search', async (c)=>{
  const q=c.req.query('q')?.trim()
  if(!q) return c.json([])
  try{
    const data=await ytSearchFast(q)
    return c.json(data)
  }catch(e){ return c.json([]) }
})

app.get('/api/stats', async (c)=>{
  const db=await getDb()
  return c.json({total:db.length,totalHits:db.reduce((a,b)=>a+(b.hits||0),0),blobUsedKB:Math.round(JSON.stringify(db).length/1024)})
})
app.get('/api/extract', async (c)=>{
  const id=c.req.query('id')?.trim()
  if(!id) return c.json({error:'id required'},400)
  let db=await getDb()
  const f=db.find(x=>x.id===id)
  if(f){f.hits=(f.hits||0)+1; await saveDb(db); return c.json({status:'cache',telegram_file_id:f.file_id,title:f.title})}
  try{
    const r=await fetch(`https://pipedapi.syncpundit.io/streams/${id}`,{signal:AbortSignal.timeout(7000)}).then(r=>r.json())
    const audio=r.audioStreams?.find((s:any)=>s.mimeType?.includes('mp4a'))||r.audioStreams?.[0]
    if(!audio?.url) return c.json({error:'Extract fail'},500)
    const buf=await fetch(audio.url).then(r=>r.arrayBuffer())
    const fd=new FormData()
    fd.append('chat_id',CHAT)
    fd.append('audio',new Blob([buf],{type:'audio/mp4'}),`${id}.m4a`)
    fd.append('title',r.title||id)
    const tr=await tg('sendAudio',fd)
    if(!tr.ok) return c.json({error:'tg upload fail'},500)
    const file_id=tr.result.audio?.file_id
    db.push({id,file_id,title:r.title||id,hits:1})
    const newId=await saveDb(db)
    return c.json({status:'fresh',telegram_file_id:file_id,newDbFileId:newId,title:r.title||id})
  }catch(e:any){return c.json({error:e.message},500)}
})
app.get('/api/file', async (c)=>{
  const fid=c.req.query('file_id')
  const f=await fetch(`https://api.telegram.org/bot${BOT}/getFile?file_id=${fid}`).then(r=>r.json())
  if(!f.ok) return c.text('not found',404)
  return c.redirect(`https://api.telegram.org/file/bot${BOT}/${f.result.file_path}`,302)
})
app.get('/api/ping', (c)=>c.text('ok'))

export default handle(app)