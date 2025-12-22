# Karaoke Captions Wiring Audit (ASS/FFmpeg)

**Date:** 2024  
**Scope:** Complete end-to-end audit of karaoke caption implementation in Vaiform  
**Status:** Audit only (no code changes)

---

## A) File Map

### Core ASS Generation
- **[src/utils/karaoke.ass.js](src/utils/karaoke.ass.js)** — Primary ASS subtitle generation module
  - `buildKaraokeASS()` — Legacy function for estimated word timing (lines 244-341)
  - `buildKaraokeASSFromTimestamps()` — Main function using TTS word timings (lines 356-758)
  - `convertOverlayToASSStyle()` — Converts overlay caption styling to ASS format (lines 137-242)
  - Helper functions: `tokenize()`, `msToHMS()`, `colorToASS()`, `alignmentToASS()`, `mapTokensToWrappedLines()`

### TTS & Timestamp Extraction
- **[src/services/tts.service.js](src/services/tts.service.js)** — TTS service with timestamp support
  - `synthVoiceWithTimestamps()` — Generates TTS audio with word/character timestamps (lines 339-445)
- **[src/adapters/elevenlabs.adapter.js](src/adapters/elevenlabs.adapter.js)** — ElevenLabs API adapter
  - `elevenLabsSynthesizeWithTimestamps()` — Extracts timestamps from ElevenLabs API response (lines 40-234)
  - Parses `alignment` or `normalized_alignment` fields into `words[]` and `characters[]` arrays

### FFmpeg Rendering
- **[src/utils/ffmpeg.video.js](src/utils/ffmpeg.video.js)** — Main video rendering pipeline
  - `buildVideoChain()` — Builds FFmpeg filter graph, adds ASS subtitles (lines 382-634)
  - `renderVideoQuoteOverlay()` — Renders video with captions and ASS karaoke (lines 727-1764)
  - ASS integration points:
    - Raster overlay mode: lines 536-544 (adds `subtitles=` filter after PNG overlay)
    - Legacy overlay mode: lines 583-627 (uses `subtitles=` instead of `drawtext` when `assPath` present)
- **[src/utils/ffmpeg.js](src/utils/ffmpeg.js)** — Solid color and image background rendering
  - `renderSolidQuoteVideo()` — Solid color backgrounds with ASS (lines 210-286)
  - `renderImageQuoteVideo()` — Image backgrounds with ASS (lines 288-730)
  - Both use `subtitles='${esc(assPath)}'` filter when `assPath` is provided

### Service Integration
- **[src/services/story.service.js](src/services/story.service.js)** — Story rendering pipeline
  - `renderStory()` — Renders story segments with karaoke captions (lines 737-1011)
  - Calls `synthVoiceWithTimestamps()` → `buildKaraokeASSFromTimestamps()` → `renderVideoQuoteOverlay()` (lines 776-916)
- **[src/services/shorts.service.js](src/services/shorts.service.js)** — Shorts/quote video rendering
  - `createShortService()` — Main entry point (lines 28-705)
  - Karaoke detection and ASS generation: lines 160-223
  - Calls `buildKaraokeASS()` for estimated timing or `buildKaraokeASSFromTimestamps()` if timestamps available

### Capability Detection
- **[src/utils/ffmpeg.capabilities.js](src/utils/ffmpeg.capabilities.js)** — FFmpeg feature detection
  - `hasSubtitlesFilter()` — Checks if FFmpeg supports `subtitles`/`ass` filter (lines 7-24)
  - Used to determine if karaoke mode should use ASS or fallback to progress bar

---

## B) Data Model & Inputs

### Text Source
- **Origin:** Quote text from `usedQuote.text` (shorts) or `caption.text` (story segments)
- **Format:** Plain string, whitespace-normalized
- **Wrapping:** Optional `wrappedText` parameter (newline-separated lines) for multi-line display

### TTS Timestamp Structure

**ElevenLabs API Response Format:**
```json
{
  "audio_base64": "...",
  "alignment": {
    "characters": [
      { "character": "H", "start_time_ms": 0, "end_time_ms": 50 },
      { "character": "e", "start_time_ms": 50, "end_time_ms": 100 }
    ],
    "words": [
      { "word": "Hello", "start_time_ms": 0, "end_time_ms": 200 },
      { "word": "world", "start_time_ms": 200, "end_time_ms": 400 }
    ]
  }
}
```

**Internal Timestamp Format (after parsing):**
```javascript
{
  characters: [
    { character: "H", start_time_ms: 0, end_time_ms: 50 },
    { character: "e", start_time_ms: 50, end_time_ms: 100 }
  ],
  words: [
    { word: "Hello", start_time_ms: 0, end_time_ms: 200 },
    { word: "world", start_time_ms: 200, end_time_ms: 400 }
  ]
}
```

**Units:** All timestamps are in **milliseconds** (`start_time_ms`, `end_time_ms`)

**Conversion Points:**
- ElevenLabs API may return seconds → converted to ms in adapter (lines 146-147, 189-190 in `elevenlabs.adapter.js`)
- ASS `\k` tags require **centiseconds** → conversion at line 657 in `karaoke.ass.js`: `Math.round(durMs / 10)`
- ASS dialogue times use `msToHMS()` format: `HH:MM:SS.CS` (centiseconds)

### Overlay Caption Styling (SSOT)

**Input Structure:**
```javascript
{
  fontFamily: "DejaVu Sans",
  fontPx: 64,
  color: "#ffffff",
  opacity: 1.0,
  textAlign: "center",
  placement: "center",
  weightCss: "normal",
  fontStyle: "normal",
  yPct: 0.5,
  xPct: 0.5,
  wPct: 0.8,
  lines: ["Line 1", "Line 2"] // Optional wrapped text
}
```

**Conversion:** `convertOverlayToASSStyle()` (lines 137-242) converts to ASS style format with:
- `PrimaryColour`: Base text color (white by default)
- `SecondaryColour`: Highlight color (cyan `#00ffff` for white text, brighter version for colored text)
- `Fontname`, `Fontsize`, `Bold`, `Italic`, `Alignment`, `MarginL/R/V`, `Outline`, `Shadow`

---

## C) ASS Generation Details

### ASS Header & Styles

**Header Template** (lines 699-714 in `karaoke.ass.js`):
```
[Script Info]
ScriptType: v4.00+
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.601
PlayResX: 1080
PlayResY: 1920

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: QMain, DejaVu Sans, 64, &H00FFFFFF, &H00FFFF00, &H80202020, &H00000000, 0, 0, 0, 0, 100, 100, 0.5, 0, 1, 3, 1, 5, 120, 120, 0, 1
```

**Key Style Properties:**
- `PrimaryColour: &H00FFFFFF` — White (final color after karaoke highlight)
- `SecondaryColour: &H00FFFF00` — Cyan/blue-green (highlight color shown before word is spoken)
- `OutlineColour: &H80202020` — Dark outline (semi-transparent)
- `Alignment: 5` — Center-middle (was 2 = center-bottom in legacy)
- `MarginV: 0` — Vertical centering (was 260 = bottom margin in legacy)
- `BorderStyle: 1`, `Outline: 3`, `Shadow: 1` — Text outline and shadow

### Dialogue Line Construction

**Karaoke Mechanism:** Uses ASS `\k` (karaoke) tags

**How `\k` Tags Work:**
- `\k` tag waits N centiseconds, then changes text from `SecondaryColour` (cyan) to `PrimaryColour` (white)
- Format: `{\kNN}word` where NN is duration in centiseconds
- Each word gets its own `\k` tag with duration computed from TTS timestamps

**Dialogue Line Generation** (lines 635-675 in `karaoke.ass.js`):

```javascript
for (let i = 0; i < tokens.length; i++) {
  const word = tokens[i];
  const timing = wordTimingsFinal[i];
  
  // Calculate word duration from TTS timestamps
  const wordStartMs = timing.start_time_ms || 0;
  const wordEndMs = timing.end_time_ms || (wordStartMs + 200);
  let durMs = wordEndMs - wordStartMs;
  
  // Apply scaling if audio duration doesn't match timestamp sum
  if (shouldScale && scale !== 1.0) {
    durMs = durMs * scale;
  }
  
  // Convert to centiseconds for \k tag
  const k = Math.max(1, Math.round(durMs / 10));
  
  // Build ASS karaoke part: {\kNN}word
  parts.push(`{\\k${k}}${word}`);
  
  // Add space or newline between words
  if (i < tokens.length - 1) {
    if (wrapMap && wrapMap.tokenToLine[i] !== wrapMap.tokenToLine[i + 1]) {
      parts.push("\\N"); // ASS newline
    } else {
      parts.push(" "); // Space
    }
  }
}
```

**Example Generated Dialogue Line:**
```
Dialogue: 0,0:00:00.00,0:00:03.50,QMain,,0,0,0,,{\k20}Hello {\k30}world {\k25}this {\k40}is {\k35}karaoke
```

**Explanation:**
- `{\k20}Hello` — Wait 20 centiseconds (200ms), then change "Hello" from cyan to white
- `{\k30}world` — Wait 30 centiseconds (300ms), then change "world" from cyan to white
- Each word starts in `SecondaryColour` (cyan) and transitions to `PrimaryColour` (white) after its `\k` duration

### Duration Scaling Logic

**Problem:** TTS timestamp sum may not match actual audio file duration

**Solution** (lines 512-541 in `karaoke.ass.js`):
1. Calculate sum of word durations from timestamps: `sumDurMs`
2. Get target duration: `ffprobeDurationMs` (from audio file) or `durationMs` (from API)
3. If difference > 50ms, calculate scale factor: `scale = targetDurationMs / sumDurMs`
4. Apply scale to each word duration: `durMs = durMs * scale`

**Verification Logging:**
- Logs first 10 `\k` values (line 684)
- Logs sum of all `\k` values vs target duration (lines 689-697)
- Logs sample scaled durations if scaling applied (lines 686-688)

### Cyan → White Behavior

**Implementation:**
1. **Initial State:** All text rendered in `SecondaryColour` (`&H00FFFF00` = cyan)
2. **Per-Word Transition:** Each word has `{\kNN}` tag that waits NN centiseconds
3. **After Wait:** Word changes to `PrimaryColour` (`&H00FFFFFF` = white)
4. **Result:** Sentence starts cyan, words turn white as they're spoken

**ASS Color Format:**
- Format: `&HAABBGGRR` (AA=alpha, BB=blue, GG=green, RR=red)
- Cyan: `&H00FFFF00` = `&H00` (alpha) + `FF` (blue) + `FF` (green) + `00` (red)
- White: `&H00FFFFFF` = `&H00` (alpha) + `FF` (blue) + `FF` (green) + `FF` (red)

**No Per-Word Override Blocks:** The current implementation does NOT use per-word `\c&H...` overrides. The color change is driven entirely by the `\k` tag timing and the style's `PrimaryColour`/`SecondaryColour` settings.

---

## D) FFmpeg Burn-In Stage

### FFmpeg Command Structure

**Main Rendering Function:** `renderVideoQuoteOverlay()` in `src/utils/ffmpeg.video.js`

**Command Builder** (lines 1702-1720):
```javascript
const args = [
  '-y',
  '-i', videoPath,
  ...(usingCaptionPng ? ['-i', captionPngPath] : []),
  ...(ttsPath ? ['-i', ttsPath] : []),
  ...(hasKaraoke ? [] : ['-ss', '0.5']), // Skip video start offset for karaoke alignment
  '-filter_complex', finalFilter,
  '-map', '[vout]', '-map', '[aout]',
  '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast',
  '-color_primaries', 'bt709',
  '-color_trc', 'bt709',
  '-colorspace', 'bt709',
  '-c:a', 'aac', '-b:a', '96k',
  '-movflags', '+faststart',
  '-r', String(fps),
  '-t', String(outSec),
  outPath,
];
```

**Key Points:**
- `-ss 0.5` is **skipped** when `hasKaraoke` is true (line 1708) to align with ASS dialogue start at `0:00:00.00`
- ASS file path is embedded in `-filter_complex` string, not passed as separate input

### Filter Graph Order

**Raster Overlay Mode** (lines 439-559 in `buildVideoChain()`):
```
[0:v]scale=...:crop=...:format=rgba[vmain];
[1:v]format=rgba[ovr];
[vmain][ovr]overlay=x:y:format=auto,format=yuv420p[vsub];
[vsub]subtitles='path/to/file.ass'[vout]
```

**Order:**
1. Video scaling/cropping → `[vmain]`
2. PNG caption overlay → `[ovr]`
3. Overlay composition → `[vsub]`
4. **ASS subtitles** → `[vout]` (applied after PNG overlay)

**Legacy Overlay Mode** (lines 583-627):
```
[0:v]scale=...:crop=...:format=rgba[base];
[base]subtitles='path/to/file.ass'[vsub];
[vsub]drawtext=...:format=yuv420p:colorspace=all=bt709:fast=1[vout]
```

**Order:**
1. Video scaling/cropping → `[base]`
2. **ASS subtitles** → `[vsub]` (replaces drawtext when assPath present)
3. Other layers (watermark, etc.) → `[vout]`

**Solid Color Background** (`renderSolidQuoteVideo`, lines 233-240):
```
subtitles='path/to/file.ass',drawtext=... (author line),drawtext=... (watermark)
```

**Image Background** (`renderImageQuoteVideo`, lines 473-480):
```
scale=...:crop=...,kenburns=...,format=rgba[cover];
[cover]subtitles='path/to/file.ass'[vsub];
[vsub]drawtext=... (author),format=yuv420p[vout]
```

### libass Settings

**Subtitles Filter Syntax:**
```javascript
const escAssPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
const subtitlesFilter = `[vsub]subtitles='${escAssPath}'[vout]`;
```

**Optional Fonts Directory** (lines 594-608):
```javascript
let fontsDir = null;
try {
  const fontPath1 = path.resolve(process.cwd(), 'assets', 'fonts');
  const fontPath2 = path.resolve(process.cwd(), 'src', 'assets', 'fonts');
  if (fs.existsSync(fontPath1)) {
    fontsDir = fontPath1;
  } else if (fs.existsSync(fontPath2)) {
    fontsDir = fontPath2;
  }
} catch (e) {
  // Ignore errors, fontsdir is optional
}

const fontsDirParam = fontsDir ? `:fontsdir='${fontsDir.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")}'` : '';
const subtitlesFilter = `[base]subtitles='${escAssPath}'${fontsDirParam}[vsub]`;
```

**No `force_style` Override:** The current implementation does not use `force_style` parameter. All styling comes from the ASS file's `[V4+ Styles]` section.

**Margins:** Handled via ASS style `MarginL`, `MarginR`, `MarginV` properties, not FFmpeg filter parameters.

### ASS File Location at Render Time

**File Creation** (line 754 in `karaoke.ass.js`):
```javascript
const outPath = join(tmpdir(), `vaiform-${randomUUID()}.ass`);
await writeFile(outPath, ass, "utf8");
```

**Path Format:** `/tmp/vaiform-{UUID}.ass` (or Windows equivalent)

**Lifecycle:**
- Created in system temp directory (`os.tmpdir()`)
- Passed to FFmpeg via `-filter_complex` string
- **Not automatically cleaned up** — relies on OS temp file cleanup or manual deletion
- File exists for duration of render process

**Per-Beat/Per-Video:** Each video segment gets its own ASS file (one per story segment, one per short video)

---

## E) "Where to Add Word Pop"

### Current Implementation Analysis

**Karaoke Mechanism:** Uses ASS `\k` tags with style-level color transition
- **Base sentence:** `SecondaryColour` (cyan)
- **Active word:** Transitions to `PrimaryColour` (white) after `\k` duration
- **No per-word styling:** All words use same style, color change is timing-based

### Recommended Insertion Point

**Location:** `src/utils/karaoke.ass.js`, function `buildKaraokeASSFromTimestamps()`, lines 660-661

**Current Code:**
```javascript
// Add karaoke timing using \k tag - wait k centiseconds, then change from SecondaryColour (cyan) to PrimaryColour (white)
parts.push(`{\\k${k}}${word}`);
```

**Recommended Enhancement:**
Add per-word override block with scale/alpha animation for "pop" effect:

```javascript
// Add karaoke timing with pop effect
// \k tag handles color transition, \t() handles scale/alpha animation
const popDuration = Math.min(k * 10, 200); // Pop duration in ms (max 200ms)
const popStart = 0;
const popEnd = popDuration;
// Scale: 1.0 → 1.15 → 1.0 over popDuration
// Alpha: 1.0 → 1.0 (no fade, just scale)
parts.push(`{\\k${k}\\t(${popStart},${popEnd},\\fscx115\\fscy115)\\t(${popEnd},${popEnd + 50},\\fscx100\\fscy100)}${word}`);
```

**Alternative (Simpler):**
```javascript
// Pop effect: scale up then down during first 150ms of word
parts.push(`{\\k${k}\\t(0,150,\\fscx110\\fscy110)\\t(150,200,\\fscx100\\fscy100)}${word}`);
```

### Per-Word Override Feasibility

**✅ Confirmed:** Per-word override blocks are **possible** with current scheme

**ASS Override Tags:**
- `\fscxNNN` / `\fscyNNN` — Scale X/Y (100 = 100%, 110 = 110%)
- `\t(start,end,overrides)` — Time-based animation
- `\c&H...` — Color override (not needed, `\k` handles color)
- `\alpha&H...` — Alpha/opacity (optional for fade)

**Scope:** Override blocks apply to the word they precede. Multiple overrides can be combined in one block.

### Gotchas & Limitations

1. **`\k` Tag Behavior:**
   - `\k` waits N centiseconds, then applies `PrimaryColour`
   - Override blocks with `\t()` can run concurrently with `\k` timing
   - Scale animation can start immediately while color transition waits

2. **Timing Coordination:**
   - Pop effect should complete before or during word's active period
   - Recommended: Pop in first 150-200ms, then hold at normal scale
   - Avoid pop extending beyond word's `\k` duration

3. **Style Inheritance:**
   - Override blocks inherit base style properties
   - `\fscx`/`\fscy` are relative to style's `ScaleX`/`ScaleY` (100 = 100%)
   - Font size from style is not affected by scale overrides

4. **Performance:**
   - Multiple `\t()` animations per word may impact rendering performance
   - Test with long sentences to ensure smooth playback

5. **Line Breaks:**
   - Current code handles `\N` (newline) between words (lines 664-673)
   - Pop effect should work across line breaks, but test multi-line scenarios

### Implementation Checklist

- [ ] Add `\t()` override block to word parts in `buildKaraokeASSFromTimestamps()` (line 661)
- [ ] Test with single-word sentences
- [ ] Test with multi-line wrapped text
- [ ] Verify timing alignment with audio (pop should sync with word start)
- [ ] Test performance with long sentences (50+ words)
- [ ] Consider making pop effect optional/configurable (add parameter to function)
- [ ] Update logging to show pop effect parameters in debug output

---

## F) Risk / Regression Notes

### Preview vs Final Render Differences

**Preview System:** `public/js/caption-preview.js`, `src/routes/caption.preview.routes.js`
- **Preview:** Uses browser Canvas API to render captions with word-level highlighting
- **Final Render:** Uses ASS subtitles via FFmpeg
- **Risk:** Preview may not match final render exactly (different rendering engines)
- **Mitigation:** Preview uses same styling data (SSOT), but rendering paths differ

**Known Differences:**
- Preview uses Canvas `fillText()` with manual word positioning
- Final render uses libass subtitle renderer
- Font rendering may differ (browser vs libass)
- Line wrapping may differ (browser text metrics vs ASS word wrapping)

### Font Availability Issues

**Font Resolution:**
- ASS files specify `Fontname: "DejaVu Sans"` (or from overlay caption)
- FFmpeg `subtitles` filter uses system fonts or `fontsdir` parameter
- **Risk:** Font may not be available on render server
- **Current Mitigation:** Optional `fontsdir` parameter points to `assets/fonts` or `src/assets/fonts` (lines 594-608)

**Hardcoded Font Paths:**
- Default font: `"DejaVu Sans"` (line 249, 593, 609 in `karaoke.ass.js`)
- Fallback in `renderSolidQuoteVideo`: `/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf` (line 249 in `ffmpeg.js`)
- **Risk:** Font path may not exist on Windows or custom Linux setups

**Recommendation:** Add font file existence check before ASS generation, or use more robust font fallback chain.

### Concurrency Hazards

**Temp File Naming:**
- ASS files use `randomUUID()` for uniqueness (line 338, 754 in `karaoke.ass.js`)
- Format: `vaiform-{UUID}.ass`
- **Risk:** UUID collision is extremely unlikely but theoretically possible
- **Mitigation:** UUID v4 provides 122 bits of entropy

**File Cleanup:**
- ASS files are created in system temp directory
- **Not automatically deleted** after render completes
- **Risk:** Temp directory may fill up over time
- **Current Behavior:** Relies on OS temp file cleanup (typically on reboot or periodic cleanup)

**Recommendation:** Add cleanup hook to delete ASS files after successful render, or use `tmp` package with automatic cleanup.

### Timing Synchronization Risks

**Duration Mismatch:**
- TTS timestamp sum may not match actual audio duration
- Scaling logic (lines 512-541) attempts to correct this
- **Risk:** If scaling fails or is inaccurate, words may desync from audio
- **Mitigation:** Logs scaling factor and verification data (lines 684-697)

**Video Start Offset:**
- `-ss 0.5` is skipped when karaoke is present (line 1708 in `ffmpeg.video.js`)
- **Risk:** If ASS dialogue doesn't start at `0:00:00.00`, words will be misaligned
- **Current Behavior:** ASS dialogue always starts at `0:00:00.00` (line 553 in `karaoke.ass.js`)

**Audio Delay:**
- `voiceoverDelaySec` parameter can delay TTS audio start
- **Risk:** ASS timing doesn't account for audio delay
- **Current Behavior:** ASS dialogue starts at video start, not accounting for TTS delay
- **Recommendation:** Adjust ASS dialogue start time if `voiceoverDelaySec > 0`

### Character vs Word Timestamp Fallback

**Fallback Chain:**
1. Prefer `timestamps.words` if available
2. Fall back to `timestamps.characters` and reconstruct word timings (lines 398-477)
3. Fall back to estimated timing if no timestamps (line 374)

**Risk:** Character-to-word reconstruction may be inaccurate if:
- Character timings are incomplete
- Word boundaries don't align with character boundaries
- Punctuation/spaces cause matching issues

**Mitigation:** Logs reconstruction results (line 476) and warns on mismatches (line 387)

### ASS File Path Escaping

**Path Escaping** (lines 539, 591 in `ffmpeg.video.js`):
```javascript
const escAssPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
```

**Risk:** Complex paths (spaces, special chars) may not be properly escaped
- Windows paths with drive letters: `C:\Users\...` → `C\:/Users/...`
- Paths with spaces: Should be wrapped in single quotes (already done)
- **Current Behavior:** Basic escaping handles most cases, but edge cases may fail

**Recommendation:** Use FFmpeg's input file list (`-i` flag) instead of embedding path in filter string, or use more robust path escaping library.

### Style Parity Between Preview and Render

**SSOT Compliance:**
- Preview uses `overlayCaption` object for styling
- ASS generation uses `convertOverlayToASSStyle()` to convert to ASS format
- **Risk:** Conversion may not preserve all styling properties exactly
- **Known Differences:**
  - Preview uses pixel-based positioning (`yPx`, `xPx`)
  - ASS uses margin-based positioning (`MarginL`, `MarginR`, `MarginV`)
  - Conversion may introduce rounding errors

**Mitigation:** Both systems use same `overlayCaption` object as source of truth, but rendering engines differ.

---

## Summary

### Active Implementation

**Primary Path:** `buildKaraokeASSFromTimestamps()` in `src/utils/karaoke.ass.js`
- Uses TTS word timings from ElevenLabs API
- Generates ASS files with `\k` karaoke tags
- Applied via FFmpeg `subtitles` filter

**Legacy Path:** `buildKaraokeASS()` in same file
- Uses estimated word timing (weighted by word length)
- Only used when TTS timestamps unavailable

### Karaoke Mechanism Confirmed

- **Tag Type:** `\k` (karaoke wait tag)
- **Base Color:** `SecondaryColour` (cyan `&H00FFFF00`)
- **Active Color:** `PrimaryColour` (white `&H00FFFFFF`)
- **Transition:** Automatic via `\k` tag timing (no per-word overrides for color)
- **Font/Size/Margins:** From ASS style section, converted from overlay caption SSOT

### Best Insertion Point for Word Pop

**File:** `src/utils/karaoke.ass.js`  
**Function:** `buildKaraokeASSFromTimestamps()`  
**Line:** 661 (where `parts.push(\`{\\k${k}}${word}\`)` is called)  
**Method:** Add `\t()` override block with `\fscx`/`\fscy` scale animation  
**Compatibility:** ✅ Confirmed — per-word overrides work with current `\k` tag scheme

---

**End of Audit Report**







