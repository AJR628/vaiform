import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api } from '../../lib/api'

export function ShortDetailsPage(){
  const { jobId } = useParams<{ jobId: string }>()
  const [state, setState] = useState<{loading:boolean; error?:string; data?:any}>({ loading:true })

  useEffect(() => {
    if (!jobId) { setState({ loading:false, error:"Missing jobId" }); return }
    ;(async () => {
      const res = await api.getShort(jobId)
      if (res.ok) setState({ loading:false, data: res.data })
      else setState({ loading:false, error: res.error })
    })()
  }, [jobId])

  if (state.loading) return <div className="p-6">Loading…</div>
  if (state.error)   return <div className="p-6 text-red-600">Error: {state.error}</div>

  const d = state.data!
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Short: {d.jobId}</h1>

      {d.videoUrl && (
        <video
          src={d.videoUrl}
          controls
          playsInline
          muted
          className="w-full max-w-md rounded-lg"
        />
      )}

      <div className="space-x-3">
        {d.videoUrl && <a className="underline" href={d.videoUrl} target="_blank" rel="noreferrer">Open video</a>}
        {d.coverImageUrl && <a className="underline" href={d.coverImageUrl} target="_blank" rel="noreferrer">Open cover</a>}
      </div>

      <pre className="bg-gray-100 p-3 rounded text-sm overflow-auto">
{JSON.stringify(d, null, 2)}
      </pre>

      <Link to="/studio" className="underline">← Back to Studio</Link>
    </div>
  )
}
export default ShortDetailsPage
