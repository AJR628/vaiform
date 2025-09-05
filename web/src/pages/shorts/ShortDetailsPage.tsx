import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { shorts } from '../../lib/api'

export function ShortDetailsPage(){
  const { jobId } = useParams()
  const [data, setData] = useState<any>(null)
  const [err, setErr] = useState<string|null>(null)
  useEffect(()=>{
    if (!jobId) return
    shorts.get(jobId).then(r=>{
      if (r.ok) setData(r.data)
      else setErr(r.error||'ERR')
    })
  },[jobId])
  if (err) return <div className="text-sm text-red-400">{err}</div>
  if (!data) return <div className="text-sm">Loading…</div>
  const d = (data as any).data || data
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-semibold">Short {d.jobId}</h1>
      {d.videoUrl && (<video src={d.videoUrl} className="w-full max-w-md rounded" controls playsInline muted />)}
      {d.coverImageUrl && (<a className="text-blue-400 text-sm" href={d.coverImageUrl} target="_blank">Open cover.jpg</a>)}
      <pre className="text-xs bg-neutral-900 border border-neutral-800 rounded p-2 overflow-auto">{JSON.stringify(d,null,2)}</pre>
    </div>
  )
}


