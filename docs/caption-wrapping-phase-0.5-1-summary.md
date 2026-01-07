# Caption Wrapping SSOT - Phase 0.5 & 1 Implementation Summary

**Date**: 2026-01-07  
**Status**: ✅ Phase 0.5 and Phase 1 Complete

---

## Phase 0.5: Width Semantics Fix

### Created: `src/utils/caption.wrapWidth.js`

**Function**: `deriveCaptionWrapWidthPx()`

**Purpose**: Unify width calculation between preview and render paths.

**Logic**:
- **Preview path** (rasterW provided): `maxWidthPx = rasterW - (2 * rasterPaddingPx)`
- **Render path** (frameW/wPct): `maxWidthPx = (frameW * wPct) - (2 * internalPaddingPx)`

**Verification**:
```javascript
// Preview path: rasterW=864, pad=24 → maxWidthPx=816
deriveCaptionWrapWidthPx({ rasterW: 864, rasterPaddingPx: 24 })
// Result: { boxW: 864, pad: 24, maxWidthPx: 816 }

// Render path: frameW=1080, wPct=0.8, pad=24 → maxWidthPx=816
deriveCaptionWrapWidthPx({ frameW: 1080, wPct: 0.8, internalPaddingPx: 24 })
// Result: { boxW: 864, pad: 24, maxWidthPx: 816 }
```

**Status**: ✅ **Width semantics unified** - Both paths produce identical `maxWidthPx` (816px)

---

## Phase 1: Shared Wrapper SSOT

### Created: `src/utils/caption.wrap.js`

**Function**: `wrapTextWithFont()`

**Purpose**: Extract wrapping algorithm from preview into shared utility for both preview and render.

**Implementation**:
- Extracted from `wrapLinesWithFont()` in `caption.preview.routes.js:1633-1662`
- Uses same algorithm: word-by-word measurement with `ctx.measureText()`
- Accounts for `letterSpacingPx` (same logic as preview)
- Uses `canvasFontString()` from `font.registry.js` (same as preview)
- Lazy font registration: calls `registerDejaVuFonts()` on first use (fonts already registered at server startup, but this ensures safety)

**Returns**:
```javascript
{
  lines: string[],           // Wrapped lines array
  linesCount: number,        // lines.length
  totalTextH: number,        // lines.length * fontPx + (lines.length - 1) * lineSpacingPx
  maxWidthPx: number         // Echo back the maxWidthPx used
}
```

**Font Registration**:
- Fonts already registered at server startup (`server.js:22-24`)
- Added lazy guard in `wrapTextWithFont()` for safety
- Logs: `[fonts] node-canvas DejaVu registered` (once)

---

## Files Created

1. `src/utils/caption.wrapWidth.js` (NEW)
   - Exports: `deriveCaptionWrapWidthPx()`
   - Lines: 47

2. `src/utils/caption.wrap.js` (NEW)
   - Exports: `wrapTextWithFont()`
   - Lines: 120

---

## Verification Results

### Width Semantics Test
```
Preview path (rasterW=864, pad=24): maxWidthPx=816 ✅
Render path (frameW=1080, wPct=0.8, pad=24): maxWidthPx=816 ✅
```

**Result**: Both paths produce identical `maxWidthPx` (816px) for equivalent inputs.

### Font Registration
- Fonts registered at server startup: ✅ (already in `server.js`)
- Lazy guard added in wrapper: ✅ (safety check)

---

## Next Steps (Pending Review)

**Phase 2**: Update preview endpoint to use shared wrapper
- Import `wrapTextWithFont()` and `deriveCaptionWrapWidthPx()`
- Always compute lines from `textRaw` (ignore client `lines[]`)
- Update response meta and logs to use final server values

**Phase 3**: Update render to use shared wrapper
- Replace character-count approximation with `wrapTextWithFont()`
- Use `deriveCaptionWrapWidthPx()` instead of hardcoded `1080 - 120`
- Pass `wrappedText` to ASS generation

---

## Evidence

| Component | Before | After |
|-----------|--------|-------|
| Preview width | `rasterW - (2 * rasterPadding)` | `deriveCaptionWrapWidthPx({ rasterW, rasterPaddingPx })` |
| Render width | Hardcoded `1080 - 120 = 960px` | `deriveCaptionWrapWidthPx({ frameW: 1080, wPct: 0.8, internalPaddingPx: 24 })` → 816px |
| Preview wrapping | `wrapLinesWithFont()` (local) | `wrapTextWithFont()` (shared) |
| Render wrapping | `approxCharW = fontPx * 0.55` | `wrapTextWithFont()` (shared) |

**Status**: Ready for Phase 2 and Phase 3 implementation.

