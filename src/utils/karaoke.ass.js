import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { normalizeWeight } from "./font.registry.js";

function tokenize(text) {
  return String(text || "").trim().split(/\s+/);
}

/**
 * Map raw text tokens to wrapped text structure
 * @param {string[]} rawTokens - Tokens from raw text
 * @param {string} wrappedText - Text with \n line breaks
 * @returns {object|null} Mapping of token indices to line indices, or null if no wrapping
 */
function mapTokensToWrappedLines(rawTokens, wrappedText) {
  if (!wrappedText || !wrappedText.includes('\n')) {
    return null; // No wrapping needed
  }
  
  // Split wrapped text into lines and then into words per line
  const wrappedLines = wrappedText.split('\n').map(line => line.trim().split(/\s+/).filter(w => w.length > 0));
  const flatWrapped = wrappedLines.flat();
  
  // Map: for each raw token index, which line does it belong to?
  const tokenToLine = [];
  let wrappedIdx = 0;
  
  for (let i = 0; i < rawTokens.length; i++) {
    // Find matching word in wrapped structure (case-insensitive, ignore punctuation)
    const rawWord = rawTokens[i].toLowerCase().replace(/[^\w]/g, '');
    
    while (wrappedIdx < flatWrapped.length) {
      const wrappedWord = flatWrapped[wrappedIdx].toLowerCase().replace(/[^\w]/g, '');
      if (wrappedWord === rawWord || (rawWord && wrappedWord.includes(rawWord)) || (wrappedWord && rawWord.includes(wrappedWord))) {
        break;
      }
      wrappedIdx++;
    }
    
    // Find which line this word belongs to
    let lineIdx = 0;
    let wordCount = 0;
    for (const line of wrappedLines) {
      if (wrappedIdx < wordCount + line.length) {
        tokenToLine[i] = lineIdx;
        break;
      }
      wordCount += line.length;
      lineIdx++;
    }
    
    // If we couldn't find a match, assign to last line
    if (tokenToLine[i] === undefined) {
      tokenToLine[i] = wrappedLines.length - 1;
    }
    
    wrappedIdx++;
  }
  
  return { tokenToLine, wrappedLines };
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

/**
 * Convert hex/rgb color to ASS BGR format (&H00BBGGRR)
 * @param {string} color - Hex color (#ffffff) or rgb/rgba string
 * @param {number} [alpha] - Alpha value 0-1 (default: 1.0)
 * @returns {string} ASS color format
 */
function colorToASS(color, alpha = 1.0) {
  if (!color) return "&H00FFFFFF";
  
  let r = 255, g = 255, b = 255;
  const c = String(color).trim();
  
  // Hex format: #ffffff or #fff
  if (c.startsWith('#')) {
    const hex = c.slice(1);
    if (hex.length === 6) {
      r = parseInt(hex.slice(0, 2), 16);
      g = parseInt(hex.slice(2, 4), 16);
      b = parseInt(hex.slice(4, 6), 16);
    } else if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    }
  } else {
    // Parse rgb(R, G, B) or rgba(R, G, B, A)
    const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(c);
    if (m) {
      r = parseInt(m[1], 10);
      g = parseInt(m[2], 10);
      b = parseInt(m[3], 10);
    }
  }
  
  // ASS format: &HAABBGGRR (AA=alpha, BB=blue, GG=green, RR=red)
  const a = Math.round(alpha * 255);
  return `&H${a.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${r.toString(16).padStart(2, '0')}`;
}

/**
 * Map text alignment to ASS alignment number
 * @param {string} align - 'left', 'center', 'right'
 * @param {string} placement - 'top', 'center', 'bottom' (for vertical alignment)
 * @returns {number} ASS alignment (1-9)
 */
function alignmentToASS(align = 'center', placement = 'center') {
  // ASS alignment: 1=bottom-left, 2=bottom-center, 3=bottom-right
  //                4=middle-left, 5=middle-center, 6=middle-right
  //                7=top-left, 8=top-center, 9=top-right
  const hAlign = align === 'left' ? 1 : (align === 'right' ? 3 : 2);
  const vAlign = placement === 'top' ? 3 : (placement === 'bottom' ? 1 : 2);
  return (vAlign - 1) * 3 + hAlign;
}

/**
 * Convert overlay caption styling to ASS subtitle style format
 * @param {object} overlayCaption - Overlay caption object with styling
 * @param {number} width - Video width (default: 1080)
 * @param {number} height - Video height (default: 1920)
 * @returns {object} ASS style object
 */
export function convertOverlayToASSStyle(overlayCaption, width = 1080, height = 1920) {
  if (!overlayCaption) {
    return null;
  }
  
  // Extract styling from overlay
  const fontFamily = overlayCaption.fontFamily || 'DejaVu Sans';
  const fontPx = overlayCaption.fontPx || overlayCaption.sizePx || 64;
  const color = overlayCaption.color || '#ffffff';
  const opacity = typeof overlayCaption.opacity === 'number' ? overlayCaption.opacity : 1.0;
  const textAlign = overlayCaption.textAlign || overlayCaption.align || 'center';
  const placement = overlayCaption.placement || 'center';
  const weightCss = overlayCaption.weightCss || 'normal';
  const fontStyle = overlayCaption.fontStyle || 'normal';
  const yPct = typeof overlayCaption.yPct === 'number' ? overlayCaption.yPct : 0.5;
  const xPct = typeof overlayCaption.xPct === 'number' ? overlayCaption.xPct : 0.5;
  const wPct = typeof overlayCaption.wPct === 'number' ? overlayCaption.wPct : 0.8;
  
  // Convert color to ASS format
  const primaryColor = colorToASS(color, opacity);
  
  // Create highlight color (brighter/more saturated version for active words)
  // For white text, use blue-green/cyan highlight. For colored text, increase brightness
  let highlightColor;
  if (color.toLowerCase() === '#ffffff' || color.toLowerCase() === 'white' || color.toLowerCase() === 'rgb(255, 255, 255)') {
    // White text: use blue-green/cyan highlight for visibility
    highlightColor = colorToASS('#00ffff', opacity); // Cyan/blue-green
  } else {
    // Colored text: increase brightness by ~40% and saturation
    let r = 255, g = 255, b = 255;
    if (color.startsWith('#')) {
      const hex = color.slice(1);
      if (hex.length === 6) {
        r = parseInt(hex.slice(0, 2), 16);
        g = parseInt(hex.slice(2, 4), 16);
        b = parseInt(hex.slice(4, 6), 16);
        // Increase brightness: move towards white
        r = Math.min(255, Math.round(r + (255 - r) * 0.4));
        g = Math.min(255, Math.round(g + (255 - g) * 0.4));
        b = Math.min(255, Math.round(b + (255 - b) * 0.4));
      }
    } else {
      // Parse rgb/rgba
      const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(color);
      if (m) {
        r = parseInt(m[1], 10);
        g = parseInt(m[2], 10);
        b = parseInt(m[3], 10);
        r = Math.min(255, Math.round(r + (255 - r) * 0.4));
        g = Math.min(255, Math.round(g + (255 - g) * 0.4));
        b = Math.min(255, Math.round(b + (255 - b) * 0.4));
      }
    }
    highlightColor = colorToASS(`#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`, opacity);
  }
  
  // Calculate margins based on position
  // MarginV: vertical margin (top for top placement, bottom for bottom placement)
  // For center placement, use 0 to center vertically
  let marginV = 0; // default center (was 260)
  if (placement === 'top') {
    marginV = Math.round(yPct * height * 0.1); // Top margin
  } else if (placement === 'bottom') {
    marginV = Math.round((1 - yPct) * height * 0.1); // Bottom margin
  } else {
    // Center: use 0 for vertical centering
    marginV = 0;
  }
  marginV = Math.max(0, Math.min(800, marginV)); // Clamp to reasonable range (min 0 for center)
  
  // MarginL and MarginR: horizontal margins based on xPct and wPct
  // For center alignment, use equal margins
  let marginL, marginR;
  if (textAlign === 'center' && placement === 'center') {
    // Center alignment: use equal margins (e.g., 120px each)
    marginL = 120;
    marginR = 120;
  } else {
    marginL = Math.round((1 - xPct - wPct / 2) * width * 0.1);
    marginR = Math.round((xPct - wPct / 2) * width * 0.1);
  }
  
  return {
    Fontname: fontFamily,
    Fontsize: Math.round(fontPx),
    PrimaryColour: primaryColor,
    SecondaryColour: highlightColor, // Brighter color for highlighted words
    OutlineColour: "&H80202020", // Dark outline
    BackColour: "&H00000000", // No background
    Bold: normalizeWeight(weightCss) >= 600 ? 1 : 0,
    Italic: fontStyle === 'italic' ? 1 : 0,
    Underline: 0,
    StrikeOut: 0,
    ScaleX: 100,
    ScaleY: 100,
    Spacing: 0.5,
    Angle: 0,
    BorderStyle: 1,
    Outline: 3, // Outline width
    Shadow: 1, // Shadow depth
    Alignment: alignmentToASS(textAlign, placement),
    MarginL: Math.max(0, marginL),
    MarginR: Math.max(0, marginR),
    MarginV: marginV
  };
}

export async function buildKaraokeASS({
  text,
  durationMs,
  wrappedText = null,
  style = {
    Fontname: "DejaVu Sans",
    Fontsize: 64,
    PrimaryColour: "&H00FFFFFF",
    OutlineColour: "&H80202020",
    BackColour: "&H00000000",
    SecondaryColour: "&H00FFFF00", // Cyan/blue-green highlight for karaoke
    Bold: 0, Italic: 0, Underline: 0, StrikeOut: 0,
    ScaleX: 100, ScaleY: 100, Spacing: 0.5, Angle: 0,
    BorderStyle: 1, Outline: 3, Shadow: 1,
    Alignment: 5, // Center-middle (was 2 = center-bottom)
    MarginL: 120, MarginR: 120, MarginV: 0 // Center vertically (was 260 = bottom margin)
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

  // Map tokens to wrapped lines if wrappedText is provided
  const wrapMap = wrappedText ? mapTokensToWrappedLines(tokens, wrappedText) : null;
  
  // Get primary color for reset from style
  const primaryColorReset = style.PrimaryColour || "&H00FFFFFF";
  
  const parts = [];
  let cumulativeTimeMs = 0; // Track cumulative time from start
  
  for (let i=0;i<tokens.length;i++) {
    const wordDurationMs = alloc[i];
    const wordStartMs = cumulativeTimeMs;
    const wordEndMs = wordStartMs + wordDurationMs;
    
    const startCs = Math.max(1, Math.round(wordStartMs / 10)); // Convert to centiseconds
    const endCs = Math.max(1, Math.round(wordEndMs / 10)); // Convert to centiseconds
    
    // Add karaoke timing - word highlights at 'startCs' centiseconds from start
    // Then reset color back to primary at word end time using {\t} transform
    // Use very short transform (1cs) at end time to make reset appear instant
    parts.push(`{\\k${startCs}}${tokens[i]}{\\t(${endCs},${endCs + 1},\\c${primaryColorReset})}`);
    
    // Update cumulative time for next word
    cumulativeTimeMs = wordEndMs;
    
    if (i < tokens.length - 1) {
      // Check if next word starts a new line
      if (wrapMap && wrapMap.tokenToLine[i] !== undefined && wrapMap.tokenToLine[i + 1] !== undefined) {
        if (wrapMap.tokenToLine[i] !== wrapMap.tokenToLine[i + 1]) {
          parts.push("\\N"); // ASS newline
        } else {
          parts.push(" "); // Space between words on same line
        }
      } else {
        parts.push(" "); // Default: space between words
      }
    }
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
 * @param {object} [params.style] - ASS style configuration (legacy, use overlayCaption instead)
 * @param {object} [params.overlayCaption] - Overlay caption object with styling (SSOT)
 * @param {number} [params.width] - Video width for margin calculations (default: 1080)
 * @param {number} [params.height] - Video height for margin calculations (default: 1920)
 * @returns {Promise<string>} Path to generated ASS file
 */
export async function buildKaraokeASSFromTimestamps({ text, timestamps, durationMs, wrappedText = null, style = {}, overlayCaption = null, width = 1080, height = 1920 }) {
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
  if (!wordTimingsFinal && charTimings && charTimings.length > 0) {
    // Reconstruct word timings from character timings
    // Build a character string from the character timings to match against text
    const charString = charTimings.map(c => c.character || '').join('');
    
    wordTimingsFinal = [];
    let charIdx = 0; // Current position in character timings array
    
    for (const word of tokens) {
      // Find the word in the character string starting from current position
      const wordInChars = word.split('').join(''); // Word as character sequence
      let found = false;
      let wordStartCharIdx = -1;
      let wordEndCharIdx = -1;
      
      // Search for the word in the character sequence
      for (let i = charIdx; i < charTimings.length; i++) {
        // Try to match the word starting at position i
        let matches = true;
        for (let j = 0; j < word.length && (i + j) < charTimings.length; j++) {
          const charFromTiming = charTimings[i + j].character || '';
          const charFromWord = word[j] || '';
          // Match character (case-insensitive, ignore spaces)
          if (charFromTiming.toLowerCase() !== charFromWord.toLowerCase() && 
              charFromTiming !== ' ' && charFromWord !== ' ') {
            matches = false;
            break;
          }
        }
        
        if (matches && wordStartCharIdx === -1) {
          wordStartCharIdx = i;
          // Skip spaces before the word
          while (wordStartCharIdx < charTimings.length && 
                 (charTimings[wordStartCharIdx].character === ' ' || 
                  charTimings[wordStartCharIdx].character === '\n')) {
            wordStartCharIdx++;
          }
          // Find end of word (last non-space character)
          wordEndCharIdx = wordStartCharIdx;
          let charsMatched = 0;
          for (let k = wordStartCharIdx; k < charTimings.length && charsMatched < word.length; k++) {
            const ch = charTimings[k].character || '';
            if (ch !== ' ' && ch !== '\n') {
              charsMatched++;
              wordEndCharIdx = k;
            }
          }
          found = true;
          break;
        }
      }
      
      if (found && wordStartCharIdx >= 0 && wordEndCharIdx >= wordStartCharIdx) {
        // Use timing from first and last character of the word
        const startChar = charTimings[wordStartCharIdx];
        const endChar = charTimings[wordEndCharIdx];
        wordTimingsFinal.push({
          word: word,
          start_time_ms: startChar.start_time_ms || 0,
          end_time_ms: endChar.end_time_ms || (startChar.start_time_ms || 0) + 200
        });
        charIdx = wordEndCharIdx + 1; // Move past this word
      } else {
        // Fallback: estimate timing based on previous word or average
        const estimatedDuration = durationMs ? (durationMs / tokens.length) : 200;
        const lastEnd = wordTimingsFinal.length > 0 
          ? wordTimingsFinal[wordTimingsFinal.length - 1].end_time_ms 
          : 0;
        wordTimingsFinal.push({
          word: word,
          start_time_ms: lastEnd,
          end_time_ms: lastEnd + estimatedDuration
        });
        // Don't advance charIdx on fallback to avoid getting stuck
      }
    }
    
    console.log('[karaoke] Reconstructed word timings from character timings:', wordTimingsFinal.length, 'words');
  }

  // Calculate total duration first (needed for style determination)
  // Use actual TTS audio duration (durationMs) as primary source to ensure captions
  // disappear when speech finishes, not with a buffer. This allows captions to disappear
  // during the breath gap between sentences. Fall back to last word's end time only if
  // durationMs is not available.
  // Use a tiny fade-out buffer (~50ms) for smooth caption disappearance
  const FADE_OUT_MS = 50; // Tiny buffer for smooth caption fade-out
  const totalDurationMs = durationMs
    ? durationMs + FADE_OUT_MS
    : (wordTimingsFinal.length > 0
      ? wordTimingsFinal[wordTimingsFinal.length - 1].end_time_ms + FADE_OUT_MS
      : 3000);

  const start = msToHMS(0);
  const end = msToHMS(totalDurationMs);
  
  // Log timing verification for debugging
  const lastWordEndMs = wordTimingsFinal.length > 0
    ? wordTimingsFinal[wordTimingsFinal.length - 1].end_time_ms
    : null;
  console.log('[karaoke] ASS dialogue timing:', {
    actualAudioDurationMs: durationMs || 'not provided',
    lastWordEndMs: lastWordEndMs,
    dialogueEndMs: totalDurationMs,
    dialogueEndSec: (totalDurationMs / 1000).toFixed(2),
    fadeOutBufferMs: 50,
    usingAudioDuration: !!durationMs,
    note: 'Caption ends when speech finishes, allowing disappearance during breath gap'
  });

  // Convert overlay caption styling to ASS format (SSOT)
  let finalStyle;
  if (overlayCaption) {
    const overlayStyle = convertOverlayToASSStyle(overlayCaption, width, height);
    if (overlayStyle) {
      finalStyle = overlayStyle;
      console.log('[karaoke] Using overlay SSOT styling:', {
        fontPx: overlayCaption.fontPx,
        color: overlayCaption.color,
        placement: overlayCaption.placement,
        alignment: overlayStyle.Alignment
      });
    } else {
      // Fallback to defaults if conversion fails
      // Use center-middle alignment to match centered drawtext at y=(h-text_h)/2
      finalStyle = {
        Fontname: "DejaVu Sans",
        Fontsize: 64,
        PrimaryColour: "&H00FFFFFF",
        OutlineColour: "&H80202020",
        BackColour: "&H00000000",
        SecondaryColour: "&H00FFFF00", // Cyan/blue-green highlight
        Bold: 0, Italic: 0, Underline: 0, StrikeOut: 0,
        ScaleX: 100, ScaleY: 100, Spacing: 0.5, Angle: 0,
        BorderStyle: 1, Outline: 3, Shadow: 1,
        Alignment: 5, // Center-middle (was 2 = center-bottom)
        MarginL: 40, MarginR: 40, MarginV: 0 // Center vertically (was 260 = bottom margin)
      };
    }
  } else {
    // Use provided style or defaults (legacy mode)
    // Use center-middle alignment to match centered drawtext at y=(h-text_h)/2
    const defaultStyle = {
      Fontname: "DejaVu Sans",
      Fontsize: 64,
      PrimaryColour: "&H00FFFFFF",
      OutlineColour: "&H80202020",
      BackColour: "&H00000000",
      SecondaryColour: "&H00FFFF00", // Cyan/blue-green highlight for karaoke
      Bold: 0, Italic: 0, Underline: 0, StrikeOut: 0,
      ScaleX: 100, ScaleY: 100, Spacing: 0.5, Angle: 0,
      BorderStyle: 1, Outline: 3, Shadow: 1,
      Alignment: 5, // Center-middle (was 2 = center-bottom)
      MarginL: 40, MarginR: 40, MarginV: 0 // Center vertically (was 260 = bottom margin)
    };
    finalStyle = { ...defaultStyle, ...style };
  }

  // Build ASS karaoke parts with word-level highlighting
  // ASS karaoke: {\k} tags control timing - the number is centiseconds from dialogue start
  // when the word should change from PrimaryColour to SecondaryColour (highlight)
  // Format: {\k50}word means: wait 50 centiseconds from start, then highlight this word
  // To reset color back to white after word is read, use {\c&H00FFFFFF} at word end time
  
  // Map tokens to wrapped lines if wrappedText is provided
  const wrapMap = wrappedText ? mapTokensToWrappedLines(tokens, wrappedText) : null;
  
  const parts = [];
  
  // Get primary color for reset from finalStyle
  const primaryColorReset = finalStyle.PrimaryColour || "&H00FFFFFF";
  
  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i];
    const timing = wordTimingsFinal[i];
    
    if (!timing) {
      // Fallback timing - estimate start time based on previous words
      const estimatedDuration = durationMs ? (durationMs / tokens.length) : 200;
      const lastEnd = i > 0 && wordTimingsFinal[i - 1] 
        ? wordTimingsFinal[i - 1].end_time_ms 
        : 0;
      const wordStartMs = lastEnd;
      const wordEndMs = wordStartMs + estimatedDuration;
      const startCs = Math.max(1, Math.round(wordStartMs / 10)); // Convert to centiseconds
      const endCs = Math.max(1, Math.round(wordEndMs / 10)); // Convert to centiseconds
      // Add karaoke timing - word highlights at 'startCs' centiseconds from start
      // Then reset color back to primary at word end time using {\t} transform
      // Use very short transform (1cs) at end time to make reset appear instant
      parts.push(`{\\k${startCs}}${word}{\\t(${endCs},${endCs + 1},\\c${primaryColorReset})}`);
    } else {
      // Use the word's start time (when it begins being spoken)
      const wordStartMs = timing.start_time_ms || 0;
      const wordEndMs = timing.end_time_ms || (wordStartMs + 200);
      const startCs = Math.max(1, Math.round(wordStartMs / 10)); // Convert to centiseconds
      const endCs = Math.max(1, Math.round(wordEndMs / 10)); // Convert to centiseconds
      // Add karaoke timing - word highlights when it starts being spoken
      // The {\k} tag value is the time from dialogue start to when this word highlights
      // Then reset color back to primary at word end time using {\t} transform
      // Use very short transform (1cs) at end time to make reset appear instant
      parts.push(`{\\k${startCs}}${word}{\\t(${endCs},${endCs + 1},\\c${primaryColorReset})}`);
    }
    
    if (i < tokens.length - 1) {
      // Check if next word starts a new line
      if (wrapMap && wrapMap.tokenToLine[i] !== undefined && wrapMap.tokenToLine[i + 1] !== undefined) {
        if (wrapMap.tokenToLine[i] !== wrapMap.tokenToLine[i + 1]) {
          parts.push("\\N"); // ASS newline
        } else {
          parts.push(" "); // Space between words on same line
        }
      } else {
        parts.push(" "); // Default: space between words
      }
    }
  }

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

  // Debug: Log first few words and their timing
  if (wordTimingsFinal && wordTimingsFinal.length > 0) {
    const sampleWords = wordTimingsFinal.slice(0, 3).map((t, i) => ({
      word: tokens[i],
      start: t.start_time_ms,
      end: t.end_time_ms,
      duration: t.end_time_ms - t.start_time_ms
    }));
    console.log('[karaoke] Sample word timings:', JSON.stringify(sampleWords));
    console.log('[karaoke] ASS dialogue preview:', parts.slice(0, 3).join(''));
  }

  const outPath = join(tmpdir(), `vaiform-${randomUUID()}.ass`);
  await writeFile(outPath, ass, "utf8");
  console.log('[karaoke] Generated ASS file:', outPath, `(${wordTimingsFinal?.length || tokens.length} words)`);
  return outPath;
}

export default { buildKaraokeASS, buildKaraokeASSFromTimestamps };


