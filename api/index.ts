export default async function handler(req: any, res: any) {
  const url = new URL(req.url, `https://${req.headers.host}`)
  const id = url.searchParams.get('id')?.trim()

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Content-Type', 'application/json')

  if (!id) return res.status(400).json({ error: 'id required' })

  try {
    // WATCH PAGE - fastest
    const html = await fetch(`https://www.youtube.com/watch?v=${id}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 Chrome/122.0.0.0' }
    }).then(r=>r.text())

    const m = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/)
    if (m) {
      const j = JSON.parse(m[1])
      const fmts = [...(j.streamingData?.adaptiveFormats||[])]
      // itag 140 (m4a) lo - sabse fast, throttling kam
      let aud = fmts.filter((f:any)=>f.itag==140 && f.url)[0]
      if (!aud) aud = fmts.filter((f:any)=>f.mimeType?.includes('audio') && f.url).sort((a:any,b:any)=> (b.bitrate||0)-(a.bitrate||0))[0]
      if (aud?.url) {
        return res.status(200).json({
          status: 'ok',
          id,
          title: j.videoDetails?.title,
          direct_url: aud.url,
          duration: j.videoDetails?.lengthSeconds
        })
      }
    }

    // FALLBACK ANDROID
    const r = await fetch(`https://www.youtube.com/youtubei/v1/player?key=AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: { client: { clientName: "ANDROID", clientVersion: "20.09.36", gl: "US" } }, videoId: id })
    }).then(r=>r.json())

    const aud = (r.streamingData?.adaptiveFormats||[]).filter((f:any)=>f.mimeType?.includes('audio') && f.url).sort((a:any,b:any)=> (b.bitrate||0)-(a.bitrate||0))[0]
    if (aud?.url) return res.status(200).json({ status: 'ok', id, title: r.videoDetails?.title, direct_url: aud.url })

    return res.status(500).json({ error: 'no audio' })
  } catch(e:any){
    return res.status(500).json({ error: e.message })
  }
}
