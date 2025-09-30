import { TtsRequestSchema } from "../schemas/tts.schema.js";
import { buildTtsPayload } from "../builders/tts.builder.js";
import { elevenLabsSynthesize } from "../adapters/elevenlabs.adapter.js";

export async function ttsPreview(req, res) {
  try {
    const parsed = TtsRequestSchema.parse(req.body);
    const payload = buildTtsPayload(parsed); // SSOT
    const { contentType, buffer } = await elevenLabsSynthesize(payload);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store");
    return res.send(buffer);
  } catch (e) {
    const status = e.status || 400;
    return res.status(status).json({ error: "TTS preview failed", detail: e.detail || e.message });
  }
}
