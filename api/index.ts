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
      if (r.ok) {
        DB_FILE_ID = r.result.document.file_id
        await tg('pinChatMessage', { chat_id: CHAT, message_id: r.result.message_id, disable_notification: true }).catch(()=>{})
      }
      return DB_FILE_ID
    } catch { return null }
  }

  const getAudioDirect = async (vid: string) => {
    const ytUrl = `https://www.youtube.com/watch?v=${vid}`
    const bases = [
      "https://api.ayaka.one",
      "https://co.wuk.sh",
      "https://cobalt.canine.tools",
      "https://api.cobalt.squair.xyz",
      "https://api.cobalt.sqir.xyz"
    ]
    for (const base of bases) {
      for (const p of ["/api/json", ""]) {
        try {
          const fullApi = base + p
          const proxied = WORKER + encodeURIComponent(fullApi)
          log(`Trying via worker -> ${fullApi}`)
          const r = await fetch(proxied, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ url: ytUrl, downloadMode: 'audio', audioFormat: 'mp3', filenameStyle: 'basic' }),
            signal: AbortSignal.timeout(12000)
          })
          const text = await r.text()
          let j: any = null
          try { j = JSON.parse(text) } catch { log(`Non JSON from ${fullApi}: ${text.slice(0,150)}`); continue }
          if (j?.url) {
            log(`Success via ${fullApi}`)
            return { url: j.url, title: j.filename || vid }
          }
          log(`No url from ${fullApi}: ${text.slice(0,300)}`)
        } catch (e: any) {
          log(`${base}${p} fail: ${e.message}`)
        }
      }
    }
    throw new Error('no audio url - all via worker failed')
  }

  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')

  if (path.includes('/api/ping')) {
    return res.status(200).json({ ping: 'ok', worker: WORKER, ts: Date.now() })
  }

  if (path.includes('/api/search')) {
    if (!q) return res.status(200).json([])
    try {
      const html = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%253D%253D`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(5000)
      }).then(r => r.text())
      const ids = [...html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)].map(m => m[1])
      const titles = [...html.matchAll(/"title":\{"runs":\[\{"text":"([^"]{3,120})"/g)].map(m => m[1])
      const uniq = [...new Set(ids)].slice(0, 10)
      return res.status(200).json(uniq.map((vid, i) => ({ id: vid, title: titles[i] || vid, thumbnail: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`, uploader: '' })))
    } catch {
      return res.status(200).json([])
    }
  }

  if (path.includes('/api/extract')) {
    if (!id) return res.status(400).json({ error: 'id required', logs })
    let db = await getDb()
    const found = db.find(x => x.id === id)
    if (found) {
      found.hits = (found.hits || 0) + 1
      await saveDb(db)
      return res.status(200).json({ status: 'cache', telegram_file_id: found.file_id, title: found.title, logs })
    }
    try {
      const { url: aUrl, title } = await getAudioDirect(id)
      log(`Downloading audio: ${aUrl.slice(0, 80)}`)
      const buf = await fetch(aUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(25000) }).then(r => r.arrayBuffer())
      const fd = new FormData()
      fd.append('chat_id', CHAT)
      fd.append('audio', new Blob([buf], { type: 'audio/mpeg' }), `${id}.mp3`)
      fd.append('title', title)
      const tr = await tg('sendAudio', fd)
      if (!tr.ok) return res.status(500).json({ error: 'tg upload fail', raw: tr, logs })
      const file_id2 = tr.result.audio?.file_id
      db.push({ id, file_id: file_id2, title, hits: 1 })
      const newId = await saveDb(db)
      return res.status(200).json({ status: 'fresh', telegram_file_id: file_id2, newDbFileId: newId, title, logs })
    } catch (e: any) {
      log(`FINAL FAIL: ${e.message}`)
      return res.status(500).json({ error: `Extract fail: ${e.message}`, logs })
    }
  }

  return res.status(200).json({ ok: true })
}