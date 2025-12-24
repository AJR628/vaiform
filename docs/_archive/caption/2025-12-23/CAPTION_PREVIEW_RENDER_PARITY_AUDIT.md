# Caption Preview ↔ Render Parity Audit Report

**Date**: 2024-12-19  
**Goal**: Identify root causes of preview↔render drift and font mismatch  
**Status**: Audit Complete - Ready for Fix Planning

---

## Executive Summary

**Critical Finding**: Server-side rewrap violates SSOT by changing line count while keeping client's `rasterH`/`yPx_png`/`totalTextH`, causing vertical drift as text length increases.

**Secondary Issues**:
1. Font weight defaults mismatch (client: 'bold', server: '700', render: 'normal')
2. Anchor semantics confusion (`yPx_png` is top-anchored, CSS uses center via `translateY(-50%)`)
3. Server rewrap changes line count but doesn't recompute dependent geometry

**Root Cause Ranked**:
1. **#1 PARITY BREAK**: Server rewrap keeps client geometry (lines 1186-1200 in `caption.preview.routes.js`)
2. **#2 DEFAULT MISMATCH**: Font weight defaults diverge across preview/render
3. **#3 ANCHOR CONFUSION**: `yPx_png` top-anchored vs CSS center-anchored

---

## Step 0: End-to-End Data Flow

### Preview Pipeline (Client → Server → Response)

**Call Chain**:
1. User edits beat text → `commitBeatTextEdit()` (`creative.html:7202`)
2. Calls `generateBeatCaptionPreviewDebounced()` (`caption-preview.js:832`)
3. Calls `generateBeatCaptionPreview()` (`caption-preview.js:751`)
4. Calls `measureBeatCaptionGeometry()` (`caption-overlay.js:1699`)
5. Builds payload via `buildBeatPreviewPayload()` (`caption-preview.js:691`)
6. POST `/api/caption/preview` (`caption-preview.routes.js:65`)
7. Server validates, may rewrap lines (`caption.preview.routes.js:1186`)
8. Server renders PNG using `renderCaptionRaster()` (`caption.preview.routes.js:1039`)
9. Response includes `meta.rasterUrl` + geometry
10. Client applies via `applyPreviewResultToBeatCard()` (`caption-preview.js:884`)

**Key Files**:
- `public/js/caption-preview.js` - Preview generation
- `public/js/caption-overlay.js` - Geometry measurement
- `src/routes/caption.preview.routes.js` - Server endpoint
- `public/creative.html` - UI hooks

### Render Pipeline (Session → FFmpeg)

**Call Chain**:
1. Render request includes `session.overlayCaption` (`story.service.js:796`)
2. `renderVideoQuoteOverlay()` receives `overlayCaption` (`ffmpeg.video.js:727`)
3. Normalizes via `normalizeOverlayCaption()` (`overlay.helpers.js:391`)
4. Computes placement via `computeOverlayPlacement()` (`overlay.helpers.js:38`)
5. Materializes PNG from `overlayCaption.rasterUrl` (`ffmpeg.video.js:783`)
6. Builds FFmpeg filter graph via `buildVideoChain()` (`ffmpeg.video.js:382`)
7. Overlays PNG using `overlay=${xExpr}:${yPx_png}` expression

**Key Files**:
- `src/utils/ffmpeg.video.js` - Render pipeline
- `src/render/overlay.helpers.js` - Placement computation
- `src/services/story.service.js` - Session overlay storage

---

## Step 1: Parity Matrix (Meta Contract Ownership)

| Field | Preview (Client) | Preview (Server) | Render | SSOT Owner | Notes |
|-------|-----------------|------------------|--------|------------|-------|
| **Typography** |
| `fontFamily` | Computed from DOM | Echoed (default: 'DejaVu Sans') | From `overlayCaption` | **Client** | Server validates, doesn't change |
| `fontPx` | Computed from DOM | Echoed (clamped 8-400) | From `overlayCaption` | **Client** | Server clamps but echoes |
| `weightCss` | **'bold'** (line 324) | **'700'** (line 22) | **'normal'** (line 421) | **❌ DIVERGENT** | **Default mismatch** |
| `fontStyle` | From DOM | Echoed (default: 'normal') | From `overlayCaption` | **Client** | Server echoes |
| `previewFontString` | Computed from DOM | Echoed (line 1249) | From `overlayCaption` | **Client** | Server freezes for parity |
| **Layout** |
| `lines[]` | **DOM Range API** (line 2084) | **May rewrap** (line 1186) | From `overlayCaption.lines` | **❌ DIVERGENT** | **Server can change** |
| `totalTextH` | `lines.length * fontPx + (lines-1) * lineSpacingPx` | **Echoed even if rewrap** (line 150) | From `overlayCaption` | **❌ VIOLATED** | **Server keeps client value after rewrap** |
| `lineSpacingPx` | Computed from lineHeight | Echoed (default: 0) | From `overlayCaption` | **Client** | Server echoes |
| `letterSpacingPx` | From DOM | Echoed (default: 0) | From `overlayCaption` | **Client** | Server echoes |
| **Geometry** |
| `rasterW` | Client-computed (tight) | **Echoed even if rewrap** (line 271) | From `overlayCaption` | **❌ VIOLATED** | **Server keeps client value after rewrap** |
| `rasterH` | Client-computed (tight) | **Echoed even if rewrap** (line 272) | From `overlayCaption` | **❌ VIOLATED** | **Server keeps client value after rewrap** |
| `rasterPadding` | Client-computed | Echoed (default: 24) | From `overlayCaption` | **Client** | Server echoes |
| `yPx_png` | **Top of PNG** (line 1502) | **Echoed even if rewrap** (line 275) | From `overlayCaption` | **❌ VIOLATED** | **Server keeps client value after rewrap** |
| `yPct` | **Center anchor** (line 917) | Not returned in V3 raster | From `overlayCaption` | **❌ MISSING** | **Not in server response** |
| `xExpr_png` | '(W-overlay_w)/2' | Echoed | From `overlayCaption` | **Client** | Server echoes |
| **Effects** |
| `color` | From DOM | Echoed | From `overlayCaption` | **Client** | Server echoes |
| `opacity` | From DOM | Echoed | From `overlayCaption` | **Client** | Server echoes |
| `strokePx` | From DOM | Echoed | From `overlayCaption` | **Client** | Server echoes |
| `shadowBlur` | From DOM | Echoed | From `overlayCaption` | **Client** | Server echoes |

**Legend**:
- ✅ **Client**: Client is SSOT, server echoes
- ❌ **VIOLATED**: Server changes value but keeps client's dependent geometry
- ❌ **DIVERGENT**: Server can change value (rewrap)
- ❌ **MISSING**: Field not returned in server response

---

## Step 2: Server Rewrap Analysis (CRITICAL PARITY BREAK)

### Evidence from Code

**Location**: `src/routes/caption.preview.routes.js` lines 1137-1200

**Server Rewrap Logic**:
```javascript
// Line 1137: Validate lines fit within maxLineWidth
let needsRewrap = false;
for (const line of lines) {
  const width = measureTextWidth(tempCtx, transformedLine, letterSpacingPx);
  if (width > maxLineWidth + 1) {
    needsRewrap = true;  // Line overflow detected
  }
}

// Line 1186: Server rewraps if needed
if (needsRewrap) {
  serverWrappedLines = wrapLinesWithFont(text, maxLineWidth, tempCtx, letterSpacingPx);
  console.log('[parity:server-rewrap]', {
    oldLines: lines.length,      // e.g., 8
    newLines: serverWrappedLines.length,  // e.g., 2
  });
}

// Line 1298: Uses server-wrapped lines for drawing
const finalLines = serverWrappedLines;

// BUT: Line 271-275: Still echoes client's rasterH/yPx_png
const ssotMeta = {
  rasterW: data.rasterW,      // ❌ Client value (based on 8 lines)
  rasterH: data.rasterH,      // ❌ Client value (based on 8 lines)
  yPx_png: data.yPx_png,      // ❌ Client value (positioned for 8 lines)
  lines: lines,                // ❌ Still returns client lines, not serverWrappedLines
};
```

### The Parity Violation

**Problem**: When server rewraps (e.g., 8 lines → 2 lines), it:
1. ✅ Uses server-wrapped lines for **drawing** (line 1298)
2. ❌ Still echoes client's `rasterH` (computed for 8 lines)
3. ❌ Still echoes client's `yPx_png` (positioned for 8 lines)
4. ❌ Still echoes client's `totalTextH` (computed for 8 lines)
5. ❌ Returns client's `lines[]` in response, not `serverWrappedLines`

**Result**: PNG is drawn with 2 lines, but `rasterH`/`yPx_png` assume 8 lines → **vertical drift**.

**Log Evidence** (from user report):
```
[parity:server-rewrap] oldLines: 8 → newLines: 2
```

**Impact**: As text gets longer, client sends more lines → server rewraps to fewer → geometry mismatch increases → drift upward.

---

## Step 3: Anchor Semantics Analysis

### CSS Positioning (Beat Preview)

**Location**: `public/creative.html` lines 289-295

```css
.beat-caption-overlay {
  position: absolute;
  left: 50%;
  top: calc(var(--y-pct) * 100%);
  transform: translateX(-50%) translateY(-50%);
}
```

**Semantics**: `translateY(-50%)` means `yPct` represents the **center** of the overlay image.

### Client Computation

**Location**: `public/js/caption-preview.js` lines 914-930

```javascript
// Line 917: Derives center from top
const yPct = Number.isFinite(meta.yPct) 
  ? meta.yPct 
  : ((meta.yPx_png + meta.rasterH / 2) / meta.frameH);
```

**Semantics**: Client derives `yPct` as **center** = `(yPx_png + rasterH/2) / frameH`.

### Server Computation

**Location**: `public/js/caption-overlay.js` line 1502

```javascript
const yPx_png = Math.round(yPct * frameH);
```

**Semantics**: `yPx_png` is computed as **top** of PNG = `yPct * frameH` (no `- rasterH/2`).

### Render Usage

**Location**: `src/utils/ffmpeg.video.js` line 398

```javascript
y: overlayCaption.yPx_png ?? overlayCaption.yPx ?? 24,
```

**Semantics**: FFmpeg uses `yPx_png` as **top** anchor (overlay filter uses top-left).

### The Confusion

1. **Client CSS**: Expects `yPct` as **center** (via `translateY(-50%)`)
2. **Client computation**: `yPx_png` is **top** (line 1502)
3. **Client CSS derivation**: Converts top → center (line 917)
4. **Server response**: Doesn't return `yPct` in V3 raster mode (line 259-308)
5. **Render**: Uses `yPx_png` as **top** (correct for FFmpeg)

**Issue**: If server rewraps and changes `rasterH`, the center derivation becomes wrong because `rasterH` in meta doesn't match actual drawn PNG height.

---

## Step 4: Defaults Alignment Analysis

### Font Weight Defaults

| Location | Default | Code Reference |
|----------|---------|----------------|
| **Client Preview** | `'bold'` | `caption-preview.js:324` |
| **Server Preview** | `'700'` | `caption.preview.routes.js:22` |
| **Render Normalize** | `'normal'` | `overlay.helpers.js:421` |

**Impact**: If style object is missing `weightCss`:
- Preview may use 'bold' → server normalizes to '700' → render uses 'normal'
- Font appearance mismatch between preview and render

### Other Defaults (Aligned)

| Field | Client | Server | Render | Status |
|-------|--------|--------|--------|--------|
| `fontFamily` | 'DejaVu Sans' | 'DejaVu Sans' | 'DejaVu Sans' | ✅ Aligned |
| `fontPx` | 48 | 48 (clamped) | 48 | ✅ Aligned |
| `lineSpacingPx` | 0 | 0 | 0 | ✅ Aligned |
| `rasterPadding` | 24 | 24 | 24 | ✅ Aligned |

---

## Step 5: Line Extraction Divergence

### Client Line Extraction

**Location**: `public/js/caption-overlay.js` lines 2084-2156

**Method**: DOM Range API (primary) → Canvas measurement (fallback)

**Process**:
1. Uses `Range.getClientRects()` to detect line breaks (line 2108)
2. Falls back to canvas word-wrapping if DOM fails (line 2132)

**Output**: Array of strings matching browser rendering

### Server Line Rewrap

**Location**: `src/routes/caption.preview.routes.js` lines 1137-1200

**Method**: Canvas measurement with server font

**Triggers**:
1. Line width exceeds `maxLineWidth` (line 1150)
2. Mid-word break detected (line 1164)

**Process**:
1. Measures each client line with server font
2. If overflow, rewraps using `wrapLinesWithFont()` (line 1194)
3. Uses server-wrapped lines for drawing (line 1298)
4. **BUT**: Still echoes client geometry (line 271-275)

**Divergence**: Server font may measure differently than browser font → different wrapping → geometry mismatch.

---

## Root Cause Summary

### #1: Server Rewrap Keeps Client Geometry (CRITICAL)

**Location**: `src/routes/caption.preview.routes.js` lines 1186-1200, 271-275

**Problem**: When server rewraps lines (e.g., 8 → 2), it:
- Uses server-wrapped lines for drawing ✅
- But echoes client's `rasterH`/`yPx_png`/`totalTextH` (computed for 8 lines) ❌

**Impact**: PNG is drawn with 2 lines, but geometry assumes 8 lines → vertical drift increases with text length.

**Evidence**: Logs show `oldLines: 8 → newLines: 2` while `rasterH`/`yPx_png` remain unchanged.

**Fix Required**: When server rewraps, **recompute** `rasterH`, `totalTextH`, and `yPx_png` from server-wrapped lines, OR **reject** client lines and force client to match server wrapping.

---

### #2: Font Weight Default Mismatch

**Location**: Multiple files (see Step 4)

**Problem**: Default `weightCss` differs:
- Client: `'bold'`
- Server: `'700'`
- Render: `'normal'`

**Impact**: Preview may look "very bold" if style object missing `weightCss`.

**Fix Required**: Single SSOT default (recommend `'700'` to match server).

---

### #3: Anchor Semantics Confusion

**Location**: `caption-preview.js:917`, `caption-overlay.js:1502`, `creative.html:295`

**Problem**: 
- `yPx_png` is **top**-anchored (correct for FFmpeg)
- CSS uses `translateY(-50%)` which expects **center**-anchored
- Client derives center from top, but if `rasterH` is wrong (due to rewrap), center is wrong

**Impact**: If server rewraps and `rasterH` doesn't match actual PNG, center derivation fails.

**Fix Required**: Either:
- Return `yPct` explicitly in server response (center-anchored)
- OR use `yPx_png` as top and adjust CSS to not use `translateY(-50%)`

---

## Minimal Debug Instrumentation Plan

Add **ONE** structured log line per request at these locations:

### Client (Before POST)

**Location**: `public/js/caption-preview.js` line 787 (just before `apiFetch`)

```javascript
if (window.__beatPreviewDebug || window.__parityAudit) {
  console.log('[PARITY:CLIENT:REQUEST]', JSON.stringify({
    textLen: text?.length || 0,
    linesCount: payload.lines?.length || 0,
    rasterW: payload.rasterW,
    rasterH: payload.rasterH,
    yPct: payload.yPct,
    yPx_png: payload.yPx_png,
    fontPx: payload.fontPx,
    weightCss: payload.weightCss,
    previewFontString: payload.previewFontString,
    totalTextH: payload.totalTextH,
    timestamp: Date.now()
  }));
}
```

### Server (Before Response)

**Location**: `src/routes/caption.preview.routes.js` line 360 (just before `res.status(200).json`)

```javascript
if (process.env.DEBUG_CAPTION_PARITY === '1') {
  console.log('[PARITY:SERVER:RESPONSE]', JSON.stringify({
    textLen: text?.length || 0,
    clientLinesCount: data.lines?.length || 0,
    serverLinesCount: serverWrappedLines?.length || data.lines?.length || 0,
    rewrapped: needsRewrap,
    rasterW: ssotMeta.rasterW,
    rasterH: ssotMeta.rasterH,
    yPx_png: ssotMeta.yPx_png,
    fontPx: ssotMeta.fontPx,
    weightCss: ssotMeta.weightCss,
    previewFontString: ssotMeta.previewFontString,
    totalTextH: ssotMeta.totalTextH,
    timestamp: Date.now()
  }));
}
```

### Render (Before FFmpeg)

**Location**: `src/utils/ffmpeg.video.js` line 461 (just before filter graph)

```javascript
if (process.env.DEBUG_CAPTION_PARITY === '1') {
  console.log('[PARITY:RENDER:FFMPEG]', JSON.stringify({
    textLen: overlayCaption?.text?.length || 0,
    linesCount: overlayCaption?.lines?.length || 0,
    rasterW: placement.rasterW,
    rasterH: placement.rasterH,
    yPx_png: placement.y,
    fontPx: overlayCaption?.fontPx,
    weightCss: overlayCaption?.weightCss,
    previewFontString: overlayCaption?.previewFontString,
    totalTextH: overlayCaption?.totalTextH,
    timestamp: Date.now()
  }));
}
```

**Guard**: Only log when `window.__beatPreviewDebug` (client) or `process.env.DEBUG_CAPTION_PARITY === '1'` (server).

---

## Minimal Fix Options (Ranked by SSOT Compliance)

### Option A: Server Recomputes Geometry on Rewrap (RECOMMENDED)

**Principle**: Server is SSOT for wrapping → server must recompute dependent geometry.

**Changes**:
1. In `caption.preview.routes.js` line 1186-1200, when `needsRewrap === true`:
   - Recompute `totalTextH` from `serverWrappedLines`
   - Recompute `rasterH` using `window.CaptionGeom.computeRasterH()` logic (server-side equivalent)
   - Recompute `yPx_png` from `yPct` and new `rasterH`
   - Return `serverWrappedLines` in response, not `lines`

**Files**:
- `src/routes/caption.preview.routes.js` (lines 1186-1200, 271-275)

**Pros**:
- ✅ SSOT-compliant (server owns wrapping → server owns geometry)
- ✅ Minimal diff (only server-side)
- ✅ Fixes drift immediately

**Cons**:
- ⚠️ Requires server-side `computeRasterH()` equivalent (or reuse client formula)

---

### Option B: Reject Client Lines That Overflow (ALTERNATIVE)

**Principle**: Client must match server wrapping exactly → reject if mismatch.

**Changes**:
1. In `caption.preview.routes.js` line 1137-1200:
   - If `needsRewrap === true`, return 400 error with reason `'CLIENT_LINES_OVERFLOW'`
   - Client retries with server's suggested `maxLineWidth`

**Files**:
- `src/routes/caption.preview.routes.js` (lines 1137-1200)

**Pros**:
- ✅ Forces client to match server wrapping
- ✅ No server-side geometry recomputation needed

**Cons**:
- ⚠️ Requires client retry logic
- ⚠️ May cause preview flicker on retry

---

### Option C: Align Font Weight Defaults (SUPPLEMENTARY)

**Principle**: Single SSOT default for `weightCss`.

**Changes**:
1. Client: Change default from `'bold'` to `'700'` (`caption-preview.js:324`)
2. Render: Change default from `'normal'` to `'700'` (`overlay.helpers.js:421`)

**Files**:
- `public/js/caption-preview.js` (line 324)
- `src/render/overlay.helpers.js` (line 421)

**Pros**:
- ✅ Simple, low-risk
- ✅ Fixes font weight mismatch

**Cons**:
- ⚠️ Doesn't fix drift (requires Option A or B)

---

## Recommended Fix Plan

**Phase 1**: Implement Option A (server recomputes geometry on rewrap)
- **Priority**: CRITICAL (fixes drift)
- **Effort**: Medium (requires server-side geometry computation)

**Phase 2**: Implement Option C (align font weight defaults)
- **Priority**: HIGH (fixes font mismatch)
- **Effort**: Low (2-line change)

**Phase 3**: Add debug instrumentation (from Step 5)
- **Priority**: MEDIUM (enables verification)
- **Effort**: Low (3 log statements)

**Phase 4**: Consider Option B as fallback if Option A proves complex
- **Priority**: LOW (alternative approach)
- **Effort**: Medium (requires client retry logic)

---

## Testing Checklist

After implementing fixes:

1. **Drift Test**: Edit beat text from short → long → very long
   - Expected: Preview position stays stable (no upward drift)
   - Verify: Server logs show `rewrapped: true` → geometry recomputed

2. **Font Weight Test**: Preview with missing `weightCss` in style
   - Expected: Preview and render match (both use '700')
   - Verify: Console logs show `weightCss: '700'` in both paths

3. **Parity Log Test**: Enable debug flags, generate preview
   - Expected: Single structured log line per request showing final values
   - Verify: `linesCount` matches between client request and server response

---

## Appendix: Code References

### Preview Pipeline
- `public/js/caption-preview.js:751` - `generateBeatCaptionPreview()`
- `public/js/caption-overlay.js:1699` - `measureBeatCaptionGeometry()`
- `src/routes/caption.preview.routes.js:65` - POST `/api/caption/preview`
- `src/routes/caption.preview.routes.js:1039` - `renderCaptionRaster()`

### Render Pipeline
- `src/utils/ffmpeg.video.js:727` - `renderVideoQuoteOverlay()`
- `src/render/overlay.helpers.js:38` - `computeOverlayPlacement()`
- `src/render/overlay.helpers.js:391` - `normalizeOverlayCaption()`

### CSS Positioning
- `public/creative.html:289` - `.beat-caption-overlay` styles
- `public/js/caption-preview.js:884` - `applyPreviewResultToBeatCard()`

---

**End of Audit Report**

