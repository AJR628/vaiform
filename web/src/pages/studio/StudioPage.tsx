import { useEffect, useState } from 'react'
import { api, CaptionMode, KenBurns } from '../../lib/api'

export function StudioPage(){
  const [step, setStep] = useState(0)
  const [studioId, setStudioId] = useState<string>('')
  const [template, setTemplate] = useState<'calm'|'bold'|'cosmic'|'minimal'>('minimal')
  const [durationSec, setDurationSec] = useState<number>(8)
  const [watermark, setWatermark] = useState(true)

  // picks
  const [quoteChosen, setQuoteChosen] = useState<string|null>(null)
  const [imageChosen, setImageChosen] = useState<string|null>(null)
  const [videoChosen, setVideoChosen] = useState<string|null>(null)

  useEffect(()=>{
    const sid = localStorage.getItem('vaiform_lastStudio')
    if (sid) { setStudioId(sid); setStep(1) }
  },[])

  async function start(){
    const r = await api.startStudio({ template, durationSec, maxRefines:5 })
    if (r.ok && (r.data as any).id){
      setStudioId((r.data as any).id)
      localStorage.setItem('vaiform_lastStudio', (r.data as any).id)
      setStep(1)
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Studio</h1>
      {step===0 && (
        <div className="space-y-2">
          <div className="flex gap-2 items-center">
            <label>Template</label>
            <select value={template} onChange={e=>setTemplate(e.target.value as any)} className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1">
              <option value="calm">calm</option>
              <option value="bold">bold</option>
              <option value="cosmic">cosmic</option>
              <option value="minimal">minimal</option>
            </select>
            <label>Duration</label>
            <input type="range" min={6} max={10} value={durationSec} onChange={e=>setDurationSec(parseInt(e.target.value)||8)} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={watermark} onChange={e=>setWatermark(e.target.checked)} />Watermark</label>
            <button onClick={start} className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500">Start Session</button>
          </div>
        </div>
      )}
      {step===1 && <QuoteStep studioId={studioId} onChosen={(id)=>{setQuoteChosen(id); setStep(2)}} />}
      {step===2 && <BackgroundStep studioId={studioId} onImage={(id)=>{setImageChosen(id); setStep(3)}} onVideo={(id)=>{setVideoChosen(id); setStep(3)}} />}
      {step===3 && <RenderStep studioId={studioId} captionMode={'progress'} watermark={watermark} onDone={()=>{localStorage.removeItem('vaiform_lastStudio')}} />}
    </div>
  )
}

function QuoteStep({ studioId, onChosen }:{ studioId:string; onChosen:(id:string)=>void }){
  const [mode, setMode] = useState<'feeling'|'quote'>('feeling')
  const [text, setText] = useState('calm focus')
  const [cands, setCands] = useState<any[]>([])
  async function gen(){
    const r = await api.studioQuote({ studioId, mode, text, count:3 })
    if (r.ok) setCands((r.data as any).quote.candidates)
  }
  async function choose(id:string){
    const r = await api.studioChoose({ studioId, track:'quote', candidateId:id })
    if (r.ok) onChosen(id)
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2 items-center">
        <select value={mode} onChange={e=>setMode(e.target.value as any)} className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1">
          <option value="feeling">Feeling</option>
          <option value="quote">Exact quote</option>
        </select>
        <input value={text} onChange={e=>setText(e.target.value)} className="flex-1 bg-neutral-900 border border-neutral-800 rounded px-2 py-1" />
        <button onClick={gen} className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700">Generate ×3</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {cands.map(c => (
          <div key={c.id} className="border border-neutral-800 rounded p-3 space-y-1">
            <div className="text-sm">{c.text}</div>
            {c.author && (<div className="text-xs text-neutral-400">— {c.author}</div>)}
            <button onClick={()=>choose(c.id)} className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-500">Choose</button>
          </div>
        ))}
      </div>
    </div>
  )
}

function BackgroundStep({ studioId, onImage, onVideo }:{ studioId:string; onImage:(id:string)=>void; onVideo:(id:string)=>void }){
  const [tab, setTab] = useState<'stockImage'|'stockVideo'|'imageUrl'|'upload'|'ai'>('stockImage')
  const [query, setQuery] = useState('calm')
  const [ken, setKen] = useState<KenBurns>('in')
  const [cands, setCands] = useState<any[]>([])
  async function genImage(){
    const r = await api.studioImage({ studioId, kind:'stock', query, kenBurns:ken })
    if (r.ok) setCands((r.data as any).image.candidates)
  }
  async function genVideo(){
    const r = await api.studioVideo({ studioId, kind:'stockVideo', query })
    if (r.ok) setCands((r.data as any).video.candidates)
  }
  async function chooseImage(id:string){
    const r = await api.studioChoose({ studioId, track:'image', candidateId:id })
    if (r.ok) onImage(id)
  }
  async function chooseVideo(id:string){
    const r = await api.studioChoose({ studioId, track:'video', candidateId:id })
    if (r.ok) onVideo(id)
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button onClick={()=>setTab('stockImage')} className={`px-2 py-1 rounded ${tab==='stockImage'?'bg-blue-600':'bg-neutral-800'}`}>Stock Image</button>
        <button onClick={()=>setTab('stockVideo')} className={`px-2 py-1 rounded ${tab==='stockVideo'?'bg-blue-600':'bg-neutral-800'}`}>Stock Video</button>
      </div>
      {tab==='stockImage' && (
        <div className="space-y-2">
          <div className="flex gap-2 items-center">
            <input value={query} onChange={e=>setQuery(e.target.value)} className="flex-1 bg-neutral-900 border border-neutral-800 rounded px-2 py-1" />
            <select value={ken} onChange={e=>setKen(e.target.value as any)} className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1">
              <option value="in">in</option>
              <option value="out">out</option>
              <option value="">none</option>
            </select>
            <button onClick={genImage} className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700">Search</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {cands.map(c => (
              <div key={c.id} className="border border-neutral-800 rounded overflow-hidden">
                <img src={c.url} className="w-full h-40 object-cover" />
                <button onClick={()=>chooseImage(c.id)} className="w-full text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500">Choose</button>
              </div>
            ))}
          </div>
        </div>
      )}
      {tab==='stockVideo' && (
        <div className="space-y-2">
          <div className="flex gap-2 items-center">
            <input value={query} onChange={e=>setQuery(e.target.value)} className="flex-1 bg-neutral-900 border border-neutral-800 rounded px-2 py-1" />
            <button onClick={genVideo} className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700">Search</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {cands.map(c => (
              <div key={c.id} className="border border-neutral-800 rounded overflow-hidden">
                <video src={c.url} className="w-full h-40 object-cover" muted playsInline />
                <button onClick={()=>chooseVideo(c.id)} className="w-full text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500">Choose</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function RenderStep({ studioId, captionMode, watermark, onDone }:{ studioId:string; captionMode:CaptionMode; watermark:boolean; onDone:()=>void }){
  const [voiceover, setVoiceover] = useState(true)
  const [wantAttribution, setWantAttribution] = useState(true)
  const [result, setResult] = useState<any>(null)
  const [showRemix, setShowRemix] = useState(false)
  const [videoUrl, setVideoUrl] = useState<string|undefined>(undefined)
  const [loading, setLoading] = useState(false)
  useEffect(()=>{
    if (!studioId) return
    const es = new EventSource(`/api/studio/events/${encodeURIComponent(studioId)}`)
    es.onmessage = (e)=>{
      try{
        const payload = JSON.parse(e.data)
        console.log('[ui][sse]', 'message', e.data)
        // common handler for socket payload
        handlePreviewPayload(payload)
        if (payload.event === 'video_ready' && payload.url){ setVideoUrl(payload.url); setLoading(false) }
        if (payload.event === 'done'){}
        if (payload.event === 'error'){ setLoading(false); alert(payload.message || 'Render failed') }
      }catch{}
    }
    return ()=>{ es.close() }
  }, [studioId])

  function pickUrl(obj:any, endsWith:string){
    try { return Object.values(obj).find((u:any) => typeof u === 'string' && u.endsWith(endsWith)) as string|undefined } catch { return undefined }
  }
  function chooseMp4(result:any){
    const urls = result?.urls || {}
    const direct = (typeof result?.url === 'string' && result.url.endsWith('.mp4')) ? result.url : undefined
    const explicitKey = Object.keys(urls).find(k => /_9x16\.mp4$/i.test(k))
    const nine = direct || (explicitKey ? urls[explicitKey] : pickUrl(urls, '_9x16.mp4'))
    if (nine) return { src: nine, poster: (urls[result?.renderId + '_poster_9x16.png'] || pickUrl(urls, '_poster_9x16.png')) }
    // fallbacks
    const one = pickUrl(urls, '_1x1.mp4') || Object.values(urls).find((u:any)=>String(u).endsWith('_1x1.mp4'))
    const wide = pickUrl(urls, '_16x9.mp4') || Object.values(urls).find((u:any)=>String(u).endsWith('_16x9.mp4'))
    const src = (one as string) || (wide as string) || direct
    const poster = urls[result?.renderId + '_poster_9x16.png'] || pickUrl(urls, '_poster_9x16.png')
    return { src, poster }
  }
  function handlePreviewPayload(result:any){
    if (!result) return
    const { src, poster } = chooseMp4(result)
    if (!src) return
    const el = document.querySelector('#preview') as HTMLVideoElement | null
    if (el){
      el.setAttribute('controls','')
      el.setAttribute('playsinline','')
      el.setAttribute('preload','metadata')
      if (poster) el.poster = poster
      // Rebuild sources to help browser pick correct type
      try { while (el.firstChild) el.removeChild(el.firstChild) } catch {}
      const source = document.createElement('source')
      source.src = src
      source.type = 'video/mp4'
      el.appendChild(source)
      el.setAttribute('src', src)
      ;(el as any).srcObject = null
      try { el.removeAttribute('crossorigin') } catch {}
      el.load()
      el.muted = true
      try { void el.play().catch(()=>{}) } catch {}
      el.addEventListener('loadeddata', ()=>{ console.log('[preview][ready]', { currentSrc: el.currentSrc, readyState: el.readyState, networkState: el.networkState }); el.classList.add('is-ready') }, { once:true })
      el.addEventListener('error', ()=>{ console.error('[preview][error]', { src: el.currentSrc, code: (el.error && el.error.code) || null }) }, { once:true })
      console.log('[preview] src:', src, 'poster:', poster || '(none)')
    }
  }
  async function finalize(){
    setLoading(true)
    const r = await api.studioFinalize({ studioId, voiceover, wantAttribution, captionMode, watermark })
    console.log('[ui] finalize response', r)
    if (r.ok){ setResult(r.data); handlePreviewPayload(r.data) }
    setLoading(false)
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={voiceover} onChange={e=>setVoiceover(e.target.checked)} />Voiceover</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={wantAttribution} onChange={e=>setWantAttribution(e.target.checked)} />Attribution</label>
        <button onClick={finalize} className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-500">Render</button>
        {result && (
          <button onClick={()=>setShowRemix(true)} className="px-3 py-1.5 rounded bg-purple-600 hover:bg-purple-500">Remix</button>
        )}
      </div>
      {loading && (<div className="text-xs text-neutral-400">Rendering…</div>)}
      <div className="border border-neutral-800 rounded p-3 space-y-2">
        <video
          id="preview"
          className="w-full max-w-md rounded"
          controls
          playsInline
          preload="metadata"
          crossOrigin="anonymous"
          style={{ backgroundColor: '#000' as any }}
        />
        {result?.coverImageUrl && (
          <a className="text-blue-400 text-sm" href={result.coverImageUrl} target="_blank">Open cover.jpg</a>
        )}
      </div>
      {showRemix && (
        <RemixPanel studioId={studioId} onClose={()=>setShowRemix(false)} />
      )}
    </div>
  )
}

function RemixPanel({ studioId, onClose }:{ studioId:string; onClose:()=>void }){
  const [tab, setTab] = useState<'background'|'audio'|'style'|'timing'>('background')
  // background search
  const [bgKind, setBgKind] = useState<'stockVideo'|'stock'>('stockVideo')
  const [query, setQuery] = useState('calm')
  const [cands, setCands] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  // audio
  const [keepAudio, setKeepAudio] = useState(true)
  const [bgVol, setBgVol] = useState(0.35)
  const [voiceDelay, setVoiceDelay] = useState(0)
  // style presets
  const [style, setStyle] = useState<'Minimal'|'Bold'|'Cinematic'>('Minimal')
  const styleMap:any = {
    Minimal: { fontcolor:'white', box:1, boxcolor:'black@0.30', boxborderw:24 },
    Bold: { fontcolor:'white', shadowColor:'black', shadowX:3, shadowY:3, box:1, boxcolor:'black@0.45', boxborderw:28 },
    Cinematic: { fontcolor:'white', shadowColor:'black', shadowX:2, shadowY:2, box:1, boxcolor:'black@0.35', boxborderw:24, watermark:true },
  }
  // local remixes list
  const [remixes, setRemixes] = useState<any[]>([])

  async function search(){
    setLoading(true)
    try{
      if (bgKind==='stockVideo') {
        const r = await api.studioVideo({ studioId, kind:'stockVideo', query })
        if (r.ok) setCands((r.data as any).video.candidates)
      } else {
        const r = await api.studioImage({ studioId, kind:'stock', query })
        if (r.ok) setCands((r.data as any).image.candidates)
      }
    } finally { setLoading(false) }
  }
  async function more(){
    // call same search to advance paging on server; session keeps next page
    await search()
  }
  async function choose(id:string){
    const track = bgKind==='stockVideo' ? 'video' : 'image'
    await api.studioChoose({ studioId, track: track as any, candidateId: id })
  }
  async function apply(){
    const renderSpec:any = {
      output: { durationSec: 8, safeMargin: 0.06 },
      style: styleMap[style],
      audio: { keepVideoAudio: keepAudio, bgAudioVolume: bgVol, voiceoverDelaySec: voiceDelay },
    }
    const r = await api.studioFinalize({ studioId, renderSpec, formats: ['9x16','1x1','16x9'], wantImage: true, wantAudio: true })
    if (r.ok) setRemixes(prev => [{ id: (r.data as any).renderId, urls: (r.data as any).urls }, ...prev])
  }
  return (
    <div className="fixed inset-0 bg-black/50 flex">
      <div className="ml-auto w-full max-w-md h-full bg-neutral-950 border-l border-neutral-800 p-4 space-y-3 overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="font-semibold">Remix</div>
          <button onClick={onClose} className="text-sm text-neutral-400">Close</button>
        </div>
        <div className="flex gap-2 text-xs">
          <button onClick={()=>setTab('background')} className={`px-2 py-1 rounded ${tab==='background'?'bg-neutral-800':'bg-neutral-900'}`}>Background</button>
          <button onClick={()=>setTab('audio')} className={`px-2 py-1 rounded ${tab==='audio'?'bg-neutral-800':'bg-neutral-900'}`}>Audio</button>
          <button onClick={()=>setTab('style')} className={`px-2 py-1 rounded ${tab==='style'?'bg-neutral-800':'bg-neutral-900'}`}>Style</button>
          <button onClick={()=>setTab('timing')} className={`px-2 py-1 rounded ${tab==='timing'?'bg-neutral-800':'bg-neutral-900'}`}>Timing</button>
        </div>
        {tab==='background' && (
          <div className="space-y-2">
            <div className="flex gap-2 items-center">
              <select value={bgKind} onChange={e=>setBgKind(e.target.value as any)} className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1">
                <option value="stockVideo">More results (video)</option>
                <option value="stock">More results (image)</option>
              </select>
              <input value={query} onChange={e=>setQuery(e.target.value)} className="flex-1 bg-neutral-900 border border-neutral-800 rounded px-2 py-1" />
              <button disabled={loading} onClick={search} className="px-2 py-1 bg-neutral-800 rounded">Search</button>
              <button disabled={loading} onClick={more} className="px-2 py-1 bg-neutral-800 rounded">More</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {cands.map(c => (
                <div key={c.id} className="border border-neutral-800 rounded overflow-hidden">
                  {bgKind==='stockVideo' ? (
                    <video src={c.url} className="w-full h-32 object-cover" muted playsInline />
                  ) : (
                    <img src={c.url} className="w-full h-32 object-cover" />
                  )}
                  <button onClick={()=>choose(c.id)} className="w-full text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500">Use</button>
                </div>
              ))}
            </div>
          </div>
        )}
        {tab==='audio' && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={keepAudio} onChange={e=>setKeepAudio(e.target.checked)} />Keep original audio</label>
            <div className="text-xs">BG volume: {bgVol.toFixed(2)}</div>
            <input type="range" min={0} max={1} step={0.05} value={bgVol} onChange={e=>setBgVol(parseFloat(e.target.value))} />
          </div>
        )}
        {tab==='style' && (
          <div className="space-x-2">
            {(['Minimal','Bold','Cinematic'] as const).map(s => (
              <button key={s} onClick={()=>setStyle(s)} className={`px-2 py-1 rounded ${style===s?'bg-blue-600':'bg-neutral-800'}`}>{s}</button>
            ))}
          </div>
        )}
        {tab==='timing' && (
          <div className="space-y-2">
            <div className="text-xs">Voiceover delay: {voiceDelay.toFixed(2)}s</div>
            <input type="range" min={0} max={1} step={0.05} value={voiceDelay} onChange={e=>setVoiceDelay(parseFloat(e.target.value))} />
          </div>
        )}
        <div className="pt-2 flex justify-between items-center">
          <div className="text-xs text-neutral-400">Remixes: {remixes.length}</div>
          <button onClick={apply} className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-500">Apply</button>
        </div>
        {!!remixes.length && (
          <div className="space-y-2">
            {remixes.map(r => (
              <div key={r.id} className="border border-neutral-800 rounded p-2 text-xs">
                <div className="font-medium">{r.id}</div>
                <div className="overflow-x-auto">
                  <pre className="whitespace-pre-wrap break-all">{JSON.stringify(r.urls, null, 2)}</pre>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}


