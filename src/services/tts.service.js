import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const TTS_PROVIDER = (process.env.TTS_PROVIDER || "openai").toLowerCase();

// The service always returns { audioPath|null, durationMs|null } and never throws.
export async function synthVoice({ text }) {
  try {
    if (!text || text.trim().length < 2) return { audioPath: null, durationMs: null };

    if (TTS_PROVIDER === "openai" && process.env.OPENAI_API_KEY) {
      return await synthOpenAI({ text });
    }

    if (TTS_PROVIDER === "elevenlabs" && process.env.ELEVENLABS_API_KEY && process.env.ELEVEN_VOICE_ID) {
      return await synthEleven({ text });
    }

    console.warn("[tts] provider not configured; delivering silent video");
    return { audioPath: null, durationMs: null };
  } catch (err) {
    console.warn("[tts] soft-fail:", err?.message || err);
    return { audioPath: null, durationMs: null };
  }
}

async function synthOpenAI({ text }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
  const voice = process.env.OPENAI_TTS_VOICE || "alloy";

  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      voice,
      input: text,
      format: "mp3"
    })
  });
  if (!res.ok) throw new Error(`OPENAI_TTS_${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const dir = await mkdtemp(join(tmpdir(), "vaiform-tts-"));
  const audioPath = join(dir, `quote-${randomUUID()}.mp3`);
  await writeFile(audioPath, buf);
  return { audioPath, durationMs: null }; // duration optional; -shortest will handle
}

async function synthEleven({ text }) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVEN_VOICE_ID;
  const modelId = process.env.ELEVEN_TTS_MODEL || "eleven_flash_v2_5";

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?optimize_streaming_latency=0&output_format=mp3_44100_128`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      "Accept": "audio/mpeg"
    },
    body: JSON.stringify({
      model_id: modelId,
      text,
      voice_settings: { stability: 0.5, similarity_boost: 0.75 }
    })
  });
  if (!res.ok) throw new Error(`ELEVEN_TTS_${res.status}`);

  const buf = Buffer.from(await res.arrayBuffer());
  const dir = await mkdtemp(join(tmpdir(), "vaiform-tts-"));
  const audioPath = join(dir, `quote-${randomUUID()}.mp3`);
  await writeFile(audioPath, buf);
  return { audioPath, durationMs: null };
}

export default { synthVoice };


