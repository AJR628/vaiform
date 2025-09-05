import { useAuth } from '../app/layout'

const API_BASE = process.env.NEXT_PUBLIC_API_BASE as string

export async function api(path: string, init: RequestInit = {}) {
  const token = typeof window !== 'undefined' ? (localStorage.getItem('vaiform:idToken') || '') : ''
  const headers = new Headers(init.headers || {})
  headers.set('Authorization', `Bearer ${token}`)
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers })
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

export const studio = {
  start: (p: { template: 'calm'|'bold'|'cosmic'|'minimal'; durationSec: number; maxRefines?: number }) =>
    api('/api/studio/start', { method: 'POST', body: JSON.stringify(p) }),
  quote: (p: { studioId: string; mode: 'quote'|'feeling'; text: string; count?: number }) =>
    api('/api/studio/quote', { method: 'POST', body: JSON.stringify(p) }),
  choose: (p: { studioId: string; track: 'quote'|'image'; candidateId: string }) =>
    api('/api/studio/choose', { method: 'POST', body: JSON.stringify(p) }),
  image: (p: { studioId: string; kind: 'stock'|'imageUrl'|'upload'|'ai'; query?: string; imageUrl?: string; uploadUrl?: string; prompt?: string; kenBurns?: 'in'|'out' }) =>
    api('/api/studio/image', { method: 'POST', body: JSON.stringify(p) }),
  finalize: (p: { studioId: string; voiceover?: boolean; wantAttribution?: boolean; captionMode?: 'progress'|'karaoke'; watermark?: boolean }) =>
    api('/api/studio/finalize', { method: 'POST', body: JSON.stringify(p) }),
  get: (studioId: string) => api(`/api/studio/${studioId}`),
  list: () => api('/api/studio/'),
  resume: (studioId: string) => api('/api/studio/resume', { method: 'POST', body: JSON.stringify({ studioId }) }),
  del: (studioId: string) => api('/api/studio/delete', { method: 'POST', body: JSON.stringify({ studioId }) }),
}

export const shorts = {
  get: (jobId: string) => api(`/api/shorts/${jobId}`),
}


