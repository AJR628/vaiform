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

  // Log request details for debugging
  console.log('[elevenlabs.timestamps] Request URL:', url);
  console.log('[elevenlabs.timestamps] Request body:', JSON.stringify(body, null, 2));

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
  
  // DEBUG: Log actual response structure to diagnose missing timestamps
  console.log('[elevenlabs.timestamps] Response keys:', Object.keys(data));
  console.log('[elevenlabs.timestamps] Has characters:', !!data.characters, 'type:', typeof data.characters, 'length:', data.characters?.length);
  console.log('[elevenlabs.timestamps] Has words:', !!data.words, 'type:', typeof data.words, 'length:', data.words?.length);
  
  if (data.characters && Array.isArray(data.characters) && data.characters.length > 0) {
    console.log('[elevenlabs.timestamps] Sample character:', JSON.stringify(data.characters[0]));
  }
  if (data.words && Array.isArray(data.words) && data.words.length > 0) {
    console.log('[elevenlabs.timestamps] Sample word:', JSON.stringify(data.words[0]));
  }
  
  // Log first 1000 chars of response to see structure
  const responsePreview = JSON.stringify(data).substring(0, 1000);
  console.log('[elevenlabs.timestamps] Full response preview:', responsePreview);
  
  // ElevenLabs with-timestamps returns:
  // - audio_base64: base64 encoded audio
  // - characters: array of { character, start_time_ms, end_time_ms }
  // - words: array of { word, start_time_ms, end_time_ms } (if available)
  // Note: Some API versions may nest timestamps or use different field names
  
  const audioBuffer = Buffer.from(data.audio_base64, 'base64');
  
  // Extract timestamps with defensive handling for different response structures
  let characters = [];
  let words = [];
  
  // Try direct fields first
  if (data.characters && Array.isArray(data.characters)) {
    characters = data.characters;
  } else if (data.character_timestamps && Array.isArray(data.character_timestamps)) {
    characters = data.character_timestamps;
  } else if (data.timestamps?.characters && Array.isArray(data.timestamps.characters)) {
    characters = data.timestamps.characters;
  }
  
  if (data.words && Array.isArray(data.words)) {
    words = data.words;
  } else if (data.word_timestamps && Array.isArray(data.word_timestamps)) {
    words = data.word_timestamps;
  } else if (data.timestamps?.words && Array.isArray(data.timestamps.words)) {
    words = data.timestamps.words;
  }
  
  // Log what we extracted
  if (characters.length > 0 || words.length > 0) {
    console.log('[elevenlabs.timestamps] Extracted timestamps - characters:', characters.length, 'words:', words.length);
  } else {
    console.warn('[elevenlabs.timestamps] WARNING: No timestamps found in response. Check logs above for actual structure.');
  }
  
  return {
    contentType: "audio/mpeg",
    buffer: audioBuffer,
    timestamps: {
      characters,
      words
    }
  };
}