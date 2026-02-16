# Commit 1: Parity-Safe Refactor Summary

## Changes Made

### File: `public/js/caption-overlay.js`

1. **Added `computeCaptionMetaFromElements()` helper** (exported function, ~line 1500)
   - Extracted exact computation logic from `emitCaptionState()`
   - Copy/paste of existing working code (lines 1209-1440 logic)
   - Only addition: computes `yPxFirstLine = yPx_png + rasterPadding` (V3 raster mode truth)
   - Returns overlayMeta object with all SSOT fields including `yPxFirstLine`

2. **Added `compareMetaParity()` dev helper** (exported function, ~line 1640)
   - Compares legacy `window.getCaptionMeta()` output vs new helper output
   - Compares: `rasterW`, `rasterH`, `rasterPadding`, `totalTextH`, `yPx_png`, `previewFontString`, `lines[]`
   - Does NOT compare `yPxFirstLine` (legacy doesn't have it), logs it separately
   - Returns `true` if all fields match, `false` otherwise

3. **Refactored `emitCaptionState()`** (inside `initCaptionOverlay`, ~line 1203)
   - Now calls `computeCaptionMetaFromElements()` instead of duplicating computation
   - Preserves all existing behavior:
     - `lastGoodDOMCache` assignment
     - Mode determination (`geometryDirty ? 'dom' : ...`)
     - All console.log statements (format preserved)
     - NaN/null guard
     - `window.__overlayMeta` assignment
     - `window.updateCaptionState()` call
   - `window.__overlayMeta` now includes `yPxFirstLine` field

### File: `public/js/caption-preview.js`

1. **Removed `yPxFirstLine` fallback** (line 303)
   - BEFORE: `yPxFirstLine: overlayMeta.yPxFirstLine || (overlayMeta.yPx_png + overlayMeta.rasterPadding)`
   - AFTER: `yPxFirstLine: overlayMeta.yPxFirstLine`
   - Helper now always provides `yPxFirstLine`, no fallback needed

2. **Added conditional audit logging** (after payload construction, ~line 333)
   - Behind `window.__parityAudit` flag
   - Logs before POST: `linesCount`, `rasterW`, `rasterH`, `rasterPadding`, `totalTextH`, `yPx_png`, `yPxFirstLine`, `previewFontString`, `frameW`, `frameH`
   - Logs after response: same fields from `data.data.meta`
   - Added guard warning if `yPxFirstLine` is missing in overlayMeta

## Testing Steps

1. Start dev server: `npm run dev`
2. Open browser to `creative.html`, open DevTools console
3. Enable audit logging: `window.__parityAudit = true;`
4. Trigger existing caption preview flow (edit caption text/slider)
5. Verify console logs show:
   - `[__parityAudit] payload: {...}` with all fields including `yPxFirstLine`
   - `[__parityAudit] response: {...}` with meta fields
   - No runtime errors
6. Run parity check: `compareMetaParity()`
   - Expected: `[parity-check] ✅ MATCH - all fields identical`
   - Must return `true` before proceeding
7. Verify existing overlay preview still works:
   - Caption appears correctly positioned
   - Preview PNG matches overlay visually
   - No console errors
8. Check Network tab: POST `/api/caption/preview` returns 200
9. Verify `yPxFirstLine` is computed:
   - Console: `window.__overlayMeta.yPxFirstLine`
   - Should be: `yPx_png + rasterPadding` (verify numerically)
   - Should NOT be `undefined`

## Commit Message

```
refactor(captions): extract SSOT meta helper + add yPxFirstLine + parity audit logs

- Extract computeCaptionMetaFromElements() helper from emitCaptionState()
- Add yPxFirstLine = yPx_png + rasterPadding computation (V3 raster mode truth)
- Add compareMetaParity() dev helper for golden-master verification
- Refactor emitCaptionState() to use shared helper (preserves all existing behavior)
- Remove yPxFirstLine fallback from caption-preview.js (helper always provides it)
- Add __parityAudit conditional logging for payload/response inspection

No behavior changes - pure refactor with parity verification gate.
```

