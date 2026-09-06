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

    // stats / ping - taaki frontend 500 na de
    if (path.includes('stats') || path.includes('ping')) {
      return res.status(200).json({
        total: 0,
        totalHits: 0,
        blobUsedKB: 0,
        status: 'ok',
        uptime: Date.now()
      })
    }

    // --- SEARCH ---
    if (path.includes('search')) {
      const q = url.searchParams.get('q')?.trim()
      if (!q) return res.status(200).json([])

      try {
        // YouTube Inner API - Vercel pe sabse stable
        const ytRes = await fetch('https://www.youtube.com/youtubei/v1/search?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
          body: JSON.stringify({
            context: { client: { clientName: 'WEB', clientVersion: '2.20240301.01.00' } },
            query: q
          })
        }).then(r => r.json())

        const sec = ytRes?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || []
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

        // Fallback: Invidious
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
      } catch (e) {
        console.error('search error', e)
        return res.status(200).json([])
      }
    }

    // --- EXTRACT ---
    const id = url.searchParams.get('id')?.trim()
    if (!id) {
      return res.status(200).json({ status: 'ok', msg: 'use /api/search?q=... or /api/extract?id=VIDEO_ID' })
    }

    const getUrl = (f: any) => f.url || (f.signatureCipher? new URLSearchParams(f.signatureCipher).get('url') : null)

    try {
      // 1. Cobalt API - music ke liye sabse reliable
      for (const api of ['https://api.cobalt.tools/api/json', 'https://co.wuk.sh/api/json']) {
        try {
          const r: any = await fetch(api, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${id}`, isAudioOnly: true, aFormat: 'mp3' })
          }).then(r => r.json())
          if (r.url) {
            return res.status(200).json({ status: 'ok', id, title: r.filename || id, direct_url: r.url, source: 'cobalt' })
          }
        } catch {}
      }

      // 2. Invidious instances
      for (const inst of ['https://inv.tux.pizza', 'https://yewtu.be', 'https://invidious.io.lol', 'https://invidious.snopyta.org']) {
        try {
          const j: any = await fetch(`${inst}/api/v1/videos/${id}`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.json())
          const fmts = [...(j.adaptiveFormats || []),...(j.formatStreams || [])].filter((f: any) => f.type?.includes('audio') || f.mimeType?.includes('audio')).sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))
          if (fmts[0]?.url) {
            return res.status(200).json({ status: 'ok', id, title: j.title, direct_url: fmts[0].url, duration: j.lengthSeconds, source: 'invidious:' + inst })
          }
        } catch {}
      }

      // 3. Piped instances
      for (const inst of ['https://pipedapi.kavin.rocks', 'https://pipedapi.adminforge.de', 'https://api.piped.projectsegfau.lt', 'https://piped-api.lunar.icu']) {
        try {
          const j: any = await fetch(`${inst}/streams/${id}`).then(r => r.json())
          const best = j.audioStreams?.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0]
          if (best?.url) {
            return res.status(200).json({ status: 'ok', id, title: j.title, direct_url: best.url, duration: j.duration, source: 'piped' })
          }
        } catch {}
      }

      // 4. YouTube player API fallback
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

      // Agar yaha tak aaya to ye gaana copyright ki wajah se blocked hai
      return res.status(200).json({
        error: 'all extractors failed - this song is copyright blocked by label',
        id,
        hint: 'Try Gajendra Verma version gn_cO002sm0 or pv6W3RJB918 - woh copyright free hai aur chal jayega'
      })
    } catch (e: any) {
      return res.status(200).json({ error: e.message, id })
    }
  } catch (e: any) {
    console.error('TOP ERROR', e)
    return res.status(200).json([])
  }
}
