export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Content-Type', 'application/json')

  try {
    const host = req.headers.host || 'yt-ext-xi.vercel.app'
    const url = new URL(req.url, `https://${host}`)
    const path = url.pathname || ''

    // Stats - hamesha 200
    if (path.includes('stats') || path.includes('ping')) {
      return res.status(200).json({ total: 0, totalHits: 0, blobUsedKB: 0, status: 'ok' })
    }

    // Search
    if (path.includes('search')) {
      const q = url.searchParams.get('q') || ''
      if (!q) return res.status(200).json([])

      try {
        // Invidious - no timeout wala simple fetch
        const inv = await fetch(`https://inv.tux.pizza/api/v1/search?q=${encodeURIComponent(q)}&type=video`, {
          headers: { 'User-Agent': 'Mozilla/5.0' }
        })
        const data = await inv.json()
        if (Array.isArray(data) && data.length > 0) {
          const items = data.slice(0,12).map((it:any)=>({
            videoId: it.videoId,
            title: it.title,
            author: it.author,
            thumb: it.videoThumbnails?.[2]?.url || `https://i.ytimg.com/vi/${it.videoId}/mqdefault.jpg`,
            duration: ''
          }))
          return res.status(200).json(items)
        }
      } catch (e) {
        console.error('invidious fail', e)
      }

      // YT API Key agar hai
      if (process.env.YT_API_KEY) {
        try {
          const r = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&maxResults=12&key=${process.env.YT_API_KEY}`)
          const j = await r.json()
          if (j.items) {
            return res.status(200).json(j.items.map((it:any)=>({
              videoId: it.id.videoId,
              title: it.snippet.title,
              author: it.snippet.channelTitle,
              thumb: it.snippet.thumbnails.medium.url,
              duration: ''
            })))
          }
        } catch {}
      }

      // Fail pe bhi 200 with []
      return res.status(200).json([])
    }

    // Extract
    const id = url.searchParams.get('id')
    if (!id) return res.status(400).json({ error: 'id required' })

    try {
      const j = await fetch(`https://pipedapi.kavin.rocks/streams/${id}`).then(r=>r.json())
      const best = j.audioStreams?.sort((a:any,b:any)=>b.bitrate-a.bitrate)[0]
      if (best?.url) return res.status(200).json({ status:'ok', id, title: j.title, direct_url: best.url })
    } catch {}

    return res.status(500).json({ error: 'extract failed', id })

  } catch (e:any) {
    console.error('TOP LEVEL CRASH', e)
    // Top level pe bhi 500 mat de, 200 with [] de de taaki UI na toote
    if (req.url?.includes('search') || req.url?.includes('stats')) {
      return res.status(200).json([])
    }
    return res.status(200).json({ error: e.message })
  }
}
