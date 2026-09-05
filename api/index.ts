export default async function handler(req: any, res: any) {
  const logs: string[] = []
  const log = (m: string) => { logs.push(m); console.log(m) }
  const url = new URL(req.url, `https://${req.headers.host}`)
  const path = url.pathname
  const q = url.searchParams.get('q')?.trim()
  const id = url.searchParams.get('id')?.trim()
  const BOT = process.env.BOT_TOKEN || ''
  const CHAT = process.env.CHANNEL_ID || ''
  let DB_FILE_ID = process.env.DB_FILE_ID || ''
  const WORKER = "https://yt-proxy.tgdot.workers.dev/?url="

  const tg = async (m: string, b?: any) => {
    const u = `https://api.telegram.org/bot${BOT}/${m}`
    if (b instanceof FormData) return await fetch(u, { method: 'POST', body: b }).then(r => r.json())
    return await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json())
  }
  const getDb = async (): Promise<any[]> => {
    try {
      if (!DB_FILE_ID) return []
      const f = await fetch(`https://api.telegram.org/bot${BOT}/getFile?file_id=${DB_FILE_ID}`).then(r => r.json())
      if (!f.ok) return []
      return await fetch(`https://api.telegram.org/file/bot${BOT}/${f.result.file_path}`).then(r => r.json()).catch(() => [])
    } catch { return [] }
  }
  const saveDb = async (db: any[]) => {
    try {
      const fd = new FormData()
      fd.append('chat_id', CHAT)
      fd.append('document', new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' }), 'database.json')
      const r = await tg('sendDocument', fd)
      if (r.ok) { DB_FILE_ID = r.result.document.file_id; await tg('pinChatMessage', { chat_id: CHAT, message_id: r.result.message_id, disable_notification: true }).catch(()=>{}) }
      return DB_FILE_ID
    } catch { return null }
  }

  const getAudioDirect = async (vid: string) => {
    const ytUrl = `https://www.youtube.com/watch?v=${vid}`
    const payload = { url: ytUrl, downloadMode: 'audio', audioFormat: 'mp3', filenameStyle: 'basic', audioBitrate: '128' }
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }

    // 1. DIRECT zarz.moe - bina worker ke (ye naya hai, Vercel se khul sakta hai)
    const directTargets = ["https://api.zarz.moe/v1/dl/cobalt", "https://api.zarz.moe", "https://co.wuk.sh/api/json"]
    for (const api of directTargets) {
      try {
        log(`Trying DIRECT -> ${api}`)
        const r = await fetch(api, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(12000) })
        const j: any = await r.json().catch(async()=>{ const t=await r.text(); log(`Non JSON ${api}: ${t.slice(0,120)}`); return null })
        if (j?.url || j?.data?.url) { log(`SUCCESS DIRECT ${api}`); return { url: j.url || j.data.url, title: j.filename || vid } }
        log(`No url from ${api}: ${JSON.stringify(j)?.slice(0,200)}`)
      } catch(e:any){ log(`DIRECT fail ${api}: ${e.message}`) }
    }

    // 2. Via Worker + proxies
    const proxies = [WORKER, "https://api.allorigins.win/raw?url="]
    for (const proxy of proxies) {
      for (const api of directTargets) {
        try {
          const proxied = proxy + encodeURIComponent(api)
          log(`Trying via ${proxy.includes('tgdot')?'worker':'proxy'} -> ${api}`)
          const r = await fetch(proxied, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) })
          const j: any = await r.json().catch(()=>null)
          if (j?.url || j?.data?.url) { log(`SUCCESS via proxy ${api}`); return { url: j.url || j.data.url, title: j.filename || vid } }
        } catch(e:any){ log(`Proxy fail ${api}: ${e.message}`) }
      }
    }
    throw new Error('no audio url')
  }

  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')

  if (path.includes('/api/ping')) return res.status(200).json({ ping: 'ok', cobalt: 'https://api.zarz.moe/v1/dl/cobalt', worker: WORKER })

  if (path.includes('/api/search')) {
    if (!q) return res.status(200).json([])
    try {
      const html = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%253D%253D`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) }).then(r=>r.text())
      const ids = [...html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)].map(m=>m[1])
      const titles = [...html.matchAll(/"title":\{"runs":\[\{"text":"([^"]{3,120})"/g)].map(m=>m[1])
      return res.status(200).json([...new Set(ids)].slice(0,10).map((vid,i)=>({ id: vid, title: titles[i]||vid, thumbnail: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`, uploader: '' })))
    } catch { return res.status(200).json([]) }
  }

  if (path.includes('/api/extract')) {
    if (!id) return res.status(400).json({ error: 'id required', logs })
    let db = await getDb()
    const found = db.find(x=>x.id===id)
    if (found) { found.hits=(found.hits||0)+1; await saveDb(db); return res.status(200).json({ status: 'cache', telegram_file_id: found.file_id, title: found.title, logs }) }
    try {
      const { url: aUrl, title } = await getAudioDirect(id)
      log(`Downloading ${aUrl.slice(0,80)}`)
      const buf = await fetch(aUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(25000) }).then(r=>r.arrayBuffer())
      if (!BOT ||!CHAT) { log('No BOT/CHAT env, returning direct url'); return res.status(200).json({ status: 'direct_no_tg', direct_url: aUrl, title, logs }) }
      const fd = new FormData(); fd.append('chat_id', CHAT); fd.append('audio', new Blob([buf], { type: 'audio/mpeg' }), `${id}.mp3`); fd.append('title', title)
      const tr = await tg('sendAudio', fd)
      if (!tr.ok) { log(`TG fail, returning direct`); return res.status(200).json({ status: 'direct_tg_fail', direct_url: aUrl, tg_error: tr, logs }) }
      const file_id2 = tr.result.audio?.file_id
      db.push({ id, file_id: file_id2, title, hits: 1 })
      const newId = await saveDb(db)
      return res.status(200).json({ status: 'fresh', telegram_file_id: file_id2, newDbFileId: newId, title, logs })
    } catch(e:any){ log(`FINAL FAIL: ${e.message}`); return res.status(500).json({ error: `Extract fail: ${e.message}`, logs }) }
  }
  return res.status(200).json({ ok: true })
}