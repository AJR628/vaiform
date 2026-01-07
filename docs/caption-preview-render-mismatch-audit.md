# Caption Preview vs Render Mismatch Audit

**Date**: 2026-01-07  
**Context**: Logs from 4-beat render showing preview (V3 RASTER PNG) and final render (ASS subtitles) using different line wrapping logic.

---

## Executive Summary

**Problem**: Preview captions and final render captions use **different line wrapping algorithms**, causing visual mismatch when line counts differ.

**Root Cause**: 
- **Preview**: Uses canvas font measurement (`wrapLinesWithFont()` with `ctx.measureText()`)
- **Render**: Uses character-count approximation (`approxCharW = fontPx * 0.55`)

**Impact**: When wrapping produces different line counts (e.g., Beat 3: preview=3 lines, render=4 lines), captions appear differently positioned and sized.

---

## Preview Caption Flow (V3 RASTER Path)

### Step 1: Client Sends Lines
**Location**: `public/js/caption-preview.js` (client-side)

**What Happens**:
- Client browser uses DOM Range API to measure text and split into lines
- Sends `lines[]` array to server in POST request
- Example from logs: Beat 1 sends 10 lines

**Log Evidence**:
```
[raster] Using client lines (browser truth): 10 lines
```

### Step 2: Server Validates Client Lines
**Location**: `src/routes/caption.preview.routes.js:1186-1229`

**What Happens**:
1. Server creates canvas context with same font as client
2. Measures each client line width using `ctx.measureText()`
3. Checks for overflow: `width > maxLineWidth + 1`
4. Checks for mid-word breaks (heuristic: line ends with letter, next starts with letter, no hyphen)

**Log Evidence**:
```
[font-parity:measure] { line: 'Beat 1', width: 175, maxLineWidth: 816, fits: true }
[font-parity:measure] { line: 'Are you', width: 209, maxLineWidth: 816, fits: true }
...
[raster:word-split] { lineA: 'Beat 1', lineB: 'Are you', index: 0 }
```

### Step 3: Server Rewraps if Needed
**Location**: `src/routes/caption.preview.routes.js:1235-1292`

**What Happens**:
- If `needsRewrap === true`, calls `wrapLinesWithFont(text, maxLineWidth, tempCtx, letterSpacingPx)`
- This function uses **canvas font measurement** (`ctx.measureText()`) for each word
- Recomputes geometry: `totalTextH`, `rasterH` based on new line count

**Log Evidence**:
```
[parity:server-rewrap] Client lines overflow or broken words detected, rewrapping with server font
[parity:server-rewrap] { oldLines: 10, newLines: 3, maxLineWidth: 816 }
[parity:server-rewrap:geometry] {
  oldRasterH: 670,
  newRasterH: 232,
  oldTotalTextH: 600,
  newTotalTextH: 158,
  oldLines: 10,
  newLines: 3
}
```

### Step 4: PNG Generation
**Location**: `src/routes/caption.preview.routes.js:1298-1547`

**What Happens**:
- Creates transparent canvas: `rasterW × rasterH` (using recomputed `rasterH` if rewrapped)
- Draws text using `serverWrappedLines` (or original `lines` if no rewrap)
- Returns PNG as base64 data URL

**Log Evidence**:
```
[raster] Drew caption PNG with styles: {
  rasterW: 864,
  rasterH: 232,  // ← Recomputed from 3 lines
  yPx: 960,
  padding: 24,
  lines: 3,  // ← Server-wrapped lines
  ...
}
```

**Key Function**: `wrapLinesWithFont()` at `caption.preview.routes.js:1633`
- Uses `ctx.measureText()` for accurate font measurement
- Accounts for `letterSpacingPx`
- Measures each word individually before adding to line

---

## Render Caption Flow (ASS Subtitles Path)

### Step 1: Text Extraction
**Location**: `src/services/story.service.js:779-857`

**What Happens**:
- Extracts `caption.text` from session (per-beat text)
- Example: "Beat 1 Are you struggling to bring your creative ideas to life? Beat 1"

### Step 2: Wrapping Computation
**Location**: `src/services/story.service.js:826-855`

**What Happens**:
1. Checks if `overlayCaption?.lines` exists (doesn't in current logs)
2. Falls back to character-count approximation:
   ```javascript
   const fontPx = overlayCaption?.fontPx || 64;
   const boxWidthPx = 1080 - 120;  // 960px
   const approxCharW = fontPx * 0.55;  // Approximation: 0.55 × font size
   const maxChars = Math.max(12, Math.floor(boxWidthPx / approxCharW));
   ```
3. Splits text by spaces, counts characters per line
4. Joins lines with `\n`

**Log Evidence**:
```
[story.service] Computed wrapped text: 3 lines  // Beat 1
[story.service] Computed wrapped text: 2 lines  // Beat 2
[story.service] Computed wrapped text: 4 lines  // Beat 3 ← MISMATCH with preview (3 lines)
[story.service] Computed wrapped text: 2 lines  // Beat 4
```

**Key Difference**: Uses **character count approximation** (`0.55 × fontPx`), not actual font measurement.

### Step 3: ASS File Generation
**Location**: `src/utils/karaoke.ass.js:356-758`

**What Happens**:
- Receives `wrappedText` from Step 2
- Maps tokens to wrapped lines using `mapTokensToWrappedLines()`
- Generates ASS file with `\N` line breaks at wrapped boundaries
- ASS file includes word-level karaoke timing (`\k` tags)

**Log Evidence**:
```
[karaoke] Text used for ASS: Beat 1 Are you struggling
to bring your creative
ideas to life? Beat 1
```

### Step 4: FFmpeg Render
**Location**: `src/utils/ffmpeg.video.js:617-660`

**What Happens**:
- FFmpeg uses `subtitles=` filter with ASS file
- ASS file contains line breaks (`\N`) from Step 3
- FFmpeg renders subtitles using ASS line breaks (not re-wrapping)

**Log Evidence**:
```
[karaoke] ASS file present, using subtitles filter instead of drawtext
[karaoke] subtitles filter: [base]subtitles='...ass':fontsdir='...'[vsub]
[captions] strategy=ass reason="assPath exists"
```

---

## Mismatch Analysis

### Beat-by-Beat Comparison

| Beat | Preview Lines | Render Lines | Match? | Text Sample |
|------|---------------|--------------|--------|-------------|
| 1    | 3 (from 10)   | 3            | ✅     | "Beat 1 Are you struggling..." |
| 2    | 2 (from 6)    | 2            | ✅     | "Beat 2, concepts remain..." |
| 3    | 3 (from 12)   | 4            | ❌     | "Beat 3 Creativity thrives..." |
| 4    | 2 (from 5)    | 2            | ✅     | "Beat 4 Brainstorm ideas..." |

### Why Beat 3 Mismatches

**Preview Path**:
- Client sends 12 lines
- Server detects overflow/broken words
- Server rewraps using `wrapLinesWithFont()` → **3 lines**
- Uses canvas font measurement: `ctx.measureText("Creativity thrives on action; stop waiting for inspiration to strike.")`

**Render Path**:
- Text: "Beat 3 Creativity thrives on action; stop waiting for inspiration to strike. Beat 3"
- Character-count approximation:
  - `fontPx = 48` (from logs: `fontPx: 48`)
  - `approxCharW = 48 × 0.55 = 26.4px`
  - `maxChars = floor(960 / 26.4) = 36 characters`
- Wraps to **4 lines** (different break points than canvas measurement)

**Root Cause**: Character-count approximation (`0.55 × fontPx`) doesn't account for:
- Variable character widths (e.g., 'i' vs 'W')
- Font-specific metrics
- Letter spacing
- Actual rendered width

---

## Code Locations

### Preview Wrapping
- **Function**: `wrapLinesWithFont()` at `src/routes/caption.preview.routes.js:1633`
- **Method**: Canvas font measurement (`ctx.measureText()`)
- **Accuracy**: High (uses actual font rendering)

### Render Wrapping
- **Function**: Inline code at `src/services/story.service.js:826-855`
- **Method**: Character-count approximation (`approxCharW = fontPx * 0.55`)
- **Accuracy**: Low (assumes uniform character width)

### ASS Line Break Mapping
- **Function**: `mapTokensToWrappedLines()` at `src/utils/karaoke.ass.js:18`
- **Purpose**: Maps word tokens to wrapped lines for `\N` insertion

---

## Impact

### Visual Mismatch
When line counts differ (e.g., Beat 3: 3 vs 4 lines):
- **Preview**: Shows 3 lines, positioned for 3-line height
- **Render**: Shows 4 lines, positioned for 4-line height
- **Result**: Caption appears in different vertical position and has different height

### Geometry Mismatch
- Preview `rasterH` computed for 3 lines: `232px`
- Render ASS assumes 4 lines: different `totalTextH`
- Vertical positioning (`yPx`) differs

### User Experience
- User sees preview with 3 lines
- Final video shows 4 lines
- Caption appears "jump" or "shift" between preview and render

---

## Why This Happens

### Historical Context
1. **Preview** was built with V3 RASTER path using canvas measurement (accurate)
2. **Render** was built with ASS subtitles using character approximation (fast, but inaccurate)
3. **No shared wrapping logic** between the two paths

### Current State
- Preview uses accurate font measurement (canvas)
- Render uses fast approximation (character count)
- Both produce different results for same text

### Missing SSOT
- No single source of truth for line wrapping
- Each path implements its own wrapping logic
- No guarantee of identical `lines[]` arrays

---

## Evidence from Logs

### Preview Rewrap (Beat 1)
```
[parity:server-rewrap] { oldLines: 10, newLines: 3, maxLineWidth: 816 }
[parity:server-rewrap:geometry] {
  oldRasterH: 670,
  newRasterH: 232,
  oldTotalTextH: 600,
  newTotalTextH: 158
}
```

### Render Wrapping (Beat 1)
```
[story.service] Computed wrapped text: 3 lines
```

### Preview Rewrap (Beat 3)
```
[parity:server-rewrap] { oldLines: 12, newLines: 3, maxLineWidth: 816 }
```

### Render Wrapping (Beat 3)
```
[story.service] Computed wrapped text: 4 lines  ← MISMATCH
```

---

## Conclusion

**The mismatch occurs because**:
1. Preview uses canvas font measurement (accurate)
2. Render uses character-count approximation (inaccurate)
3. These produce different line counts for the same text
4. No shared wrapping logic ensures parity

**The fix requires**:
1. Extract wrapping logic into shared utility
2. Use same wrapping algorithm (canvas measurement) for both preview and render
3. Ensure identical `lines[]` arrays regardless of renderer (raster PNG vs ASS)

**Next Step**: Create `src/utils/caption.wrap.js` with single `wrapTextWithFont()` function that both preview and render use.

