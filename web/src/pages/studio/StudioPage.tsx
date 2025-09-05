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
  async function finalize(){
    const r = await api.studioFinalize({ studioId, voiceover, wantAttribution, captionMode, watermark })
    if (r.ok) setResult(r.data)
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={voiceover} onChange={e=>setVoiceover(e.target.checked)} />Voiceover</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={wantAttribution} onChange={e=>setWantAttribution(e.target.checked)} />Attribution</label>
        <button onClick={finalize} className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-500">Render</button>
      </div>
      {result && (
        <div className="border border-neutral-800 rounded p-3 space-y-2">
          <video src={result.videoUrl} className="w-full max-w-md rounded" controls playsInline />
          {result.coverImageUrl && (<a className="text-blue-400 text-sm" href={result.coverImageUrl} target="_blank">Open cover.jpg</a>)}
        </div>
      )}
    </div>
  )
}


