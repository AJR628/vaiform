import { z } from "zod";
import { createShortService } from "../services/shorts.service.js";

const BackgroundSchema = z.object({
  kind: z.enum(["solid", "imageUrl", "stock", "upload", "ai"]).default("solid"),
  // imageUrl lane
  imageUrl: z.string().url().optional(),
  // stock lane
  query: z.string().min(1).max(80).optional(),
  // upload lane
  uploadUrl: z.string().url().optional(),
  // ai lane
  prompt: z.string().min(4).max(160).optional(),
  style: z.enum(["photo", "illustration", "abstract"]).optional(),
  // common
  kenBurns: z.enum(["in", "out"]).optional(),
});

const CreateShortSchema = z
  .object({
    mode: z.enum(["quote", "feeling"]).default("quote").optional(),
    text: z.string().min(2).max(280),
    template: z.enum(["calm", "bold", "cosmic", "minimal"]).default("calm").optional(),
    durationSec: z.number().int().min(6).max(10).default(8).optional(),
    voiceover: z.boolean().default(false).optional(),
    wantAttribution: z.boolean().default(true).optional(),
    background: BackgroundSchema.default({ kind: "solid" }).optional(),
    debugAudioPath: z.string().optional(),
    captionMode: z.enum(["static", "progress", "karaoke"]).default("static").optional(),
    watermark: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    const bg = val?.background;
    if (bg?.kind === "imageUrl") {
      if (!bg.imageUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Required when kind=imageUrl",
          path: ["background", "imageUrl"],
        });
      } else {
        try {
          const u = new URL(bg.imageUrl);
          if (u.protocol !== "https:") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Only https URLs are allowed",
              path: ["background", "imageUrl"],
            });
          }
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Invalid URL",
            path: ["background", "imageUrl"],
          });
        }
      }
    }
    if (bg?.kind === "stock") {
      if (!bg.query || typeof bg.query !== "string" || bg.query.trim().length < 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Required when kind=stock",
          path: ["background", "query"],
        });
      } else if (bg.query.length > 80) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Must be at most 80 characters",
          path: ["background", "query"],
        });
      }
    }
    if (bg?.kind === "upload") {
      if (!bg.uploadUrl) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Required when kind=upload",
          path: ["background", "uploadUrl"],
        });
      } else {
        try {
          const u = new URL(bg.uploadUrl);
          if (u.protocol !== "https:") {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "Only https URLs are allowed",
              path: ["background", "uploadUrl"],
            });
          }
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Invalid URL",
            path: ["background", "uploadUrl"],
          });
        }
      }
    }
    if (bg?.kind === "ai") {
      if (!bg.prompt || typeof bg.prompt !== "string" || bg.prompt.trim().length < 4) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Required when kind=ai",
          path: ["background", "prompt"],
        });
      }
    }
  });

export async function createShort(req, res) {
  try {
    const parsed = CreateShortSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: "INVALID_INPUT", detail: parsed.error.flatten() });
    }
    const { mode = "quote", text, template = "calm", durationSec = 8, voiceover = false, wantAttribution = true, background = { kind: "solid" }, debugAudioPath, captionMode = "static", watermark } = parsed.data;

    const ownerUid = req.user?.uid;
    if (!ownerUid) {
      return res.status(401).json({ success: false, error: "UNAUTHENTICATED", message: "Login required" });
    }

    const result = await createShortService({ ownerUid, mode, text, template, durationSec, voiceover, wantAttribution, background, debugAudioPath, captionMode, watermark });
    return res.json({ success: true, data: result });
  } catch (e) {
    const msg = e?.message || "Short creation failed";
    // Provide a helpful hint when ffmpeg is missing
    const hint = e?.code === "FFMPEG_NOT_FOUND" ? "ffmpeg is not installed or not in PATH. Install ffmpeg and retry." : undefined;
    console.error("/shorts/create error", msg, e?.stderr || "");
    return res.status(500).json({ success: false, error: "SHORTS_CREATE_FAILED", message: hint || msg });
  }
}

export async function getShortById(req, res) {
  try {
    const ownerUid = req.user?.uid;
    if (!ownerUid) {
      return res.status(401).json({ success: false, error: "UNAUTHENTICATED", message: "Login required" });
    }
    const jobId = String(req.params?.jobId || "").trim();
    if (!jobId) return res.status(400).json({ success: false, error: "INVALID_INPUT", message: "jobId required" });

    // Build artifact URLs; HEAD probe for existence
    const destBase = `artifacts/${ownerUid}/${jobId}`;
    const { buildPublicUrl, headUrl } = await import("../utils/storage.js");
    // utils/storage.js doesn't export buildPublicUrl; synthesize from uploadPublic pattern
    const admin = (await import("../config/firebase.js")).default;
    const bucket = admin.storage().bucket();
    const mkUrl = (p) => `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(p)}?alt=media`;
    const videoUrl = mkUrl(`${destBase}/short.mp4`);
    const coverImageUrl = mkUrl(`${destBase}/cover.jpg`);
    const metaUrl = mkUrl(`${destBase}/meta.json`);

    // Probe video existence via HEAD
    const headRes = await fetch(videoUrl, { method: "HEAD" });
    if (!headRes.ok) {
      return res.status(404).json({ success: false, error: "NOT_FOUND" });
    }

    // Try meta
    let meta = null;
    try {
      const mr = await fetch(metaUrl);
      if (mr.ok) meta = await mr.json();
    } catch {}

    const out = meta ? {
      jobId: meta.jobId || jobId,
      videoUrl,
      coverImageUrl,
      usedTemplate: meta.usedTemplate ?? null,
      durationSec: meta.durationSec ?? null,
      usedQuote: meta.usedQuote ?? null,
      credits: meta.credits ?? null,
      createdAt: meta.createdAt ?? null,
    } : {
      jobId,
      videoUrl,
      coverImageUrl,
      usedTemplate: null,
      durationSec: null,
      usedQuote: null,
      credits: null,
      createdAt: null,
    };

    return res.json({ success: true, data: out });
  } catch (e) {
    console.error("/shorts/:jobId error", e?.message || e);
    return res.status(500).json({ success: false, error: "GET_SHORT_FAILED" });
  }
}
