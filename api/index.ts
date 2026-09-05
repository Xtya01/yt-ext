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
      if (r.ok) DB_FILE_ID = r.result.document.file_id
      return DB_FILE_ID
    } catch { return null }
  }

  const getAudioDirect = async (vid: string) => {
    const invs = ["https://inv.tux.pizza", "https://yewtu.be", "https://invidious.snopyta.org"]
    for (const inv of invs) {
      try {
        log(`Trying INV DIRECT -> ${inv}/api/v1/videos/${vid}`)
        const r = await fetch(`${inv}/api/v1/videos/${vid}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) })
        const j: any = await r.json()
        log(`INV response: ${j.title?.slice(0,50)} formats:${j.adaptiveFormats?.length}`)
        const audios = (j.adaptiveFormats || []).filter((f:any)=>f.type?.startsWith('audio/')).sort((a:any,b:any)=>b.bitrate-a.bitrate)
        if (audios[0]?.url) { log(`SUCCESS via ${inv}`); return { url: audios[0].url, title: j.title || vid } }
        log(`No audio in ${inv}`)
      } catch(e:any){ log(`INV fail ${inv}: ${e.message}`) }
    }
    throw new Error('no audio url from invidious')
  }

  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')

  try {
    if (path.includes('/api/ping')) return res.status(200).json({ ping: 'ok', method: 'invidious-direct' })

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
      log(`Got audio: ${aUrl.slice(0,80)}`)

      if (!BOT ||!CHAT) return res.status(200).json({ status: 'direct', direct_url: aUrl, title, logs })

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