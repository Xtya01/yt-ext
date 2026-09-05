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

    // 1) loader.to / convert2mp3s - sabse stable
    try {
      log('Trying loader.to')
      const r = await fetch(`https://convert2mp3s.com/api/single/mp3?url=${encodeURIComponent(ytUrl)}`, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) })
      const html = await r.text()
      const m = html.match(/href="([^"]+\.mp3[^"]*)"/) || html.match(/"url":"([^"]+\.mp3[^"]*)"/)
      if (m) { log('loader.to success'); return { url: m[1].replace(/\\/g,''), title: vid } }
    } catch(e:any){ log(`loader.to fail ${e.message}`) }

    // 2) 10downloader.com
    try {
      log('Trying 10downloader.com')
      const r = await fetch(`https://10downloader.com/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
        body: `url=${encodeURIComponent(ytUrl)}`,
        signal: AbortSignal.timeout(8000)
      })
      const html = await r.text()
      const m = html.match(/href="([^"]*\.mp3[^"]*)"/i) || html.match(/downloadUrl":"([^"]+)"/)
      if (m) { log('10downloader success'); return { url: m[1], title: vid } }
    } catch(e:any){ log(`10downloader fail ${e.message}`) }

    // 3) y2mate.is / yt1s.com
    try {
      log('Trying y2mate.is')
      const r = await fetch(`https://www.y2mate.is/api/ajaxSearch/index`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' },
        body: `q=${encodeURIComponent(ytUrl)}&vt=home`,
        signal: AbortSignal.timeout(8000)
      })
      const j = await r.json()
      if (j.vid) {
        const r2 = await fetch(`https://www.y2mate.is/api/mConvert`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `vid=${j.vid}&k=mp3`,
          signal: AbortSignal.timeout(8000)
        })
        const j2 = await r2.json()
        if (j2.dlink) { log('y2mate success'); return { url: j2.dlink, title: j.title || vid } }
      }
    } catch(e:any){ log(`y2mate fail ${e.message}`) }

    // 4) savefrom.net
    try {
      log('Trying savefrom.net')
      const r = await fetch(`https://worker.sf-tools.com/savefrom.php?url=${encodeURIComponent(ytUrl)}`, { signal: AbortSignal.timeout(8000) })
      const j = await r.json()
      if (j.url?.[0]?.url) { log('savefrom success'); return { url: j.url[0].url, title: vid } }
    } catch(e:any){ log(`savefrom fail ${e.message}`) }

    throw new Error('no audio url - all 5 YouTube sites failed')
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
      log(`Downloading ${aUrl.slice(0,60)}`)
      const buf = await fetch(aUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(20000) }).then(r=>r.arrayBuffer())
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