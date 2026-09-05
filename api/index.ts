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
      if (r.ok) { DB_FILE_ID = r.result.document.file_id }
      return DB_FILE_ID
    } catch { return null }
  }

  const getAudioDirect = async (vid: string) => {
    const ytUrl = `https://www.youtube.com/watch?v=${vid}`
    const payload = { url: ytUrl, downloadMode: 'audio', audioFormat: 'mp3', filenameStyle: 'basic' }
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' }

    // Sirf 2 try - fast
    const tries = [
      { url: "https://api.zarz.moe/v1/dl/cobalt", via: "direct" },
      { url: WORKER + encodeURIComponent("https://api.zarz.moe/v1/dl/cobalt"), via: "worker" }
    ]
    for (const t of tries) {
      try {
        log(`Trying ${t.via} -> ${t.url.slice(0,40)}`)
        const r = await fetch(t.url, { method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) })
        const txt = await r.text()
        log(`Response ${t.via}: ${txt.slice(0,200)}`)
        let j: any = null
        try { j = JSON.parse(txt) } catch { continue }
        const audioUrl = j.url || j.data?.url || j.result?.url
        if (audioUrl) return { url: audioUrl, title: j.filename || vid }
      } catch(e:any){ log(`${t.via} fail: ${e.message}`) }
    }
    throw new Error('no audio url')
  }

  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')

  try {
    if (path.includes('/api/ping')) return res.status(200).json({ ping: 'ok', time: Date.now() })

    if (path.includes('/api/search')) {
      if (!q) return res.status(200).json([])
      const html = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%253D%253D`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) }).then(r=>r.text()).catch(()=> '')
      const ids = [...html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)].map(m=>m[1])
      return res.status(200).json([...new Set(ids)].slice(0,8).map(vid=>({ id: vid, title: vid, thumbnail: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` })))
    }

    if (path.includes('/api/extract')) {
      if (!id) return res.status(400).json({ error: 'id required', logs })
      let db = await getDb()
      const found = db.find(x=>x.id===id)
      if (found) return res.status(200).json({ status: 'cache', telegram_file_id: found.file_id, logs })

      const { url: aUrl, title } = await getAudioDirect(id)
      log(`Got audio url: ${aUrl.slice(0,80)}`)

      // Agar BOT nahi hai to direct url hi de de taaki pata chale kaam kar raha hai
      if (!BOT || !CHAT) return res.status(200).json({ status: 'direct', direct_url: aUrl, title, logs })

      const buf = await fetch(aUrl, { signal: AbortSignal.timeout(15000) }).then(r=>r.arrayBuffer()).catch(()=>null)
      if (!buf) return res.status(200).json({ status: 'direct_no_dl', direct_url: aUrl, logs })

      const fd = new FormData(); fd.append('chat_id', CHAT); fd.append('audio', new Blob([buf], { type: 'audio/mpeg' }), `${id}.mp3`)
      const tr = await tg('sendAudio', fd)
      if (!tr.ok) return res.status(200).json({ status: 'direct_tg_fail', direct_url: aUrl, tg_error: tr, logs })

      const file_id2 = tr.result.audio?.file_id
      db.push({ id, file_id: file_id2, title, hits: 1 })
      await saveDb(db)
      return res.status(200).json({ status: 'fresh', telegram_file_id: file_id2, title, logs })
    }

    return res.status(200).json({ ok: true })
  } catch(e:any){
    return res.status(500).json({ error: e.message, logs })
  }
}