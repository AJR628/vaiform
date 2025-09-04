import { z } from "zod";

const CreateShortSchema = z.object({
  mode: z.enum(["quote", "feeling"]).default("quote").optional(),
  text: z.string().min(1).max(500),
  template: z.enum(["minimal", "bold", "pastel"]).default("minimal").optional(),
  durationSec: z.number().int().min(3).max(20).default(8).optional(),
});

export async function createShort(req, res) {
  try {
    const parsed = CreateShortSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: "INVALID_INPUT", detail: parsed.error.flatten() });
    }
    const { mode = "quote", text, template = "minimal", durationSec = 8 } = parsed.data;

    // Stub service call (ffmpeg work to be implemented later)
    // const { videoUrl, jobId, usedQuote } = await createShortService({ uid: req.user.uid, mode, text, template, durationSec });

    return res.json({ success: true, message: "shorts controller reached", data: { mode, text, template, durationSec } });
  } catch (e) {
    console.error("/shorts/create error", e);
    return res.status(500).json({ success: false, error: "INTERNAL" });
  }
}
