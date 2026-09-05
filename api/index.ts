export default async function handler(req: any, res: any) {
  const logs: string[] = []
  const log = (m: string) => { logs.push(m); console.log(m) }
  const url = new URL(req.url, `https://${req.headers.host}`)
  const path = url.pathname
  const id = url.searchParams.get('id')?.trim()
  const BOT = process.env.BOT_TOKEN || ''
  const CHAT = process.env.CHANNEL_ID || ''
  let DB_FILE_ID = process.env.DB_FILE_ID || ''
  const YT_COOKIE = process.env.YT_COOKIE || ''

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

  const getAudio = async (vid: string) => {
    // WATCH PAGE
    try {
      log(`WATCH PAGE try`)
      const headers: any = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      }
      if (YT_COOKIE) headers['Cookie'] = YT_COOKIE
      const html = await fetch(`https://www.youtube.com/watch?v=${vid}`, { headers }).then(r=>r.text())
      const m = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/)
      if (m) {
        const j = JSON.parse(m[1])
        const fmts = [...(j.streamingData?.adaptiveFormats||[]),...(j.streamingData?.formats||[])]
        const aud = fmts.filter((f:any)=>f.mimeType?.includes('audio') && f.url).sort((a:any,b:any)=>(b.bitrate||0)-(a.bitrate||0))
        log(`WATCH PAGE audios url wale: ${aud.length}`)
        if (aud[0]?.url) return { url: aud[0].url, title: j.videoDetails?.title }
      }
    } catch(e:any){ log(`watch fail ${e.message}`) }

    // ANDROID
    try {
      log(`ANDROID try`)
      const r = await fetch(`https://www.youtube.com/youtubei/v1/player?key=AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'com.google.android.youtube/20.09.36 (Linux; U; Android 13)' },
        body: JSON.stringify({ context: { client: { clientName: "ANDROID", clientVersion: "20.09.36", androidSdkVersion: 30, gl: "US", hl: "en" } }, videoId: vid })
      }).then(r=>r.json())
      const fmts = r.streamingData?.adaptiveFormats||[]
      const aud = fmts.filter((f:any)=>f.mimeType?.includes('audio') && f.url).sort((a:any,b:any)=>(b.bitrate||0)-(a.bitrate||0))
      log(`ANDROID audios: ${aud.length} status:${r.playabilityStatus?.status}`)
      if (aud[0]?.url) return { url: aud[0].url, title: r.videoDetails?.title }
    } catch(e:any){ log(`android fail ${e.message}`) }
    return null
  }

  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')

  try {
    if (path.includes('/api/extract')) {
      if (!id) return res.status(400).json({ error: 'id required', logs })
      let db = await getDb()
      const found = db.find(x=>x.id===id)
      if (found) return res.status(200).json({ status: 'cache', telegram_file_id: found.file_id, logs })

      const result = await getAudio(id)
      if (!result) throw new Error('no audio found')
      log(`Got final audio url`)

      // VERCEL PE DIRECT DOWNLOAD - FIX
      try {
        log(`Downloading googlevideo...`)
        const audioRes = await fetch(result.url, {
          headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': '*/*' },
        })
        log(`Audio fetch status: ${audioRes.status} len:${audioRes.headers.get('content-length')}`)
        if (!audioRes.ok) throw new Error(`audio fetch ${audioRes.status}`)
        const ab = await audioRes.arrayBuffer()
        log(`Downloaded ${ab.byteLength} bytes`)

        const fd = new FormData()
        fd.append('chat_id', CHAT)
        fd.append('audio', new Blob([ab], { type: 'audio/webm' }), `${id}.webm`)
        fd.append('title', result.title || id)
        const tr = await tg('sendAudio', fd)
        log(`TG sendAudio ok:${tr.ok} err:${JSON.stringify(tr).slice(0,300)}`)
        if (!tr.ok) throw new Error(`tg fail ${JSON.stringify(tr)}`)

        const file_id2 = tr.result.audio?.file_id || tr.result.document?.file_id
        db.push({ id, file_id: file_id2, title: result.title, hits: 1 })
        await saveDb(db)
        return res.status(200).json({ status: 'fresh', telegram_file_id: file_id2, logs })
      } catch(dlErr:any) {
        log(`Download/upload failed: ${dlErr.message}`)
        // fallback - direct play ke liye de de
        return res.status(200).json({ status: 'direct_no_dl', direct_url: result.url, title: result.title, error: dlErr.message, logs })
      }
    }
    return res.status(200).json({ ok: true })
  } catch(e:any){
    return res.status(500).json({ error: e.message, logs })
  }
}
