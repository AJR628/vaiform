import './globals.css'
import type { ReactNode } from 'react'

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="border-b border-neutral-800">
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
            <div className="font-semibold tracking-wide">Vaiform Studio</div>
            <DevTokenPanel />
          </div>
        </div>
        <main className="max-w-5xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  )
}

function DevTokenPanel() {
  'use client'
  const [open, setOpen] = useState(false)
  const { token, setToken } = useAuth()
  return (
    <div className="text-sm text-neutral-400">
      <button className="px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700" onClick={() => setOpen(!open)}>Dev Token</button>
      {open && (
        <div className="absolute right-4 top-12 w-[420px] bg-neutral-900 border border-neutral-800 rounded p-3 space-y-2 shadow-xl">
          <div className="text-xs">Paste Firebase ID token (dev only)</div>
          <textarea className="w-full h-28 bg-neutral-950 border border-neutral-800 rounded p-2 text-xs" value={token} onChange={e => setToken(e.target.value)} placeholder="eyJhbGciOi..." />
        </div>
      )}
    </div>
  )
}

import { useState, useEffect, useCallback, createContext, useContext } from 'react'

type AuthCtx = { token: string; setToken: (t: string) => void }
const AuthContext = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  'use client'
  const [token, setToken] = useState('')
  useEffect(() => {
    const t = localStorage.getItem('vaiform:idToken') || ''
    setToken(t)
  }, [])
  const set = useCallback((t: string) => {
    localStorage.setItem('vaiform:idToken', t)
    setToken(t)
  }, [])
  return <AuthContext.Provider value={{ token, setToken: set }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  'use client'
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}


