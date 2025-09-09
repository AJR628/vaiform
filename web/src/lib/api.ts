import { getToken } from "./auth";

export type CaptionMode = "progress" | "karaoke";
export type KenBurns = "in" | "out" | undefined;
export type BackgroundKind = "solid"|"imageUrl"|"stock"|"upload"|"ai"|"stockVideo";

export interface QuoteCandidate { id:string; text:string; author?:string|null; attributed?:boolean; isParaphrase?:boolean; }
export interface ImageCandidate { id:string; kind:"stock"|"imageUrl"|"upload"|"ai"; url:string; kenBurns?:KenBurns; }
export interface VideoCandidate { id:string; kind:"stockVideo"; url:string; duration?:number; }

export interface QuoteTrack { mode:"quote"|"feeling"; input:string; candidates:QuoteCandidate[]; chosenId:string|null; iterationsLeft:number; }
export interface ImageTrack { kind:Exclude<BackgroundKind,"solid"|"stockVideo">; query?:string|null; imageUrl?:string|null; uploadUrl?:string|null; prompt?:string|null; kenBurns?:KenBurns|null; candidates:ImageCandidate[]; chosenId:string|null; iterationsLeft:number; }
export interface VideoTrack { kind:"stockVideo"; query:string; candidates:VideoCandidate[]; chosenId:string|null; iterationsLeft:number; }

export interface StudioState {
  id:string; status:"draft"|"done";
  constraints:{ maxRefines:number };
  quote:QuoteTrack; image:ImageTrack; video?:VideoTrack;
  render:{ template:"calm"|"bold"|"cosmic"|"minimal"; durationSec:number; createdAt:string; updatedAt:string; };
  expiresAt:string;
}

function withSlash(u: string) {
  return u.endsWith("/") ? u : u + "/";
}
function baseUrl(): string {
  const env = (import.meta as any).env?.VITE_API_BASE ?? "";
  const qp = new URLSearchParams(location.search).get("api");
  const raw = qp || env || "/";
  return withSlash(raw);
}

async function req<T>(path: string, init?: RequestInit): Promise<{ok:true,data:T}|{ok:false,error:string}> {
  const token = getToken();
  const headers: Record<string,string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  // Attach studio header if present in body
  try {
    const bodyObj = init?.body ? JSON.parse(String(init.body)) : null;
    const sid = bodyObj?.studioId || new URLSearchParams(location.search).get('studioId');
    if (sid) headers['x-studio-id'] = String(sid);
  } catch {}
  try {
    const r = await fetch(baseUrl() + path.replace(/^\//,""), { ...init, headers: { ...headers, ...(init?.headers||{}) }});
    const text = await r.text();
    const json = text ? JSON.parse(text) : {};
    if (!r.ok || (json?.success === false)) {
      const err = json?.error || `HTTP_${r.status}`;
      return { ok:false, error: String(err) };
    }
    const data = json?.data ?? json;
    return { ok:true, data };
  } catch (e:any) {
    return { ok:false, error: e?.message || "NETWORK_ERROR" };
  }
}

export const api = {
  studioRemix: (p:{ parentRenderId:string; renderSpec:any; formats?:Array<"9x16"|"1x1"|"16x9">; wantImage?:boolean; wantAudio?:boolean }) =>
    req<any>("/api/studio/remix", { method:"POST", body: JSON.stringify(p) }),

  listRemixes: (renderId:string) =>
    req<any>(`/api/studio/${encodeURIComponent(renderId)}/remixes`),
  startStudio: (p:{template:"calm"|"bold"|"cosmic"|"minimal"; durationSec:number; maxRefines:number}) =>
    req<{id:string}>("/api/studio/start", { method:"POST", body: JSON.stringify(p) }),

  studioQuote: (p:{studioId:string; mode:"feeling"|"quote"; text:string; count:number}) =>
    req<{quote:QuoteTrack}>("/api/studio/quote", { method:"POST", body: JSON.stringify(p) }),

  studioImage: (p:{studioId:string; kind:"stock"|"imageUrl"|"upload"|"ai"; query?:string; imageUrl?:string; uploadUrl?:string; kenBurns?:KenBurns}) =>
    req<{image:ImageTrack}>("/api/studio/image", { method:"POST", body: JSON.stringify(p) }),

  studioVideo: (p:{studioId:string; kind:"stockVideo"; query:string}) =>
    req<{video:VideoTrack}>("/api/studio/video", { method:"POST", body: JSON.stringify(p) }),

  studioChoose: (p:{studioId:string; track:"quote"|"image"|"video"; candidateId:string}) =>
    req<{ok:true}>("/api/studio/choose", { method:"POST", body: JSON.stringify(p) }),

  studioFinalize: (p:{
    studioId:string; voiceover?:boolean; wantAttribution?:boolean; captionMode?:CaptionMode;
    renderSpec?: any;
    formats?: Array<"9x16"|"1x1"|"16x9">;
    wantImage?: boolean;
    wantAudio?: boolean;
  }) => req<any>("/api/studio/finalize", { method:"POST", body: JSON.stringify(p) }),

  getShort: (jobId:string) =>
    req<any>(`/api/shorts/${encodeURIComponent(jobId)}`),

  diagTtsState: () =>
    req<any>("/diag/tts_state"),
};
