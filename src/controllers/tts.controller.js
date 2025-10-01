import { TtsRequestSchema } from "../schemas/tts.schema.js";
import { buildTtsPayload } from "../builders/tts.builder.js";
import { elevenLabsSynthesize } from "../adapters/elevenlabs.adapter.js";

export async function ttsPreview(req, res) {
  try {
    const parsed = TtsRequestSchema.parse(req.body);
    
    // SSOT: Build unified TTS payload
    const payload = buildTtsPayload(parsed);
    
    console.log(`[tts.preview] Received request: voiceId=${payload.voiceId}, text="${payload.text.substring(0, 50)}...", settings=${JSON.stringify(payload.voiceSettings)}`);
    
    const { contentType, buffer } = await elevenLabsSynthesize(payload);
    
    console.log(`[tts.preview] ElevenLabs synthesis OK: ${buffer.length} bytes`);
    
    // Return base64-encoded JSON format (matches existing /voice/preview pattern)
    const base64Audio = buffer.toString('base64');
    
    return res.json({
      success: true,
      data: {
        audio: `data:audio/mpeg;base64,${base64Audio}`,
        voiceId: payload.voiceId,
        text: payload.text,
        duration: null // Could be calculated if needed
      }
    });
  } catch (e) {
    console.error(`[tts.preview] Error:`, e.message, e.detail || '');
    const status = e.status || 400;
    return res.status(status).json({ 
      success: false,
      error: "TTS preview failed", 
      detail: e.detail || e.message 
    });
  }
}
