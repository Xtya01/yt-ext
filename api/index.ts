export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  const id = new URL(req.url, `https://${req.headers.host}`).searchParams.get('id')?.trim()
  if (!id) return res.status(400).json({ error: 'id required' })

  const getUrl = (f:any) => f.url || (f.signatureCipher ? new URLSearchParams(f.signatureCipher).get('url') : null)

  try {
    // 1. PIPED - Vercel pe sabse fast, no timeout
    for (const inst of ['https://pipedapi.kavin.rocks','https://pipedapi.adminforge.de']) {
      try {
        const j = await fetch(`${inst}/streams/${id}`, { signal: AbortSignal.timeout(8000) }).then(r=>r.json())
        const best = j.audioStreams?.sort((a:any,b:any)=>b.bitrate-a.bitrate)[0]
        if (best?.url) return res.json({ status:'ok', id, title: j.title, direct_url: best.url, duration: j.duration, source:'piped' })
      } catch {}
    }

    // 2. COBALT
    try {
      const r = await fetch('https://api.cobalt.tools/api/json', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ url:`https://www.youtube.com/watch?v=${id}`, isAudioOnly:true, aFormat:'mp3' }),
        signal: AbortSignal.timeout(8000)
      }).then(r=>r.json())
      if (r.url) return res.json({ status:'ok', id, title: r.filename, direct_url: r.url, source:'cobalt' })
    } catch {}

    return res.status(500).json({ error: 'all extractors failed - Piped & Cobalt both down', id })
  } catch(e:any){
    return res.status(500).json({ error: e.message, id })
  }
}
