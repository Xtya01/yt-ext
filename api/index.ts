export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Content-Type', 'application/json')
  const url = new URL(req.url, `https://${req.headers.host}`)
  const path = url.pathname

  // /api/search?q=milo na tum to
  if (path.includes('/search')) {
    const q = url.searchParams.get('q')?.trim()
    if (!q) return res.status(400).json({ error: 'q required' })
    try {
      // Piped search - no API key, no CF block
      const r = await fetch(`https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(q)}&filter=music_songs`, { signal: AbortSignal.timeout(8000) }).then(r=>r.json())
      const items = r.items?.slice(0,12).map((it:any)=>({
        videoId: it.url?.split('v=')[1] || it.url?.split('/').pop(),
        title: it.title,
        author: it.uploaderName,
        thumb: it.thumbnail,
        duration: it.duration? `${Math.floor(it.duration/60)}:${String(it.duration%60).padStart(2,'0')}` : ''
      })) || []
      return res.json(items)
    } catch(e:any){
      return res.status(500).json({ error: e.message })
    }
  }

  // /api/extract?id=VIDEO_ID ya /api?id=VIDEO_ID
  const id = url.searchParams.get('id')?.trim()
  if (!id) return res.status(400).json({ error: 'id required' })

  const getUrl = (f:any) => f.url || (f.signatureCipher? new URLSearchParams(f.signatureCipher).get('url') : null)

  try {
    for (const inst of ['https://pipedapi.kavin.rocks','https://pipedapi.adminforge.de']) {
      try {
        const j = await fetch(`${inst}/streams/${id}`, { signal: AbortSignal.timeout(8000) }).then(r=>r.json())
        const best = j.audioStreams?.sort((a:any,b:any)=> (b.bitrate||0)-(a.bitrate||0))[0]
        if (best?.url) return res.json({ status:'ok', id, title: j.title, direct_url: best.url, duration: j.duration, source:'piped' })
      } catch {}
    }
    // Cobalt fallback
    const r = await fetch('https://api.cobalt.tools/api/json', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ url:`https://www.youtube.com/watch?v=${id}`, isAudioOnly:true, aFormat:'mp3' }),
      signal: AbortSignal.timeout(8000)
    }).then(r=>r.json())
    if (r.url) return res.json({ status:'ok', id, title: r.filename, direct_url: r.url, source:'cobalt' })

    return res.status(500).json({ error: 'all extractors failed', id })
  } catch(e:any){
    return res.status(500).json({ error: e.message, id })
  }
}
