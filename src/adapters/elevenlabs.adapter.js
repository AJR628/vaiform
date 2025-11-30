import fetch from "node-fetch";

export async function elevenLabsSynthesize({ text, voiceId, modelId, outputFormat, voiceSettings }) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY not set");

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`;
  const body = {
    text,
    model_id: modelId,
    voice_settings: voiceSettings,
    output_format: outputFormat
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": key,
      "Content-Type": "application/json",
      "Accept": "audio/mpeg"
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const detail = await resp.text();
    const err = new Error(`ElevenLabs error ${resp.status}`);
    err.detail = detail;
    err.status = resp.status;
    throw err;
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  return { contentType: "audio/mpeg", buffer: buf };
}

/**
 * Synthesize speech with word-level timestamps using ElevenLabs with-timestamps endpoint
 * Returns both audio buffer and timestamp data for word highlighting
 */
export async function elevenLabsSynthesizeWithTimestamps({ text, voiceId, modelId, outputFormat, voiceSettings }) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY not set");

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`;
  const body = {
    text,
    model_id: modelId,
    voice_settings: voiceSettings,
    output_format: outputFormat
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": key,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const detail = await resp.text();
    const err = new Error(`ElevenLabs error ${resp.status}`);
    err.detail = detail;
    err.status = resp.status;
    throw err;
  }

  const data = await resp.json();
  
  // ElevenLabs with-timestamps returns:
  // - audio_base64: base64 encoded audio
  // - characters: array of { character, start_time_ms, end_time_ms }
  // - words: array of { word, start_time_ms, end_time_ms } (if available)
  
  const audioBuffer = Buffer.from(data.audio_base64, 'base64');
  
  return {
    contentType: "audio/mpeg",
    buffer: audioBuffer,
    timestamps: {
      characters: data.characters || [],
      words: data.words || []
    }
  };
}