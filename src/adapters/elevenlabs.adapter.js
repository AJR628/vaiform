import { withAbortTimeout } from '../utils/fetch.timeout.js';

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

  return await withAbortTimeout(async (signal) => {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
        "Accept": "audio/mpeg"
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
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
  }, { timeoutMs: 30000, errorMessage: 'TTS_TIMEOUT' });
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

  return await withAbortTimeout(async (signal) => {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
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
    console.log('[elevenlabs.timestamps] Has alignment:', !!data.alignment, 'type:', typeof data.alignment);
    console.log('[elevenlabs.timestamps] Has normalized_alignment:', !!data.normalized_alignment, 'type:', typeof data.normalized_alignment);
    
    // Log alignment structure if it exists
    if (data.alignment) {
      if (Array.isArray(data.alignment)) {
        console.log('[elevenlabs.timestamps] Alignment is array, length:', data.alignment.length);
        if (data.alignment.length > 0) {
          console.log('[elevenlabs.timestamps] Sample alignment entry:', JSON.stringify(data.alignment[0]));
        }
      } else if (typeof data.alignment === 'object') {
        console.log('[elevenlabs.timestamps] Alignment keys:', Object.keys(data.alignment));
        console.log('[elevenlabs.timestamps] Alignment preview:', JSON.stringify(data.alignment).substring(0, 500));
      } else {
        console.log('[elevenlabs.timestamps] Alignment value:', String(data.alignment).substring(0, 200));
      }
    }
    
    // ElevenLabs with-timestamps returns:
    // - audio_base64: base64 encoded audio
    // - characters: array of { character, start_time_ms, end_time_ms }
    // - words: array of { word, start_time_ms, end_time_ms } (if available)
    // Note: Some API versions may nest timestamps or use different field names
    
    const audioBuffer = Buffer.from(data.audio_base64, 'base64');
    
    // Extract timestamps with defensive handling for different response structures
    let characters = [];
    let words = [];
    
    // ElevenLabs /with-timestamps endpoint returns alignment data in 'alignment' or 'normalized_alignment' fields
    // The alignment format can be:
    // 1. Object with separate arrays: { characters: [...], character_start_times_seconds: [...], character_end_times_seconds: [...] }
    // 2. Array of objects with character/word info
    // 3. Object with nested characters/words arrays
    if (data.alignment) {
      if (Array.isArray(data.alignment)) {
        // Parse alignment array - each entry typically has character/word info with timestamps
        for (const entry of data.alignment) {
          if (entry.character && (entry.start_time_ms !== undefined || entry.start !== undefined)) {
            // Character-level timing
            characters.push({
              character: entry.character,
              start_time_ms: entry.start_time_ms ?? (entry.start ? entry.start * 1000 : 0),
              end_time_ms: entry.end_time_ms ?? (entry.end ? entry.end * 1000 : 0)
            });
          }
          if (entry.word && (entry.start_time_ms !== undefined || entry.start !== undefined)) {
            // Word-level timing
            words.push({
              word: entry.word,
              start_time_ms: entry.start_time_ms ?? (entry.start ? entry.start * 1000 : 0),
              end_time_ms: entry.end_time_ms ?? (entry.end ? entry.end * 1000 : 0)
            });
          }
        }
      } else if (typeof data.alignment === 'object') {
        // Check for separate arrays format (characters + character_start_times_seconds + character_end_times_seconds)
        if (Array.isArray(data.alignment.characters) && 
            Array.isArray(data.alignment.character_start_times_seconds) &&
            Array.isArray(data.alignment.character_end_times_seconds)) {
          // Zip the arrays together to create character timing objects
          const chars = data.alignment.characters;
          const starts = data.alignment.character_start_times_seconds;
          const ends = data.alignment.character_end_times_seconds;
          for (let i = 0; i < chars.length && i < starts.length && i < ends.length; i++) {
            characters.push({
              character: chars[i],
              start_time_ms: Math.round(starts[i] * 1000),
              end_time_ms: Math.round(ends[i] * 1000)
            });
          }
          console.log('[elevenlabs.timestamps] Parsed character timestamps from separate arrays:', characters.length);
        } else if (Array.isArray(data.alignment.characters)) {
          characters = data.alignment.characters;
        } else if (Array.isArray(data.alignment.words)) {
          words = data.alignment.words;
        }
      }
    }
    
    // Try normalized_alignment if alignment didn't yield results
    if (characters.length === 0 && words.length === 0 && data.normalized_alignment) {
      if (Array.isArray(data.normalized_alignment)) {
        for (const entry of data.normalized_alignment) {
          if (entry.character && (entry.start_time_ms !== undefined || entry.start !== undefined)) {
            characters.push({
              character: entry.character,
              start_time_ms: entry.start_time_ms ?? (entry.start ? entry.start * 1000 : 0),
              end_time_ms: entry.end_time_ms ?? (entry.end ? entry.end * 1000 : 0)
            });
          }
          if (entry.word && (entry.start_time_ms !== undefined || entry.start !== undefined)) {
            words.push({
              word: entry.word,
              start_time_ms: entry.start_time_ms ?? (entry.start ? entry.start * 1000 : 0),
              end_time_ms: entry.end_time_ms ?? (entry.end ? entry.end * 1000 : 0)
            });
          }
        }
      } else if (typeof data.normalized_alignment === 'object') {
        // Check for separate arrays format in normalized_alignment
        if (Array.isArray(data.normalized_alignment.characters) && 
            Array.isArray(data.normalized_alignment.character_start_times_seconds) &&
            Array.isArray(data.normalized_alignment.character_end_times_seconds)) {
          const chars = data.normalized_alignment.characters;
          const starts = data.normalized_alignment.character_start_times_seconds;
          const ends = data.normalized_alignment.character_end_times_seconds;
          for (let i = 0; i < chars.length && i < starts.length && i < ends.length; i++) {
            characters.push({
              character: chars[i],
              start_time_ms: Math.round(starts[i] * 1000),
              end_time_ms: Math.round(ends[i] * 1000)
            });
          }
          console.log('[elevenlabs.timestamps] Parsed character timestamps from normalized_alignment arrays:', characters.length);
        } else if (Array.isArray(data.normalized_alignment.characters)) {
          characters = data.normalized_alignment.characters;
        } else if (Array.isArray(data.normalized_alignment.words)) {
          words = data.normalized_alignment.words;
        }
      }
    }
    
    // Fallback to legacy field names
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
  }, { timeoutMs: 30000, errorMessage: 'TTS_TIMEOUT' });
}