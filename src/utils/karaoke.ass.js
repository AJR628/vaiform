import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { normalizeWeight } from './font.registry.js';
import { getDurationMsFromMedia } from './media.duration.js';

function tokenize(text) {
  return String(text || '')
    .trim()
    .split(/\s+/);
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
  const wrappedLines = wrappedText.split('\n').map((line) =>
    line
      .trim()
      .split(/\s+/)
      .filter((w) => w.length > 0)
  );
  const flatWrapped = wrappedLines.flat();

  // Map: for each raw token index, which line does it belong to?
  const tokenToLine = [];
  let wrappedIdx = 0;

  for (let i = 0; i < rawTokens.length; i++) {
    // Find matching word in wrapped structure (case-insensitive, ignore punctuation)
    const rawWord = rawTokens[i].toLowerCase().replace(/[^\w]/g, '');

    while (wrappedIdx < flatWrapped.length) {
      const wrappedWord = flatWrapped[wrappedIdx].toLowerCase().replace(/[^\w]/g, '');
      if (
        wrappedWord === rawWord ||
        (rawWord && wrappedWord.includes(rawWord)) ||
        (wrappedWord && rawWord.includes(wrappedWord))
      ) {
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
  const s = Math.floor(t / 1000) % 60;
  const m = Math.floor(t / 60000) % 60;
  const h = Math.floor(t / 3600000);
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(cs)}`;
}

/**
 * Convert hex/rgb color to ASS BGR format (&H00BBGGRR)
 * @param {string} color - Hex color (#ffffff) or rgb/rgba string
 * @param {number} [alpha] - Alpha value 0-1 (default: 1.0)
 * @returns {string} ASS color format
 */
function colorToASS(color, alpha = 1.0) {
  if (!color) return '&H00FFFFFF';

  let r = 255,
    g = 255,
    b = 255;
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
  // ASS uses inverted alpha: 00 = opaque, FF = transparent
  const a = Math.round((1 - alpha) * 255);

  // Debug guard: Warn if alpha is inverted incorrectly (AA starts with FF when opacity=1)
  if (alpha >= 0.99 && a > 0xf0) {
    console.warn(
      `[karaoke:color] WARNING: Alpha inversion detected! opacity=${alpha}, ASS alpha=${a.toString(16).padStart(2, '0')} (should be 00 for opaque)`
    );
  }

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
  const hAlign = align === 'left' ? 1 : align === 'right' ? 3 : 2;
  const vAlign = placement === 'top' ? 3 : placement === 'bottom' ? 1 : 2;
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
  const raw = String(color || '');
  const norm = raw.toLowerCase().replace(/\s+/g, '');
  const isWhite =
    norm === '#ffffff' ||
    norm === 'white' ||
    norm === 'rgb(255,255,255)' ||
    norm === 'rgba(255,255,255,1)' ||
    norm === 'rgba(255,255,255,1.0)';

  let highlightColor;
  if (isWhite) {
    // White text: use blue-green/cyan highlight for visibility
    highlightColor = colorToASS('#00ffff', opacity); // Cyan/blue-green
  } else {
    // Colored text: increase brightness by ~40% and saturation
    let r = 255,
      g = 255,
      b = 255;
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
    highlightColor = colorToASS(
      `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
      opacity
    );
  }

  // Debug: Log resolved opacity and resulting colors
  console.log('[karaoke:style] Color conversion:', {
    color: color,
    opacity: opacity,
    primaryColour: primaryColor,
    secondaryColour: highlightColor,
    primaryAlpha: primaryColor.substring(2, 4), // Extract AA from &HAABBGGRR
    secondaryAlpha: highlightColor.substring(2, 4),
    warning: primaryColor.startsWith('&HFF')
      ? 'PrimaryColour has transparent alpha (FF) - should be 00 for opaque'
      : null,
  });

  // Warn if PrimaryColour starts with &HFF (transparent)
  if (primaryColor.startsWith('&HFF')) {
    console.warn(
      '[karaoke:style] WARNING: PrimaryColour has transparent alpha (FF). Caption fill will be invisible!'
    );
  }

  // Calculate margins based on position
  // MarginV: vertical margin (top for top placement, bottom for bottom placement)
  // For center placement, use 0 to center vertically
  let marginV = 0; // default center (was 260)
  if (placement === 'top') {
    // Use yPx_png directly (SSOT) if available, otherwise derive from yPct
    if (typeof overlayCaption.yPx_png === 'number' && Number.isFinite(overlayCaption.yPx_png)) {
      marginV = Math.round(overlayCaption.yPx_png); // Use SSOT value directly
    } else {
      marginV = Math.round(yPct * height); // Derive from yPct (no extra * 0.1)
    }
  } else if (placement === 'bottom') {
    // For bottom, MarginV is margin from bottom edge
    if (
      typeof overlayCaption.yPx_png === 'number' &&
      Number.isFinite(overlayCaption.yPx_png) &&
      typeof overlayCaption.rasterH === 'number'
    ) {
      // Calculate bottom margin: height - (yPx_png + rasterH)
      marginV = Math.round(height - (overlayCaption.yPx_png + overlayCaption.rasterH));
    } else {
      // Derive from yPct: bottom margin = (1 - yPct) * height (no extra * 0.1)
      marginV = Math.round((1 - yPct) * height);
    }
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

  // ASS Spacing scale: 1 = pixel equivalence (verify with test render)
  // If test shows mismatch, adjust this constant
  const ASS_SPACING_SCALE = 1;

  // Read letterSpacingPx from overlayCaption (which will be meta.effectiveStyle from render)
  const letterSpacingPx = overlayCaption?.letterSpacingPx ?? 0.5;

  // Apply scale (default 1, adjust if test shows mismatch)
  const assSpacing = letterSpacingPx * ASS_SPACING_SCALE;

  // Log for verification
  console.log('[karaoke:spacing]', {
    letterSpacingPx,
    assSpacing,
    source: overlayCaption?.letterSpacingPx ? 'overlayCaption' : 'default',
  });

  return {
    Fontname: fontFamily,
    Fontsize: Math.round(fontPx),
    PrimaryColour: primaryColor,
    SecondaryColour: highlightColor, // Brighter color for highlighted words
    OutlineColour: '&H80202020', // Dark outline
    BackColour: '&H00000000', // No background
    Bold: normalizeWeight(weightCss) >= 600 ? 1 : 0,
    Italic: fontStyle === 'italic' ? 1 : 0,
    Underline: 0,
    StrikeOut: 0,
    ScaleX: 100,
    ScaleY: 100,
    Spacing: assSpacing, // ✅ Replace hardcoded 0.5
    Angle: 0,
    BorderStyle: 1,
    Outline: 3, // Outline width
    Shadow: 1, // Shadow depth
    Alignment: alignmentToASS(textAlign, placement),
    MarginL: Math.max(0, marginL),
    MarginR: Math.max(0, marginR),
    MarginV: marginV,
  };
}

export async function buildKaraokeASS({
  text,
  durationMs,
  wrappedText = null,
  style = {
    Fontname: 'DejaVu Sans',
    Fontsize: 64,
    PrimaryColour: '&H00FFFFFF',
    OutlineColour: '&H80202020',
    BackColour: '&H00000000',
    SecondaryColour: '&H00FFFF00', // Cyan/blue-green highlight for karaoke
    Bold: 0,
    Italic: 0,
    Underline: 0,
    StrikeOut: 0,
    ScaleX: 100,
    ScaleY: 100,
    Spacing: 0.5,
    Angle: 0,
    BorderStyle: 1,
    Outline: 3,
    Shadow: 1,
    Alignment: 5, // Center-middle (was 2 = center-bottom)
    MarginL: 120,
    MarginR: 120,
    MarginV: 0, // Center vertically (was 260 = bottom margin)
  },
}) {
  const tokens = tokenize(text);
  if (!tokens.length) throw new Error('KARAOKE_NO_TOKENS');

  const minSlice = 120; // ms
  const weights = tokens.map((t) => Math.pow(Math.max(1, t.replace(/[^\w]/g, '').length), 0.9));
  const sumW = weights.reduce((a, b) => a + b, 0) || 1;
  let alloc = weights.map((w) => Math.max(minSlice, Math.floor(durationMs * (w / sumW))));
  // normalize to exactly durationMs
  let total = alloc.reduce((a, b) => a + b, 0);
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

  const parts = [];

  for (let i = 0; i < tokens.length; i++) {
    const wordDurationMs = alloc[i];

    // Compute duration in centiseconds for \k tag
    const durCs = Math.max(1, Math.round(wordDurationMs / 10));

    // Add karaoke timing using \k tag - wait durCs centiseconds, then change from SecondaryColour (cyan) to PrimaryColour (white)
    parts.push(`{\\k${durCs}}${tokens[i]}`);

    if (i < tokens.length - 1) {
      // Check if next word starts a new line
      if (
        wrapMap &&
        wrapMap.tokenToLine[i] !== undefined &&
        wrapMap.tokenToLine[i + 1] !== undefined
      ) {
        if (wrapMap.tokenToLine[i] !== wrapMap.tokenToLine[i + 1]) {
          parts.push('\\N'); // ASS newline
        } else {
          parts.push(' '); // Space between words on same line
        }
      } else {
        parts.push(' '); // Default: space between words
      }
    }
  }

  const start = msToHMS(0);
  const end = msToHMS(durationMs);

  const header = `[Script Info]
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

  const dialogue = `Dialogue: 0,${start},${end},QMain,,0,0,0,,${parts.join('')}\n`;
  const ass = header + dialogue;

  const outPath = join(tmpdir(), `vaiform-${randomUUID()}.ass`);
  await writeFile(outPath, ass, 'utf8');
  return outPath;
}

/**
 * Build ASS karaoke file from ElevenLabs timestamp data
 * @param {object} params
 * @param {string} params.text - Original text
 * @param {object} params.timestamps - ElevenLabs timestamp data with characters/words arrays
 * @param {number} [params.durationMs] - Total duration in ms from ElevenLabs API (fallback if timestamps incomplete)
 * @param {string} [params.audioPath] - Path to actual audio file for duration verification and scaling
 * @param {object} [params.style] - ASS style configuration (legacy, use overlayCaption instead)
 * @param {object} [params.overlayCaption] - Overlay caption object with styling (SSOT)
 * @param {number} [params.width] - Video width for margin calculations (default: 1080)
 * @param {number} [params.height] - Video height for margin calculations (default: 1920)
 * @returns {Promise<string>} Path to generated ASS file
 */
export async function buildKaraokeASSFromTimestamps({
  text,
  timestamps,
  durationMs,
  audioPath = null,
  wrappedText = null,
  style = {},
  overlayCaption = null,
  width = 1080,
  height = 1920,
}) {
  if (!text || !timestamps) {
    throw new Error('KARAOKE_TIMESTAMPS: text and timestamps required');
  }

  // Use words if available, otherwise fall back to characters
  const wordTimings = timestamps.words && timestamps.words.length > 0 ? timestamps.words : null;

  const charTimings =
    timestamps.characters && timestamps.characters.length > 0 ? timestamps.characters : null;

  if (!wordTimings && !charTimings) {
    // Fallback to estimated timing if no timestamps available
    console.warn('[karaoke] No word/character timestamps, falling back to estimated timing');
    if (durationMs) {
      return await buildKaraokeASS({ text, durationMs, style });
    }
    throw new Error('KARAOKE_TIMESTAMPS: No timestamps and no duration provided');
  }

  // Tokenize text into words
  const tokens = tokenize(text);
  if (!tokens.length) throw new Error('KARAOKE_NO_TOKENS');

  // Text/timestamp mismatch guard
  const wordCount = wordTimings ? wordTimings.length : charTimings ? charTimings.length : 0;
  const tokenCount = tokens.length;
  if (Math.abs(tokenCount - wordCount) > 2) {
    console.warn(`[karaoke] text/timestamps mismatch: ${tokenCount} tokens vs ${wordCount} words`);
  } else {
    console.log(`[karaoke] text/timestamps match: ${tokenCount} tokens vs ${wordCount} words`);
  }

  // Log text used for ASS
  const assText = wrappedText || text;
  console.log(
    '[karaoke] Text used for ASS:',
    assText.substring(0, 100) + (assText.length > 100 ? '...' : '')
  );

  // Build word-level timing from character timings if needed
  let wordTimingsFinal = wordTimings;
  if (!wordTimingsFinal && charTimings && charTimings.length > 0) {
    // Reconstruct word timings from character timings
    // Build a character string from the character timings to match against text
    const charString = charTimings.map((c) => c.character || '').join('');

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
        for (let j = 0; j < word.length && i + j < charTimings.length; j++) {
          const charFromTiming = charTimings[i + j].character || '';
          const charFromWord = word[j] || '';
          // Match character (case-insensitive, ignore spaces)
          if (
            charFromTiming.toLowerCase() !== charFromWord.toLowerCase() &&
            charFromTiming !== ' ' &&
            charFromWord !== ' '
          ) {
            matches = false;
            break;
          }
        }

        if (matches && wordStartCharIdx === -1) {
          wordStartCharIdx = i;
          // Skip spaces before the word
          while (
            wordStartCharIdx < charTimings.length &&
            (charTimings[wordStartCharIdx].character === ' ' ||
              charTimings[wordStartCharIdx].character === '\n')
          ) {
            wordStartCharIdx++;
          }
          // Find end of word (last non-space character)
          wordEndCharIdx = wordStartCharIdx;
          let charsMatched = 0;
          for (
            let k = wordStartCharIdx;
            k < charTimings.length && charsMatched < word.length;
            k++
          ) {
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
          end_time_ms: endChar.end_time_ms || (startChar.start_time_ms || 0) + 200,
        });
        charIdx = wordEndCharIdx + 1; // Move past this word
      } else {
        // Fallback: estimate timing based on previous word or average
        const estimatedDuration = durationMs ? durationMs / tokens.length : 200;
        const lastEnd =
          wordTimingsFinal.length > 0
            ? wordTimingsFinal[wordTimingsFinal.length - 1].end_time_ms
            : 0;
        wordTimingsFinal.push({
          word: word,
          start_time_ms: lastEnd,
          end_time_ms: lastEnd + estimatedDuration,
        });
        // Don't advance charIdx on fallback to avoid getting stuck
      }
    }

    console.log(
      '[karaoke] Reconstructed word timings from character timings:',
      wordTimingsFinal.length,
      'words'
    );
  }

  // Get actual audio file duration via ffprobe if audioPath is provided
  let ffprobeDurationMs = null;
  if (audioPath) {
    try {
      ffprobeDurationMs = await getDurationMsFromMedia(audioPath);
      if (ffprobeDurationMs) {
        console.log('[karaoke] ffprobe audio duration:', ffprobeDurationMs, 'ms');
      } else {
        console.warn('[karaoke] Could not get duration from audio file via ffprobe');
      }
    } catch (err) {
      console.warn('[karaoke] Failed to get audio duration via ffprobe:', err?.message);
    }
  }

  // Calculate sum of word durations from timestamps (base for scaling)
  let sumDurMs = 0;
  if (wordTimingsFinal && wordTimingsFinal.length > 0) {
    sumDurMs = wordTimingsFinal.reduce((sum, timing) => {
      const wordStartMs = timing.start_time_ms || 0;
      const wordEndMs = timing.end_time_ms || wordStartMs + 200;
      return sum + (wordEndMs - wordStartMs);
    }, 0);
  }

  // Log duration comparison
  console.log('[karaoke] Duration comparison:', {
    sumDurMs: sumDurMs || 'not calculated',
    durationMs: durationMs || 'not provided (ElevenLabs API)',
    ffprobeDurationMs: ffprobeDurationMs || 'not available',
    note: 'sumDurMs = sum of word durations from timestamps',
  });

  // Determine if scaling is needed and calculate scale factor
  // Use ffprobe duration as ground truth if available, otherwise use durationMs from API
  const targetDurationMs = ffprobeDurationMs || durationMs;
  let scale = 1.0;
  let shouldScale = false;

  if (targetDurationMs && sumDurMs > 0) {
    const diff = Math.abs(targetDurationMs - sumDurMs);
    // Scale if difference is significant (>50ms threshold)
    if (diff > 50) {
      scale = targetDurationMs / sumDurMs;
      shouldScale = true;
      console.log('[karaoke] Duration mismatch detected - applying scaling:', {
        sumDurMs,
        targetDurationMs,
        diff,
        scale: scale.toFixed(4),
        note: 'Word durations will be scaled proportionally',
      });
    } else {
      console.log('[karaoke] Duration match - no scaling needed:', {
        sumDurMs,
        targetDurationMs,
        diff,
        note: 'Difference is within tolerance',
      });
    }
  } else if (!targetDurationMs) {
    console.warn('[karaoke] No target duration available - cannot verify or scale timing');
  }

  // Calculate total duration for ASS dialogue end time
  // Use ffprobe duration as ground truth if available, otherwise fall back to durationMs or sumDurMs
  const FADE_OUT_MS = 150; // Buffer to keep captions visible until TTS fully ends
  const effectiveDurationMs = ffprobeDurationMs || durationMs || (sumDurMs > 0 ? sumDurMs : null);
  const totalDurationMs = effectiveDurationMs
    ? effectiveDurationMs + FADE_OUT_MS
    : wordTimingsFinal.length > 0
      ? wordTimingsFinal[wordTimingsFinal.length - 1].end_time_ms + FADE_OUT_MS
      : 3000;

  const start = msToHMS(0);
  // Use effectiveDurationMs (ffprobe if available, else durationMs) for end time
  // This ensures dialogue end matches actual audio duration
  const end = msToHMS(
    effectiveDurationMs !== null && effectiveDurationMs !== undefined
      ? effectiveDurationMs
      : totalDurationMs
  );

  // Log timing verification for debugging
  const lastWordEndMs =
    wordTimingsFinal.length > 0 ? wordTimingsFinal[wordTimingsFinal.length - 1].end_time_ms : null;
  console.log('[karaoke] ASS dialogue timing:', {
    sumDurMs: sumDurMs || 'not calculated',
    durationMs: durationMs || 'not provided (ElevenLabs API)',
    ffprobeDurationMs: ffprobeDurationMs || 'not available',
    effectiveDurationMs: effectiveDurationMs || 'not available',
    lastWordEndMs: lastWordEndMs,
    dialogueEndMs: totalDurationMs,
    dialogueEndSec: (totalDurationMs / 1000).toFixed(2),
    fadeOutBufferMs: 150,
    scale: shouldScale ? scale.toFixed(4) : 'none (1.0)',
    usingFfprobeDuration: !!ffprobeDurationMs,
    note: 'Dialogue end uses ffprobe duration when available to match actual audio',
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
        alignment: overlayStyle.Alignment,
      });
    } else {
      // Fallback to defaults if conversion fails
      // Use center-middle alignment to match centered drawtext at y=(h-text_h)/2
      finalStyle = {
        Fontname: 'DejaVu Sans',
        Fontsize: 64,
        PrimaryColour: '&H00FFFFFF',
        OutlineColour: '&H80202020',
        BackColour: '&H00000000',
        SecondaryColour: '&H00FFFF00', // Cyan/blue-green highlight
        Bold: 0,
        Italic: 0,
        Underline: 0,
        StrikeOut: 0,
        ScaleX: 100,
        ScaleY: 100,
        Spacing: 0.5,
        Angle: 0,
        BorderStyle: 1,
        Outline: 3,
        Shadow: 1,
        Alignment: 5, // Center-middle (was 2 = center-bottom)
        MarginL: 40,
        MarginR: 40,
        MarginV: 0, // Center vertically (was 260 = bottom margin)
      };
    }
  } else {
    // Use provided style or defaults (legacy mode)
    // Use center-middle alignment to match centered drawtext at y=(h-text_h)/2
    const defaultStyle = {
      Fontname: 'DejaVu Sans',
      Fontsize: 64,
      PrimaryColour: '&H00FFFFFF',
      OutlineColour: '&H80202020',
      BackColour: '&H00000000',
      SecondaryColour: '&H00FFFF00', // Cyan/blue-green highlight for karaoke
      Bold: 0,
      Italic: 0,
      Underline: 0,
      StrikeOut: 0,
      ScaleX: 100,
      ScaleY: 100,
      Spacing: 0.5,
      Angle: 0,
      BorderStyle: 1,
      Outline: 3,
      Shadow: 1,
      Alignment: 5, // Center-middle (was 2 = center-bottom)
      MarginL: 40,
      MarginR: 40,
      MarginV: 0, // Center vertically (was 260 = bottom margin)
    };
    finalStyle = { ...defaultStyle, ...style };
  }

  // Build ASS karaoke parts with word-level highlighting using \k tags
  // \k tags work by: wait NN centiseconds, then change from SecondaryColour (highlight) to PrimaryColour (normal)
  // Each word gets its own \k tag with duration from TTS word timings, scaled if needed to match actual audio duration

  // Map tokens to wrapped lines if wrappedText is provided
  const wrapMap = wrappedText ? mapTokensToWrappedLines(tokens, wrappedText) : null;

  const parts = [];
  const kValues = []; // Track all \k values for verification
  const scaledDurations = []; // Track scaled durations for logging

  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i];
    const timing = wordTimingsFinal[i];

    let durMs;
    if (!timing) {
      // Fallback timing - estimate duration based on total duration and number of tokens
      durMs = effectiveDurationMs ? effectiveDurationMs / tokens.length : 200;
    } else {
      // Use the word's actual timing from TTS timestamps
      const wordStartMs = timing.start_time_ms || 0;
      const wordEndMs = timing.end_time_ms || wordStartMs + 200;
      durMs = wordEndMs - wordStartMs;

      // Apply scaling if needed to match actual audio duration
      if (shouldScale && scale !== 1.0) {
        durMs = durMs * scale;
        scaledDurations.push({ word, original: wordEndMs - wordStartMs, scaled: durMs });
      }
    }

    // Compute duration in centiseconds for \k tag
    const k = Math.max(1, Math.round(durMs / 10));
    kValues.push(k);

    // Add karaoke timing using \k tag - wait k centiseconds, then change from SecondaryColour (cyan) to PrimaryColour (white)
    parts.push(`{\\k${k}}${word}`);

    if (i < tokens.length - 1) {
      // Check if next word starts a new line
      if (
        wrapMap &&
        wrapMap.tokenToLine[i] !== undefined &&
        wrapMap.tokenToLine[i + 1] !== undefined
      ) {
        if (wrapMap.tokenToLine[i] !== wrapMap.tokenToLine[i + 1]) {
          parts.push('\\N'); // ASS newline
        } else {
          parts.push(' '); // Space between words on same line
        }
      } else {
        parts.push(' '); // Default: space between words
      }
    }
  }

  // Verification logging: \k values and sum
  const first10K = kValues.slice(0, Math.min(10, kValues.length));
  const sumKCs = kValues.reduce((sum, k) => sum + k, 0);
  const sumKMs = sumKCs * 10; // Convert centiseconds to milliseconds
  const targetForComparison = ffprobeDurationMs || durationMs || sumDurMs;
  const diff = targetForComparison ? sumKMs - targetForComparison : null;

  console.log('[karaoke] First 10 \\k values:', first10K);
  if (shouldScale && scaledDurations.length > 0) {
    const sampleScaled = scaledDurations.slice(0, Math.min(3, scaledDurations.length));
    console.log('[karaoke] Sample scaled word durations:', JSON.stringify(sampleScaled));
  }
  console.log('[karaoke] \\k sum verification:', {
    sumKCs,
    sumKMs,
    targetDurationMs: targetForComparison || 'not available',
    diff: diff !== null ? diff : 'not calculated',
    scale: shouldScale ? scale.toFixed(4) : 'none (1.0)',
    wordCount: kValues.length,
    note: 'Sum should match targetDurationMs after scaling',
  });

  const header = `[Script Info]
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

  const dialogue = `Dialogue: 0,${start},${end},QMain,,0,0,0,,${parts.join('')}\n`;
  const ass = header + dialogue;

  // Debug: Log full Dialogue line for verification
  console.log('[karaoke] Dialogue preview:', dialogue.trim());

  // Debug: Log style verification
  console.log('[karaoke] Style verification:', {
    styleName: 'QMain',
    primaryColour: finalStyle.PrimaryColour,
    secondaryColour: finalStyle.SecondaryColour,
    note: 'PrimaryColour should be white, SecondaryColour should be cyan highlight',
  });

  // Debug: Log first few words and their timing
  if (wordTimingsFinal && wordTimingsFinal.length > 0) {
    const sampleWords = wordTimingsFinal.slice(0, 3).map((t, i) => ({
      word: tokens[i],
      start: t.start_time_ms,
      end: t.end_time_ms,
      duration: t.end_time_ms - t.start_time_ms,
    }));
    console.log('[karaoke] Sample word timings:', JSON.stringify(sampleWords));
  }

  // Log ASS dialogue timing summary
  console.log('[karaoke] ASS dialogue timing summary:', {
    start: start,
    end: end,
    sumDurMs: sumDurMs || 'not calculated',
    durationMs: durationMs || 'not provided (ElevenLabs API)',
    ffprobeDurationMs: ffprobeDurationMs || 'not available',
    effectiveDurationMs: effectiveDurationMs || 'not available',
    totalDurationMs: totalDurationMs,
    scale: shouldScale ? scale.toFixed(4) : 'none (1.0)',
    note: 'End time uses ffprobe duration when available to match actual audio file',
  });

  const outPath = join(tmpdir(), `vaiform-${randomUUID()}.ass`);
  await writeFile(outPath, ass, 'utf8');
  console.log(
    '[karaoke] Generated ASS file:',
    outPath,
    `(${wordTimingsFinal?.length || tokens.length} words)`
  );
  return outPath;
}

export default { buildKaraokeASS, buildKaraokeASSFromTimestamps };
