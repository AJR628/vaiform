const API_BASE = (process.env.NEXT_PUBLIC_API_BASE || (import.meta as any).env?.VITE_API_BASE || '').replace(/\/?$/, '')

async function request<T>(path: string, init: RequestInit = {}): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const token = typeof window !== 'undefined' ? (localStorage.getItem('vaiform_token') || localStorage.getItem('vaiform:idToken') || '') : ''
    const headers = new Headers(init.headers || {})
    if (token) headers.set('Authorization', `Bearer ${token}`)
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    const res = await fetch(`${API_BASE}${path}`, { ...init, headers })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: json?.error || String(res.status) }
    const data = (json?.data ?? json) as T
    return { ok: true, data }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'NETWORK_ERROR' }
  }
}

export type CaptionMode = 'progress' | 'karaoke'
export type KenBurns = 'in' | 'out' | undefined
export type BackgroundKind = 'solid'|'imageUrl'|'stock'|'upload'|'ai'|'stockVideo'

export interface QuoteCandidate { id:string; text:string; author?:string|null; attributed?:boolean; isParaphrase?:boolean }
export interface ImageCandidate { id:string; kind:'stock'|'imageUrl'|'upload'|'ai'; url:string; kenBurns?:KenBurns }
export interface VideoCandidate { id:string; kind:'stockVideo'; url:string; duration?:number }

export interface QuoteTrack { mode:'quote'|'feeling'; input:string; candidates:QuoteCandidate[]; chosenId:string|null; iterationsLeft:number }
export interface ImageTrack { kind:Exclude<BackgroundKind,'solid'|'stockVideo'>; query?:string|null; imageUrl?:string|null; uploadUrl?:string|null; prompt?:string|null; kenBurns?:KenBurns|null; candidates:ImageCandidate[]; chosenId:string|null; iterationsLeft:number }
export interface VideoTrack { kind:'stockVideo'; query:string; candidates:VideoCandidate[]; chosenId:string|null; iterationsLeft:number }

export const studio = {
  start: (p: { template: 'calm'|'bold'|'cosmic'|'minimal'; durationSec: number; maxRefines?: number }) =>
    request<{ id:string }>(`/api/studio/start`, { method: 'POST', body: JSON.stringify(p) }),
  quote: (p: { studioId: string; mode: 'quote'|'feeling'; text: string; count?: number }) =>
    request<{ quote: QuoteTrack }>(`/api/studio/quote`, { method: 'POST', body: JSON.stringify(p) }),
  image: (p: { studioId: string; kind: 'stock'|'imageUrl'|'upload'|'ai'; query?: string; imageUrl?: string; uploadUrl?: string; prompt?: string; kenBurns?: 'in'|'out' }) =>
    request<{ image: ImageTrack }>(`/api/studio/image`, { method: 'POST', body: JSON.stringify(p) }),
  video: (p: { studioId: string; kind: 'stockVideo'; query: string }) =>
    request<{ video: VideoTrack }>(`/api/studio/video`, { method: 'POST', body: JSON.stringify(p) }),
  choose: (p: { studioId: string; track: 'quote'|'image'|'video'; candidateId: string }) =>
    request<{ ok: true }>(`/api/studio/choose`, { method: 'POST', body: JSON.stringify(p) }),
  finalize: (p: { studioId: string; voiceover?: boolean; wantAttribution?: boolean; captionMode?: CaptionMode; watermark?: boolean; keepVideoAudio?: boolean; bgAudioVolume?: number; duckDuringTTS?: boolean; duck?: { threshold?: number; ratio?: number; attack?: number; release?: number } }) =>
    request<{ jobId:string; videoUrl:string; coverImageUrl:string }>(`/api/studio/finalize`, { method: 'POST', body: JSON.stringify(p) }),
  get: (studioId: string) => request(`/api/studio/${studioId}`),
  list: () => request(`/api/studio/`),
  resume: (studioId: string) => request(`/api/studio/resume`, { method: 'POST', body: JSON.stringify({ studioId }) }),
  del: (studioId: string) => request(`/api/studio/delete`, { method: 'POST', body: JSON.stringify({ studioId }) }),
}

export const shorts = {
  get: (jobId: string) => request(`/api/shorts/${jobId}`),
}


