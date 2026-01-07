# Caption Wrapping SSOT - Phase 2 & 3 Implementation Summary

**Date**: 2026-01-07  
**Status**: ✅ Phase 2 and Phase 3 Complete

---

## Phase 2: Preview Endpoint Uses SSOT Wrap Always

### File: `src/routes/caption.preview.routes.js`

**Changes**:
1. **Imports added**:
   - `wrapTextWithFont` from `src/utils/caption.wrap.js`
   - `deriveCaptionWrapWidthPx` from `src/utils/caption.wrapWidth.js`

2. **Width derivation** (SSOT):
   - Uses `deriveCaptionWrapWidthPx()` with frame-derived width (preferred)
   - `frameW = 1080` (server canonical)
   - `wPct = data.wPct ?? (data.rasterW ? data.rasterW / 1080 : 0.8)`
   - `internalPaddingPx = data.internalPaddingPx ?? data.rasterPadding ?? 24`
   - Falls back to `rasterW/rasterPadding` if needed for compatibility

3. **Lines computation** (ALWAYS server SSOT):
   - Always computes lines from `textRaw || text` using `wrapTextWithFont()`
   - Ignores client-provided `lines[]` for drawing (kept for debug comparison only)
   - Uses same algorithm as render: `ctx.measureText()` with letter spacing

4. **Response meta** (server SSOT values):
   - `ssotMeta.lines = lines` (server-computed)
   - `ssotMeta.totalTextH = wrapResult.totalTextH` (server-computed)
   - `ssotMeta.rasterH` computed from `totalTextH + padding + shadows`

5. **Logs fixed** (use final values):
   - `v3:raster:complete` uses `ssotMeta.*` values
   - `PARITY_CHECKLIST` uses `ssotMeta.*` values
   - Added `[preview-wrap:ssot]` log with `maxWidthPx`, `linesCount`, etc.

---

## Phase 3: Render (ASS) Uses Same SSOT Wrap + Same Width

### Files: `src/services/story.service.js`, `src/services/shorts.service.js`

**Changes**:

1. **Imports added**:
   - `wrapTextWithFont` from `src/utils/caption.wrap.js`
   - `deriveCaptionWrapWidthPx` from `src/utils/caption.wrapWidth.js`

2. **Removed approximation**:
   - Deleted: `boxWidthPx = 1080 - 120` (hardcoded)
   - Deleted: `approxCharW = fontPx * 0.55` (character-count approximation)
   - Deleted: `maxChars = floor(boxWidthPx / approxCharW)` (character-based wrapping)

3. **Width derivation** (SSOT):
   - Uses `deriveCaptionWrapWidthPx()` with same semantics as preview
   - `frameW = 1080`
   - `wPct = overlayCaption?.wPct ?? 0.8`
   - `pad = overlayCaption?.internalPaddingPx ?? overlayCaption?.internalPadding ?? overlayCaption?.rasterPadding ?? 24`

4. **Lines computation** (SSOT wrapper):
   - Uses `wrapTextWithFont()` with same parameters as preview
   - `wrappedText = wrapResult.lines.join('\n')`
   - Passes `wrappedText` to `buildKaraokeASSFromTimestamps()` (already supported)

5. **Logging**:
   - Added `[render-wrap:ssot]` log with `beatId`, `maxWidthPx`, `linesCount`, `fontPx`, `fontFamily`, `weightCss`, `wPct`, `pad`
   - Warns if `letterSpacingPx !== 0` (ASS may not render it the same)

---

## Files Changed

1. `src/routes/caption.preview.routes.js`
   - Added imports for SSOT wrapper and width derivation
   - Replaced client lines trust with server SSOT computation
   - Updated response meta to use server-computed values
   - Fixed logs to use final `ssotMeta.*` values

2. `src/services/story.service.js`
   - Added imports for SSOT wrapper and width derivation
   - Replaced character-count approximation with SSOT wrapper
   - Added `[render-wrap:ssot]` logging

3. `src/services/shorts.service.js`
   - Added dynamic imports for SSOT wrapper and width derivation
   - Replaced character-count approximation with SSOT wrapper
   - Added `[render-wrap:ssot]` logging

---

## Verification Results

### Width Semantics
- **Preview**: `deriveCaptionWrapWidthPx({ frameW: 1080, wPct: 0.8, internalPaddingPx: 24 })` → `maxWidthPx = 816px`
- **Render**: `deriveCaptionWrapWidthPx({ frameW: 1080, wPct: 0.8, internalPaddingPx: 24 })` → `maxWidthPx = 816px`
- **Status**: ✅ **Identical width semantics**

### Wrapping Algorithm
- **Preview**: `wrapTextWithFont()` using `ctx.measureText()` with letter spacing
- **Render**: `wrapTextWithFont()` using `ctx.measureText()` with letter spacing
- **Status**: ✅ **Identical wrapping algorithm**

### Expected Parity
For the same `textRaw` + style:
- Preview `linesCount` should equal render `linesCount`
- Preview `maxWidthPx` should equal render `maxWidthPx`
- Preview `lines[]` should match render `wrappedText` (joined with `\n`)

---

## Next Steps (Verification)

1. **Test with known mismatch beat** (Beat 3 from logs):
   - Call preview endpoint with Beat 3 text + style
   - Capture `meta.linesCount` and `maxWidthPx` from response
   - Run render with same text + style
   - Confirm logs show same `linesCount` and `maxWidthPx`

2. **Verify ASS file**:
   - Check that ASS file contains `\N` line breaks matching preview `lines[]`

3. **Compare logs**:
   - `[preview-wrap:ssot]` should show same `maxWidthPx` and `linesCount` as `[render-wrap:ssot]`

---

## Evidence

| Component | Before | After |
|-----------|--------|-------|
| Preview width | `rasterW - (2 * rasterPadding)` | `deriveCaptionWrapWidthPx({ frameW: 1080, wPct, internalPaddingPx })` |
| Preview lines | Trust client `lines[]` | Always compute via `wrapTextWithFont()` |
| Render width | Hardcoded `1080 - 120 = 960px` | `deriveCaptionWrapWidthPx({ frameW: 1080, wPct: 0.8, internalPaddingPx: 24 })` → 816px |
| Render wrapping | `approxCharW = fontPx * 0.55` | `wrapTextWithFont()` (same as preview) |

**Status**: Ready for verification testing.

