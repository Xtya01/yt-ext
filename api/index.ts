export default async function handler(req:any,res:any){
  res.setHeader('Access-Control-Allow-Origin','*')
  res.setHeader('Content-Type','application/json')
  if(req.method==='OPTIONS') return res.status(200).end()
  try{
    const host = req.headers.host || 'yt-ext-xi.vercel.app'
    const url = new URL(req.url, `https://${host}`)
    const path = url.pathname

    if(path.includes('stats')||path.includes('ping')){
      return res.status(200).json({total:0,totalHits:0,blobUsedKB:0,status:'ok'})
    }

    if(path.includes('search')){
      const q = url.searchParams.get('q')?.trim()
      if(!q) return res.status(200).json([])
      try{
        // YouTube Inner API
        const yt = await fetch('https://www.youtube.com/youtubei/v1/search?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',{
          method:'POST',headers:{'Content-Type':'application/json','User-Agent':'Mozilla/5.0'},
          body: JSON.stringify({context:{client:{clientName:'WEB',clientVersion:'2.20240301.01.00'}},query:q})
        }).then(r=>r.json())
        const sec = yt?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents||[]
        let vids:any[]=[]
        for(const s of sec){ for(const it of (s.itemSectionRenderer?.contents||[])){ if(it.videoRenderer) vids.push(it.videoRenderer) } }
        if(vids.length){
          return res.status(200).json(vids.slice(0,12).map((vr:any)=>({
            videoId: vr.videoId, title: vr.title?.runs?.[0]?.text||'', author: vr.ownerText?.runs?.[0]?.text||'', thumb: vr.thumbnail?.thumbnails?.pop()?.url||`https://i.ytimg.com/vi/${vr.videoId}/mqdefault.jpg`, duration: vr.lengthText?.simpleText||''
          })))
        }
      }catch{}
      return res.status(200).json([])
    }

    const id = url.searchParams.get('id')?.trim()
    if(!id) return res.status(200).json({status:'ok'})

    const getUrl = (f:any)=> f.url || (f.signatureCipher? new URLSearchParams(f.signatureCipher).get('url'):null)

    // --- EXTRACT ---
    try{
      // 1. Cobalt - music ke liye best
      for(const api of ['https://api.cobalt.tools/api/json','https://co.wuk.sh/api/json','https://cobalt-api.kwiatekmiki.com/api/json']){
        try{
          const r:any = await fetch(api,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({url:`https://www.youtube.com/watch?v=${id}`,isAudioOnly:true,aFormat:'mp3'})}).then(r=>r.json())
          if(r.url) return res.status(200).json({status:'ok',id,title:r.filename||id,direct_url:r.url,source:'cobalt:'+api})
        }catch{}
      }

      // 2. Invidious 6 instances
      for(const inst of ['https://inv.tux.pizza','https://yewtu.be','https://invidious.io.lol','https://invidious.snopyta.org','https://iv.melmac.space','https://inv.nadeko.net']){
        try{
          const j:any = await fetch(`${inst}/api/v1/videos/${id}`,{headers:{'User-Agent':'Mozilla/5.0'}}).then(r=>r.json())
          const fmt = [...(j.adaptiveFormats||[]),...(j.formatStreams||[])].filter((f:any)=>f.type?.includes('audio')||f.mimeType?.includes('audio')).sort((a:any,b:any)=>(b.bitrate||0)-(a.bitrate||0))[0]
          if(fmt?.url) return res.status(200).json({status:'ok',id,title:j.title,direct_url:fmt.url,source:'invidious:'+inst})
        }catch{}
      }

      // 3. Piped 5 instances
      for(const inst of ['https://pipedapi.kavin.rocks','https://pipedapi.adminforge.de','https://api.piped.projectsegfau.lt','https://piped-api.lunar.icu','https://pipedapi.moomoo.me']){
        try{
          const j:any = await fetch(`${inst}/streams/${id}`).then(r=>r.json())
          const best = j.audioStreams?.sort((a:any,b:any)=>(b.bitrate||0)-(a.bitrate||0))[0]
          if(best?.url) return res.status(200).json({status:'ok',id,title:j.title,direct_url:best.url,source:'piped'})
        }catch{}
      }

      // 4. Android player
      try{
        const r:any = await fetch('https://www.youtube.com/youtubei/v1/player?key=AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({context:{client:{clientName:'ANDROID',clientVersion:'20.09.36'}},videoId:id})}).then(r=>r.json())
        const aud = (r.streamingData?.adaptiveFormats||[]).map((f:any)=>({...f,_u:getUrl(f)})).filter((f:any)=>f.mimeType?.includes('audio')&&f._u).sort((a:any,b:any)=>(b.bitrate||0)-(a.bitrate||0))[0]
        if(aud?._u) return res.status(200).json({status:'ok',id,title:r.videoDetails?.title,direct_url:aud._u,source:'android'})
      }catch{}

      return res.status(200).json({error:'all extractors failed - this song is UMG blocked',id})
    }catch(e:any){ return res.status(200).json({error:e.message,id}) }
  }catch(e:any){ return res.status(200).json([]) }
}
