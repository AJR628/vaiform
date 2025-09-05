'use client'
import { useEffect, useMemo, useState } from 'react'
import { studio, shorts } from '../../lib/api'

type QuoteCand = { id: string; text: string; author?: string|null; attributed?: boolean }
type ImageCand = { id: string; kind: string; url: string; kenBurns?: 'in'|'out' }

export default function StudioPage() {
  const [studioId, setStudioId] = useState<string>('')
  const [template, setTemplate] = useState<'calm'|'bold'|'cosmic'|'minimal'>('minimal')
  const [durationSec, setDurationSec] = useState<number>(8)
  const [step, setStep] = useState<number>(0)
  const [loading, setLoading] = useState(false)
  const [quote, setQuote] = useState<{ candidates: QuoteCand[]; chosenId?: string; iterationsLeft?: number }>({ candidates: [] })
  const [image, setImage] = useState<{ candidates: ImageCand[]; chosenId?: string; iterationsLeft?: number }>({ candidates: [] })
  const [result, setResult] = useState<{ jobId: string; videoUrl: string; coverImageUrl: string }|null>(null)

  useEffect(() => {
    const sid = sessionStorage.getItem('vaiform:studioId')
    if (sid) { setStudioId(sid); resume(sid).catch(()=>{}) }
  }, [])

  async function start() {
    setLoading(true)
    try {
      const r = await studio.start({ template, durationSec })
      const s = r.data || r
      setStudioId(s.id)
      sessionStorage.setItem('vaiform:studioId', s.id)
      setStep(1)
    } finally { setLoading(false) }
  }

  async function resume(id: string) {
    const r = await studio.get(id)
    const s = r.data || r
    setTemplate(s.render.template)
    setDurationSec(s.render.durationSec)
    setQuote({ candidates: s.quote.candidates || [], chosenId: s.quote.chosenId, iterationsLeft: s.quote.iterationsLeft })
    setImage({ candidates: s.image.candidates || [], chosenId: s.image.chosenId, iterationsLeft: s.image.iterationsLeft })
    setStep(s.quote.chosenId ? (s.image.chosenId ? 3 : 2) : 1)
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Studio</h1>
      {step === 0 && (
        <div className="space-y-3">
          <div className="flex gap-3">
            <select value={template} onChange={e=>setTemplate(e.target.value as any)} className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1">
              <option value="calm">calm</option>
              <option value="bold">bold</option>
              <option value="cosmic">cosmic</option>
              <option value="minimal">minimal</option>
            </select>
            <input type="number" min={6} max={10} value={durationSec} onChange={e=>setDurationSec(parseInt(e.target.value)||8)} className="w-24 bg-neutral-900 border border-neutral-800 rounded px-2 py-1" />
            <button disabled={loading} onClick={start} className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50">Start</button>
          </div>
        </div>
      )}
      {step === 1 && <QuoteStage studioId={studioId} template={template} onUpdate={(q)=>setQuote(q)} quote={quote} onNext={()=>setStep(2)} />}
      {step === 2 && <ImageStage studioId={studioId} onUpdate={(i)=>setImage(i)} image={image} onNext={()=>setStep(3)} />}
      {step === 3 && <RenderStage studioId={studioId} template={template} durationSec={durationSec} onDone={setResult} />}

      {result && (
        <div className="border border-neutral-800 rounded p-4 space-y-2">
          <div className="font-medium">Result</div>
          {result.coverImageUrl && (<img src={result.coverImageUrl} alt="cover" className="w-40 rounded" />)}
          <a className="text-blue-400" href={result.videoUrl} target="_blank">Open video</a>
        </div>
      )}
    </div>
  )
}

function QuoteStage({ studioId, template, quote, onUpdate, onNext }:{ studioId:string; template:string; quote:{candidates:QuoteCand[],chosenId?:string,iterationsLeft?:number}; onUpdate:(q:any)=>void; onNext:()=>void }){
  const [mode, setMode] = useState<'quote'|'feeling'>('feeling')
  const [text, setText] = useState('calm focus')
  const [loading, setLoading] = useState(false)
  async function gen(){
    setLoading(true)
    try{
      const r = await studio.quote({ studioId, mode, text, count:3 })
      onUpdate(r.data?.quote || r.quote)
    } finally { setLoading(false) }
  }
  async function choose(id:string){
    await studio.choose({ studioId, track:'quote', candidateId:id })
    onUpdate({ ...quote, chosenId:id })
    onNext()
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <select value={mode} onChange={e=>setMode(e.target.value as any)} className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1">
          <option value="quote">quote</option>
          <option value="feeling">feeling</option>
        </select>
        <input value={text} onChange={e=>setText(e.target.value)} className="flex-1 bg-neutral-900 border border-neutral-800 rounded px-2 py-1" />
        <button disabled={loading} onClick={gen} className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50">Generate</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {quote.candidates.map(c=> (
          <div key={c.id} className={`border rounded p-3 space-y-2 ${quote.chosenId===c.id?'border-blue-500':'border-neutral-800'}`}>
            <div className="text-sm">{c.text}</div>
            {c.author && (<div className="text-xs text-neutral-400">— {c.author}</div>)}
            <button onClick={()=>choose(c.id)} className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-500">Choose</button>
          </div>
        ))}
      </div>
      {typeof quote.iterationsLeft==='number' && (
        <div className="text-xs text-neutral-400">Iterations left: {quote.iterationsLeft}</div>
      )}
    </div>
  )
}

function ImageStage({ studioId, image, onUpdate, onNext }:{ studioId:string; image:{candidates:ImageCand[],chosenId?:string,iterationsLeft?:number}; onUpdate:(i:any)=>void; onNext:()=>void }){
  const [kind, setKind] = useState<'stock'|'imageUrl'|'upload'|'ai'>('stock')
  const [query, setQuery] = useState('calm')
  const [kenBurns, setKenBurns] = useState<'in'|'out'>('in')
  const [loading, setLoading] = useState(false)
  async function gen(){
    setLoading(true)
    try{
      const r = await studio.image({ studioId, kind, query, kenBurns })
      onUpdate(r.data?.image || r.image)
    } finally { setLoading(false) }
  }
  async function choose(id:string){
    await studio.choose({ studioId, track:'image', candidateId:id })
    onUpdate({ ...image, chosenId:id })
    onNext()
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <select value={kind} onChange={e=>setKind(e.target.value as any)} className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1">
          <option value="stock">stock</option>
          <option value="imageUrl">url</option>
          <option value="upload">upload</option>
          <option value="ai">ai</option>
        </select>
        <input value={query} onChange={e=>setQuery(e.target.value)} className="flex-1 bg-neutral-900 border border-neutral-800 rounded px-2 py-1" />
        <select value={kenBurns} onChange={e=>setKenBurns(e.target.value as any)} className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1">
          <option value="in">in</option>
          <option value="out">out</option>
        </select>
        <button disabled={loading} onClick={gen} className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50">Generate</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {image.candidates.map(c=> (
          <div key={c.id} className={`border rounded p-2 ${image.chosenId===c.id?'border-blue-500':'border-neutral-800'}`}>
            <img src={c.url} alt="candidate" className="w-full h-40 object-cover rounded" />
            <div className="p-2 flex items-center justify-between text-xs text-neutral-400">
              <span>{c.kind}</span>
              <button onClick={()=>choose(c.id)} className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-500">Choose</button>
            </div>
          </div>
        ))}
      </div>
      {typeof image.iterationsLeft==='number' && (
        <div className="text-xs text-neutral-400">Iterations left: {image.iterationsLeft}</div>
      )}
    </div>
  )
}

function RenderStage({ studioId, template, durationSec, onDone }:{ studioId:string; template:string; durationSec:number; onDone:(r:any)=>void }){
  const [voiceover, setVoiceover] = useState(true)
  const [wantAttribution, setWantAttribution] = useState(true)
  const [captionMode, setCaptionMode] = useState<'progress'|'karaoke'>('progress')
  const [watermark, setWatermark] = useState(true)
  const [loading, setLoading] = useState(false)
  async function finalize(){
    setLoading(true)
    try{
      const r = await studio.finalize({ studioId, voiceover, wantAttribution, captionMode, watermark })
      onDone(r.data)
    } finally { setLoading(false) }
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-3 items-center">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={voiceover} onChange={e=>setVoiceover(e.target.checked)} />Voiceover</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={wantAttribution} onChange={e=>setWantAttribution(e.target.checked)} />Attribution</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={watermark} onChange={e=>setWatermark(e.target.checked)} />Watermark</label>
        <select value={captionMode} onChange={e=>setCaptionMode(e.target.value as any)} className="bg-neutral-900 border border-neutral-800 rounded px-2 py-1">
          <option value="progress">progress</option>
          <option value="karaoke">karaoke</option>
        </select>
        <button disabled={loading} onClick={finalize} className="px-3 py-1.5 rounded bg-green-600 hover:bg-green-500 disabled:opacity-50">Finalize</button>
      </div>
    </div>
  )
}


