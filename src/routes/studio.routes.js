import { Router } from "express";
import { z } from "zod";
import requireAuth from "../middleware/requireAuth.js";
import { startStudio, getStudio, generateQuoteCandidates, generateImageCandidates, chooseCandidate, finalizeStudio, listStudios, deleteStudio } from "../services/studio.service.js";
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
  track: z.enum(["quote", "image"]),
  candidateId: z.string().min(3),
});

const FinalizeSchema = z.object({
  studioId: z.string().min(3),
  voiceover: z.boolean().optional(),
  wantAttribution: z.boolean().optional(),
  captionMode: z.enum(["progress", "karaoke"]).optional(),
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
    const r = await resolveStockVideo({ query, targetDur: 8 });
    const candidates = (r.ok ? r.items : []).slice(0, 3);
    // we don't persist video track in session structure yet; reuse image-like response shape under video
    return res.json({ success: true, data: { video: { candidates } } });
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
    const out = await chooseCandidate({ uid: req.user.uid, studioId, track, candidateId });
    return res.json({ success: true, data: out });
  } catch (e) {
    return res.status(500).json({ success: false, error: "STUDIO_CHOOSE_FAILED" });
  }
});

r.post("/finalize", async (req, res) => {
  const parsed = FinalizeSchema.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ success: false, error: "INVALID_INPUT", detail: parsed.error.flatten() });
  const { studioId, voiceover = false, wantAttribution = true, captionMode = "progress" } = parsed.data;
  try {
    const out = await finalizeStudio({ uid: req.user.uid, studioId, voiceover, wantAttribution, captionMode });
    return res.json({ success: true, data: out });
  } catch (e) {
    return res.status(500).json({ success: false, error: "STUDIO_FINALIZE_FAILED", message: e?.message || "Finalize failed" });
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


