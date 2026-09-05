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

  const getAudioDirect = async (vid: string) => {
    const key = 'AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w'
    const clients = [
      { clientName: 'IOS', clientVersion: '20.10.38', deviceModel: 'iPhone16,2', osName: 'iOS', osVersion: '17.5.1.21F90', hl: 'en', gl: 'US' },
      { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, hl: 'en', gl: 'US' },
      { clientName: 'ANDROID_MUSIC', clientVersion: '6.42.52', androidSdkVersion: 30, hl: 'en', gl: 'US' }
    ]
    // 1. Official YouTube player
    for (const client of clients) {
      try {
        const r = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context: { client }, videoId: vid }),
          signal: AbortSignal.timeout(6000)
        })
        const j: any = await r.json()
        let fmts = j.streamingData?.adaptiveFormats || []
        fmts = fmts.map((f: any) => {
          if (f.signatureCipher) {
            try { const p = new URLSearchParams(f.signatureCipher); if (p.get('url')) f.url = p.get('url') } catch {}
          }
          return f
        })
        const audio = fmts.filter((f: any) => f.mimeType?.includes('audio/')).sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0]
        if (audio?.url) return { url: audio.url, title: j.videoDetails?.title || vid }
      } catch {}
    }
    // 2. Invidious fallback
    for (const base of ['https://yewtu.be', 'https://inv.tux.pizza', 'https://inv.nadeko.net']) {
      try {
        const r = await fetch(`${base}/api/v1/videos/${vid}`, { signal: AbortSignal.timeout(5000) })
        const j: any = await r.json()
        const audio = (j.adaptiveFormats || []).filter((f: any) => f.type?.startsWith('audio/')).sort((a: any, b: any) => b.bitrate - a.bitrate)[0]
        if (audio?.url) return { url: audio.url, title: j.title || vid }
      } catch {}
    }
    // 3. Piped fallback
    for (const base of ['https://pipedapi.syncpundit.io', 'https://api.piped.private.coffee', 'https://pipedapi.kavin.rocks']) {
      try {
        const r: any = await fetch(`${base}/streams/${vid}`, { signal: AbortSignal.timeout(5000) }).then(r => r.json())
        const audio = r.audioStreams?.find((s: any) => s.mimeType?.includes('mp4a')) || r.audioStreams?.[0]
        if (audio?.url) return { url: audio.url, title: r.title || vid }
      } catch {}
    }
    throw new Error('no audio url')
  }

  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')

  if (path.includes('/api/ping') || path === '/api' || path === '/api/index.ts') {
    return res.status(200).json({ ping: 'ok' })
  }

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

  if (path.includes('/api/stats')) {
    const db = await getDb()
    return res.status(200).json({ total: db.length, totalHits: db.reduce((a: any, b: any) => a + (b.hits || 0), 0) })
  }

  if (path.includes('/api/file')) {
    const fid = url.searchParams.get('file_id')
    const f = await fetch(`https://api.telegram.org/bot${BOT}/getFile?file_id=${fid}`).then(r => r.json())
    if (!f.ok) return res.status(404).json({ error: 'not found' })
    return res.redirect(`https://api.telegram.org/file/bot${BOT}/${f.result.file_path}`)
  }

  if (path.includes('/api/extract')) {
    if (!id) return res.status(400).json({ error: 'id required' })
    let db = await getDb()
    const found = db.find(x => x.id === id)
    if (found) {
      found.hits = (found.hits || 0) + 1
      await saveDb(db)
      return res.status(200).json({ status: 'cache', telegram_file_id: found.file_id, title: found.title })
    }
    try {
      const { url: aUrl, title } = await getAudioDirect(id)
      const buf = await fetch(aUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) }).then(r => r.arrayBuffer())
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
    } catch (e: any) {
      return res.status(500).json({ error: 'Extract fail: ' + e.message })
    }
  }

  return res.status(200).json({ ok: true, path })
}