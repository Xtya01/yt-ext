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
  const PROXIES = [WORKER, "https://api.allorigins.win/raw?url=", "https://corsproxy.io/?"]

  // Tera wala naya instance + purane backup
  const COBALT_URLS = [
    "https://api.zarz.moe/v1/dl/cobalt",
    "https://api.zarz.moe",
    "https://api.co.wuk.sh",
    "https://wuk.sh/api/json",
    "https://cobalt-api.kittycat.boo"
  ]
  const INVIDIOUS = ["https://inv.tux.pizza", "https://yewtu.be", "https://invidious.snopyta.org"]

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
    // 1. Tera wala zarz.moe wala cobalt pehle try karo
    for (const proxy of PROXIES) {
      for (const api of COBALT_URLS) {
        try {
          const proxied = proxy + encodeURIComponent(api)
          log(`Trying COBALT ${api} via ${proxy.includes('tgdot')?'worker':'proxy'}`)
          const r = await fetch(proxied, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ url: ytUrl, downloadMode: 'audio', audioFormat: 'mp3', filenameStyle: 'basic' }),
            signal: AbortSignal.timeout(15000)
          })
          const txt = await r.text()
          let j: any = null
          try { j = JSON.parse(txt) } catch { log(`Non JSON ${api}: ${txt.slice(0,120)}`); continue }
          // zarz.moe kabhi kabhi {data:{url}} deta hai
          const audioUrl = j.url || j.data?.url || j.result?.url
          if (audioUrl) { log(`SUCCESS via ${api}`); return { url: audioUrl, title: j.filename || j.title || vid } }
          log(`No url from ${api}: ${txt.slice(0,200)}`)
        } catch(e:any){ log(`Fail ${api}: ${e.message}`) }
      }
    }
    // 2. Agar cobalt fail to invidious fallback
    for (const proxy of PROXIES) {
      for (const inv of INVIDIOUS) {
        try {
          const apiUrl = `${inv}/api/v1/videos/${vid}`
          const proxied = proxy + encodeURIComponent(apiUrl)
          log(`Trying INV ${inv}`)
          const r = await fetch(proxied, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) })
          const j = await r.json().catch(()=>null)
          const audios = (j?.adaptiveFormats || []).filter((f:any)=>f.type?.startsWith('audio/')).sort((a:any,b:any)=>b.bitrate-a.bitrate)
          if (audios[0]?.url) return { url: audios[0].url, title: j.title || vid }
        } catch {}
      }
    }
    throw new Error('no audio url')
  }

  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')

  if (path.includes('/api/ping')) return res.status(200).json({ ping: 'ok', cobalt: "https://api.zarz.moe/v1/dl/cobalt", worker: WORKER })

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
      const fd = new FormData(); fd.append('chat_id', CHAT); fd.append('audio', new Blob([buf], { type: 'audio/mpeg' }), `${id}.mp3`); fd.append('title', title)
      const tr = await tg('sendAudio', fd)
      if (!tr.ok) return res.status(500).json({ error: 'tg upload fail', raw: tr, logs })
      const file_id2 = tr.result.audio?.file_id
      db.push({ id, file_id: file_id2, title, hits: 1 })
      const newId = await saveDb(db)
      return res.status(200).json({ status: 'fresh', telegram_file_id: file_id2, newDbFileId: newId, title, logs })
    } catch(e:any){ log(`FINAL FAIL: ${e.message}`); return res.status(500).json({ error: `Extract fail: ${e.message}`, logs }) }
  }
  return res.status(200).json({ ok: true })
}