import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { TOKEN_KEY } from '../lib/auth'
import { api } from '../lib/api'

export function AppShell() {
  const nav = useNavigate()
  const loc = useLocation()
  const [drawer, setDrawer] = useState(false)
  const [token, setToken] = useState('')
  const [base, setBase] = useState((import.meta as any).env?.VITE_API_BASE || '')
  const [tts, setTts] = useState<{provider?:string,configured?:boolean}|null>(null)

  useEffect(() => {
    const tok = localStorage.getItem(TOKEN_KEY) || ''
    setToken(tok)
  }, [])

  async function checkTts(){
    const r = await api.diagTtsState()
    setTts((r.ok ? r.data : null) as any)
  }

  function save(){
    localStorage.setItem(TOKEN_KEY, token)
    setDrawer(false)
  }

  return (
    <div>
      <header className="border-b border-neutral-800">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/studio" className={`hover:underline ${loc.pathname.startsWith('/studio')?'text-white':'text-neutral-400'}`}>Studio</Link>
            {String((import.meta as any).env?.VITE_ENABLE_IMAGES_LAB) === 'true' && (
              <Link to="/images" className="text-neutral-400 hover:underline">Images</Link>
            )}
          </div>
          <button onClick={()=>setDrawer(!drawer)} className="text-sm px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700">⚙</button>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-6">
        <Outlet />
      </main>
      {drawer && (
        <div className="fixed right-4 top-14 w-[380px] bg-neutral-900 border border-neutral-800 rounded p-3 space-y-2 shadow-xl">
          <div className="text-sm">API Base (VITE_API_BASE or ?api=)</div>
          <input className="w-full bg-neutral-950 border border-neutral-800 rounded px-2 py-1 text-sm" value={base} onChange={e=>setBase(e.target.value)} readOnly />
          <div className="text-sm">Bearer token</div>
          <textarea className="w-full h-28 bg-neutral-950 border border-neutral-800 rounded p-2 text-xs" value={token} onChange={e=>setToken(e.target.value)} placeholder="eyJhbGciOi..." />
          <div className="flex items-center gap-2">
            <button onClick={save} className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500">Save</button>
            <button onClick={checkTts} className="px-3 py-1.5 rounded bg-neutral-800 hover:bg-neutral-700">Check TTS</button>
            {tts && (
              <span className={`text-xs px-2 py-0.5 rounded ${tts.configured? 'bg-green-700':'bg-neutral-700'}`}>{tts.provider}:{tts.configured? 'on':'off'}</span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}


