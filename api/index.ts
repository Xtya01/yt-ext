export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const host = req.headers.host || 'yt-ext-xi.vercel.app'
    const url = new URL(req.url, `https://${host}`)
    const path = url.pathname || ''
    const qParam = url.searchParams.get('q')?.trim()
    const idParam = url.searchParams.get('id')?.trim()

    // --- /api/stats, /api/ping ---
    if (path.includes('stats') || path.includes('ping')) {
      return res.status(200).json({
        total: 0,
        totalHits: 0,
        blobUsedKB: 0,
        status: 'ok',
        uptime: Date.now()
      })
    }

    // --- /api/search?q=... ---
    if (path.includes('search')) {
      if (!qParam) return res.status(200).json([])

      try {
        // 1. YouTube Data API (agar key hai to 100% stable)
        if (process.env.YT_API_KEY) {
          try {
            const r = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(qParam)}&type=video&maxResults=12&key=${process.env.YT_API_KEY}`)
            const j:any = await r.json()
            if (j.items?.length) {
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

        // 2. YouTube Inner API (Vercel pe chalta hai)
        try {
          const yt = await fetch('https://www.youtube.com/youtubei/v1/search?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
            body: JSON.stringify({
              context: { client: { clientName: 'WEB', clientVersion: '2.20240301.01.00' } },
              query: qParam
            })
          }).then(r=>r.json())

          const sec = yt?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || []
          let videos:any[] = []
          for (const s of sec) {
            const contents = s.itemSectionRenderer?.contents || []
            for (const it of contents) {
              if (it.videoRenderer) videos.push(it.videoRenderer)
            }
          }
          if (videos.length) {
            return res.status(200).json(videos.slice(0,12).map((vr:any)=>({
              videoId: vr.videoId,
              title: vr.title?.runs?.[0]?.text || vr.title?.simpleText || '',
              author: vr.ownerText?.runs?.[0]?.text || vr.shortBylineText?.runs?.[0]?.text || '',
              thumb: vr.thumbnail?.thumbnails?.pop()?.url || `https://i.ytimg.com/vi/${vr.videoId}/mqdefault.jpg`,
              duration: vr.lengthText?.simpleText || ''
            })))
          }
        } catch (e) { console.error('yt inner fail', e) }

        // 3. Invidious Fallback
        try {
          const inv = await fetch(`https://inv.tux.pizza/api/v1/search?q=${encodeURIComponent(qParam)}&type=video`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
          }).then(r=>r.json())
          if (Array.isArray(inv) && inv.length) {
            return res.status(200).json(inv.slice(0,12).map((it:any)=>({
              videoId: it.videoId,
              title: it.title,
              author: it.author,
              thumb: it.videoThumbnails?.[2]?.url || `https://i.ytimg.com/vi/${it.videoId}/mqdefault.jpg`,
              duration: ''
            })))
          }
        } catch {}

        return res.status(200).json([])
      } catch (e:any) {
        console.error('search crash', e)
        return res.status(200).json([])
      }
    }

    // --- /api/extract?id=... OR /api?id=... OR /api/file ---
    const id = idParam
    if (!id) {
      if (path.includes('file') || path.includes('extract')) {
        return res.status(400).json({ error: 'id required' })
      }
      return res.status(200).json({ status: 'ok', msg: 'use /api/search?q=... or /api/extract?id=...' })
    }

    // helper to get url from cipher
    const getUrl = (f:any) => f.url || (f.signatureCipher? new URLSearchParams(f.signatureCipher).get('url') : null)

    try {
      // 1. Piped
      for (const inst of ['https://pipedapi.kavin.rocks','https://pipedapi.adminforge.de']) {
        try {
          const j:any = await fetch(`${inst}/streams/${id}`).then(r=>r.json())
          const best = j.audioStreams?.sort((a:any,b:any)=> (b.bitrate||0)-(a.bitrate||0))[0]
          if (best?.url) {
            return res.status(200).json({ status:'ok', id, title: j.title, direct_url: best.url, duration: j.duration, source:'piped' })
          }
        } catch {}
      }

      // 2. Cobalt
      try {
        const r:any = await fetch('https://api.cobalt.tools/api/json', {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ url:`https://www.youtube.com/watch?v=${id}`, isAudioOnly:true, aFormat:'mp3' })
        }).then(r=>r.json())
        if (r.url) return res.status(200).json({ status:'ok', id, title: r.filename, direct_url: r.url, source:'cobalt' })
      } catch {}

      // 3. Watch page + cipher
      try {
        const html = await fetch(`https://www.youtube.com/watch?v=${id}`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r=>r.text())
        const m = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/)
        if (m) {
          const j = JSON.parse(m[1])
          const fmts = [...(j.streamingData?.adaptiveFormats||[])]
          let aud = fmts.map((f:any)=>({...f, _u:getUrl(f)})).filter((f:any)=>f.itag==140 && f._u)[0]
          if (!aud) aud = fmts.map((f:any)=>({...f, _u:getUrl(f)})).filter((f:any)=>f.mimeType?.includes('audio') && f._u).sort((a:any,b:any)=> (b.bitrate||0)-(a.bitrate||0))[0]
          if (aud?._u) return res.status(200).json({ status:'ok', id, title: j.videoDetails?.title, direct_url: aud._u, duration: j.videoDetails?.lengthSeconds, source:'watch' })
        }
      } catch {}

      return res.status(500).json({ error: 'all extractors failed', id })
    } catch (e:any) {
      return res.status(500).json({ error: e.message, id })
    }

  } catch (e:any) {
    console.error('TOP CRASH', e)
    return res.status(200).json([])
  }
}
