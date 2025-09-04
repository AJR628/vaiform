import { z } from "zod";
import { createShortService } from "../services/shorts.service.js";

const CreateShortSchema = z.object({
  mode: z.enum(["quote", "feeling"]).default("quote").optional(),
  text: z.string().min(2).max(280),
  template: z.enum(["calm", "bold", "cosmic", "minimal"]).default("calm").optional(),
  durationSec: z.number().int().min(6).max(10).default(8).optional(),
});

export async function createShort(req, res) {
  try {
    const parsed = CreateShortSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: "INVALID_INPUT", detail: parsed.error.flatten() });
    }
    const { mode = "quote", text, template = "calm", durationSec = 8 } = parsed.data;

    const ownerUid = req.user?.uid;
    if (!ownerUid) {
      return res.status(401).json({ success: false, error: "UNAUTHENTICATED", message: "Login required" });
    }

    const result = await createShortService({ ownerUid, mode, text, template, durationSec });
    return res.json({ success: true, data: result });
  } catch (e) {
    const msg = e?.message || "Short creation failed";
    // Provide a helpful hint when ffmpeg is missing
    const hint = e?.code === "FFMPEG_NOT_FOUND" ? "ffmpeg is not installed or not in PATH. Install ffmpeg and retry." : undefined;
    console.error("/shorts/create error", msg, e?.stderr || "");
    return res.status(500).json({ success: false, error: "SHORTS_CREATE_FAILED", message: hint || msg });
  }
}
