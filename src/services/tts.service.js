import { writeFile, mkdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const TTS_PROVIDER = (process.env.TTS_PROVIDER || "openai").toLowerCase();
const OPENAI_MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const OPENAI_VOICE = process.env.OPENAI_TTS_VOICE || "alloy";
const OPENAI_ORG   = process.env.OPENAI_ORG_ID || null;

// Tunables
const MAX_TRIES   = Number(process.env.TTS_MAX_TRIES || 3);
const BASE_DELAY  = Number(process.env.TTS_BASE_DELAY_MS || 500);
const MIN_GAP_MS  = Number(process.env.TTS_RATE_LIMIT_MIN_GAP_MS || 500);
const COOLDOWN_MS = Number(process.env.TTS_COOLDOWN_MS || 60_000);
const CACHE_TTL   = Number(process.env.TTS_CACHE_TTL_MS || 10 * 60_000);

// Cache and inflight
const mem = new Map(); // key -> { path, at }
const inflight = new Map(); // key -> Promise<{audioPath,durationMs}>
const diskDir = join(tmpdir(), "vaiform-tts-cache");

// Throttle and cooldown state
let lastCallAt = 0;
let last429At  = 0;

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
function keyFor(opts){
  const { provider, model, voice, text } = opts;
  const norm = String(text || "").trim().toLowerCase();
  return createHash("sha1").update(`${provider}|${model}|${voice}|${norm}`).digest("hex");
}

async function rateLimit(){
  const now = Date.now();
  const wait = Math.max(0, lastCallAt + MIN_GAP_MS - now);
  if (wait) await sleep(wait);
  lastCallAt = Date.now();
}

function fromMem(k){
  const v = mem.get(k);
  if (!v) return null;
  if ((Date.now() - v.at) > CACHE_TTL) { mem.delete(k); return null; }
  return v.path;
}

async function fromDisk(k){
  try {
    const p = join(diskDir, `${k}.mp3`);
    await access(p);
    return p;
  } catch { return null; }
}

async function toDisk(k, buf){
  await mkdir(diskDir, { recursive: true });
  const p = join(diskDir, `${k}.mp3`);
  await writeFile(p, buf);
  return p;
}

async function withRetry(fetchFn, { tries = MAX_TRIES, baseDelay = BASE_DELAY } = {}){
  let res;
  for (let i = 0; i < tries; i++){
    res = await fetchFn();
    if (res && res.ok) return res;
    if (res && (res.status === 429 || res.status >= 500)){
      const ra = Number(res.headers.get("retry-after") || 0);
      const wait = ra ? ra * 1000 : baseDelay * Math.pow(2, i) + Math.floor(Math.random()*150);
      if (res.status === 429) last429At = Date.now();
      await sleep(wait);
      continue;
    }
    break;
  }
  return res;
}

// Always resolves; never throws
export async function synthVoice({ text }){
  try {
    const t = String(text || "").trim();
    if (t.length < 2) return { audioPath: null, durationMs: null };

    const provider = TTS_PROVIDER;
    const useOpenAI = provider === "openai" && !!process.env.OPENAI_API_KEY;
    const useEleven = provider === "elevenlabs" && !!process.env.ELEVENLABS_API_KEY && !!process.env.ELEVEN_VOICE_ID;

    if (!useOpenAI && !useEleven){
      console.warn("[tts] provider not configured; silent fallback");
      return { audioPath: null, durationMs: null };
    }

    if (Date.now() - last429At < COOLDOWN_MS){
      console.warn("[tts] cooldown active (recent 429); silent fallback");
      return { audioPath: null, durationMs: null };
    }

    const model = useOpenAI ? OPENAI_MODEL : (process.env.ELEVEN_TTS_MODEL || "eleven_flash_v2_5");
    const voice = useOpenAI ? OPENAI_VOICE : (process.env.ELEVEN_VOICE_ID);
    const k = keyFor({ provider, model, voice, text: t });

    const memHit = fromMem(k);
    if (memHit) return { audioPath: memHit, durationMs: null };
    const diskHit = await fromDisk(k);
    if (diskHit) { mem.set(k, { path: diskHit, at: Date.now() }); return { audioPath: diskHit, durationMs: null }; }

    if (inflight.has(k)) return inflight.get(k);

    const p = (async () => {
      await rateLimit();
      if (useOpenAI) return await synthOpenAI({ text: t, k });
      if (useEleven) return await synthEleven({ text: t, k });
      return { audioPath: null, durationMs: null };
    })();

    inflight.set(k, p);
    const out = await p.catch(err => {
      console.warn("[tts] soft-fail:", err?.message || err);
      return { audioPath: null, durationMs: null };
    });
    inflight.delete(k);

    if (out?.audioPath) mem.set(k, { path: out.audioPath, at: Date.now() });
    return out;
  } catch (err){
    console.warn("[tts] soft-fail:", err?.message || err);
    return { audioPath: null, durationMs: null };
  }
}

async function synthOpenAI({ text, k }){
  const apiKey = process.env.OPENAI_API_KEY;

  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), Number(process.env.TTS_FETCH_TIMEOUT_MS || 20_000));

  const res = await withRetry(() => fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(OPENAI_ORG ? { "OpenAI-Organization": OPENAI_ORG } : {})
    },
    body: JSON.stringify({ model: OPENAI_MODEL, voice: OPENAI_VOICE, input: text, format: "mp3" }),
    signal: controller.signal
  }));

  clearTimeout(to);

  if (!res || !res.ok) throw new Error(`OPENAI_TTS_${res?.status || "FETCH_FAIL"}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const diskPath = await toDisk(k, buf);
  return { audioPath: diskPath, durationMs: null };
}

async function synthEleven({ text, k }){
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVEN_VOICE_ID;
  const modelId = process.env.ELEVEN_TTS_MODEL || "eleven_flash_v2_5";

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?optimize_streaming_latency=0&output_format=mp3_44100_128`;

  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), Number(process.env.TTS_FETCH_TIMEOUT_MS || 20_000));

  const res = await withRetry(() => fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      "Accept": "audio/mpeg"
    },
    body: JSON.stringify({
      model_id: modelId,
      text,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 }
    }),
    signal: controller.signal
  }));

  clearTimeout(to);

  if (!res || !res.ok) throw new Error(`ELEVEN_TTS_${res?.status || "FETCH_FAIL"}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const diskPath = await toDisk(k, buf);
  return { audioPath: diskPath, durationMs: null };
}

export default { synthVoice };


