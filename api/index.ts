export default async function handler(req: any, res: any) {
  const url = new URL(req.url, `https://${req.headers.host}`)
  const path = url.pathname
  const q = url.searchParams.get('q')?.trim()
  const id = url.searchParams.get('id')?.trim()
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
      if (!DB_FILE_ID ||!BOT ||!CHAT) return []
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
        await tg('pinChatMessage', { chat_id: CHAT, message_id: r.result.message_id, disable_notification: true }).catch(() => {})
      }
      return DB_FILE_ID
    } catch { return null }
  }

  // Direct YouTube Innertube audio - no Piped
  const getAudioDirect = async (vid: string) => {
    const key = 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w'
    const apiUrl = `https://www.youtube.com/youtubei/v1/player?key=${key}`
    const body = { context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, hl: 'en', gl: 'US' } }, videoId: vid }
    const r = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(6000) })
    const j: any = await r.json()
    const fmts = j.streamingData?.adaptiveFormats || []
    const audio = fmts.filter((f: any) => f.mimeType?.includes('audio/')).sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0]
    if (!audio?.url) throw new Error('no audio url')
    return { url: audio.url, title: j.videoDetails?.title || vid }
  }

  res.setHeader('Content-Type', 'application/json')

  if (path.includes('/api/ping') || path === '/api') return res.status(200).json({ ping: 'ok' })

  if (path.includes('/api/search')) {
    if (!q) return res.status(200).json([])
    try {
      const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%253D%253D`
      const htmlRes = await fetch(ytUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) })
      const html = await htmlRes.text()
      const ids = [...html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)].map(m => m[1])
      const titles = [...html.matchAll(/"title":\{"runs":\[\{"text":"([^"]{3,120})"/g)].map(m => m[1])
      const uniq = [...new Set(ids)].slice(0, 10)
      const out = uniq.map((id, i) => ({ id, title: titles[i] || id, thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, uploader: '' }))
      return res.status(200).json(out)
    } catch { return res.status(200).json([]) }
  }

  if (path.includes('/api/extract')) {
    if (!id) return res.status(400).json({ error: 'id required' })
    let db = await getDb()
    const found = db.find(x => x.id === id)
    if (found) { found.hits = (found.hits || 0) + 1; await saveDb(db); return res.status(200).json({ status: 'cache', telegram_file_id: found.file_id, title: found.title }) }
    try {
      const { url: aUrl, title } = await getAudioDirect(id)
      const buf = await fetch(aUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) }).then(r => r.arrayBuffer())
      const fd = new FormData()
      fd.append('chat_id', CHAT)
      fd.append('audio', new Blob([buf], { type: 'audio/mp4' }), `${id}.m4a`)
      fd.append('title', title)
      const tr = await tg('sendAudio', fd)
      if (!tr.ok) return res.status(500).json({ error: 'tg upload fail', raw: tr })
      const file_id2 = tr.result.audio?.file_id
      db.push({ id, file_id: file_id2, title, hits: 1 })
      const newId = await saveDb(db)
      return res.status(200).json({ status: 'fresh', telegram_file_id: file_id2, newDbFileId: newId, title })
    } catch (e: any) { return res.status(500).json({ error: 'Extract fail: ' + e.message }) }
  }

  if (path.includes('/api/stats')) {
    const db = await getDb()
    return res.status(200).json({ total: db.length, totalHits: db.reduce((a, b) => a + (b.hits || 0), 0) })
  }

  return res.status(200).json({ ok: true })
}