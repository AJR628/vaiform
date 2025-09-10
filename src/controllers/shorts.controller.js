import { z } from "zod";
import { createShortService } from "../services/shorts.service.js";
import admin from "../config/firebase.js";
import { buildPublicUrl, getDownloadToken } from "../utils/storage.js";

const BackgroundSchema = z.object({
  kind: z.enum(["solid", "imageUrl", "stock", "upload", "ai", "stockVideo", "imageMontage"]).default("solid"),
  // imageUrl lane
  imageUrl: z.string().url().optional(),
  // stock lane
  query: z.string().min(1).max(120).optional(),
  // upload lane
  uploadUrl: z.string().url().optional(),
  // ai lane
  prompt: z.string().min(4).max(160).optional(),
  style: z.enum(["photo", "illustration", "abstract"]).optional(),
  // common
  kenBurns: z.enum(["in", "out", "pan_up", "pan_down", "pan_left", "pan_right"]).optional(),
  // video audio mix options
  keepVideoAudio: z.boolean().optional(),
  bgAudioVolume: z.number().min(0).max(1).optional(),
  duckDuringTTS: z.boolean().optional(),
  duck: z.object({
    threshold: z.number().max(0).min(-60).optional(),
    ratio: z.number().min(1).max(20).optional(),
    attack: z.number().min(1).max(200).optional(),
    release: z.number().min(10).max(2000).optional(),
  }).optional(),
});

const CaptionStyleSchema = z.object({
  font: z.string().default("system").optional(),
  weight: z.enum(["normal", "bold"]).default("normal").optional(),
  size: z.number().int().min(28).max(72).default(48).optional(),
  opacity: z.number().int().min(30).max(100).default(80).optional(),
  placement: z.enum(["top", "middle", "bottom"]).default("middle").optional(),
  background: z.boolean().default(false).optional(),
  bgOpacity: z.number().int().min(0).max(100).default(50).optional(),
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
    captionStyle: CaptionStyleSchema.optional(),
    voiceId: z.string().optional(),
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
    const { mode = "quote", text, template = "calm", durationSec = 8, voiceover = false, wantAttribution = true, background = { kind: "solid" }, debugAudioPath, captionMode = "static", watermark, captionStyle, voiceId } = parsed.data;

    const ownerUid = req.user?.uid;
    if (!ownerUid) {
      return res.status(401).json({ success: false, error: "UNAUTHENTICATED", message: "Login required" });
    }

    const result = await createShortService({ ownerUid, mode, text, template, durationSec, voiceover, wantAttribution, background, debugAudioPath, captionMode, watermark, captionStyle, voiceId });
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

    const debug = req.query?.debug === "1";

    const destBase = `artifacts/${ownerUid}/${jobId}/`;
    const bucket = admin.storage().bucket();
    const bucketName = bucket.name;
    const fVideo = bucket.file(`${destBase}short.mp4`);
    const fCover = bucket.file(`${destBase}cover.jpg`);
    const fMeta  = bucket.file(`${destBase}meta.json`);

    const diag = { bucket: bucketName, uid: ownerUid, jobId, base: destBase, steps: [] };

    // Try meta.json first (internal download)
    let meta = null;
    try {
      const [buf] = await fMeta.download();
      meta = JSON.parse(buf.toString("utf8"));
      diag.steps.push("meta_download_ok");
    } catch (e) {
      diag.steps.push(`meta_missing:${e?.code||e?.message||e}`);
    }

    if (meta?.urls?.video) {
      const payload = {
        jobId,
        videoUrl: meta.urls.video,
        coverImageUrl: meta.urls.cover || null,
        durationSec: meta.durationSec ?? null,
        usedTemplate: meta.usedTemplate ?? null,
        usedQuote: meta.usedQuote ?? null,
        credits: meta.credits ?? null,
        createdAt: meta.createdAt ?? null,
      };
      if (debug) return res.json({ ok: true, source: "meta.urls", diag, data: payload });
      return res.json({ success: true, data: payload });
    }

    // Fallback: use admin metadata tokens
    const [existsVideo] = await fVideo.exists();
    if (!existsVideo) {
      if (debug) return res.json({ ok: false, code: "NO_VIDEO_OBJECT", diag });
      return res.status(404).json({ success: false, error: "NOT_FOUND" });
    }
    const tokenVideo = await getDownloadToken(fVideo);
    const videoUrl = buildPublicUrl({ bucket: bucketName, path: `${destBase}short.mp4`, token: tokenVideo });

    const [existsCover] = await fCover.exists();
    let coverImageUrl = null;
    if (existsCover) {
      const tokenCover = await getDownloadToken(fCover);
      coverImageUrl = buildPublicUrl({ bucket: bucketName, path: `${destBase}cover.jpg`, token: tokenCover });
    }

    const payload = {
      jobId,
      videoUrl,
      coverImageUrl,
      durationSec: meta?.durationSec ?? null,
      usedTemplate: meta?.usedTemplate ?? null,
      usedQuote: meta?.usedQuote ?? null,
      credits: meta?.credits ?? null,
      createdAt: meta?.createdAt ?? null,
    };
    if (debug) return res.json({ ok: true, source: "metadata.tokens", diag, data: payload });
    return res.json({ success: true, data: payload });
  } catch (e) {
    console.error("/shorts/:jobId error", e?.message || e);
    return res.status(500).json({ success: false, error: "GET_SHORT_FAILED" });
  }
}
