import { writeFile, mkdir, access, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { buildTtsPayload } from "../builders/tts.builder.js";
import { elevenLabsSynthesize, elevenLabsSynthesizeWithTimestamps } from "../adapters/elevenlabs.adapter.js";
import { normalizeVoiceSettings, logNormalizedSettings } from "../utils/voice.normalize.js";
import { withAbortTimeout } from '../utils/fetch.timeout.js';

const TTS_PROVIDER = (process.env.TTS_PROVIDER || "openai").toLowerCase();
const OPENAI_MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const OPENAI_VOICE = process.env.OPENAI_TTS_VOICE || "alloy";
const OPENAI_ORG   = process.env.OPENAI_ORG_ID || null;

// New in-memory cache + limiter and diag state
const ttsMem = new Map(); // key -> { buf, ts }
const TTL_MS = 15 * 60 * 1000; // 15 min
let quotaBlockedUntil = 0;
let ttsLock = Promise.resolve();
let lastTtsState = { status: null, code: null, when: null, cache: { hit: false, key: null } };
export function getLastTtsState() { return lastTtsState; }

function cacheKey({ provider, model, voice, text }) {
  return `${provider}|${model}|${voice}|${String(text || "").trim()}`;
}
async function withTtsSlot(fn) {
  const prev = ttsLock;
  let release;
  ttsLock = new Promise((res) => (release = res));
  try {
    await prev;
    return await fn();
  } finally {
    release();
  }
}
function pickHeaders(h) {
  try {
    const get = (k) => h.get(k);
    return {
      "retry-after": get("retry-after"),
      "x-request-id": get("x-request-id"),
      "x-ratelimit-limit": get("x-ratelimit-limit"),
      "x-ratelimit-remaining": get("x-ratelimit-remaining"),
    };
  } catch {
    return {};
  }
}

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
export async function synthVoice({ text, voiceId, modelId, outputFormat, voiceSettings }){
  try {
    const t = String(text || "").replace(/\s+/g, ' ').trim();
    try { console.log('[tts] input len/chars', t.length, 'words', t.split(/\s+/).length, 'sample', t.slice(0,200)); } catch {}
    if (t.length < 2) return { audioPath: null, durationMs: null };

    const provider = (process.env.TTS_PROVIDER || "openai").toLowerCase();
    const isOpenAI = provider === "openai" && !!process.env.OPENAI_API_KEY;
    const isEleven = provider === "elevenlabs" && !!process.env.ELEVENLABS_API_KEY && !!process.env.ELEVEN_VOICE_ID;
    if (!isOpenAI && !isEleven) {
      console.warn("[tts] provider not configured; silent fallback");
      return { audioPath: null, durationMs: null };
    }

    if (Date.now() < quotaBlockedUntil) {
      console.warn("[tts] quota cooldown active; skipping provider");
      return { audioPath: null, durationMs: null };
    }

    // SSOT: Use the same builder for both preview and render
    const payload = buildTtsPayload({ 
      text: t, 
      voiceId: voiceId || process.env.ELEVEN_VOICE_ID,
      modelId,
      outputFormat,
      voiceSettings
    });
    
    // SSOT: Normalize voice settings to ensure 0-1 range and snake_case keys
    const normalizedSettings = normalizeVoiceSettings(payload.voiceSettings);
    payload.voiceSettings = normalizedSettings;
    
    logNormalizedSettings('[tts.render]', voiceSettings, normalizedSettings);
    
    const key = cacheKey({ provider, model: payload.modelId, voice: payload.voiceId, text: t });

    // In-memory cache
    const hit = ttsMem.get(key);
    if (hit && (Date.now() - hit.ts) < TTL_MS) {
      lastTtsState = { status: 200, code: "cache_hit", when: new Date().toISOString(), cache: { hit: true, key } };
      const dir = await mkdtemp(join(tmpdir(), "vaiform-tts-"));
      const audioPath = join(dir, "cached.mp3");
      await writeFile(audioPath, hit.buf);
      return { audioPath, durationMs: null };
    }

    // Single-slot limiter and one polite retry
    return await withTtsSlot(async () => {
      try {
        const { buf } = await fetchWithRetry(async () => {
          if (isOpenAI) return await doOpenAI({ text: t, model: payload.modelId, voice: payload.voiceId });
          if (isEleven) {
            console.log(`[elevenlabs] Render synthesis: ${payload.text.substring(0, 50)}...`);
            return await doElevenSSOT(payload);
          }
          return { res: new Response(null, { status: 503 }), buf: Buffer.alloc(0), headers: new Headers() };
        }, key);

        ttsMem.set(key, { buf, ts: Date.now() });

        const dir = await mkdtemp(join(tmpdir(), "vaiform-tts-"));
        const audioPath = join(dir, "quote.mp3");
        await writeFile(audioPath, buf);
        // probe size + duration
        try {
          const { stat } = await import('node:fs/promises');
          const st = await stat(audioPath);
          const { getDurationMsFromMedia } = await import('../utils/media.duration.js');
          const ms = await getDurationMsFromMedia(audioPath);
          console.log('[elevenlabs] Render synthesis OK:', st?.size || 0, 'bytes, duration:', ms ? (ms/1000).toFixed(2) + 's' : 'unknown');
        } catch {}
        return { audioPath, durationMs: null };
      } catch (err) {
        console.warn("[tts] soft-fail:", err?.message || err);
        return { audioPath: null, durationMs: null };
      }
    });
  } catch (err) {
    console.warn("[tts] soft-fail:", err?.message || err);
    return { audioPath: null, durationMs: null };
  }
}

async function fetchWithRetry(doFetch, key) {
  let attempt = 0;
  while (attempt < 2) {
    attempt++;
    const { res, buf, headers } = await doFetch();
    const status = res?.status ?? 0;
    let code = null;
    try {
      if (status >= 400 && buf) {
        const body = JSON.parse(Buffer.from(buf).toString("utf8"));
        code = body?.error?.code || null;
      }
    } catch {}
    lastTtsState = { status, code, when: new Date().toISOString(), cache: { hit: false, key }, headers: pickHeaders(headers || new Headers()) };

    if (res && res.ok) return { buf };

    if (code === "insufficient_quota") {
      quotaBlockedUntil = Date.now() + 10 * 60 * 1000; // 10 min
      break;
    }
    if (status === 429) {
      const ra = (headers && headers.get) ? headers.get("retry-after") : null;
      const ms = ra ? Math.min((parseInt(ra, 10) || 1) * 1000, 2500) : (800 + Math.floor(Math.random() * 600));
      await new Promise((r) => setTimeout(r, ms));
      continue;
    }
    break;
  }
  throw new Error("TTS_FAILED");
}

async function doOpenAI({ text, model, voice }) {
  return await withAbortTimeout(async (signal) => {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        ...(OPENAI_ORG ? { "OpenAI-Organization": OPENAI_ORG } : {}),
      },
      body: JSON.stringify({ model, voice, input: text, format: "mp3" }),
      ...(signal ? { signal } : {}),
    });
    const ab = await res.arrayBuffer();
    return { res, buf: Buffer.from(ab), headers: res.headers };
  }, { timeoutMs: 30000, errorMessage: 'TTS_TIMEOUT' });
}

async function doEleven({ text, voiceId }) {
  const voice = voiceId || process.env.ELEVEN_VOICE_ID;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`;
  return await withAbortTimeout(async (signal) => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({ model_id: process.env.ELEVEN_TTS_MODEL || "eleven_flash_v2_5", text }),
      ...(signal ? { signal } : {}),
    });
    const ab = await res.arrayBuffer();
    return { res, buf: Buffer.from(ab), headers: res.headers };
  }, { timeoutMs: 30000, errorMessage: 'TTS_TIMEOUT' });
}

// SSOT: Use the same adapter for both preview and render
async function doElevenSSOT(payload) {
  const { contentType, buffer } = await elevenLabsSynthesize(payload);
  return { 
    res: new Response(buffer, { headers: { "Content-Type": contentType } }), 
    buf: buffer, 
    headers: new Headers({ "Content-Type": contentType })
  };
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

/**
 * Synthesize voice with word-level timestamps (ElevenLabs only)
 * Returns audio path, duration, and timestamp data for word highlighting
 */
export async function synthVoiceWithTimestamps({ text, voiceId, modelId, outputFormat, voiceSettings }) {
  try {
    const t = String(text || "").replace(/\s+/g, ' ').trim();
    if (t.length < 2) return { audioPath: null, durationMs: null, timestamps: null };

    const provider = (process.env.TTS_PROVIDER || "openai").toLowerCase();
    const isEleven = provider === "elevenlabs" && !!process.env.ELEVENLABS_API_KEY;
    
    if (!isEleven) {
      console.warn("[tts.timestamps] Only ElevenLabs supports timestamps; falling back to regular synthesis");
      const result = await synthVoice({ text, voiceId, modelId, outputFormat, voiceSettings });
      return { ...result, timestamps: null };
    }

    if (Date.now() < quotaBlockedUntil) {
      console.warn("[tts.timestamps] quota cooldown active; skipping");
      return { audioPath: null, durationMs: null, timestamps: null };
    }

    // Build payload with normalized settings
    const payload = buildTtsPayload({
      text: t,
      voiceId: voiceId || process.env.ELEVEN_VOICE_ID,
      modelId: modelId || process.env.ELEVEN_TTS_MODEL || "eleven_flash_v2_5",
      outputFormat: outputFormat || "mp3_44100_128",
      voiceSettings
    });

    const normalizedSettings = normalizeVoiceSettings(payload.voiceSettings);
    payload.voiceSettings = normalizedSettings;

    logNormalizedSettings('[tts.timestamps]', voiceSettings, normalizedSettings);

    // Generate with timestamps
    return await withTtsSlot(async () => {
      try {
        const { buffer, timestamps } = await elevenLabsSynthesizeWithTimestamps(payload);

        // Save audio to temp file
        const dir = await mkdtemp(join(tmpdir(), "vaiform-tts-"));
        const audioPath = join(dir, "quote.mp3");
        await writeFile(audioPath, buffer);

        // Get duration if possible
        let durationMs = null;
        try {
          const { getDurationMsFromMedia } = await import('../utils/media.duration.js');
          durationMs = await getDurationMsFromMedia(audioPath);
          console.log('[tts.timestamps] Synthesis OK:', buffer.length, 'bytes, duration:', durationMs ? (durationMs/1000).toFixed(2) + 's' : 'unknown');
        } catch (err) {
          console.warn('[tts.timestamps] Could not get duration:', err.message);
        }

        // Log timing summary for karaoke verification
        if (timestamps && (timestamps.words || timestamps.characters)) {
          const words = timestamps.words || [];
          const chars = timestamps.characters || [];
          
          // Log text and first few word timestamps
          console.log('[tts.timestamps] Text sent to ElevenLabs:', t.substring(0, 100) + (t.length > 100 ? '...' : ''));
          console.log('[tts.timestamps] durationMs:', durationMs);
          
          if (words.length > 0) {
            const firstFew = words.slice(0, Math.min(5, words.length));
            console.log('[tts.timestamps] First few word timestamps:', JSON.stringify(firstFew.map(w => ({
              word: w.word,
              start: w.start_time_ms,
              end: w.end_time_ms
            }))));
            
            // Compute timing summary
            const firstStart = words[0]?.start_time_ms || 0;
            const lastEnd = words[words.length - 1]?.end_time_ms || 0;
            const sumDurMs = words.reduce((sum, w) => {
              const start = w.start_time_ms || 0;
              const end = w.end_time_ms || (start + 200);
              return sum + (end - start);
            }, 0);
            
            console.log('[tts.timestamps] Timing summary:', {
              firstStart,
              lastEnd,
              sumDurMs,
              durationMs,
              wordCount: words.length
            });
          } else if (chars.length > 0) {
            const firstFew = chars.slice(0, Math.min(10, chars.length));
            console.log('[tts.timestamps] First few character timestamps:', JSON.stringify(firstFew.map(c => ({
              char: c.character,
              start: c.start_time_ms,
              end: c.end_time_ms
            }))));
          }
        }

        return { audioPath, durationMs, timestamps };
      } catch (err) {
        console.warn("[tts.timestamps] soft-fail:", err?.message || err);
        return { audioPath: null, durationMs: null, timestamps: null };
      }
    });
  } catch (err) {
    console.warn("[tts.timestamps] soft-fail:", err?.message || err);
    return { audioPath: null, durationMs: null, timestamps: null };
  }
}

export default { synthVoice, synthVoiceWithTimestamps };


