// api/index.ts - YT Extractor - Telegram DB - Final Working

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Content-Type', 'application/json')

  if (req.method === 'OPTIONS') return res.status(200).end()

  try {
    const host = req.headers.host || 'yt-ext-xi.vercel.app'
    const url = new URL(req.url, `https://${host}`)
    const path = url.pathname || ''

    // --- /api/stats /api/ping ---
    if (path.includes('stats') || path.includes('ping')) {
      return res.status(200).json({
        total: 0,
        totalHits: 0,
        blobUsedKB: 0,
        status: 'ok',
        uptime: Date.now()
      })
    }

    // --- /api/search?q=milo na tum to ---
    if (path.includes('search')) {
      const q = url.searchParams.get('q')?.trim()
      if (!q) return res.status(200).json([])

      try {
        // 1. YT Data API if key set
        if (process.env.YT_API_KEY) {
          try {
            const r = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&maxResults=12&key=${process.env.YT_API_KEY}`)
            const j: any = await r.json()
            if (j.items?.length) {
              return res.status(200).json(j.items.map((it: any) => ({
                videoId: it.id.videoId,
                title: it.snippet.title,
                author: it.snippet.channelTitle,
                thumb: it.snippet.thumbnails.medium.url,
                duration: ''
              })))
            }
          } catch {}
        }

        // 2. YouTube Inner API - Vercel pe stable
        try {
          const yt = await fetch('https://www.youtube.com/youtubei/v1/search?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
            body: JSON.stringify({
              context: { client: { clientName: 'WEB', clientVersion: '2.20240301.01.00' } },
              query: q
            })
          }).then(r => r.json())

          const sec = yt?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || []
          let videos: any[] = []
          for (const s of sec) {
            const contents = s.itemSectionRenderer?.contents || []
            for (const it of contents) {
              if (it.videoRenderer) videos.push(it.videoRenderer)
            }
          }
          if (videos.length) {
            return res.status(200).json(videos.slice(0, 12).map((vr: any) => ({
              videoId: vr.videoId,
              title: vr.title?.runs?.[0]?.text || vr.title?.simpleText || '',
              author: vr.ownerText?.runs?.[0]?.text || vr.shortBylineText?.runs?.[0]?.text || '',
              thumb: vr.thumbnail?.thumbnails?.pop()?.url || `https://i.ytimg.com/vi/${vr.videoId}/mqdefault.jpg`,
              duration: vr.lengthText?.simpleText || ''
            })))
          }
        } catch (e) {
          console.error('yt inner fail', e)
        }

        // 3. Invidious fallback
        try {
          const inv = await fetch(`https://inv.tux.pizza/api/v1/search?q=${encodeURIComponent(q)}&type=video`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
          }).then(r => r.json())
          if (Array.isArray(inv) && inv.length) {
            return res.status(200).json(inv.slice(0, 12).map((it: any) => ({
              videoId: it.videoId,
              title: it.title,
              author: it.author,
              thumb: it.videoThumbnails?.[2]?.url || `https://i.ytimg.com/vi/${it.videoId}/mqdefault.jpg`,
              duration: ''
            })))
          }
        } catch {}

        return res.status(200).json([])
      } catch (e: any) {
        console.error('search crash', e)
        return res.status(200).json([])
      }
    }

    // --- /api/extract?id=VIDEOID ---
    const id = url.searchParams.get('id')?.trim()
    if (!id) {
      return res.status(200).json({ status: 'ok', msg: 'use /api/search?q=... or /api/extract?id=VIDEO_ID' })
    }

    const getUrl = (f: any) => f.url || (f.signatureCipher? new URLSearchParams(f.signatureCipher).get('url') : null)

    try {
      // 1. Invidious - music ke liye best (content-id block nahi)
      for (const inst of ['https://inv.tux.pizza', 'https://yewtu.be', 'https://invidious.io.lol', 'https://invidious.snopyta.org']) {
        try {
          const j: any = await fetch(`${inst}/api/v1/videos/${id}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
          }).then(r => r.json())
          const fmts = [...(j.adaptiveFormats || []),...(j.formatStreams || [])]
          const aud = fmts.filter((f: any) => f.type?.includes('audio') || f.mimeType?.includes('audio')).sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0]
          if (aud?.url) {
            return res.status(200).json({
              status: 'ok',
              id,
              title: j.title,
              direct_url: aud.url,
              duration: j.lengthSeconds,
              source: 'invidious:' + inst
            })
          }
        } catch {}
      }

      // 2. Piped - 4 instances
      for (const inst of ['https://pipedapi.kavin.rocks', 'https://pipedapi.adminforge.de', 'https://api.piped.projectsegfau.lt', 'https://piped-api.lunar.icu']) {
        try {
          const j: any = await fetch(`${inst}/streams/${id}`).then(r => r.json())
          const best = j.audioStreams?.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0]
          if (best?.url) {
            return res.status(200).json({
              status: 'ok',
              id,
              title: j.title,
              direct_url: best.url,
              duration: j.duration,
              source: 'piped'
            })
          }
        } catch {}
      }

      // 3. Cobalt - 2 instances
      for (const api of ['https://api.cobalt.tools/api/json', 'https://co.wuk.sh/api/json']) {
        try {
          const r: any = await fetch(api, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${id}`, isAudioOnly: true, aFormat: 'mp3' })
          }).then(r => r.json())
          if (r.url) {
            return res.status(200).json({ status: 'ok', id, title: r.filename, direct_url: r.url, source: 'cobalt' })
          }
        } catch {}
      }

      // 4. ANDROID youtubei last
      try {
        const r: any = await fetch('https://www.youtube.com/youtubei/v1/player?key=AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context: { client: { clientName: 'ANDROID', clientVersion: '20.09.36' } }, videoId: id })
        }).then(r => r.json())
        const aud = (r.streamingData?.adaptiveFormats || []).map((f: any) => ({...f, _u: getUrl(f) })).filter((f: any) => f.mimeType?.includes('audio') && f._u).sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0]
        if (aud?._u) {
          return res.status(200).json({ status: 'ok', id, title: r.videoDetails?.title, direct_url: aud._u, source: 'android' })
        }
      } catch {}

      return res.status(500).json({ error: 'all extractors failed', id })
    } catch (e: any) {
      return res.status(500).json({ error: e.message, id })
    }
  } catch (e: any) {
    console.error('TOP CRASH', e)
    return res.status(200).json([])
  }
}
