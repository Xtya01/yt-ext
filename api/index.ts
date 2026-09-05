export const config = { maxDuration: 30 }

export default async function handler(req: any, res: any) {
  const logs: string[] = []
  const log = (m: string) => { logs.push(m); console.log(m) }
  const url = new URL(req.url, `https://${req.headers.host}`)
  const id = url.searchParams.get('id')?.trim()
  const BOT = process.env.BOT_TOKEN || ''
  const CHAT = process.env.CHANNEL_ID || ''
  let DB_FILE_ID = process.env.DB_FILE_ID || ''

  const tg = async (m: string, b?: any) => {
    const u = `https://api.telegram.org/bot${BOT}/${m}`
    if (b instanceof FormData) return await fetch(u, { method: 'POST', body: b }).then(r => r.json())
    return await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json())
  }

  const getAudio = async (vid: string) => {
    try {
      log(`STEP 1: WATCH PAGE`)
      const html = await fetch(`https://www.youtube.com/watch?v=${vid}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36' }
      }).then(r=>r.text())
      const m = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/)
      if (m) {
        const j = JSON.parse(m[1])
        const fmts = [...(j.streamingData?.adaptiveFormats||[])]
        const aud = fmts.filter((f:any)=>f.mimeType?.includes('audio') && f.url).sort((a:any,b:any)=>(b.bitrate||0)-(a.bitrate||0))
        log(`WATCH audios with url: ${aud.length}`)
        if (aud[0]?.url) return { url: aud[0].url, title: j.videoDetails?.title }
      }
    } catch(e:any){ log(`watch err ${e.message}`) }

    log(`STEP 2: ANDROID`)
    const r = await fetch(`https://www.youtube.com/youtubei/v1/player?key=AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: { client: { clientName: "ANDROID", clientVersion: "20.09.36", gl: "US", hl: "en" } }, videoId: vid })
    }).then(r=>r.json())
    const fmts = r.streamingData?.adaptiveFormats||[]
    const aud = fmts.filter((f:any)=>f.mimeType?.includes('audio') && f.url).sort((a:any,b:any)=>(b.bitrate||0)-(a.bitrate||0))
    log(`ANDROID audios: ${aud.length} status:${r.playabilityStatus?.status}`)
    if (aud[0]?.url) return { url: aud[0].url, title: r.videoDetails?.title }
    return null
  }

  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')

  try {
    if (!id) return res.status(400).json({ error: 'id required' })

    const result = await getAudio(id)
    if (!result) throw new Error('no audio url found')
    log(`Got URL: ${result.url.slice(0,80)}...`)

    // DOWNLOAD ON VERCEL ITSELF
    log(`STEP 3: Downloading from googlevideo...`)
    const audioRes = await fetch(result.url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    log(`Googlevideo response: ${audioRes.status} ${audioRes.statusText} type:${audioRes.headers.get('content-type')} len:${audioRes.headers.get('content-length')}`)

    if (!audioRes.ok) {
      const txt = await audioRes.text().catch(()=> '')
      log(`Googlevideo body: ${txt.slice(0,500)}`)
      return res.status(200).json({ status: 'direct_no_dl', direct_url: result.url, logs, google_status: audioRes.status, google_body: txt.slice(0,500) })
    }

    const ab = await audioRes.arrayBuffer()
    log(`Downloaded ${ab.byteLength} bytes, uploading to TG...`)

    const fd = new FormData()
    fd.append('chat_id', CHAT)
    fd.append('audio', new Blob([ab], { type: 'audio/webm' }), `${id}.webm`)
    const tr = await tg('sendAudio', fd)
    log(`TG result ok:${tr.ok}`)

    if (!tr.ok) return res.status(200).json({ status: 'tg_fail', direct_url: result.url, tg_error: tr, logs })

    return res.status(200).json({ status: 'fresh', telegram_file_id: tr.result.audio.file_id, direct_url: result.url, logs })

  } catch(e:any){
    return res.status(500).json({ error: e.message, logs })
  }
}
