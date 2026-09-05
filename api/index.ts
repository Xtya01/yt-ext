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

  const getAudioFromWatchPage = async (vid: string) => {
    try {
      log(`Trying WATCH PAGE scrape -> ${vid} cookie:${YT_COOKIE?'yes':'no'}`)
      const headers: any = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      }
      if (YT_COOKIE) headers['Cookie'] = YT_COOKIE

      const html = await fetch(`https://www.youtube.com/watch?v=${vid}&bpctr=9999999999&has_verified=1`, { headers, signal: AbortSignal.timeout(10000) }).then(r=>r.text())
      log(`HTML length: ${html.length}`)

      // Method 1: ytInitialPlayerResponse
      let match = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/)
      if (!match) match = html.match(/var ytInitialPlayerResponse = ({.+?});/)
      if (match) {
        const j = JSON.parse(match[1])
        log(`Found ytInitialPlayerResponse status:${j.playabilityStatus?.status}`)
        const formats = [...(j.streamingData?.adaptiveFormats||[]),...(j.streamingData?.formats||[])]
        const audios = formats.filter((f:any)=>f.mimeType?.includes('audio')).sort((a:any,b:any)=>(b.bitrate||0)-(a.bitrate||0))
        log(`WatchPage audios: ${audios.length}`)
        if (audios[0]?.url) return { url: audios[0].url, title: j.videoDetails?.title || vid }
      }

      // Method 2: ytInitialData se bhi try
      log(`No playerResponse, trying to find streamingData in html`)
      const streamMatch = html.match(/"adaptiveFormats":(\[.+?\])/)
      if (streamMatch) {
        const fmts = JSON.parse(streamMatch[1])
        const audios = fmts.filter((f:any)=>f.mimeType?.includes('audio')).sort((a:any,b:any)=>(b.bitrate||0)-(a.bitrate||0))
        if (audios[0]?.url) { log(`Found via adaptiveFormats regex`); return { url: audios[0].url, title: vid } }
      }

    } catch(e:any){ log(`WatchPage fail: ${e.message}`) }
    return null
  }

  const getAudioViaYoutubeI = async (vid: string) => {
    const key = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39"
    const clients = [
      { clientName: "ANDROID_MUSIC", clientVersion: "6.34.51", androidSdkVersion: 30 },
      { clientName: "ANDROID", clientVersion: "20.09.36", androidSdkVersion: 30 },
    ]
    const baseHeaders: any = { 'Content-Type': 'application/json', 'User-Agent': 'com.google.android.apps.youtube.music/6.34.51 (Linux; U; Android 13)' }
    if (YT_COOKIE) baseHeaders['Cookie'] = YT_COOKIE

    for (const c of clients) {
      try {
        log(`Trying YouTubei ${c.clientName}`)
        const r = await fetch(`https://www.youtube.com/youtubei/v1/player?key=${key}`, {
          method: 'POST',
          headers: baseHeaders,
          body: JSON.stringify({ context: { client: {...c, gl: "US", hl: "en" } }, videoId: vid }),
          signal: AbortSignal.timeout(7000)
        })
        const j: any = await r.json()
        log(`YouTubei ${c.clientName} status:${j.playabilityStatus?.status}`)
        const formats = [...(j.streamingData?.adaptiveFormats||[])]
        const audios = formats.filter((f:any)=>f.mimeType?.includes('audio')).sort((a:any,b:any)=>(b.bitrate||0)-(a.bitrate||0))
        if (audios[0]?.url) return { url: audios[0].url, title: j.videoDetails?.title || vid }
      } catch(e:any){ log(`YouTubei ${c.clientName} fail: ${e.message}`) }
    }
    return null
  }

  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')

  try {
    if (path.includes('/api/ping')) return res.status(200).json({ ping: 'ok', cookie: YT_COOKIE?'set':'missing', method: 'watchpage+android_music' })

    if (path.includes('/api/extract')) {
      if (!id) return res.status(400).json({ error: 'id required', logs })
      let db = await getDb()
      const found = db.find(x=>x.id===id)
      if (found) return res.status(200).json({ status: 'cache', telegram_file_id: found.file_id, logs })

      // 1. Watch page pehle (bina cookie bhi chal sakta hai)
      let result = await getAudioFromWatchPage(id)
      // 2. YouTubei
      if (!result) result = await getAudioViaYoutubeI(id)

      if (!result) throw new Error('no audio url from both methods')

      log(`Got audio: ${result.url.slice(0,100)}`)
      if (!BOT ||!CHAT) return res.status(200).json({ status: 'direct', direct_url: result.url, title: result.title, logs })

      const buf = await fetch(result.url, { signal: AbortSignal.timeout(20000) }).then(r=>r.arrayBuffer()).catch(()=>null)
      if (!buf) return res.status(200).json({ status: 'direct_no_dl', direct_url: result.url, logs })

      const fd = new FormData(); fd.append('chat_id', CHAT); fd.append('audio', new Blob([buf], { type: 'audio/mpeg' }), `${id}.mp3`)
      const tr = await tg('sendAudio', fd)
      if (!tr.ok) return res.status(200).json({ status: 'direct_tg_fail', direct_url: result.url, tg_error: tr, logs })

      const file_id2 = tr.result.audio?.file_id
      db.push({ id, file_id: file_id2, title: result.title, hits: 1 })
      await saveDb(db)
      return res.status(200).json({ status: 'fresh', telegram_file_id: file_id2, title: result.title, logs })
    }
    return res.status(200).json({ ok: true })
  } catch(e:any){
    return res.status(500).json({ error: e.message, logs })
  }
}
