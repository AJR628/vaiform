import crypto from "node:crypto";
import { loadJSON, saveJSON } from "../utils/json.store.js";
import admin from "../config/firebase.js";
import { getQuote } from "./quote.engine.js";
import { resolveStockImage } from "./stock.image.provider.js";
import { createShortService } from "./shorts.service.js";

function ensureSessionDefaults(s) {
  if (!s.constraints) s.constraints = { maxRefines: 5 };
  if (!s.quote) s.quote = { mode: "quote", input: "", candidates: [], chosenId: null, iterationsLeft: s.constraints.maxRefines };
  if (!s.image) s.image = { kind: "stock", query: null, uploadUrl: null, prompt: null, kenBurns: null, candidates: [], chosenId: null, iterationsLeft: s.constraints.maxRefines };
  if (!s.render) s.render = { template: "minimal", durationSec: 8, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
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
  await saveJSON({ uid, studioId: id, data: session });
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
  const set = new Map();
  for (let i = 0; i < n; i++) {
    try {
      const q = await getQuote({ mode, text, template: s.render.template });
      const key = (q.text || "").trim();
      if (!set.has(key)) set.set(key, q);
    } catch {}
  }
  s.quote.candidates = Array.from(set.values()).slice(0, n).map((q) => ({
    id: `q-${crypto.randomUUID()}`,
    text: q.text,
    author: q.author || null,
    attributed: q.attributed === true,
    isParaphrase: q.isParaphrase || false,
  }));
  if (s.quote.iterationsLeft > 0) s.quote.iterationsLeft -= 1;
  s.render.updatedAt = new Date().toISOString();
  await saveJSON({ uid, studioId, data: s });
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

  const candidates = [];
  try {
    if (kind === "stock") {
      const base = (query || "").toLowerCase().trim();
      const words = [base, ...(SYNONYMS[base] || [])];
      for (const w of words.slice(0, Math.max(1, Math.min(3, count)))) {
        try {
          const url = await resolveStockImage({ query: w });
          candidates.push({ id: `img-${crypto.randomUUID()}`, kind: "stock", url, kenBurns: kenBurns || null });
        } catch {}
      }
    } else if (kind === "imageUrl" && query) {
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
  if (s.image.iterationsLeft > 0) s.image.iterationsLeft -= 1;
  s.render.updatedAt = new Date().toISOString();
  await saveJSON({ uid, studioId, data: s });
  return s.image;
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
  s.render.updatedAt = new Date().toISOString();
  await saveJSON({ uid, studioId, data: s });
  return { ok: true };
}

export async function finalizeStudio({ uid, studioId, voiceover = false, wantAttribution = true, captionMode = "progress" }) {
  const s = await getStudio({ uid, studioId });
  if (!s) throw new Error("STUDIO_NOT_FOUND");
  const q = (s.quote.candidates || []).find((c) => c.id === s.quote.chosenId) || null;
  const img = (s.image.candidates || []).find((c) => c.id === s.image.chosenId) || null;
  if (!q) throw new Error("QUOTE_NOT_CHOSEN");
  if (!img) throw new Error("IMAGE_NOT_CHOSEN");

  const background = img.kind === "upload"
    ? { kind: "upload", uploadUrl: img.url, kenBurns: img.kenBurns || undefined }
    : { kind: "imageUrl", imageUrl: img.url, kenBurns: img.kenBurns || undefined };

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
  await saveJSON({ uid, studioId, data: s });

  return { jobId: result.jobId, videoUrl: result.videoUrl, coverImageUrl: result.coverImageUrl };
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

export default { startStudio, getStudio, generateQuoteCandidates, generateImageCandidates, chooseCandidate, finalizeStudio };


