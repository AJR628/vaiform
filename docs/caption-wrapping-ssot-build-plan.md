# Caption Wrapping SSOT Build Plan

**Date**: 2026-01-07  
**Context**: Preview (V3 raster PNG) and render (ASS subtitles) use different line wrapping algorithms, causing visual mismatch. Client-provided lines contain broken words, requiring server rewrap. Logs show inconsistencies after rewrap.

---

## Executive Summary

**Problem**: Preview and render use different wrapping algorithms, causing line count mismatches (e.g., Beat 3: preview=3 lines, render=4 lines).

**Root Causes**:
1. **Preview**: Uses canvas font measurement (`wrapLinesWithFont()` with `ctx.measureText()`) but trusts client-provided `lines[]` which contain broken words
2. **Render**: Uses character-count approximation (`approxCharW = fontPx * 0.55`) in `story.service.js:826-855`
3. **No SSOT**: Each path implements its own wrapping logic
4. **Log Inconsistencies**: After server rewrap, `PARITY_CHECKLIST` and `v3:raster:complete` logs still show old `rasterH`/`lines` counts

**Impact**: When line counts differ, captions appear in different vertical positions and heights between preview and render.

---

## Audit Findings

### Finding 1: Render Uses ASS Subtitles (Not Drawtext)

**Evidence**: Logs show `4× "[captions] strategy=ass reason=\"assPath exists\""`

**Location**: `src/utils/ffmpeg.video.js:617-660`

**What Happens**:
- FFmpeg uses `subtitles=` filter with ASS file (libass)
- ASS file contains explicit line breaks (`\N`) from `buildKaraokeASSFromTimestamps()`
- Drawtext/drawMain filters are excluded when ASS is present

**Implication**: Current preview (V3 raster PNG) cannot achieve "true parity" with render unless:
- **(A)** ASS uses identical explicit line breaks from SSOT (layout parity), OR
- **(B)** Preview generates via libass (FFmpeg subtitles) for pixel parity

### Finding 2: Client Lines Contain Broken Words

**Evidence**: Server detects and rewraps broken words:
- Examples: "struggli" + "ng to", "Creativit" + "y thrives", "Brainsto" + "rm"
- Server rewraps: 10→3, 6→2, 12→3, 5→2 lines

**Location**: `src/routes/caption.preview.routes.js:1207-1229`

**What Happens**:
1. Client sends `lines[]` array (browser DOM Range API)
2. Server validates each line width using `ctx.measureText()`
3. Server detects mid-word breaks (heuristic: line ends with letter, next starts with letter, no hyphen)
4. Server rewraps using `wrapLinesWithFont()` if needed

**Implication**: Client wrapping is not trustworthy. Server must be SSOT for `lines[]`.

### Finding 3: Log Inconsistencies After Rewrap

**Evidence**: Logs show new `rasterH`/`lines` used for drawing, but `PARITY_CHECKLIST` and `v3:raster:complete` still print old values.

**Location**: `src/routes/caption.preview.routes.js:351-382`

**What Happens**:
- `renderCaptionRaster()` returns `rewrapped: true`, `finalLines`, `serverRasterH`, `serverTotalTextH`
- Route handler uses these values in `ssotMeta` (lines 239-241, 290-326)
- But `v3:raster:complete` log (line 351) uses `lines.length` (old client value)
- `PARITY_CHECKLIST` log (line 365) uses `data.rasterH` (old client value)

**Implication**: Response meta reflects post-rewrap values, but logs don't. This makes debugging confusing.

### Finding 4: Render Uses Character-Count Approximation

**Location**: `src/services/story.service.js:826-855`

**Current Implementation**:
```javascript
const fontPx = overlayCaption?.fontPx || 64;
const boxWidthPx = 1080 - 120;  // 960px
const approxCharW = fontPx * 0.55;  // Approximation
const maxChars = Math.max(12, Math.floor(boxWidthPx / approxCharW));
// ... splits by spaces, counts characters per line
```

**Problem**: Character-count approximation doesn't account for:
- Variable character widths (e.g., 'i' vs 'W')
- Font-specific metrics
- Letter spacing
- Actual rendered width

**Result**: Different line counts than canvas measurement (e.g., Beat 3: 4 lines vs 3 lines).

### Finding 5: ASS Generation Accepts Wrapped Text

**Location**: `src/utils/karaoke.ass.js:244-341`, `src/utils/karaoke.ass.js:356-758`

**What Happens**:
- `buildKaraokeASS()` and `buildKaraokeASSFromTimestamps()` accept `wrappedText` parameter
- If provided, uses `mapTokensToWrappedLines()` to map tokens to wrapped lines
- Inserts `\N` (ASS newline) at wrapped boundaries (line 305)
- If `wrappedText` is null, tokens are joined with spaces (no wrapping)

**Implication**: ASS generation already supports explicit line breaks. We just need to pass the SSOT `lines[]` as `wrappedText`.

---

## Code Locations Reference

| Component | File | Lines | Current Behavior |
|-----------|------|-------|------------------|
| Preview wrapping | `src/routes/caption.preview.routes.js` | 1633-1662 | `wrapLinesWithFont()` - canvas measurement |
| Preview rewrap detection | `src/routes/caption.preview.routes.js` | 1186-1229 | Validates client lines, detects broken words |
| Preview response | `src/routes/caption.preview.routes.js` | 239-326 | Uses server-wrapped lines if rewrap occurred |
| Preview logs | `src/routes/caption.preview.routes.js` | 351-382 | Still show old values after rewrap |
| Render wrapping | `src/services/story.service.js` | 826-855 | Character-count approximation (`0.55 × fontPx`) |
| ASS generation | `src/utils/karaoke.ass.js` | 244-341, 356-758 | Accepts `wrappedText`, maps tokens to lines |
| ASS line breaks | `src/utils/karaoke.ass.js` | 303-305 | Inserts `\N` at wrapped boundaries |
| FFmpeg ASS render | `src/utils/ffmpeg.video.js` | 617-660 | Uses `subtitles=` filter with ASS file |

---

## Build Plan

### Commit A: Create Shared Wrapper SSOT

**Goal**: Extract wrapping logic into shared utility that both preview and render use.

**File**: `src/utils/caption.wrap.js` (NEW)

**Function Signature**:
```javascript
/**
 * Wrap text using canvas font measurement (SSOT for line wrapping)
 * @param {string} textRaw - Raw text to wrap
 * @param {number} fontPx - Font size in pixels
 * @param {string} weightCss - Font weight (CSS value: 'normal', 'bold', '400', '700', etc.)
 * @param {string} fontFamily - Font family name (e.g., 'DejaVu Sans')
 * @param {number} maxWidthPx - Maximum line width in pixels
 * @param {number} [letterSpacingPx=0] - Letter spacing in pixels
 * @param {number} [lineSpacingPx=0] - Line spacing in pixels
 * @returns {object} { lines, linesCount, totalTextH, maxLineWidthPx, didRewrap: false }
 */
export function wrapTextWithFont(textRaw, fontPx, weightCss, fontFamily, maxWidthPx, letterSpacingPx = 0, lineSpacingPx = 0)
```

**Implementation**:
- Use `node-canvas` (`createCanvas`, `getContext('2d')`)
- Set font: `canvasFontString(weightCss, 'normal', fontPx, fontFamily)`
- Measure each word using `ctx.measureText()` (accounting for `letterSpacingPx`)
- Build lines array (same algorithm as `wrapLinesWithFont()`)
- Compute `totalTextH = lines.length * fontPx + (lines.length - 1) * lineSpacingPx`
- Return `{ lines, linesCount: lines.length, totalTextH, maxLineWidthPx, didRewrap: false }`

**Dependencies**:
- Import `createCanvas` from `canvas`
- Import `canvasFontString` from `src/utils/canvas.font.js` (or inline if not available)

**Acceptance Tests**:
1. Test with short text → returns 1 line
2. Test with long text → returns multiple lines, all fit within `maxWidthPx`
3. Test with letter spacing → accounts for spacing in measurements
4. Test with different fonts → produces different line counts for same text

---

### Commit B: Update Preview Endpoint to Use Server SSOT Only

**Goal**: Stop trusting client-provided `lines[]`. Always compute canonical lines from `textRaw` + style.

**File**: `src/routes/caption.preview.routes.js`

**Changes**:

1. **Remove client lines validation/rewrap logic** (lines 1186-1292):
   - Delete `needsRewrap` detection loop
   - Delete mid-word break detection
   - Delete `wrapLinesWithFont()` call

2. **Always compute lines from textRaw** (after line 1179):
   ```javascript
   // Import shared wrapper
   import { wrapTextWithFont } from '../utils/caption.wrap.js';
   
   // Always compute canonical lines from textRaw (server SSOT)
   const maxLineWidth = rasterW - (2 * rasterPadding);
   const wrapResult = wrapTextWithFont(
     textRaw || text,
     fontPx,
     meta.weightCss || 'normal',
     meta.fontFamily || 'DejaVu Sans',
     maxLineWidth,
     letterSpacingPx,
     lineSpacingPx
   );
   
   const serverWrappedLines = wrapResult.lines;
   const serverTotalTextH = wrapResult.totalTextH;
   ```

3. **Recompute rasterH from server-wrapped lines** (after wrapResult):
   ```javascript
   const cssPaddingTop = meta.padTop || meta.rasterPadding || 24;
   const cssPaddingBottom = meta.padBottom || meta.rasterPadding || 24;
   const shadowBlur = meta.shadowBlur || 12;
   const shadowOffsetY = meta.shadowOffsetY || 2;
   
   const serverRasterH = Math.round(
     serverTotalTextH + 
     cssPaddingTop + 
     cssPaddingBottom + 
     Math.max(0, shadowBlur * 2) + 
     Math.max(0, shadowOffsetY)
   );
   ```

4. **Update response meta to use server-computed values** (line 239-326):
   - Use `serverWrappedLines` for `ssotMeta.lines`
   - Use `serverRasterH` for `ssotMeta.rasterH`
   - Use `serverTotalTextH` for `ssotMeta.totalTextH`
   - Remove `rewrapped` flag (always server-computed now)

5. **Fix logs to use final values** (lines 351-382):
   ```javascript
   console.log('[v3:raster:complete]', {
     rasterW: ssotMeta.rasterW,
     rasterH: ssotMeta.rasterH,  // ✅ Use final value
     yPx_png: ssotMeta.yPx_png,
     lines: ssotMeta.lines.length,  // ✅ Use final value
     rasterHash: rasterHash.slice(0, 8) + '...'
   });
   
   console.log('[PARITY_CHECKLIST]', {
     mode: 'raster',
     frameW: ssotMeta.frameW,
     frameH: ssotMeta.frameH,
     rasterW: ssotMeta.rasterW,
     rasterH: ssotMeta.rasterH,  // ✅ Use final value
     xExpr_png: ssotMeta.xExpr_png,
     yPx_png: ssotMeta.yPx_png,
     rasterPadding: ssotMeta.rasterPadding,
     padTop: meta.padTop || meta.rasterPadding,
     padBottom: meta.padBottom || meta.rasterPadding,
     previewFontString: rasterResult.previewFontString,
     previewFontHash: rasterResult.previewFontHash,
     rasterHash,
     bgScaleExpr: ssotMeta.bgScaleExpr,
     bgCropExpr: ssotMeta.bgCropExpr,
     willMatchPreview: true,
     linesCount: ssotMeta.lines.length  // ✅ Add linesCount
   });
   ```

6. **Update renderCaptionRaster() call** (line 201):
   - Pass `serverWrappedLines` instead of `lines`
   - Remove `rewrapped` return value handling

**Data Shape Changes**:
- **Removed**: `rewrapped` flag from `renderCaptionRaster()` return
- **Changed**: `lines` always server-computed (never from client)
- **Changed**: `rasterH`, `totalTextH` always server-computed

**Back-Compat**: ✅ Safe - Client can still send `lines[]` but it will be ignored (server always recomputes)

**Acceptance Tests**:
1. Send preview request with broken-word lines → Server computes canonical lines, response contains server lines
2. Check logs → `v3:raster:complete` and `PARITY_CHECKLIST` show final values
3. Verify response meta → `lines`, `rasterH`, `totalTextH` match server-computed values

---

### Commit C: Update ASS Generation to Use Same Wrapped Lines

**Goal**: Replace character-count approximation with shared wrapper. Pass explicit line breaks to ASS.

**Files**:
- `src/services/story.service.js` (lines 821-855)
- `src/services/shorts.service.js` (lines 180-210) - if similar logic exists

**Changes**:

1. **Replace character-count approximation** (`story.service.js:826-855`):
   ```javascript
   // Import shared wrapper
   import { wrapTextWithFont } from '../utils/caption.wrap.js';
   
   // Extract wrapped text from overlayCaption.lines or compute it
   let wrappedText = null;
   if (overlayCaption?.lines && Array.isArray(overlayCaption.lines)) {
     wrappedText = overlayCaption.lines.join('\n');
     console.log(`[story.service] Using wrapped text from overlayCaption.lines: ${overlayCaption.lines.length} lines`);
   } else if (caption?.text) {
     // Compute wrapped text using shared wrapper (SSOT)
     try {
       const fontPx = overlayCaption?.fontPx || overlayCaption?.sizePx || 64;
       const fontFamily = overlayCaption?.fontFamily || 'DejaVu Sans';
       const weightCss = overlayCaption?.weightCss || 'normal';
       const boxWidthPx = 1080 - 120; // 960px
       const letterSpacingPx = overlayCaption?.letterSpacingPx || 0;
       const lineSpacingPx = overlayCaption?.lineSpacingPx || 0;
       
       const wrapResult = wrapTextWithFont(
         caption.text,
         fontPx,
         weightCss,
         fontFamily,
         boxWidthPx,
         letterSpacingPx,
         lineSpacingPx
       );
       
       wrappedText = wrapResult.lines.join('\n');
       console.log(`[story.service] Computed wrapped text using SSOT: ${wrapResult.linesCount} lines`);
     } catch (wrapErr) {
       console.warn(`[story.service] Could not compute wrapped text:`, wrapErr?.message);
     }
   }
   ```

2. **Update shorts.service.js** (if similar logic exists at lines 180-210):
   - Apply same changes as above

**Data Shape Changes**: None (still passes `wrappedText` string to ASS generation)

**Back-Compat**: ✅ Safe - ASS generation already accepts `wrappedText`, just changing how it's computed

**Acceptance Tests**:
1. Run render with same text + style as preview → Check logs: `[story.service] Computed wrapped text using SSOT: N lines`
2. Verify ASS file → Contains `\N` at same line breaks as preview `lines[]`
3. Compare line counts → Preview `lines.length` equals render `wrapResult.linesCount`

---

### Commit D: Add ASS Preview Mode

**Goal**: Add `/api/caption/preview?mode=ass` that generates preview PNG via FFmpeg subtitles filter (libass) for pixel parity with render.

**File**: `src/routes/caption.preview.routes.js`

**Changes**:

1. **Add query parameter parsing** (after line 66):
   ```javascript
   const previewMode = req.query.mode || req.query.engine || 'raster'; // 'raster' | 'ass'
   ```

2. **Add ASS preview handler** (after raster handler, before default response):
   ```javascript
   if (previewMode === 'ass') {
     // Generate ASS file first
     const { buildKaraokeASS } = await import('../utils/karaoke.ass.js');
     
     // Compute wrapped text using shared wrapper
     const wrapResult = wrapTextWithFont(
       textRaw || text,
       fontPx,
       data.weightCss || 'normal',
       data.fontFamily || 'DejaVu Sans',
       maxLineWidth,
       letterSpacingPx,
       lineSpacingPx
     );
     
     const wrappedText = wrapResult.lines.join('\n');
     
     // Build ASS file (no timestamps, use estimated duration)
     const assPath = await buildKaraokeASS({
       text: textRaw || text,
       durationMs: 5000, // 5s placeholder
       wrappedText: wrappedText,
       style: convertOverlayToASSStyle(overlayCaption, data.frameW, data.frameH)
     });
     
     // Generate PNG via FFmpeg: 1 frame with subtitles filter
     const { execSync } = await import('child_process');
     const { tmpdir } = await import('os');
     const { join } = await import('path');
     const { writeFileSync, readFileSync, unlinkSync } = await import('fs');
     
     const pngPath = join(tmpdir(), `caption-preview-${Date.now()}.png`);
     
     // Create 1-frame video (1080x1920, 1s duration)
     const ffmpegCmd = [
       'ffmpeg',
       '-f', 'lavfi',
       '-i', `color=c=black:s=1080x1920:d=1`,
       '-vf', `subtitles='${assPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")}':fontsdir='${path.resolve(process.cwd(), 'assets', 'fonts').replace(/\\/g, '/')}'`,
       '-frames:v', '1',
       '-y',
       pngPath
     ].join(' ');
     
     execSync(ffmpegCmd, { stdio: 'ignore' });
     
     // Read PNG and convert to base64
     const pngBuffer = readFileSync(pngPath);
     const rasterDataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
     
     // Cleanup
     unlinkSync(pngPath);
     unlinkSync(assPath);
     
     // Return same response shape as raster mode
     return res.json({
       ok: true,
       data: {
         imageUrl: null,
         wPx: data.frameW,
         hPx: data.frameH,
         xPx: 0,
         meta: {
           ssotVersion: 3,
           mode: 'ass',
           rasterUrl: rasterDataUrl,
           lines: wrapResult.lines,
           linesCount: wrapResult.linesCount,
           totalTextH: wrapResult.totalTextH,
           // ... other meta fields
         }
       }
     });
   }
   ```

**Dependencies**:
- FFmpeg must be installed and in PATH
- Fonts directory must exist at `assets/fonts`

**Data Shape Changes**:
- **New**: `meta.mode: 'ass'` (vs `'raster'`)
- **Same**: Response shape matches raster mode (for client compatibility)

**Back-Compat**: ✅ Safe - Default mode is still 'raster', ASS mode is opt-in via query param

**Acceptance Tests**:
1. Request `/api/caption/preview?mode=ass` → Returns PNG generated via FFmpeg
2. Compare ASS preview vs raster preview → Should show identical line breaks (layout parity)
3. Compare ASS preview vs final render → Should show pixel-identical captions (pixel parity)

---

## Definition of Done

1. **Layout Parity**: For a given `textRaw` + style, preview response `lines[]` exactly equals ASS `lines[]` (same line breaks, same line count)

2. **Meta Consistency**: Preview meta (`rasterH`/`totalTextH`/`linesCount`) matches the actual drawn output (no old values in logs or response)

3. **Visual Match**: Beat preview visually matches render at least in line breaks (and if `mode=ass`, pixel parity)

4. **Log Accuracy**: All logs (`v3:raster:complete`, `PARITY_CHECKLIST`, `[story.service]`) reflect final computed values, not intermediate/client values

---

## Testing Strategy

### Unit Tests
- `caption.wrap.js`: Test wrapping with various text lengths, fonts, letter spacing
- Verify line widths never exceed `maxWidthPx`

### Integration Tests
1. **Preview → Render Parity Test**:
   - Send preview request with text + style
   - Capture `lines[]` from response
   - Run render with same text + style
   - Verify render `wrappedText` (joined `lines[]`) matches preview `lines[]`

2. **ASS Preview Mode Test**:
   - Request preview with `mode=ass`
   - Request preview with `mode=raster` (same text + style)
   - Compare line breaks (should be identical)
   - Compare final render output (should match ASS preview pixels)

### Manual Verification
1. Load creative page → Change caption style → Verify preview updates
2. Render story → Verify captions match preview line breaks
3. Check server logs → Verify all logs show final values (no old/client values)

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Shared wrapper performance | Slow preview generation | Cache canvas context, measure in batches |
| ASS preview mode requires FFmpeg | Preview fails if FFmpeg missing | Fallback to raster mode, log warning |
| Font file paths differ (dev vs prod) | ASS preview fails | Use absolute paths, validate fontsdir exists |
| Client still sends `lines[]` (wasted bandwidth) | Minor | Keep accepting but ignore (back-compat) |

---

## Rollout Plan

1. **Commit A** (Shared wrapper) → Deploy, verify no regressions
2. **Commit B** (Preview SSOT) → Deploy, verify preview still works
3. **Commit C** (ASS SSOT) → Deploy, verify render line counts match preview
4. **Commit D** (ASS preview mode) → Deploy, verify optional feature works

**Rollback**: Each commit is independent. If ASS preview fails, disable via feature flag (default to raster mode).

---

## Evidence Citations

| Claim | File | Line(s) |
|------|------|---------|
| Render uses ASS subtitles | `src/utils/ffmpeg.video.js` | 617-660 |
| Client lines contain broken words | `src/routes/caption.preview.routes.js` | 1207-1229 |
| Server rewraps client lines | `src/routes/caption.preview.routes.js` | 1235-1292 |
| Logs show old values | `src/routes/caption.preview.routes.js` | 351-382 |
| Render uses character approximation | `src/services/story.service.js` | 826-855 |
| ASS accepts wrappedText | `src/utils/karaoke.ass.js` | 244-341, 356-758 |
| ASS inserts \N at line breaks | `src/utils/karaoke.ass.js` | 303-305 |

