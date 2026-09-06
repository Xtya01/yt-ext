export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Content-Type', 'application/json')
  if (req.method === 'OPTIONS') return res.status(200).end()

  // proxy fetch - Vercel IP block fix
  const fetchViaProxy = async (targetUrl: string, opts: any = {}) => {
    const proxies = [
      (u: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
      (u: string) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
      (u: string) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`
    ]
    // pehle direct try
    try {
      const r = await fetch(targetUrl, opts)
      if (r.ok) return r
    } catch {}
    // fir proxy se
    for (const p of proxies) {
      try {
        const r = await fetch(p(targetUrl), opts)
        if (r.ok) return r
      } catch {}
    }
    throw new Error('proxy failed')
  }

  try {
    const host = req.headers.host || 'yt-ext-xi.vercel.app'
    const url = new URL(req.url, `https://${host}`)
    const path = url.pathname || ''

    if (path.includes('stats') || path.includes('ping')) {
      return res.status(200).json({ total: 0, totalHits: 0, blobUsedKB: 0, status: 'ok' })
    }

    if (path.includes('search')) {
      const q = url.searchParams.get('q')?.trim()
      if (!q) return res.status(200).json([])
      try {
        const yt = await fetchViaProxy('https://www.youtube.com/youtubei/v1/search?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
          body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20240301.01.00' } }, query: q })
        }).then((r: any) => r.json())

        const sec = yt?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || []
        let vids: any[] = []
        for (const s of sec) for (const it of (s.itemSectionRenderer?.contents || [])) if (it.videoRenderer) vids.push(it.videoRenderer)
        if (vids.length) {
          return res.status(200).json(vids.slice(0, 12).map((vr: any) => ({
            videoId: vr.videoId, title: vr.title?.runs?.[0]?.text || '', author: vr.ownerText?.runs?.[0]?.text || '', thumb: vr.thumbnail?.thumbnails?.pop()?.url || `https://i.ytimg.com/vi/${vr.videoId}/mqdefault.jpg`
          })))
        }
      } catch {}
      return res.status(200).json([])
    }

    const id = url.searchParams.get('id')?.trim()
    if (!id) return res.status(200).json({ status: 'ok' })
    const getUrl = (f: any) => f.url || (f.signatureCipher? new URLSearchParams(f.signatureCipher).get('url') : null)

    try {
      // YouTube clients via proxy
      const clients = [
        { name: 'ANDROID_MUSIC', ver: '6.20.51', key: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', extra: { androidSdkVersion: 30 } },
        { name: 'WEB_EMBEDDED_PLAYER', ver: '1.20240301.01.00', key: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8' },
        { name: 'TVHTML5', ver: '7.20240301.01.00', key: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8' },
      ]
      for (const c of clients) {
        try {
          const r: any = await fetchViaProxy(`https://www.youtube.com/youtubei/v1/player?key=${c.key}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
            body: JSON.stringify({ context: { client: { clientName: c.name, clientVersion: c.ver,...(c.extra || {}) } }, videoId: id, contentCheckOk: true, racyCheckOk: true })
          }).then((r: any) => r.json())
          const fmts = [...(r.streamingData?.adaptiveFormats || []),...(r.streamingData?.formats || [])].map((f: any) => ({...f, _u: getUrl(f) })).filter((f: any) => f._u && f.mimeType?.includes('audio')).sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))
          if (fmts[0]?._u) return res.status(200).json({ status: 'ok', id, title: r.videoDetails?.title || id, direct_url: fmts[0]._u, source: 'yt-' + c.name + '-proxy' })
        } catch {}
      }

      // Cobalt via proxy
      for (const api of ['https://api.cobalt.tools/api/json', 'https://co.wuk.sh/api/json']) {
        try {
          const r: any = await fetchViaProxy(api, {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${id}`, isAudioOnly: true, aFormat: 'mp3' })
          }).then((r: any) => r.json())
          if (r.url) return res.status(200).json({ status: 'ok', id, title: r.filename || id, direct_url: r.url, source: 'cobalt-proxy' })
        } catch {}
      }

      return res.status(200).json({ error: 'all extractors failed', id, hint: 'YouTube blocked Vercel IP, proxy also failed - try after 5 min' })
    } catch (e: any) {
      return res.status(200).json({ error: e.message, id })
    }
  } catch (e: any) {
    return res.status(200).json([])
  }
}
