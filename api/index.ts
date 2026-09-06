export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Content-Type', 'application/json')

  const fullUrl = `https://${req.headers.host}${req.url}`
  const url = new URL(fullUrl)
  const path = url.pathname

  // /api/stats & /api/ping
  if (path.includes('/stats') || path.includes('/ping')) {
    return res.json({ total: 0, totalHits: 0, blobUsedKB: 0, status: 'ok' })
  }

  // /api/search?q=milo na tum to
  if (path.includes('/search')) {
    const q = url.searchParams.get('q')?.trim()
    if (!q) return res.json([])
    try {
      // Piped search - 3 instance fallback
      const instances = [
        'https://pipedapi.kavin.rocks',
        'https://pipedapi.adminforge.de',
        'https://piped-api.lunar.icu'
      ]
      for (const inst of instances) {
        try {
          const r = await fetch(`${inst}/search?q=${encodeURIComponent(q)}&filter=music_songs`, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: AbortSignal.timeout(8000)
          })
          const j = await r.json()
          if (j.items?.length) {
            const items = j.items.slice(0,12).map((it:any)=>({
              videoId: it.url?.split('v=')[1] || it.url?.split('=').pop() || it.url?.split('/').pop(),
              title: it.title,
              author: it.uploaderName,
              thumb: it.thumbnail,
              duration: it.duration? `${Math.floor(it.duration/60)}:${String(it.duration%60).padStart(2,'0')}` : ''
            }))
            return res.json(items)
          }
        } catch {}
      }
      // Agar Piped down ho to empty array, 500 nahi
      return res.json([])
    } catch(e:any){
      return res.json([])
    }
  }

  // /api/extract?id=... ya /api?id=...
  const id = url.searchParams.get('id')?.trim()
  if (!id) return res.status(400).json({ error: 'id required' })

  try {
    for (const inst of ['https://pipedapi.kavin.rocks','https://pipedapi.adminforge.de']) {
      try {
        const j = await fetch(`${inst}/streams/${id}`, { signal: AbortSignal.timeout(8000) }).then(r=>r.json())
        const best = j.audioStreams?.sort((a:any,b:any)=> (b.bitrate||0)-(a.bitrate||0))[0]
        if (best?.url) return res.json({ status:'ok', id, title: j.title, direct_url: best.url, duration: j.duration, source:'piped' })
      } catch {}
    }
    const r = await fetch('https://api.cobalt.tools/api/json', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ url:`https://www.youtube.com/watch?v=${id}`, isAudioOnly:true, aFormat:'mp3' }),
      signal: AbortSignal.timeout(8000)
    }).then(r=>r.json())
    if (r.url) return res.json({ status:'ok', id, direct_url: r.url, source:'cobalt' })

    return res.status(500).json({ error: 'all failed', id })
  } catch(e:any){
    return res.status(500).json({ error: e.message, id })
  }
}
