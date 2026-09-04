export default async function handler(req: any, res: any) {
  const url = new URL(req.url, `https://${req.headers.host}`)
  const path = url.pathname
  const q = url.searchParams.get('q')?.trim()
  const id = url.searchParams.get('id')?.trim()
  const file_id = url.searchParams.get('file_id')?.trim()

  const BOT = process.env.BOT_TOKEN || ''
  const CHAT = process.env.CHANNEL_ID || ''
  let DB_FILE_ID = process.env.DB_FILE_ID || ''

  const tg = async (m: string, b?: any) => {
    const u = `https://api.telegram.org/bot${BOT}/${m}`
    if (b instanceof FormData) return await fetch(u, { method: 'POST', body: b }).then(r => r.json())
    return await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json())
  }

  const getDb = async (): Promise<any[]> => {
    try {
      if (!BOT ||!CHAT) return []
      if (!DB_FILE_ID) {
        const ch = await fetch(`https://api.telegram.org/bot${BOT}/getChat?chat_id=${CHAT}`).then(r=>r.json()).catch(()=>null)
        if (ch?.result?.pinned_message?.document?.file_name === 'database.json') DB_FILE_ID = ch.result.pinned_message.document.file_id
        else return []
      }
      const f = await fetch(`https://api.telegram.org/bot${BOT}/getFile?file_id=${DB_FILE_ID}`).then(r=>r.json())
      if (!f.ok) return []
      return await fetch(`https://api.telegram.org/file/bot${BOT}/${f.result.file_path}`).then(r=>r.json()).catch(()=>[])
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

  // /api/ping
  if (path.includes('/api/ping') || path === '/api') {
    return res.status(200).json({ ping: "ok", time: Date.now(), url: path })
  }

  // /api/search?q=kalyani
  if (path.includes('/api/search')) {
    if (!q) return res.status(200).json([])
    try {
      const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%253D%253D`
      const htmlRes = await fetch(ytUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0' },
        signal: AbortSignal.timeout(4000)
      })
      const html = await htmlRes.text()
      const ids = [...html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)].map(m => m[1])
      const titles = [...html.matchAll(/"title":\{"runs":\[\{"text":"([^"]{3,120})"/g)].map(m => m[1])
      const uniq = [...new Set(ids)].slice(0, 10)
      const out = uniq.map((id, i) => ({
        id,
        title: titles[i] || id,
        thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        uploader: ''
      }))
      return res.status(200).json(out)
    } catch (e) {
      return res.status(200).json([])
    }
  }

  // /api/stats
  if (path.includes('/api/stats')) {
    const db = await getDb()
    return res.status(200).json({ total: db.length, totalHits: db.reduce((a, b) => a + (b.hits || 0), 0), blobUsedKB: Math.round(JSON.stringify(db).length / 1024) })
  }

  // /api/extract?id=VIDEO_ID
  if (path.includes('/api/extract')) {
    if (!id) return res.status(400).json({ error: 'id required' })
    let db = await getDb()
    const found = db.find(x => x.id === id)
    if (found) { found.hits = (found.hits || 0) + 1; await saveDb(db); return res.status(200).json({ status: 'cache', telegram_file_id: found.file_id, title: found.title }) }
    try {
      const r = await fetch(`https://pipedapi.syncpundit.io/streams/${id}`, { signal: AbortSignal.timeout(8000) }).then(r => r.json())
      const audio = r.audioStreams?.find((s: any) => s.mimeType?.includes('mp4a')) || r.audioStreams?.[0]
      if (!audio?.url) return res.status(500).json({ error: 'Extract fail' })
      const buf = await fetch(audio.url).then(r => r.arrayBuffer())
      const fd = new FormData()
      fd.append('chat_id', CHAT)
      fd.append('audio', new Blob([buf], { type: 'audio/mp4' }), `${id}.m4a`)
      fd.append('title', r.title || id)
      const tr = await tg('sendAudio', fd)
      if (!tr.ok) return res.status(500).json({ error: 'tg upload fail' })
      const file_id2 = tr.result.audio?.file_id
      db.push({ id, file_id: file_id2, title: r.title || id, hits: 1 })
      const newId = await saveDb(db)
      return res.status(200).json({ status: 'fresh', telegram_file_id: file_id2, newDbFileId: newId, title: r.title || id })
    } catch (e: any) { return res.status(500).json({ error: e.message }) }
  }

  return res.status(200).json({ ok: true, path })
}