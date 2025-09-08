import crypto from "node:crypto";
import { loadJSON, saveJSON } from "../utils/json.store.js";
import admin from "../config/firebase.js";
import { getQuote } from "./quote.engine.js";
import { resolveStockImage } from "./stock.image.provider.js";
import { createShortService } from "./shorts.service.js";
import { llmQuotesByFeeling } from "./llmQuotes.service.js";
import { curatedByFeeling } from "./quotes.curated.js";
import { searchStockVideosPortrait, searchStockImagesPortrait } from "./pexels.service.js";
import { fetchVideoToTmp } from "../utils/video.fetch.js";
import { fetchImageToTmp } from "../utils/image.fetch.js";
import { uploadPublic } from "../utils/storage.js";
import { synthVoice } from "./tts.service.js";
import { renderAllFormats } from "../utils/ffmpeg.video.js";
import { runFFmpeg } from "../utils/ffmpeg.js";
import { exportSocialImage } from "../utils/ffmpeg.video.js";
import OpenAI from "openai";

function norm(s) {
  return (s || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function hydrateSets(session) {
  const s = session;
  if (!s.seen) s.seen = { quoteTexts: new Set(), videoIds: new Set(), imageIds: new Set() };
  const qt = s.seen.quoteTexts;
  const vi = s.seen.videoIds;
  const ii = s.seen.imageIds;
  if (!(qt instanceof Set)) s.seen.quoteTexts = new Set(Array.isArray(qt) ? qt : []);
  if (!(vi instanceof Set)) s.seen.videoIds = new Set(Array.isArray(vi) ? vi : []);
  if (!(ii instanceof Set)) s.seen.imageIds = new Set(Array.isArray(ii) ? ii : []);

  if (!s.pexels) s.pexels = { lastVideoQuery: null, videoPage: 1, lastImageQuery: null, imagePage: 1 };
  if (typeof s.pexels.videoPage !== "number") s.pexels.videoPage = 1;
  if (typeof s.pexels.imagePage !== "number") s.pexels.imagePage = 1;
  if (!("lastVideoQuery" in s.pexels)) s.pexels.lastVideoQuery = null;
  if (!("lastImageQuery" in s.pexels)) s.pexels.lastImageQuery = null;
  return s;
}

function dehydrateSets(session) {
  const s = session;
  const out = { ...s };
  const seen = s.seen || { quoteTexts: new Set(), videoIds: new Set(), imageIds: new Set() };
  out.seen = {
    quoteTexts: Array.from(seen.quoteTexts || []),
    videoIds: Array.from(seen.videoIds || []),
    imageIds: Array.from(seen.imageIds || []),
  };
  out.pexels = s.pexels || { lastVideoQuery: null, videoPage: 1, lastImageQuery: null, imagePage: 1 };
  return out;
}

async function saveSession({ uid, studioId, data }) {
  const dehydrated = dehydrateSets(data);
  await saveJSON({ uid, studioId, data: dehydrated });
}

function ensureSessionDefaults(s) {
  if (!s.constraints) s.constraints = { maxRefines: 5 };
  if (!s.quote) s.quote = { mode: "quote", input: "", candidates: [], chosenId: null, iterationsLeft: s.constraints.maxRefines };
  if (!s.image) s.image = { kind: "stock", query: null, uploadUrl: null, prompt: null, kenBurns: null, candidates: [], chosenId: null, iterationsLeft: s.constraints.maxRefines };
  if (!s.video) s.video = { kind: "stockVideo", query: null, candidates: [], chosenId: null, iterationsLeft: s.constraints.maxRefines };
  if (!s.render) s.render = { template: "minimal", durationSec: 8, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  hydrateSets(s);
  if (!s.pexels) s.pexels = { lastVideoQuery: null, videoPage: 1, lastImageQuery: null, imagePage: 1 };
  const ttlHours = Number(process.env.STUDIO_TTL_HOURS || 48);
  if (!s.render.createdAt) s.render.createdAt = new Date().toISOString();
  if (!s.expiresAt) {
    const created = Date.parse(s.render.createdAt || new Date().toISOString());
    s.expiresAt = new Date(created + ttlHours * 3600 * 1000).toISOString();
  }
  return s;
}

export async function startStudio({ uid, template, durationSec, maxRefines = 5, debugExpire = false }) {
  const id = `std-${crypto.randomUUID()}`;
  const nowIso = new Date().toISOString();
  const ttlMs = (Number(process.env.STUDIO_TTL_HOURS || 48)) * 3600 * 1000;
  const session = ensureSessionDefaults({
    id,
    uid,
    status: "draft",
    constraints: { maxRefines },
    quote: { mode: "quote", input: "", candidates: [], chosenId: null, iterationsLeft: maxRefines },
    image: { kind: "stock", query: null, uploadUrl: null, prompt: null, kenBurns: null, candidates: [], chosenId: null, iterationsLeft: maxRefines },
    render: { template, durationSec, createdAt: nowIso, updatedAt: nowIso },
  });
  // override TTL for debug if requested
  if (debugExpire) session.expiresAt = new Date(Date.now() + 10 * 1000).toISOString();
  else session.expiresAt = new Date(Date.now() + ttlMs).toISOString();
  await saveSession({ uid, studioId: id, data: session });
  return session;
}

export async function getStudio({ uid, studioId }) {
  const s = await loadJSON({ uid, studioId });
  if (!s) return null;
  const session = ensureSessionDefaults(s);
  if (session.deletedAt) return null;
  if (session.expiresAt && Date.now() > Date.parse(session.expiresAt)) return null;
  return session;
}

export async function generateQuoteCandidates({ uid, studioId, mode, text, template, count = 3 }) {
  const s = await getStudio({ uid, studioId });
  if (!s) throw new Error("STUDIO_NOT_FOUND");
  s.quote.mode = mode;
  s.quote.input = text;
  const n = Math.max(1, Math.min(5, count));
  hydrateSets(s);

  if (mode === "quote") {
    // Exact quote, optional author after dash
    const authorMatch = (text || "").match(/\s+[-–—]\s*(.+)$/);
    const author = authorMatch ? authorMatch[1].trim() : null;
    const main = authorMatch ? String(text || "").replace(authorMatch[0], "").trim() : String(text || "").trim();
    const cand = { id: `q-${crypto.randomUUID()}`, text: main, author: author || null, attributed: !!author, isParaphrase: false };
    s.seen.quoteTexts.add(norm(cand.text));
    s.quote.candidates = [cand];
  } else {
    // Feeling → LLM first, curated fallback, dedupe by text within session
    let fresh = [];
    try {
      fresh = await llmQuotesByFeeling({ feeling: text, count: n });
    } catch {}

    const seen = s.seen.quoteTexts;
    const uniq = (fresh || []).filter((q) => q.text && !seen.has(norm(q.text)));
    if (uniq.length < n) {
      const need = n - uniq.length;
      const fallback = curatedByFeeling(text, need, seen);
      uniq.push(...fallback);
    }
    uniq.forEach((q) => seen.add(norm(q.text)));
    s.quote.candidates = uniq.map((q) => ({
      id: q.id || `q-${crypto.randomUUID()}`,
      text: q.text,
      author: q.author || null,
      attributed: q.attributed === true,
      isParaphrase: !!q.isParaphrase,
    }));
  }
  if (s.quote.iterationsLeft > 0) s.quote.iterationsLeft -= 1;
  s.render.updatedAt = new Date().toISOString();
  await saveSession({ uid, studioId, data: s });
  return s.quote;
}

const SYNONYMS = {
  calm: ["ocean", "sky"],
  courage: ["mountain", "forest"],
  focus: ["night", "city"],
};

export async function generateImageCandidates({ uid, studioId, kind, query, uploadUrl, prompt, kenBurns, count = 3 }) {
  const s = await getStudio({ uid, studioId });
  if (!s) throw new Error("STUDIO_NOT_FOUND");
  s.image.kind = kind;
  s.image.query = query || null;
  s.image.uploadUrl = uploadUrl || null;
  s.image.prompt = prompt || null;
  s.image.kenBurns = kenBurns || null;

  // Stock images with paging + session dedupe
  if (kind === "stock") {
    hydrateSets(s);
    if (!s.pexels) s.pexels = { lastImageQuery: null, imagePage: 1 };

    if (s.pexels.lastImageQuery !== (query || "")) {
      s.pexels.lastImageQuery = query || "";
      s.pexels.imagePage = 1;
      s.seen.imageIds = new Set();
    }

    const seen = s.seen.imageIds;
    let page = s.pexels.imagePage;
    const out = [];
    for (let hops = 0; hops < 3 && out.length < 24 && page; hops++) {
      try {
        const { list, nextPage } = await searchStockImagesPortrait({ query: query || "", page, perPage: 30 });
        const fresh = (list || []).filter((i) => !seen.has(i.id));
        fresh.forEach((i) => seen.add(i.id));
        out.push(...fresh);
        page = nextPage;
      } catch {
        break;
      }
    }
    if (page) s.pexels.imagePage = page;

    s.image.candidates = out.map((i) => ({ id: i.id, kind: "stock", url: i.url, kenBurns: kenBurns || null }));
  } else {
    // Other kinds: keep existing behavior
    const candidates = [];
    try {
      if (kind === "imageUrl" && query) {
        candidates.push({ id: `img-${crypto.randomUUID()}`, kind: "imageUrl", url: query, kenBurns: kenBurns || null });
      } else if (kind === "upload" && uploadUrl) {
        candidates.push({ id: `img-${crypto.randomUUID()}`, kind: "upload", url: uploadUrl, kenBurns: kenBurns || null });
      } else if (kind === "ai" && (prompt || query)) {
        const q = prompt || query;
        const url = await resolveStockImage({ query: q });
        candidates.push({ id: `img-${crypto.randomUUID()}`, kind: "ai", url, kenBurns: kenBurns || null });
      }
    } catch {}
    s.image.candidates = candidates.slice(0, Math.max(1, Math.min(3, count)));
  }
  if (s.image.iterationsLeft > 0) s.image.iterationsLeft -= 1;
  s.render.updatedAt = new Date().toISOString();
  await saveSession({ uid, studioId, data: s });
  return s.image;
}

export async function generateVideoCandidates({ uid, studioId, kind = "stockVideo", query, count = 3, targetDur = 8 }) {
  const s = await getStudio({ uid, studioId });
  if (!s) throw new Error("STUDIO_NOT_FOUND");
  s.video.kind = kind;
  s.video.query = query || null;
  hydrateSets(s);
  s.pexels = s.pexels || { lastVideoQuery: null, videoPage: 1 };
  if (s.pexels.lastVideoQuery !== (query || "")) {
    s.pexels.lastVideoQuery = query || "";
    s.pexels.videoPage = 1;
    s.seen.videoIds = new Set();
  }

  const seen = s.seen.videoIds;
  let page = s.pexels.videoPage;
  const out = [];
  for (let hops = 0; hops < 3 && out.length < 12 && page; hops++) {
    try {
      const { list, nextPage } = await searchStockVideosPortrait({ query: query || "", page, perPage: 24 });
      const fresh = (list || []).filter((v) => !seen.has(v.id));
      fresh.forEach((v) => seen.add(v.id));
      out.push(...fresh);
      page = nextPage;
    } catch {
      break;
    }
  }
  if (page) s.pexels.videoPage = page;

  s.video.candidates = out.map((v) => ({ id: v.id, kind: "stockVideo", url: v.url, duration: v.duration }));
  if (s.video.iterationsLeft > 0) s.video.iterationsLeft -= 1;
  s.render.updatedAt = new Date().toISOString();
  await saveSession({ uid, studioId, data: s });
  return s.video;
}

export async function chooseCandidate({ uid, studioId, track, candidateId }) {
  const s = await getStudio({ uid, studioId });
  if (!s) throw new Error("STUDIO_NOT_FOUND");
  if (track === "quote") {
    s.quote.chosenId = candidateId;
    const chosen = (s.quote.candidates || []).find((c) => c.id === candidateId) || null;
    if (chosen) s.quote.chosen = chosen;
  }
  if (track === "image") s.image.chosenId = candidateId;
  if (track === "video") s.video.chosenId = candidateId;
  s.render.updatedAt = new Date().toISOString();
  await saveSession({ uid, studioId, data: s });
  return { ok: true };
}

export async function finalizeStudio({ uid, studioId, voiceover = false, wantAttribution = true, captionMode = "progress" }) {
  const s = await getStudio({ uid, studioId });
  if (!s) throw new Error("STUDIO_NOT_FOUND");
  const q = (s.quote.candidates || []).find((c) => c.id === s.quote.chosenId) || null;
  const vid = (s.video?.candidates || []).find((c) => c.id === s.video?.chosenId) || null;
  const img = (s.image.candidates || []).find((c) => c.id === s.image.chosenId) || null;
  if (!q) throw new Error("QUOTE_NOT_CHOSEN");
  if (!vid && !img) throw new Error("NEED_IMAGE_OR_VIDEO");

  let background;
  if (vid) {
    background = { kind: "stockVideo", query: s.video?.query || undefined, sourceUrl: vid.url };
  } else if (img) {
    background = img.kind === "upload"
      ? { kind: "upload", uploadUrl: img.url, kenBurns: img.kenBurns || undefined }
      : (img.kind === "imageUrl"
          ? { kind: "imageUrl", imageUrl: img.url, kenBurns: img.kenBurns || undefined }
          : { kind: "stock", query: s.image?.query || "", kenBurns: s.image?.kenBurns || undefined });
  }

  const chosenQuote = s.quote?.chosen || q;
  let usedQuote = null;
  if (chosenQuote) {
    usedQuote = {
      text: chosenQuote.text,
      author: chosenQuote.author ?? null,
      attributed: !!chosenQuote.attributed,
      isParaphrase: !!chosenQuote.isParaphrase,
    };
  }
  const modeForCredits = s.quote?.mode || "quote";

  const result = await createShortService({
    ownerUid: uid,
    mode: modeForCredits,
    text: usedQuote ? usedQuote.text : q.text,
    template: s.render.template,
    durationSec: s.render.durationSec,
    voiceover,
    wantAttribution,
    background,
    captionMode,
    overrideQuote: usedQuote || undefined,
  });

  s.status = "finalized";
  s.finalize = { jobId: result.jobId, videoUrl: result.videoUrl, coverImageUrl: result.coverImageUrl };
  s.render.updatedAt = new Date().toISOString();
  await saveSession({ uid, studioId, data: s });

  return { jobId: result.jobId, videoUrl: result.videoUrl, coverImageUrl: result.coverImageUrl };
}

/**
 * New multi-format finalize that accepts optional renderSpec overrides and produces
 * 9x16, 1x1, 16x9 videos + poster + mp3. Returns artifact URLs.
 */
export async function finalizeStudioMulti({ uid, studioId, renderSpec = {}, formats = ["9x16","1x1","16x9"], wantImage = true, wantAudio = true, voiceover = false, wantAttribution = true, parentRenderId = null, onProgress = null }) {
  if (!uid) throw new Error("MISSING_UID");
  // Load studio for background + quote if provided
  const s = studioId ? (await getStudio({ uid, studioId })) : null;
  if (studioId && !s) throw new Error("STUDIO_NOT_FOUND");
  const progress = (evt, data={}) => { try { onProgress && onProgress({ event: evt, ts: Date.now(), ...data }); } catch {} };

  // Resolve quote
  const chosenQ = s?.quote?.candidates?.find?.((c) => c.id === s?.quote?.chosenId) || null;
  const usedText = renderSpec?.text || chosenQ?.text || s?.render?.text || null;
  if (!usedText) throw new Error("QUOTE_TEXT_REQUIRED");
  const authorLine = (wantAttribution && (renderSpec?.authorLine || (chosenQ?.attributed && chosenQ?.author ? `— ${chosenQ.author}` : null))) || null;
  progress('quote_ready', { haveAuthor: !!authorLine });

  // Resolve background (prefer video; else image)
  let videoTmp = null;
  let imageTmp = null;
  let haveBgAudio = true;
  if (s?.video?.chosenId) {
    const v = (s.video.candidates || []).find((c) => c.id === s.video.chosenId) || null;
    if (!v) throw new Error("VIDEO_NOT_CHOSEN");
    videoTmp = await fetchVideoToTmp(v.url);
    progress('background_video_fetched');
    // Probe if background has audio
    haveBgAudio = true;
    try {
      await runFFmpeg(["-i", videoTmp.path, "-map", "0:a:0", "-t", "0.1", "-f", "null", "-"]);
      haveBgAudio = true;
    } catch (probeErr) {
      const msg = (probeErr?.stderr || probeErr?.message || "").toString();
      if (/Stream specifier matches no streams|Stream map '.+0:a:0'/.test(msg) || /Audio:/.test(msg) === false) {
        haveBgAudio = false;
      }
    }
  } else if (s?.image?.chosenId) {
    const i = (s.image.candidates || []).find((c) => c.id === s.image.chosenId) || null;
    if (!i) throw new Error("IMAGE_NOT_CHOSEN");
    imageTmp = await fetchImageToTmp(i.url);
    progress('background_image_fetched');
  } else {
    throw new Error("NEED_IMAGE_OR_VIDEO");
  }

  // Optional voiceover TTS
  let ttsPath = null;
  if (voiceover && wantAudio) {
    try {
      const { audioPath } = await synthVoice({ text: usedText });
      ttsPath = audioPath || null;
      progress('tts_ready', { haveTts: !!ttsPath });
    } catch {
      ttsPath = null;
    }
  }

  const jobId = (renderSpec?.id) || `render-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;

  // Call renderer
  progress('render_start');
  const rr = await renderAllFormats({
    id: jobId,
    videoPath: videoTmp?.path || null,
    imagePath: imageTmp?.path || null,
    text: usedText,
    authorLine,
    // style overrides
    fontfile: renderSpec?.style?.fontfile,
    fontcolor: renderSpec?.style?.fontcolor,
    fontsize: renderSpec?.style?.fontsize,
    lineSpacing: renderSpec?.style?.lineSpacing,
    shadowColor: renderSpec?.style?.shadowColor,
    shadowX: renderSpec?.style?.shadowX,
    shadowY: renderSpec?.style?.shadowY,
    box: renderSpec?.style?.box,
    boxcolor: renderSpec?.style?.boxcolor,
    boxborderw: renderSpec?.style?.boxborderw,
    watermark: (renderSpec?.style?.watermark ?? ((process.env.WATERMARK_ENABLED ?? "true") !== "false")),
    watermarkText: renderSpec?.style?.watermarkText || process.env.WATERMARK_TEXT || "Vaiform",
    watermarkFontSize: renderSpec?.style?.watermarkFontSize || Number(process.env.WATERMARK_FONT_SIZE || 30),
    watermarkPadding: renderSpec?.style?.watermarkPadding || Number(process.env.WATERMARK_PADDING || 42),
    safeMargin: renderSpec?.output?.safeMargin,
    // audio opts
    ttsPath,
    keepVideoAudio: !!(renderSpec?.audio?.keepVideoAudio ?? (voiceover ? false : true)),
    haveBgAudio,
    bgAudioVolume: Number.isFinite(renderSpec?.audio?.bgAudioVolume) ? renderSpec.audio.bgAudioVolume : (voiceover ? 0.25 : 1.0),
    voiceoverDelaySec: renderSpec?.audio?.voiceoverDelaySec,
    ttsDelayMs: renderSpec?.audio?.ttsDelayMs,
    tailPadSec: renderSpec?.audio?.tailPadSec ?? renderSpec?.output?.tailPadSec,
    // timing
    durationSec: renderSpec?.output?.durationSec ?? s?.render?.durationSec ?? 8,
  });
  progress('render_done');

  // Upload artifacts
  const base = `artifacts/${uid}/${jobId}`;
  const uploaded = {};
  async function up(localPath, name, contentType) {
    const dest = `${base}/${name}`;
    const { publicUrl } = await uploadPublic(localPath, dest, contentType);
    uploaded[name] = publicUrl;
    return publicUrl;
  }

  const want9x16 = !formats || formats.includes("9x16");
  const want1x1 = !formats || formats.includes("1x1");
  const want16x9 = !formats || formats.includes("16x9");

  if (want9x16 && rr.files["9x16"]) { await up(rr.files["9x16"], `${jobId}_9x16.mp4`, "video/mp4"); progress('uploaded', { kind: 'video', format: '9x16' }); }
  if (want1x1 && rr.files["1x1"]) { await up(rr.files["1x1"], `${jobId}_1x1.mp4`, "video/mp4"); progress('uploaded', { kind: 'video', format: '1x1' }); }
  if (want16x9 && rr.files["16x9"]) { await up(rr.files["16x9"], `${jobId}_16x9.mp4`, "video/mp4"); progress('uploaded', { kind: 'video', format: '16x9' }); }
  if (wantImage && rr.files.poster) { await up(rr.files.poster, `${jobId}_poster_9x16.png`, "image/png"); progress('uploaded', { kind: 'image', format: '9x16' }); }
  if (wantAudio && rr.files.audio) { await up(rr.files.audio, `${jobId}.mp3`, "audio/mpeg"); progress('uploaded', { kind: 'audio' }); }

  // Write meta.json for convenience
  try {
    const meta = {
      renderId: jobId,
      studioId: studioId || null,
      uid,
      parentRenderId: parentRenderId || null,
      createdAt: new Date().toISOString(),
      text: usedText,
      authorLine,
      files: Object.keys(uploaded),
      urls: uploaded,
    };
    const tmp = JSON.stringify(meta, null, 2);
    const tmpPath = `${rr.tmpRoot}/meta.json`;
    await import('node:fs/promises').then(m=>m.writeFile(tmpPath, tmp));
    await uploadPublic(tmpPath, `${base}/meta.json`, "application/json");
  } catch {}

  progress('done', { renderId: jobId });
  return { renderId: jobId, urls: uploaded };
}

export async function createRemix({ uid, parentRenderId, renderSpec, formats = ["9x16","1x1","16x9"], wantImage = true, wantAudio = true, onProgress }) {
  // Enforce quota: first 5 remixes free per parent renderId
  const bucket = admin.storage().bucket();
  const [files] = await bucket.getFiles({ prefix: `artifacts/${uid}/`, autoPaginate: true });
  let count = 0;
  for (const f of files) {
    if (!f.name.endsWith('/meta.json')) continue;
    try {
      const [buf] = await f.download();
      const meta = JSON.parse(buf.toString('utf8'));
      if (meta?.parentRenderId === parentRenderId) count++;
    } catch {}
  }
  if (count >= 5) {
    const err = new Error('REMIX_QUOTA_EXCEEDED');
    err.code = 'REMIX_QUOTA_EXCEEDED';
    throw err;
  }
  const out = await finalizeStudioMulti({ uid, studioId: null, renderSpec, formats, wantImage, wantAudio, parentRenderId, onProgress });
  return out;
}

export async function listRemixes({ uid, renderId }) {
  const bucket = admin.storage().bucket();
  const [files] = await bucket.getFiles({ prefix: `artifacts/${uid}/`, autoPaginate: true });
  const out = [];
  for (const f of files) {
    if (!f.name.endsWith('/meta.json')) continue;
    try {
      const [buf] = await f.download();
      const meta = JSON.parse(buf.toString('utf8'));
      if (meta?.parentRenderId === renderId) out.push(meta);
    } catch {}
  }
  out.sort((a,b)=>Date.parse(b.createdAt||0)-Date.parse(a.createdAt||0));
  return out;
}

// ---- Social image (1080x1350) ----
export async function generateSocialImage({ uid, studioId, renderSpec = {} }) {
  const s = studioId ? (await getStudio({ uid, studioId })) : null;
  if (studioId && !s) throw new Error("STUDIO_NOT_FOUND");
  const chosenQ = s?.quote?.candidates?.find?.((c) => c.id === s?.quote?.chosenId) || null;
  const usedText = renderSpec?.text || chosenQ?.text || s?.render?.text || null;
  if (!usedText) throw new Error("QUOTE_TEXT_REQUIRED");
  const authorLine = (renderSpec?.authorLine || (chosenQ?.attributed && chosenQ?.author ? `— ${chosenQ.author}` : null)) || null;

  // Resolve background (video preferred)
  let videoTmp = null;
  let imageTmp = null;
  if (s?.video?.chosenId) {
    const v = (s.video.candidates || []).find((c) => c.id === s.video.chosenId) || null;
    if (v) videoTmp = await fetchVideoToTmp(v.url);
  }
  if (!videoTmp && s?.image?.chosenId) {
    const i = (s.image.candidates || []).find((c) => c.id === s.image.chosenId) || null;
    if (i) imageTmp = await fetchImageToTmp(i.url);
  }
  if (!videoTmp && !imageTmp) throw new Error("NEED_IMAGE_OR_VIDEO");

  const jobId = `social-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
  const tmpRoot = (await import('node:os')).tmpdir();
  const p = (await import('node:path'));
  const local = p.join(tmpRoot, `${jobId}_social_1080x1350.png`);
  await exportSocialImage({
    videoPath: videoTmp?.path || null,
    imagePath: imageTmp?.path || null,
    outPath: local,
    width: 1080,
    height: 1350,
    text: usedText,
    authorLine,
    fontfile: renderSpec?.style?.fontfile,
    fontcolor: renderSpec?.style?.fontcolor,
    fontsize: renderSpec?.style?.fontsize,
    lineSpacing: renderSpec?.style?.lineSpacing,
    shadowColor: renderSpec?.style?.shadowColor,
    shadowX: renderSpec?.style?.shadowX,
    shadowY: renderSpec?.style?.shadowY,
    box: renderSpec?.style?.box,
    boxcolor: renderSpec?.style?.boxcolor,
    boxborderw: renderSpec?.style?.boxborderw,
    watermark: (renderSpec?.style?.watermark ?? ((process.env.WATERMARK_ENABLED ?? "true") !== "false")),
    watermarkText: renderSpec?.style?.watermarkText || process.env.WATERMARK_TEXT || "Vaiform",
    watermarkFontSize: renderSpec?.style?.watermarkFontSize || Number(process.env.WATERMARK_FONT_SIZE || 30),
    watermarkPadding: renderSpec?.style?.watermarkPadding || Number(process.env.WATERMARK_PADDING || 42),
    safeMargin: renderSpec?.output?.safeMargin,
    ssSec: 1,
  });

  const base = `artifacts/${uid}/${jobId}`;
  const name = `${jobId}_social_1080x1350.png`;
  const { publicUrl } = await uploadPublic(local, `${base}/${name}`, 'image/png');
  return { renderId: jobId, url: publicUrl };
}

// ---- Caption generator with cache ----
async function readJsonIfExists(path) {
  const bucket = admin.storage().bucket();
  const f = bucket.file(path);
  try { const [buf] = await f.download(); return JSON.parse(buf.toString('utf8')); } catch (e) { return null; }
}
async function writeJson(path, obj) {
  const bucket = admin.storage().bucket();
  const f = bucket.file(path);
  const buf = Buffer.from(JSON.stringify(obj, null, 2), 'utf8');
  await f.save(buf, { contentType: 'application/json', resumable: false, validation: false, metadata: { cacheControl: 'public,max-age=2592000,immutable' } });
}

export async function generateCaption({ uid, quoteId, styleId, text, tone = 'default' }) {
  const keyRaw = `${quoteId || 'unknown'}|${styleId || 'default'}|${(text||'').trim()}`;
  const hash = crypto.createHash('sha1').update(keyRaw).digest('hex');
  const cachePath = `cache/captions/${uid}/${hash}.json`;
  const hit = await readJsonIfExists(cachePath);
  if (hit) return hit;

  const apiKey = process.env.OPENAI_API_KEY || '';
  const client = apiKey ? new OpenAI({ apiKey }) : null;
  let primary = '';
  let hashtags = [];
  let alt_text = '';
  const guidance = `Tone: ${tone}. Output JSON with keys primary (1-2 sentences), hashtags (8-12 tags, no # in values), alt_text (concise description).`;
  if (client) {
    try {
      const sys = `You write concise, engaging social captions and relevant hashtags.`;
      const user = `Text: ${text}\nStyle: ${styleId}\n${guidance}`;
      const r = await client.chat.completions.create({ model: 'gpt-4o-mini', temperature: 0.6, messages: [ { role:'system', content: sys }, { role:'user', content: user } ] });
      const raw = r?.choices?.[0]?.message?.content?.trim?.() || '';
      try {
        const j = JSON.parse(raw);
        primary = String(j.primary || '');
        const tags = Array.isArray(j.hashtags) ? j.hashtags : String(j.hashtags||'').split(/\s*[#,;\n]\s*/);
        hashtags = tags.filter(Boolean).slice(0,12).map(s=>String(s).replace(/^#/,'').trim().toLowerCase());
        alt_text = String(j.alt_text || '');
      } catch {
        primary = raw.replace(/\s+/g,' ').slice(0, 220);
        const topic = (styleId||'').toLowerCase();
        hashtags = [topic,'inspiration','motivation','quote','daily','mindset','success','life','goals','focus','calm','bold','cinematic'].slice(0,12);
        alt_text = `Stylized quote image: "${(text||'').slice(0,60)}"`;
      }
    } catch {
      // fallbacks below
    }
  }
  if (!primary) primary = `${(text||'').slice(0,180)} #${(styleId||'vibes').toLowerCase()}`;
  if (!hashtags.length) hashtags = ['inspiration','motivation','quote','daily','mindset','success','life','goals','focus','calm','bold','cinematic'].slice(0,12);
  if (!alt_text) alt_text = `Quote image portrait 1080x1350: "${(text||'').slice(0,60)}"`;

  const out = { primary, hashtags, alt_text, key: hash };
  await writeJson(cachePath, out);
  return out;
}

// ---- Management APIs ----
export async function listStudios({ uid }) {
  const bucket = admin.storage().bucket();
  const [files] = await bucket.getFiles({ prefix: `drafts/${uid}/`, autoPaginate: true });
  const sessions = [];
  for (const f of files) {
    if (!f.name.endsWith("/session.json")) continue;
    const studioId = f.name.split("/")[2];
    try {
      const [buf] = await f.download();
      const s = ensureSessionDefaults(JSON.parse(buf.toString("utf8")));
      const expired = s.expiresAt && Date.now() > Date.parse(s.expiresAt);
      if (s.deletedAt || expired) {
        // purge expired/deleted
        try { if (expired) await f.delete(); } catch {}
        continue;
      }
      sessions.push({
        id: s.id || studioId,
        createdAt: s.render?.createdAt || null,
        updatedAt: s.render?.updatedAt || null,
        expiresAt: s.expiresAt || null,
        iterationsLeft: Math.min(s.quote?.iterationsLeft ?? 0, s.image?.iterationsLeft ?? 0),
        chosen: {
          quote: Boolean(s.quote?.chosenId),
          image: Boolean(s.image?.chosenId),
        },
      });
    } catch {}
  }
  sessions.sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
  return sessions;
}

export async function deleteStudio({ uid, studioId }) {
  const bucket = admin.storage().bucket();
  const f = bucket.file(`drafts/${uid}/${studioId}/session.json`);
  try { await f.delete(); } catch {}
  return { ok: true };
}

export function initStudioSweeper() {
  const intervalMin = Number(process.env.STUDIO_SWEEP_MINUTES || 30);
  const bucket = admin.storage().bucket();
  setInterval(async () => {
    try {
      const [files] = await bucket.getFiles({ prefix: `drafts/`, autoPaginate: true });
      for (const f of files) {
        if (!f.name.endsWith("/session.json")) continue;
        try {
          const [buf] = await f.download();
          const s = JSON.parse(buf.toString("utf8"));
          const expiresAt = s?.expiresAt ? Date.parse(s.expiresAt) : null;
          if ((s?.deletedAt) || (expiresAt && Date.now() > expiresAt)) {
            try { await f.delete(); } catch {}
          }
        } catch {}
      }
    } catch {}
  }, Math.max(1, intervalMin) * 60 * 1000).unref?.();
}

export default { startStudio, getStudio, generateQuoteCandidates, generateImageCandidates, chooseCandidate, finalizeStudio, finalizeStudioMulti, createRemix, listRemixes };


