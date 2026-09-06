export default async function handler(req: any, res: any) {
  const url = new URL(req.url, `https://${req.headers.host}`)
  const id = url.searchParams.get('id')?.trim()

  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Content-Type', 'application/json')

  if (!id) return res.status(400).json({ error: 'id required' })

  // Helper: signatureCipher se url nikalna
  const parseCipher = (f: any) => {
    if (f.url) return f.url
    if (f.signatureCipher) {
      const p = new URLSearchParams(f.signatureCipher)
      return p.get('url') || null
    }
    return null
  }

  try {
    // 1. PIPED - sabse reliable, deciphered + proxy url deta hai (IP-bound nahi)
    for (const inst of ['https://pipedapi.kavin.rocks','https://pipedapi.adminforge.de','https://api.piped.projectsegfau.lt']) {
      try {
        const j = await fetch(`${inst}/streams/${id}`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r=>r.json())
        const best = j.audioStreams?.sort((a:any,b:any)=> (b.bitrate||0)-(a.bitrate||0))[0]
        if (best?.url) {
          return res.status(200).json({ status: 'ok', id, title: j.title, direct_url: best.url, duration: j.duration, source: 'piped' })
        }
      } catch {}
    }

    // 2. COBALT - direct mp3 link, non IP-bound
    for (const api of ['https://api.cobalt.tools/api/json','https://co.wuk.sh/api/json']) {
      try {
        const r = await fetch(api, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${id}`, isAudioOnly: true, aFormat: 'mp3' })
        }).then(r=>r.json())
        if (r.url) return res.status(200).json({ status: 'ok', id, title: r.filename || id, direct_url: r.url, source: 'cobalt' })
      } catch {}
    }

    // 3. FALLBACK - Tera wala ANDROID + cipher handle
    const html = await fetch(`https://www.youtube.com/watch?v=${id}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 13) Chrome/122.0.0.0 Mobile' }
    }).then(r=>r.text())

    const m = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/)
    if (m) {
      const j = JSON.parse(m[1])
      const fmts = [...(j.streamingData?.adaptiveFormats||[])]
      let aud = fmts.filter((f:any)=>f.itag==140).map((f:any)=>({...f, _url: parseCipher(f) })).find((f:any)=>f._url)
      if (!aud) aud = fmts.filter((f:any)=>f.mimeType?.includes('audio')).map((f:any)=>({...f, _url: parseCipher(f) })).sort((a:any,b:any)=> (b.bitrate||0)-(a.bitrate||0)).find((f:any)=>f._url)
      if (aud?._url) {
        return res.status(200).json({ status: 'ok', id, title: j.videoDetails?.title, direct_url: aud._url, duration: j.videoDetails?.lengthSeconds, source: 'watch' })
      }
    }

    // 4. ANDROID youtubei
    const r = await fetch(`https://www.youtube.com/youtubei/v1/player?key=AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: { client: { clientName: "ANDROID", clientVersion: "20.09.36", androidSdkVersion: 33 } }, videoId: id })
    }).then(r=>r.json())

    const aud = (r.streamingData?.adaptiveFormats||[]).map((f:any)=>({...f, _url: parseCipher(f) })).filter((f:any)=>f.mimeType?.includes('audio') && f._url).sort((a:any,b:any)=> (b.bitrate||0)-(a.bitrate||0))[0]
    if (aud?._url) return res.status(200).json({ status: 'ok', id, title: r.videoDetails?.title, direct_url: aud._url, source: 'android' })

    return res.status(500).json({ error: 'no audio after all fallbacks', id })
  } catch(e:any){
    return res.status(500).json({ error: e.message, id })
  }
}
