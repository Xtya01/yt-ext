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
      if (r.ok) {
        DB_FILE_ID = r.result.document.file_id
        await tg('pinChatMessage', { chat_id: CHAT, message_id: r.result.message_id, disable_notification: true }).catch(()=>{})
      }
      return DB_FILE_ID
    } catch { return null }
  }

  const getAudioDirect = async (vid: string) => {
    const ytUrl = `https://www.youtube.com/watch?v=${vid}`

    // 1) Try via AllOrigins proxy -> Piped (bypass Cloudflare)
    for (const base of ['https://pipedapi.kavin.rocks', 'https://api.piped.private.coffee', 'https://pipedapi.syncpundit.io']) {
      try {
        const target = `${base}/streams/${vid}`
        const proxy = `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`
        log(`Trying AllOrigins Piped: ${base}`)
        const r = await fetch(proxy, { signal: AbortSignal.timeout(8000) })
        const txt = await r.text()
        if (txt.trim().startsWith('<!DOCTYPE') || txt.trim().startsWith('<html')) {
          log(`${base} via proxy returned HTML`)
          continue
        }
        const j = JSON.parse(txt)
        const a = j.audioStreams?.[0]
        if (a?.url) { log(`Success Piped ${base}`); return { url: a.url, title: j.title || vid } }
        log(`${base} no audioStreams`)
      } catch(e:any){ log(`Piped ${base} err: ${e.message}`) }
    }

    // 2) Try Cobalt direct
    for (const api of ['https://api.cobalt.tools/api/json','https://co.wuk.sh/api/json']) {
      try {
        log(`Trying Cobalt ${api}`)
        const r = await fetch(api, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
          body: JSON.stringify({ url: ytUrl, vCodec: 'h264', vQuality: '720', aFormat: 'mp3', isAudioOnly: true }),
          signal: AbortSignal.timeout(8000)
        })
        const txt = await r.text()
        if (txt.trim().startsWith('<')) { log(`Cobalt ${api} HTML`); continue }
        const j = JSON.parse(txt)
        if (j.url) { log(`Success Cobalt ${api}`); return { url: j.url, title: vid } }
        log(`Cobalt ${api} no url: ${txt.slice(0,200)}`)
      } catch(e:any){ log(`Cobalt err ${e.message}`) }
    }

    // 3) Try yt1s
    try {
      log('Trying yt1s')
      const s1 = await fetch('https://yt1s.com/api/ajaxSearch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0', 'Origin': 'https://yt1s.com' },
        body: `q=${encodeURIComponent(ytUrl)}&vt=mp3`,
        signal: AbortSignal.timeout(8000)
      })
      const t1 = await s1.text()
      if (t1.trim().startsWith('<')) { log('yt1s search HTML'); throw new Error('yt1s html') }
      const j1 = JSON.parse(t1)
      const k = j1.links?.mp3? Object.values(j1.links.mp3)[0] as any : null
      if (!k?.k) throw new Error('yt1s no k')
      const s2 = await fetch('https://yt1s.com/api/ajaxConvert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
        body: `vid=${j1.vid}&k=${k.k}`,
        signal: AbortSignal.timeout(8000)
      })
      const j2 = JSON.parse(await s2.text())
      if (j2.dlink) { log('Success yt1s'); return { url: j2.dlink, title: j1.title } }
      log('yt1s no dlink')
    } catch(e:any){ log(`yt1s err ${e.message}`) }

    throw new Error('no audio url')
  }

  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')

  if (path.includes('/api/ping')) return res.status(200).json({ ping: 'ok' })

  if (path.includes('/api/search')) {
    if (!q) return res.status(200).json([])
    try {
      const html = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIQAQ%253D%253D`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(4000) }).then(r=>r.text())
      const ids = [...html.matchAll(/"videoId":"([A-Za-z0-9_-]{11})"/g)].map(m=>m[1])
      const titles = [...html.matchAll(/"title":\{"runs":\[\{"text":"([^"]{3,120})"/g)].map(m=>m[1])
      const uniq = [...new Set(ids)].slice(0,10)
      return res.status(200).json(uniq.map((id,i)=>({ id, title: titles[i]||id, thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, uploader: '' })))
    } catch { return res.status(200).json([]) }
  }

  if (path.includes('/api/extract')) {
    if (!id) return res.status(400).json({ error: 'id required', logs })
    let db = await getDb()
    const found = db.find(x=>x.id===id)
    if (found) {
      found.hits=(found.hits||0)+1; await saveDb(db)
      return res.status(200).json({ status: 'cache', telegram_file_id: found.file_id, title: found.title, logs })
    }
    try {
      const { url: aUrl, title } = await getAudioDirect(id)
      log(`Downloading audio: ${aUrl.slice(0,80)}...`)
      const buf = await fetch(aUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) }).then(r=>r.arrayBuffer())
      log(`Audio size: ${buf.byteLength}`)
      const fd = new FormData()
      fd.append('chat_id', CHAT)
      fd.append('audio', new Blob([buf], { type: 'audio/mp4' }), `${id}.m4a`)
      fd.append('title', title)
      const tr = await tg('sendAudio', fd)
      if (!tr.ok) return res.status(500).json({ error: 'tg upload fail', raw: tr, logs })
      const file_id2 = tr.result.audio?.file_id
      db.push({ id, file_id: file_id2, title, hits: 1 })
      const newId = await saveDb(db)
      return res.status(200).json({ status: 'fresh', telegram_file_id: file_id2, newDbFileId: newId, title, logs })
    } catch(e:any){
      log(`FINAL FAIL: ${e.message}`)
      return res.status(500).json({ error: `Extract fail: ${e.message}`, logs })
    }
  }

  return res.status(200).json({ ok: true })
}