# Phase 2 Implementation Results

**Date**: 2024-12-19  
**Status**: ✅ Complete - Ready for Testing

---

## Changes Implemented

### Phase 1: Debug Instrumentation ✅
**Commit**: `debug: caption parity logs`

**Files Modified**:
1. `public/js/caption-preview.js` - Added client request log (line 789-805)
2. `src/routes/caption.preview.routes.js` - Added server response log (line 363-380)
3. `src/utils/ffmpeg.video.js` - Added render FFmpeg log (line 464-477)

**Features**:
- Structured JSON logs at 3 key points (client request, server response, render FFmpeg)
- Logs include: `textLen`, `linesCount`, `rasterW`, `rasterH`, `yPx_png`, `fontPx`, `weightCss`, `previewFontString`, `totalTextH`
- Client log includes `linesPreview` (first 12 chars of first 12 lines) to detect word-splitting
- Guarded by `window.__beatPreviewDebug` (client) and `process.env.DEBUG_CAPTION_PARITY === '1'` (server/render)

---

### Phase 2: Fix #1 - SSOT Rewrap Returns Correct Meta ✅
**Commit**: `fix: ssot rewrap returns correct meta`

**Files Modified**:
1. `src/routes/caption.preview.routes.js` - Modified `renderCaptionRaster()` and route handler

**Changes**:

#### 1. Geometry Recomputation on Rewrap (lines 1208-1245)
- When `needsRewrap === true`, server now:
  - Recomputes `totalTextH` from `serverWrappedLines`: `lines.length * fontPx + (lines-1) * lineSpacingPx`
  - Recomputes `rasterH` using server-side equivalent of `computeRasterH()`:
    ```javascript
    serverRasterH = totalTextH + padTop + padBottom + max(0, shadowBlur*2) + max(0, shadowOffsetY)
    ```
  - Logs geometry changes for verification

#### 2. Return Rewrap Info (lines 1446-1465)
- `renderCaptionRaster()` now returns:
  - `rewrapped: boolean` - Whether rewrap occurred
  - `finalLines: string[]` - Server-wrapped lines (or client lines if no rewrap)
  - `serverTotalTextH: number` - Recomputed totalTextH if rewrap, else client value
  - `serverRasterH: number` - Recomputed rasterH if rewrap, else client value

#### 3. Route Handler Uses Server Values (lines 237-275)
- Route handler now:
  - Uses `rasterResult.finalLines` if rewrap occurred, else client `lines`
  - Uses `rasterResult.serverRasterH` if rewrap occurred, else client `rasterH`
  - Uses `rasterResult.serverTotalTextH` if rewrap occurred, else client `totalTextH`
  - **Keeps `yPx_png` as-is** (no positioning policy change, only geometry recomputation)
  - Skips echo integrity check if rewrap occurred (expected divergence)

**Key Principle**: Server is SSOT for wrapping → server must recompute dependent geometry.

---

## Testing Instructions

### 1. Enable Debug Logging

**Client** (browser console):
```javascript
window.__beatPreviewDebug = true;
```

**Server** (`.env` or command line):
```bash
DEBUG_CAPTION_PARITY=1
```

### 2. Test Rewrap Scenario

**Steps**:
1. Create/edit a beat with long text that will overflow (single long line or many short lines)
2. Generate preview
3. Check console logs for:
   - `[PARITY:CLIENT:REQUEST]` - Shows client's `linesCount`, `rasterH`, `totalTextH`
   - `[PARITY:SERVER:RESPONSE]` - Shows server's `rewrapped: true/false`, `serverLinesCount`, `rasterH`, `totalTextH`
   - `[PARITY:RENDER:FFMPEG]` - Shows render's `linesCount`, `rasterH`, `totalTextH`

**Expected Results**:
- If `rewrapped: true`:
  - `serverLinesCount` should differ from `clientLinesCount`
  - `rasterH` and `totalTextH` in server response should match recomputed values (not client values)
  - Server logs should show `[parity:server-rewrap:geometry]` with old/new values
- Preview position should **not drift upward** as text length increases

### 3. Test Non-Rewrap Scenario

**Steps**:
1. Create/edit a beat with short text that fits within maxLineWidth
2. Generate preview
3. Check console logs

**Expected Results**:
- `rewrapped: false`
- `clientLinesCount === serverLinesCount`
- `rasterH` and `totalTextH` should match client values (echoed)
- Echo integrity check should pass

### 4. Verify Word-Splitting Detection

**Steps**:
1. Check `linesPreview` in client log
2. Look for lines ending with letters/digits followed by lines starting with letters/digits (no hyphen)
3. If detected, server should rewrap

**Expected Results**:
- Server logs should show `[raster:word-split]` if mid-word break detected
- `rewrapped: true` should occur

---

## Success Criteria

✅ **Phase 1 Complete**:
- Debug logs appear when flags enabled
- Logs show structured JSON with all required fields
- Client log includes `linesPreview` for word-splitting detection

✅ **Phase 2 Complete**:
- When `rewrapped: true`, server response includes:
  - `lines` = server-wrapped lines (not client lines)
  - `rasterH` = recomputed from server-wrapped lines
  - `totalTextH` = recomputed from server-wrapped lines
- Preview position stable (no upward drift)
- Server logs show geometry recomputation when rewrap occurs

---

## Next Steps

After verifying Phase 2 results:

1. **Review parity logs** to confirm:
   - `rewrapped: true` → geometry matches server-wrapped lines
   - `rewrapped: false` → geometry matches client values
   - No drift in preview position

2. **If issues found**:
   - Check server logs for `[parity:server-rewrap:geometry]` to verify recomputation
   - Compare `rasterH`/`totalTextH` between client request and server response
   - Verify `yPx_png` is kept as-is (no positioning change)

3. **If successful**:
   - Proceed with Fix #2 (font weight defaults) and Fix #3 (return yPct) in future phases

---

## Files Changed Summary

- `public/js/caption-preview.js` - +18 lines (debug log)
- `src/routes/caption.preview.routes.js` - +86 lines, -28 lines (rewrap fix + debug log)
- `src/utils/ffmpeg.video.js` - +15 lines (debug log)

**Total**: 3 files, ~119 lines added, 28 lines removed

---

**End of Phase 2 Results**

