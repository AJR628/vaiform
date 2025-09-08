import { Router } from "express";
import { z } from "zod";
import requireAuth from "../middleware/requireAuth.js";
import { startStudio, getStudio, generateQuoteCandidates, generateImageCandidates, chooseCandidate, finalizeStudio, listStudios, deleteStudio, generateVideoCandidates, finalizeStudioMulti, createRemix, listRemixes, generateSocialImage, generateCaption } from "../services/studio.service.js";
import { bus, sendEvent } from "../utils/events.js";
import { resolveStockVideo } from "../services/stock.video.provider.js";

const r = Router();
r.use(requireAuth);

const StartSchema = z.object({
  template: z.enum(["calm", "bold", "cosmic", "minimal"]),
  durationSec: z.number().int().min(6).max(10),
  maxRefines: z.number().int().min(0).max(10).optional(),
  debugExpire: z.boolean().optional(),
});

const QuoteSchema = z.object({
  studioId: z.string().min(3),
  mode: z.enum(["quote", "feeling"]),
  text: z.string().min(2).max(280),
  count: z.number().int().min(1).max(5).optional(),
});

const ImageSchema = z.object({
  studioId: z.string().min(3),
  kind: z.enum(["stock", "imageUrl", "upload", "ai"]),
  query: z.string().optional(),
  imageUrl: z.string().url().optional(),
  uploadUrl: z.string().url().optional(),
  prompt: z.string().optional(),
  kenBurns: z.enum(["in", "out"]).optional(),
});

const VideoSchema = z.object({
  studioId: z.string().min(3),
  kind: z.enum(["stockVideo"]).default("stockVideo"),
  query: z.string().min(1),
});

const ChooseSchema = z.object({
  studioId: z.string().min(3),
  track: z.enum(["quote", "image", "video"]),
  candidateId: z.string().min(3),
});

const FinalizeSchema = z.object({
  studioId: z.string().min(3),
  voiceover: z.boolean().optional(),
  wantAttribution: z.boolean().optional(),
  captionMode: z.enum(["progress", "karaoke"]).optional(),
  // New multi-format payload
  renderSpec: z.any().optional(),
  formats: z.array(z.enum(["9x16","1x1","16x9"]).default("9x16")).optional(),
  wantImage: z.boolean().optional(),
  wantAudio: z.boolean().optional(),
});

r.post("/start", async (req, res) => {
  const parsed = StartSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ success: false, error: "INVALID_INPUT", detail: parsed.error.flatten() });
  const { template, durationSec, maxRefines = 5, debugExpire = false } = parsed.data;
  try {
    const s = await startStudio({ uid: req.user.uid, template, durationSec, maxRefines, debugExpire });
    return res.json({ success: true, data: s });
  } catch (e) {
    return res.status(500).json({ success: false, error: "STUDIO_START_FAILED" });
  }
});

r.post("/video", async (req, res) => {
  const parsed = VideoSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ success: false, error: "INVALID_INPUT", detail: parsed.error.flatten() });
  const { studioId, kind, query } = parsed.data;
  try {
    const v = await generateVideoCandidates({ uid: req.user.uid, studioId, kind, query, targetDur: 8 });
    return res.json({ success: true, data: { video: v } });
  } catch (e) {
    return res.status(500).json({ success: false, error: "STUDIO_VIDEO_FAILED" });
  }
});

r.post("/quote", async (req, res) => {
  const parsed = QuoteSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ success: false, error: "INVALID_INPUT", detail: parsed.error.flatten() });
  const { studioId, mode, text, count = 3 } = parsed.data;
  try {
    const q = await generateQuoteCandidates({ uid: req.user.uid, studioId, mode, text, template: undefined, count });
    return res.json({ success: true, data: { quote: q } });
  } catch (e) {
    return res.status(500).json({ success: false, error: "STUDIO_QUOTE_FAILED" });
  }
});

r.post("/image", async (req, res) => {
  const parsed = ImageSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ success: false, error: "INVALID_INPUT", detail: parsed.error.flatten() });
  const { studioId, kind, query, imageUrl, uploadUrl, prompt, kenBurns } = parsed.data;
  try {
    const q = await generateImageCandidates({ uid: req.user.uid, studioId, kind, query: imageUrl || query, uploadUrl, prompt, kenBurns, count: 3 });
    return res.json({ success: true, data: { image: q } });
  } catch (e) {
    return res.status(500).json({ success: false, error: "STUDIO_IMAGE_FAILED" });
  }
});

r.post("/choose", async (req, res) => {
  const parsed = ChooseSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ success: false, error: "INVALID_INPUT", detail: parsed.error.flatten() });
  const { studioId, track, candidateId } = parsed.data;
  try {
    console.log("studio.choose", { studioId, track, candidateId });
    const out = await chooseCandidate({ uid: req.user.uid, studioId, track, candidateId });
    return res.json({ success: true, data: out });
  } catch (e) {
    return res.status(500).json({ success: false, error: "STUDIO_CHOOSE_FAILED" });
  }
});

r.post("/finalize", async (req, res) => {
  const parsed = FinalizeSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ success: false, error: "INVALID_INPUT", detail: parsed.error.flatten() });
  const { studioId, voiceover = false, wantAttribution = true, captionMode = "progress", renderSpec, formats, wantImage = true, wantAudio = true } = parsed.data;
  try {
    if (!renderSpec && !formats && !wantImage && !wantAudio) {
      // Back-compat: old finalize single format path
      const out = await finalizeStudio({ uid: req.user.uid, studioId, voiceover, wantAttribution, captionMode });
      return res.json({ success: true, data: out });
    }
    // New path: multi-format → run and emit events via bus, return JSON fallback
    const out = await finalizeStudioMulti({
      uid: req.user.uid,
      studioId,
      renderSpec: renderSpec || {},
      formats: formats || ["9x16","1x1","16x9"],
      wantImage,
      wantAudio,
      voiceover,
      wantAttribution,
      onProgress: (e) => sendEvent(studioId, e.event || 'progress', e),
    });
    // Choose preferred URL (vertical if present)
    const urls = out?.urls || {};
    const publicUrl = urls[`${out.renderId}_9x16.mp4`] || urls[`${out.renderId}_1x1.mp4`] || urls[`${out.renderId}_16x9.mp4`] || Object.values(urls)[0];
    sendEvent(studioId, 'video_ready', { url: publicUrl, durationSec: renderSpec?.output?.durationSec || undefined });
    sendEvent(studioId, 'done', { url: publicUrl });
    console.log('[studio][finalize] emitted: video_ready, done');
    return res.json({ success: true, url: publicUrl, durationSec: renderSpec?.output?.durationSec || undefined, urls });
  } catch (e) {
    if (e?.message === "NEED_IMAGE_OR_VIDEO") {
      return res.status(400).json({ success: false, error: "IMAGE_OR_VIDEO_REQUIRED" });
    }
    if (e?.message === 'RENDER_FAILED' || e?.message === 'FILTER_SANITIZE_FAILED') {
      return res.status(400).json({ success: false, error: 'RENDER_FAILED', detail: e?.detail || e?.cause?.message || 'ffmpeg failed', filter: e?.filter });
    }
    try { sendEvent(req.body?.studioId, 'error', { message: e?.message || 'FINALIZE_FAILED' }); } catch {}
    return res.status(500).json({ success: false, error: "STUDIO_FINALIZE_FAILED", message: e?.message || "Finalize failed" });
  }
});

// Server-Sent Events for Studio progress
r.get('/events/:studioId', async (req, res) => {
  const studioId = String(req.params?.studioId || '').trim();
  if (!studioId) return res.status(400).end();
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'keep-alive');
  const handler = (payload) => {
    try {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch {}
  };
  bus.on(studioId, handler);
  req.on('close', () => bus.off(studioId, handler));
});

// --- Remix endpoints ---
const RemixSchema = z.object({
  parentRenderId: z.string().min(6),
  renderSpec: z.any(),
  formats: z.array(z.enum(["9x16","1x1","16x9"]).default("9x16")).optional(),
  wantImage: z.boolean().optional(),
  wantAudio: z.boolean().optional(),
});

r.post("/remix", async (req, res) => {
  const parsed = RemixSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ success: false, error: "INVALID_INPUT", detail: parsed.error.flatten() });
  const { parentRenderId, renderSpec, formats, wantImage = true, wantAudio = true } = parsed.data;
  try {
    const out = await createRemix({ uid: req.user.uid, parentRenderId, renderSpec, formats, wantImage, wantAudio });
    return res.json({ success:true, data: out });
  } catch (e) {
    if (e?.code === 'REMIX_QUOTA_EXCEEDED') {
      return res.status(429).json({ success:false, error:'REMIX_QUOTA_EXCEEDED' });
    }
    return res.status(500).json({ success:false, error:'REMIX_FAILED' });
  }
});

r.get('/:renderId/remixes', async (req, res) => {
  const renderId = String(req.params?.renderId || '').trim();
  if (!renderId) return res.status(400).json({ success:false, error:'INVALID_INPUT' });
  try {
    const list = await listRemixes({ uid: req.user.uid, renderId });
    return res.json({ success:true, data: list });
  } catch (e) {
    return res.status(500).json({ success:false, error:'REMIX_LIST_FAILED' });
  }
});

// ---- Social image + caption ----
const SocialImageSchema = z.object({ studioId: z.string().min(3), renderSpec: z.any().optional() });
r.post('/social-image', async (req, res) => {
  const parsed = SocialImageSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ success:false, error:'INVALID_INPUT', detail: parsed.error.flatten() });
  const { studioId, renderSpec } = parsed.data;
  try {
    const out = await generateSocialImage({ uid: req.user.uid, studioId, renderSpec });
    return res.json({ success:true, data: out });
  } catch (e) {
    if (e?.message === 'NEED_IMAGE_OR_VIDEO') return res.status(400).json({ success:false, error:'IMAGE_OR_VIDEO_REQUIRED' });
    return res.status(500).json({ success:false, error:'SOCIAL_IMAGE_FAILED' });
  }
});

const CaptionSchema = z.object({ quoteId: z.string().optional(), styleId: z.string().optional(), text: z.string().min(4), tone: z.string().optional() });
r.post('/caption', async (req, res) => {
  const parsed = CaptionSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ success:false, error:'INVALID_INPUT', detail: parsed.error.flatten() });
  const { quoteId, styleId, text, tone } = parsed.data;
  try {
    const out = await generateCaption({ uid: req.user.uid, quoteId, styleId, text, tone });
    return res.json({ success:true, data: out });
  } catch (e) {
    return res.status(500).json({ success:false, error:'CAPTION_FAILED' });
  }
});

r.get("/:studioId", async (req, res) => {
  const studioId = String(req.params?.studioId || "").trim();
  if (!studioId) return res.status(400).json({ success: false, error: "INVALID_INPUT", message: "studioId required" });
  try {
    const s = await getStudio({ uid: req.user.uid, studioId });
    if (!s) return res.status(404).json({ success: false, error: "NOT_FOUND" });
    return res.json({ success: true, data: s });
  } catch (e) {
    return res.status(500).json({ success: false, error: "STUDIO_GET_FAILED" });
  }
});

// ---- Management ----
r.get("/", async (req, res) => {
  try {
    const list = await listStudios({ uid: req.user.uid });
    return res.json({ success: true, data: list });
  } catch (e) {
    return res.status(500).json({ success: false, error: "STUDIO_LIST_FAILED" });
  }
});

const ResumeSchema = z.object({ studioId: z.string().min(3) });
r.post("/resume", async (req, res) => {
  const parsed = ResumeSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ success: false, error: "INVALID_INPUT", detail: parsed.error.flatten() });
  const { studioId } = parsed.data;
  try {
    const s = await getStudio({ uid: req.user.uid, studioId });
    if (!s) return res.status(404).json({ success: false, error: "NOT_FOUND" });
    return res.json({ success: true, data: s });
  } catch (e) {
    return res.status(500).json({ success: false, error: "STUDIO_RESUME_FAILED" });
  }
});

const DeleteSchema = z.object({ studioId: z.string().min(3) });
r.post("/delete", async (req, res) => {
  const parsed = DeleteSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ success: false, error: "INVALID_INPUT", detail: parsed.error.flatten() });
  const { studioId } = parsed.data;
  try {
    const out = await deleteStudio({ uid: req.user.uid, studioId });
    return res.json({ success: true, data: out });
  } catch (e) {
    return res.status(500).json({ success: false, error: "STUDIO_DELETE_FAILED" });
  }
});

export default r;


