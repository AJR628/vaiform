import { z } from "zod";
import { createShortService } from "../services/shorts.service.js";
import admin from "../config/firebase.js";
import { buildPublicUrl, getDownloadToken } from "../utils/storage.js";
import { quickValidateAssetUrl } from "../utils/assetValidation.js";

const BackgroundSchema = z.object({
  kind: z.enum(["solid", "imageUrl", "stock", "upload", "ai", "stockVideo", "imageMontage"]).default("solid"),
  // imageUrl lane
  imageUrl: z.string().url().optional(),
  // stock lane - require URL when using stock
  query: z.string().min(1).max(120).optional(),
  url: z.string().url().optional(), // Required for stock/upload/ai backgrounds
  type: z.enum(["image", "video"]).optional(), // Required for stock/upload/ai backgrounds
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
}).refine((data) => {
  // Require url and type for non-solid backgrounds
  if (data.kind !== "solid" && data.kind !== "imageUrl") {
    return data.url && data.type;
  }
  return true;
}, {
  message: "Background URL and type are required for stock/upload/ai backgrounds",
  path: ["background"]
}).refine((data) => {
  // Validate that type matches URL extension
  if (data.url && data.type) {
    const url = data.url.toLowerCase();
    const isVideoUrl = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v'].some(ext => url.includes(`.${ext}`));
    const isImageUrl = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].some(ext => url.includes(`.${ext}`));
    
    if (data.type === 'video' && !isVideoUrl) {
      return false;
    }
    if (data.type === 'image' && !isImageUrl) {
      return false;
    }
  }
  return true;
}, {
  message: "Background type must match URL extension (video URLs must have type 'video', image URLs must have type 'image')",
  path: ["background"]
});

// Flexible caption style: accept any input shape and normalize
const CaptionStyleSchema = z
  .any()
  .transform((s = {}) => {
    const sizeRaw = Number.isFinite(s.sizePx) ? s.sizePx : (Number.isFinite(s.size) ? s.size : 48);
    const sizePx = Math.max(30, Math.min(96, Math.round(Number(sizeRaw || 48))));

    const opRaw = s.opacity;
    const opacity = typeof opRaw === "number" ? (opRaw > 1 ? Math.min(1, Math.max(0, opRaw / 100)) : Math.max(0, Math.min(1, opRaw))) : 0.8;

    const boxOpRaw = (typeof s.boxOpacity === 'number') ? s.boxOpacity : (typeof s.bgOpacity === 'number' ? (s.bgOpacity > 1 ? s.bgOpacity / 100 : s.bgOpacity) : 0.5);
    const boxOpacity = Math.max(0, Math.min(1, Number(boxOpRaw)));

    const showBox = typeof s.showBox === 'boolean' ? s.showBox : !!s.background;
    const font = (s.font === 'minimal' || s.font === 'cinematic' || s.font === 'system') ? s.font : 'system';
    const weight = s.weight === 'bold' ? 'bold' : 'normal';
    const placement = (s.placement === 'top' || s.placement === 'middle' || s.placement === 'bottom') ? s.placement : 'middle';
    return { font, weight, sizePx, opacity, placement, showBox, boxOpacity };
  });

const CreateShortSchema = z
  .object({
    mode: z.enum(["quote", "feeling"]).default("quote").optional(),
    // Allow empty text; we refine later to require text or captionText
    text: z.string().default("").optional(),
    template: z.enum(["calm", "bold", "cosmic", "minimal"]).default("calm").optional(),
    durationSec: z.number().int().min(6).max(10).default(8).optional(),
    voiceover: z.boolean().default(false).optional(),
    wantAttribution: z.boolean().default(true).optional(),
    background: BackgroundSchema.default({ kind: "solid" }).optional(),
    debugAudioPath: z.string().optional(),
    // Accept legacy 'none' but normalize to 'static'
    captionMode: z.union([z.enum(["static", "progress", "karaoke"]), z.literal("none")])
      .transform(v => (v === "none" ? "static" : v))
      .default("static")
      .optional(),
    includeBottomCaption: z.boolean().optional(),
    watermark: z.boolean().optional(),
    captionStyle: CaptionStyleSchema.optional(),
    caption: z
      .object({
        text: z.string().trim().min(1).max(300),
        fontFamily: z.string().optional(),
        fontSizePx: z.number().int().min(16).max(160),
        opacity: z.number().min(0).max(1).default(0.8),
        align: z.enum(["left","center","right"]).default("center"),
        // accept either position or pos; normalize later
        position: z.object({ xPct: z.number().min(0).max(100), yPct: z.number().min(0).max(100) }).optional(),
        pos: z.object({ xPct: z.number().min(0).max(100), yPct: z.number().min(0).max(100) }).optional(),
        vAlign: z.enum(["top","center","bottom"]).optional(),
        previewHeightPx: z.number().int().min(1).max(4000).optional(),
        has: z.boolean().optional(),
        lineSpacingPx: z.number().int().min(0).max(200).optional(),
        box: z.object({
          enabled: z.boolean().optional(),
          paddingPx: z.number().int().min(0).max(64).optional(),
          radiusPx: z.number().int().min(0).max(64).optional(),
          bgAlpha: z.number().min(0).max(1).optional(),
        }).optional(),
        wantBox: z.boolean().optional(),
        boxAlpha: z.number().min(0).max(1).optional(),
      })
      .transform((c)=>{
        if (!c) return c;
        const pos = c.position || c.pos;
        return { ...c, position: pos || { xPct: 50, yPct: 50 } };
      })
      .optional(),
    captionText: z.string().default("").optional(),
    voiceId: z.string().optional(),
  })
  .transform((v) => {
    // permit empty text if captionText is provided
    const text = typeof v.text === 'string' ? v.text : '';
    const ctext = typeof v.captionText === 'string' ? v.captionText : '';
    if ((text?.trim()?.length ?? 0) >= 2 || (ctext?.trim()?.length ?? 0) >= 2) return { ...v, text, captionText: ctext };
    return { ...v, text, captionText: ctext, __INVALID__: true };
  })
  .superRefine((val, ctx) => {
    if (val.__INVALID__ === true) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide text or captionText (min 2 chars).", path: ["text"] });
    }
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
    const { mode = "quote", text = "", captionText = "", template = "calm", durationSec = 8, voiceover = false, wantAttribution = true, background = { kind: "solid" }, debugAudioPath, captionMode = "static", includeBottomCaption = false, watermark, captionStyle, caption, voiceId } = parsed.data;

    const ownerUid = req.user?.uid;
    if (!ownerUid) {
      return res.status(401).json({ success: false, error: "UNAUTHENTICATED", message: "Login required" });
    }

    // Validate asset URL accessibility for non-solid backgrounds
    if (background.kind !== "solid" && background.url) {
      console.log(`[shorts] Validating asset URL: ${background.url} (type: ${background.type})`);
      const validation = await quickValidateAssetUrl(background.url, 10000); // 10 second timeout
      
      if (!validation.valid) {
        console.error(`[shorts] Asset validation failed: ${validation.error}`);
        return res.status(400).json({ 
          success: false, 
          error: "INVALID_ASSET", 
          message: `Asset URL is not accessible: ${validation.error}` 
        });
      }
      
      console.log(`[shorts] Asset validation passed: ${background.url}`);
    }

    const effectiveText = (captionText && captionText.trim().length >= 2) ? captionText.trim() : (text || '').trim();
    const overrideQuote = effectiveText ? { text: effectiveText } : undefined;
    try { console.log("[shorts] incoming caption:", caption ? { has: true, len: (caption.text||'').length, pos: caption.position || caption.pos, fontSizePx: caption.fontSizePx, opacity: caption.opacity, align: caption.align, vAlign: caption.vAlign, previewHeightPx: caption.previewHeightPx } : { has:false }); } catch {}
    const result = await createShortService({ ownerUid, mode, text, template, durationSec, voiceover, wantAttribution, background, debugAudioPath, captionMode, includeBottomCaption, watermark, captionStyle, caption, voiceId, overrideQuote });
    return res.json({ success: true, data: result });
  } catch (e) {
    const msg = e?.message || "Short creation failed";
    // Provide a helpful hint when ffmpeg is missing
    const hint = e?.code === "FFMPEG_NOT_FOUND" ? "ffmpeg is not installed or not in PATH. Install ffmpeg and retry." : undefined;
    console.error("/shorts/create error", msg, e?.stderr || "");
    return res.status(500).json({ success: false, error: "SHORTS_CREATE_FAILED", message: hint || msg });
  }
}

export async function getMyShorts(req, res) {
  try {
    const ownerUid = req.user?.uid;
    if (!ownerUid) {
      return res.status(401).json({ success: false, error: "UNAUTHENTICATED", message: "Login required" });
    }

    const limit = Math.min(Number(req.query.limit) || 24, 100);
    const cursor = req.query.cursor;
    const db = admin.firestore();
    
    // Try the optimal query first (with proper index)
    try {
      let query = db.collection('shorts')
        .where('ownerId', '==', ownerUid)
        .orderBy('createdAt', 'desc')
        .limit(limit);
      
      if (cursor) {
        query = query.startAfter(new Date(cursor));
      }
      
      const snapshot = await query.get();
      const items = snapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.() || null,
        completedAt: doc.data().completedAt?.toDate?.() || null,
        failedAt: doc.data().failedAt?.toDate?.() || null
      }));
      
      const nextCursor = items.length > 0 ? items[items.length - 1].createdAt : null;
      
      return res.json({ 
        success: true, 
        data: { 
          items, 
          nextCursor: nextCursor ? nextCursor.toISOString() : null,
          hasMore: items.length === limit
        } 
      });
    } catch (err) {
      // Firestore code=9 FAILED_PRECONDITION → requires an index
      const needsIndex = err?.code === 9 || /requires an index/i.test(String(err?.message || ''));
      if (!needsIndex) {
        // bubble real errors
        throw err;
      }
      
      console.warn("[shorts] Using index fallback for getMyShorts:", err.message);
      
      // Fallback path: no orderBy (no index required). We sort in memory.
      const snapshot = await db.collection('shorts')
        .where('ownerId', '==', ownerUid)
        .get();
      
      const all = snapshot.docs.map(doc => ({ 
        id: doc.id, 
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate?.() || null,
        completedAt: doc.data().completedAt?.toDate?.() || null,
        failedAt: doc.data().failedAt?.toDate?.() || null
      }));
      
      // Sort by createdAt in memory
      all.sort((a, b) => {
        if (!a.createdAt || !b.createdAt) return 0;
        return b.createdAt.getTime() - a.createdAt.getTime();
      });
      
      const items = all.slice(0, limit);
      const nextCursor = null; // disable pagination until index exists
      
      return res.json({ 
        success: true, 
        data: { 
          items, 
          nextCursor: null,
          hasMore: false,
          note: 'INDEX_FALLBACK'
        } 
      });
    }
  } catch (error) {
    console.error("/shorts/mine error:", error);
    return res.status(500).json({ success: false, error: "FETCH_FAILED", message: error.message });
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

export async function deleteShort(req, res) {
  try {
    const ownerUid = req.user?.uid;
    if (!ownerUid) {
      return res.status(401).json({ success: false, error: "UNAUTHENTICATED", message: "Login required" });
    }
    
    const jobId = String(req.params?.jobId || "").trim();
    if (!jobId) {
      return res.status(400).json({ success: false, error: "INVALID_INPUT", message: "jobId required" });
    }

    const db = admin.firestore();
    const shortsRef = db.collection('shorts').doc(jobId);
    
    // Check if the short exists and belongs to the user
    const doc = await shortsRef.get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, error: "NOT_FOUND", message: "Short not found" });
    }
    
    const shortData = doc.data();
    if (shortData.ownerId !== ownerUid) {
      return res.status(403).json({ success: false, error: "FORBIDDEN", message: "You can only delete your own shorts" });
    }
    
    // Delete Firestore document
    await shortsRef.delete();
    
    // Delete files from Firebase Storage
    const bucket = admin.storage().bucket();
    const destBase = `artifacts/${ownerUid}/${jobId}`;
    
    try {
      const [files] = await bucket.getFiles({ prefix: destBase });
      await Promise.all(files.map(file => file.delete()));
      console.log(`[shorts] Deleted ${files.length} files for short: ${jobId}`);
    } catch (storageError) {
      console.warn(`[shorts] Failed to delete storage files for ${jobId}:`, storageError.message);
    }
    
    return res.json({ success: true, message: "Short deleted successfully" });
  } catch (error) {
    console.error("/shorts/:jobId/delete error:", error);
    return res.status(500).json({ success: false, error: "DELETE_FAILED", message: error.message });
  }
}
