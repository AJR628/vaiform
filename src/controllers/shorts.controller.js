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
    const { mode = "quote", text, template = "calm", durationSec = 8, voiceover = false, wantAttribution = true, background = { kind: "solid" } } = parsed.data;

    const ownerUid = req.user?.uid;
    if (!ownerUid) {
      return res.status(401).json({ success: false, error: "UNAUTHENTICATED", message: "Login required" });
    }

    const result = await createShortService({ ownerUid, mode, text, template, durationSec, voiceover, wantAttribution, background });
    return res.json({ success: true, data: result });
  } catch (e) {
    const msg = e?.message || "Short creation failed";
    // Provide a helpful hint when ffmpeg is missing
    const hint = e?.code === "FFMPEG_NOT_FOUND" ? "ffmpeg is not installed or not in PATH. Install ffmpeg and retry." : undefined;
    console.error("/shorts/create error", msg, e?.stderr || "");
    return res.status(500).json({ success: false, error: "SHORTS_CREATE_FAILED", message: hint || msg });
  }
}
