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
