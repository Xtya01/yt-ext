  // /api/search?q=milo na tum to
  if (path.includes('/search')) {
    const q = url.searchParams.get('q')?.trim()
    if (!q) return res.json([])
    try {
      // 1. Invidious - Vercel pe sabse stable
      for (const inst of ['https://inv.tux.pizza','https://yewtu.be','https://invidious.io.lol']) {
        try {
          const r = await fetch(`${inst}/api/v1/search?q=${encodeURIComponent(q)}&type=video`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
          })
          const j = await r.json()
          if (Array.isArray(j) && j.length) {
            const items = j.slice(0,12).map((it:any)=>({
              videoId: it.videoId,
              title: it.title,
              author: it.author,
              thumb: it.videoThumbnails?.[2]?.url || it.videoThumbnails?.[0]?.url || `https://i.ytimg.com/vi/${it.videoId}/mqdefault.jpg`,
              duration: it.lengthSeconds? `${Math.floor(it.lengthSeconds/60)}:${String(it.lengthSeconds%60).padStart(2,'0')}` : ''
            }))
            return res.json(items)
          }
        } catch {}
      }

      // 2. YouTube Data API - agar key hai to 100% chalega (free, no card)
      if (process.env.YT_API_KEY) {
        const r = await fetch(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(q)}&type=video&maxResults=12&key=${process.env.YT_API_KEY}`).then(r=>r.json())
        if (r.items?.length) {
          return res.json(r.items.map((it:any)=>({
            videoId: it.id.videoId,
            title: it.snippet.title,
            author: it.snippet.channelTitle,
            thumb: it.snippet.thumbnails.medium.url,
            duration: ''
          })))
        }
      }

      // 3. Piped last fallback
      const r = await fetch(`https://pipedapi.kavin.rocks/search?q=${encodeURIComponent(q)}`, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r=>r.json())
      if (r.items?.length) {
        return res.json(r.items.slice(0,12).map((it:any)=>({
          videoId: it.url?.split('v=')[1] || it.url?.split('/').pop(),
          title: it.title,
          author: it.uploaderName,
          thumb: it.thumbnail,
          duration: ''
        })))
      }

      return res.json([])
    } catch(e:any){
      return res.json([])
    }
  }
