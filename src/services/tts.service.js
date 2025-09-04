import fs from "fs";
import os from "os";
import path from "path";

/**
 * Synthesize voiceover for the given text. Soft-fail on any error or missing provider.
 * Returns { audioPath, durationMs } or { audioPath:null, durationMs:null }.
 */
export async function synthVoice({ text }) {
  const t = (text || "").trim();
  if (!t) return { audioPath: null, durationMs: null };

  // Provider A: OpenAI TTS (if available in your environment)
  const openaiKey = process.env.OPENAI_API_KEY;
  const openaiVoice = process.env.TTS_VOICE || process.env.OPENAI_TTS_VOICE || "alloy";

  // Provider B: ElevenLabs (optional)
  const elevenKey = process.env.ELEVENLABS_API_KEY;
  const elevenVoice = process.env.ELEVEN_VOICE || process.env.ELEVENLABS_VOICE;

  try {
    if (openaiKey) {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "tts-"));
      const outPath = path.join(outDir, "quote.mp3");
      // Minimal, leave clear TODO for real implementation
      // TODO: integrate actual OpenAI TTS when available in environment
      // For now, simulate soft-fail by throwing to allow ElevenLabs fallback
      throw new Error("OPENAI_TTS_NOT_IMPLEMENTED");
    }
  } catch (e) {
    // ignore, try eleven labs
  }

  try {
    if (elevenKey && elevenVoice) {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "tts-"));
      const outPath = path.join(outDir, "quote.mp3");
      // TODO: implement ElevenLabs TTS fetch; for now, soft-fail
      throw new Error("ELEVEN_TTS_NOT_IMPLEMENTED");
    }
  } catch (e) {
    // ignore
  }

  console.warn("[tts] provider not configured or failed; continuing silently");
  return { audioPath: null, durationMs: null };
}

export default { synthVoice };


