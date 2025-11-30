import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

function tokenize(text) {
  return String(text || "").trim().split(/\s+/);
}

function msToHMS(ms) {
  const t = Math.max(0, Math.floor(ms));
  const cs = Math.floor((t % 1000) / 10);
  const s  = Math.floor(t/1000) % 60;
  const m  = Math.floor(t/60000) % 60;
  const h  = Math.floor(t/3600000);
  const pad = (n,w=2)=>String(n).padStart(w,"0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

export async function buildKaraokeASS({
  text,
  durationMs,
  style = {
    Fontname: "DejaVu Sans",
    Fontsize: 64,
    PrimaryColour: "&H00FFFFFF",
    OutlineColour: "&H80202020",
    BackColour: "&H00000000",
    SecondaryColour: "&H00000000",
    Bold: 0, Italic: 0, Underline: 0, StrikeOut: 0,
    ScaleX: 100, ScaleY: 100, Spacing: 0.5, Angle: 0,
    BorderStyle: 1, Outline: 3, Shadow: 1,
    Alignment: 2,
    MarginL: 40, MarginR: 40, MarginV: 260
  }
}) {
  const tokens = tokenize(text);
  if (!tokens.length) throw new Error("KARAOKE_NO_TOKENS");

  const minSlice = 120; // ms
  const weights = tokens.map(t => Math.pow(Math.max(1, t.replace(/[^\w]/g,"" ).length), 0.9));
  const sumW = weights.reduce((a,b)=>a+b, 0) || 1;
  let alloc = weights.map(w => Math.max(minSlice, Math.floor(durationMs * (w/sumW))));
  // normalize to exactly durationMs
  let total = alloc.reduce((a,b)=>a+b, 0);
  const diff = durationMs - total;
  if (diff !== 0) {
    const step = diff > 0 ? 1 : -1;
    let remaining = Math.abs(diff);
    let i = 0;
    while (remaining > 0 && tokens.length > 0) {
      const idx = i % tokens.length;
      const next = alloc[idx] + step;
      if (next >= minSlice) {
        alloc[idx] = next;
        remaining--;
      }
      i++;
    }
  }

  const parts = [];
  for (let i=0;i<tokens.length;i++) {
    const cs = Math.max(1, Math.round(alloc[i] / 10));
    parts.push(`{\\k${cs}}${tokens[i]}`);
    if (i < tokens.length - 1) parts.push(" ");
  }

  const start = msToHMS(0);
  const end   = msToHMS(durationMs);

  const header =
`[Script Info]
ScriptType: v4.00+
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.601
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: QMain, ${style.Fontname}, ${style.Fontsize}, ${style.PrimaryColour}, ${style.SecondaryColour}, ${style.OutlineColour}, ${style.BackColour}, ${style.Bold}, ${style.Italic}, ${style.Underline}, ${style.StrikeOut}, ${style.ScaleX}, ${style.ScaleY}, ${style.Spacing}, ${style.Angle}, ${style.BorderStyle}, ${style.Outline}, ${style.Shadow}, ${style.Alignment}, ${style.MarginL}, ${style.MarginR}, ${style.MarginV}, 1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const dialogue = `Dialogue: 0,${start},${end},QMain,,0,0,0,,${parts.join("")}\n`;
  const ass = header + dialogue;

  const outPath = join(tmpdir(), `vaiform-${randomUUID()}.ass`);
  await writeFile(outPath, ass, "utf8");
  return outPath;
}

/**
 * Build ASS karaoke file from ElevenLabs timestamp data
 * @param {object} params
 * @param {string} params.text - Original text
 * @param {object} params.timestamps - ElevenLabs timestamp data with characters/words arrays
 * @param {number} [params.durationMs] - Total duration in ms (fallback if timestamps incomplete)
 * @param {object} [params.style] - ASS style configuration
 * @returns {Promise<string>} Path to generated ASS file
 */
export async function buildKaraokeASSFromTimestamps({ text, timestamps, durationMs, style = {} }) {
  if (!text || !timestamps) {
    throw new Error("KARAOKE_TIMESTAMPS: text and timestamps required");
  }

  // Use words if available, otherwise fall back to characters
  const wordTimings = timestamps.words && timestamps.words.length > 0 
    ? timestamps.words 
    : null;
  
  const charTimings = timestamps.characters && timestamps.characters.length > 0
    ? timestamps.characters
    : null;

  if (!wordTimings && !charTimings) {
    // Fallback to estimated timing if no timestamps available
    console.warn("[karaoke] No word/character timestamps, falling back to estimated timing");
    if (durationMs) {
      return await buildKaraokeASS({ text, durationMs, style });
    }
    throw new Error("KARAOKE_TIMESTAMPS: No timestamps and no duration provided");
  }

  // Tokenize text into words
  const tokens = tokenize(text);
  if (!tokens.length) throw new Error("KARAOKE_NO_TOKENS");

  // Build word-level timing from character timings if needed
  let wordTimingsFinal = wordTimings;
  if (!wordTimingsFinal && charTimings) {
    // Reconstruct word timings from character timings
    // Match words to character positions in the text
    wordTimingsFinal = [];
    let textPos = 0;
    
    for (const word of tokens) {
      // Find the word's position in the original text
      const wordStartPos = text.indexOf(word, textPos);
      if (wordStartPos === -1) {
        // Word not found, use fallback
        const estimatedDuration = durationMs ? (durationMs / tokens.length) : 200;
        const lastEnd = wordTimingsFinal.length > 0 
          ? wordTimingsFinal[wordTimingsFinal.length - 1].end_time_ms 
          : 0;
        wordTimingsFinal.push({
          word: word,
          start_time_ms: lastEnd,
          end_time_ms: lastEnd + estimatedDuration
        });
        textPos += word.length + 1; // +1 for space
        continue;
      }
      
      const wordEndPos = wordStartPos + word.length;
      
      // Find corresponding character timings
      // Match by position in text (approximate)
      let charStartIdx = -1;
      let charEndIdx = -1;
      
      // Try to find character timings that correspond to this word
      // This is approximate - we match by text position
      for (let i = 0; i < charTimings.length; i++) {
        const char = charTimings[i];
        // Simple heuristic: if we have enough characters, assume they map 1:1
        if (charStartIdx === -1 && i >= wordStartPos) {
          charStartIdx = i;
        }
        if (i >= wordEndPos - 1 && charEndIdx === -1) {
          charEndIdx = i;
          break;
        }
      }
      
      if (charStartIdx >= 0 && charEndIdx >= charStartIdx) {
        const startMs = charTimings[charStartIdx].start_time_ms || 0;
        const endMs = charTimings[charEndIdx].end_time_ms || startMs + 200;
        wordTimingsFinal.push({
          word: word,
          start_time_ms: startMs,
          end_time_ms: endMs
        });
      } else {
        // Fallback: estimate timing
        const estimatedDuration = durationMs ? (durationMs / tokens.length) : 200;
        const lastEnd = wordTimingsFinal.length > 0 
          ? wordTimingsFinal[wordTimingsFinal.length - 1].end_time_ms 
          : 0;
        wordTimingsFinal.push({
          word: word,
          start_time_ms: lastEnd,
          end_time_ms: lastEnd + estimatedDuration
        });
      }
      
      textPos = wordEndPos + 1; // Move past word and space
    }
  }

  // Build ASS karaoke parts
  const parts = [];
  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i];
    const timing = wordTimingsFinal[i];
    
    if (!timing) {
      // Fallback timing
      const estimatedDuration = durationMs ? (durationMs / tokens.length) : 200;
      const lastEnd = i > 0 && wordTimingsFinal[i - 1] 
        ? wordTimingsFinal[i - 1].end_time_ms 
        : 0;
      const duration = Math.max(50, estimatedDuration); // Minimum 50ms
      const cs = Math.max(1, Math.round(duration / 10)); // Convert to centiseconds
      parts.push(`{\\k${cs}}${word}`);
    } else {
      const duration = timing.end_time_ms - timing.start_time_ms;
      const cs = Math.max(1, Math.round(duration / 10)); // Convert to centiseconds
      parts.push(`{\\k${cs}}${word}`);
    }
    
    if (i < tokens.length - 1) parts.push(" ");
  }

  // Calculate total duration
  const totalDurationMs = wordTimingsFinal.length > 0
    ? wordTimingsFinal[wordTimingsFinal.length - 1].end_time_ms
    : (durationMs || 3000);

  const start = msToHMS(0);
  const end = msToHMS(totalDurationMs);

  // Use provided style or defaults
  const defaultStyle = {
    Fontname: "DejaVu Sans",
    Fontsize: 64,
    PrimaryColour: "&H00FFFFFF",
    OutlineColour: "&H80202020",
    BackColour: "&H00000000",
    SecondaryColour: "&H00000000",
    Bold: 0, Italic: 0, Underline: 0, StrikeOut: 0,
    ScaleX: 100, ScaleY: 100, Spacing: 0.5, Angle: 0,
    BorderStyle: 1, Outline: 3, Shadow: 1,
    Alignment: 2,
    MarginL: 40, MarginR: 40, MarginV: 260
  };

  const finalStyle = { ...defaultStyle, ...style };

  const header =
`[Script Info]
ScriptType: v4.00+
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.601
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: QMain, ${finalStyle.Fontname}, ${finalStyle.Fontsize}, ${finalStyle.PrimaryColour}, ${finalStyle.SecondaryColour}, ${finalStyle.OutlineColour}, ${finalStyle.BackColour}, ${finalStyle.Bold}, ${finalStyle.Italic}, ${finalStyle.Underline}, ${finalStyle.StrikeOut}, ${finalStyle.ScaleX}, ${finalStyle.ScaleY}, ${finalStyle.Spacing}, ${finalStyle.Angle}, ${finalStyle.BorderStyle}, ${finalStyle.Outline}, ${finalStyle.Shadow}, ${finalStyle.Alignment}, ${finalStyle.MarginL}, ${finalStyle.MarginR}, ${finalStyle.MarginV}, 1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const dialogue = `Dialogue: 0,${start},${end},QMain,,0,0,0,,${parts.join("")}\n`;
  const ass = header + dialogue;

  const outPath = join(tmpdir(), `vaiform-${randomUUID()}.ass`);
  await writeFile(outPath, ass, "utf8");
  return outPath;
}

export default { buildKaraokeASS, buildKaraokeASSFromTimestamps };


