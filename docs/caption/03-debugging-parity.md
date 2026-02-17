# Caption Preview-Render Parity Debugging Guide

**SSOT Documentation** - How to verify parity between preview and render outputs.

## Verification Checklist

### 1. Preview Generation Parity

**Goal**: Verify preview PNG matches expected geometry and styling.

**Steps**:

1. Generate preview via `POST /api/caption/preview`
2. Check response `meta.rasterUrl` exists (PNG data URL)
3. Verify response `meta.rasterW`, `meta.rasterH` match request (or server-recomputed if rewrap)
4. Verify response `meta.yPx_png` matches request (unchanged even after rewrap)
5. Verify response `meta.previewFontString` matches request (font parity)

**Code References**:

- Request: `public/js/caption-preview.js:691-742` (`buildBeatPreviewPayload`)
- Response: `src/routes/caption.preview.routes.js:404-414` (response structure)

**Expected Logs**:

```
[geom:server] Using client SSOT (no recomputation): { rasterW, rasterH, yPx_png, ... }
[PARITY_CHECKLIST] { mode: 'raster', rasterW, rasterH, yPx_png, ... }
```

---

### 2. Render Pipeline Parity

**Goal**: Verify render uses same PNG and geometry as preview.

**Steps**:

1. Check `overlayCaption.rasterUrl` matches preview response `meta.rasterUrl`
2. Check `overlayCaption.rasterW`, `overlayCaption.rasterH` match preview response
3. Check `overlayCaption.yPx_png` matches preview response (unchanged)
4. Check `overlayCaption.rasterHash` matches preview response (PNG integrity)
5. Check `overlayCaption.previewFontString` matches preview response (font parity)

**Code References**:

- Render input: `src/utils/ffmpeg.video.js:1516-1535` (`rasterPlacement` construction)
- FFmpeg overlay: `src/utils/ffmpeg.video.js:515` (`overlay=${xExpr}:${y}`)

**Expected Logs**:

```
[PARITY_CHECKLIST] { mode: 'raster', rasterW, rasterH, yPx_png, ... }
[v3:parity] Using preview dimensions verbatim: { rasterW, rasterH, xExpr, y }
[ffmpeg:overlay] { overlay: "overlay=${xExpr}:${y}:format=auto" }
```

---

### 3. Beat Preview Parity

**Goal**: Verify beat preview overlay matches final render position.

**Steps**:

1. Check beat preview uses TOP-anchored positioning (no `translateY(-50%)`)
2. Check beat preview `yPct` derived from `meta.yPx_png / meta.frameH` (TOP, not center)
3. Check beat preview CSS uses `--y-pct` directly (no centering transform)
4. Verify beat preview PNG matches preview response `meta.rasterUrl`

**Code References**:

- Beat preview application: `public/js/caption-preview.js:903-971` (`applyPreviewResultToBeatCard`)
- yPct derivation: `public/js/caption-preview.js:935` (`const yPct = meta.yPx_png / meta.frameH`)

**Expected Logs** (if `window.__beatPreviewDebug` enabled):

```
[beat-preview] yPct calculation: { yPx_png, frameH, derivedYPct, clampedYPct }
[beat-preview] Overlay applied: { identifier, rasterUrl }
```

---

## Debug Log Prefixes

### Client-Side Logs

| Prefix                    | Meaning                     | Location                  |
| ------------------------- | --------------------------- | ------------------------- |
| `[caption-overlay]`       | Overlay DOM operations      | `caption-overlay.js`      |
| `[caption-preview]`       | Preview generation          | `caption-preview.js`      |
| `[beat-preview]`          | Beat preview operations     | `caption-preview.js`      |
| `[geom:client]`           | Client geometry computation | `caption-overlay.js:1306` |
| `[geom:yPx_png]`          | yPx_png computation         | `caption-overlay.js:1264` |
| `[PARITY:CLIENT:REQUEST]` | Preview request payload     | `caption-preview.js:792`  |

### Server-Side Logs

| Prefix                     | Meaning                 | Location                         |
| -------------------------- | ----------------------- | -------------------------------- |
| `[caption-preview]`        | Preview endpoint        | `caption.preview.routes.js`      |
| `[geom:server]`            | Server geometry         | `caption.preview.routes.js:122`  |
| `[raster]`                 | Raster rendering        | `caption.preview.routes.js:1083` |
| `[parity:server-rewrap]`   | Server rewrap detection | `caption.preview.routes.js:1235` |
| `[PARITY_CHECKLIST]`       | Parity verification     | `caption.preview.routes.js:364`  |
| `[PARITY:SERVER:RESPONSE]` | Server response meta    | `caption.preview.routes.js:388`  |

### Render-Side Logs

| Prefix                   | Meaning                    | Location               |
| ------------------------ | -------------------------- | ---------------------- |
| `[render]`               | Render pipeline            | `ffmpeg.video.js`      |
| `[v3:parity]`            | V3 parity checks           | `ffmpeg.video.js:503`  |
| `[ffmpeg:overlay]`       | FFmpeg overlay expression  | `ffmpeg.video.js:518`  |
| `[PARITY_CHECKLIST]`     | Render parity verification | `ffmpeg.video.js:1550` |
| `[PARITY:RENDER:FFMPEG]` | FFmpeg filter graph        | `ffmpeg.video.js:467`  |

---

## Common Mismatches

### 1. yPx_png Drift After Rewrap

**Symptom**: Preview position drifts upward as text length increases.

**Root Cause**: Server rewraps lines and recomputes `rasterH`, but keeps `yPx_png` unchanged. If `yPx_png` was computed from center-anchored `yPct`, it becomes stale.

**Detection**:

- Check server logs: `[geom:server] Using server-recomputed values (rewrap occurred)`
- Verify `meta.rasterH` increased but `meta.yPx_png` unchanged
- Check if `yPx_png` becomes negative (400 error) - indicates stale positioning
- Compare request `lines.length` vs response `meta.lines.length` (should differ if rewrap occurred)

**Fix**: Ensure client computes `yPx_png` from TOP-anchored `yPct` (not center). Server behavior is correct (keeps `yPx_png` unchanged).

**Code Reference**: `src/routes/caption.preview.routes.js:242` (`const finalYPx_png = yPx_png`)

---

### 2. Beat Preview Centering Mismatch

**Symptom**: Beat preview appears centered but render is top-aligned (or vice versa).

**Root Cause**: Beat preview uses `translateY(-50%)` centering transform, but FFmpeg uses top-left anchor.

**Detection**:

- Check beat preview CSS: Look for `transform: translateY(-50%)`
- Check FFmpeg overlay: `overlay=${xExpr}:${y}` uses Y as top-left
- Compare beat preview position vs render position

**Fix**: Remove centering transform from beat preview. Use TOP-anchored `yPct` directly.

**Verification Steps**:

1. Check beat preview CSS: No `translateY(-50%)` transform (line 295: only `translateX(-50%)` for horizontal centering)
2. Check `applyPreviewResultToBeatCard()`: Line 935 derives TOP yPct: `yPct = meta.yPx_png / meta.frameH`
3. Check FFmpeg overlay: Line 515 uses `y` as top-left: `overlay=${xExpr}:${y}:format=auto`
4. Compare beat preview position vs render position (should match if both use TOP-left anchor - FFmpeg overlay semantics)

**Code Reference**: `public/js/caption-preview.js:935-950` (`applyPreviewResultToBeatCard`)

---

### 3. Font String Mismatch

**Symptom**: Preview and render use different fonts (visual mismatch).

**Root Cause**: Client `previewFontString` doesn't match server font string.

**Detection**:

- Check server logs: `[font-parity:server]` (font comparison)
- Check server error: `FONT_MISMATCH` (422 response)
- Compare `meta.previewFontString` in request vs response

**Fix**: Ensure client extracts exact browser font string. Server validates and echoes it back.

**Code Reference**:

- Client: `public/js/caption-overlay.js:1451` (font string extraction)
- Server: `src/routes/caption.preview.routes.js:1326-1338` (font validation)

---

### 4. Server Rewrap Not Applied

**Symptom**: Client uses stale `lines`/`totalTextH`/`rasterH` after server rewrap.

**Root Cause**: Client doesn't use server response meta (uses cached/stale values).

**Detection**:

- Check server logs: `[parity:server-rewrap]` (rewrap occurred)
- Compare request `lines.length` vs response `meta.lines.length`
- Verify client uses `response.meta.lines` (not request `lines`)

**Server Rewrap Detection**:

- Check server logs: `[parity:server-rewrap] Client lines overflow or broken words detected`
- Check server logs: `[parity:server-rewrap:geometry]` (shows old vs new `rasterH`, `totalTextH`)
- Verify response `meta.lines.length` differs from request `lines.length` (if rewrap occurred)
- Verify response `meta.rasterH` differs from request `rasterH` (if rewrap occurred)
- Verify response `meta.yPx_png` matches request `yPx_png` (unchanged even after rewrap)

**Fix**: Always use server response `meta` as SSOT. Server is authoritative when rewrap occurs.

**Code Reference**: `src/routes/caption.preview.routes.js:238-240` (server authority)

---

### 5. PNG Hash Mismatch

**Symptom**: Preview PNG doesn't match render PNG (visual difference).

**Root Cause**: Different PNG used in preview vs render (stale cache, wrong URL).

**Detection**:

- Check `overlayCaption.rasterHash` vs preview response `meta.rasterHash`
- Check `overlayCaption.rasterUrl` vs preview response `meta.rasterUrl`
- Verify PNG file exists at render time

**Fix**: Ensure render uses same `rasterUrl` and `rasterHash` from preview response. Validate PNG integrity.

**Code Reference**:

- Server: `src/routes/caption.preview.routes.js:234-235` (hash computation)
- Render: `src/utils/ffmpeg.video.js:113-122` (hash validation)

---

## Debug Flags

### Client-Side Flags

| Flag                        | Purpose                 | Location                 |
| --------------------------- | ----------------------- | ------------------------ |
| `window.__beatPreviewDebug` | Beat preview debug logs | `caption-preview.js:939` |
| `window.__parityAudit`      | Parity audit logs       | `caption-preview.js:386` |
| `window.__parityDebug`      | Parity debug logs       | `caption-preview.js:834` |
| `window.__debugOverlay`     | Overlay debug logs      | `caption-overlay.js:19`  |

### Server-Side Flags

| Flag                     | Purpose              | Location                         |
| ------------------------ | -------------------- | -------------------------------- |
| `DEBUG_CAPTION_PARITY=1` | Parity debug logs    | `caption.preview.routes.js:384`  |
| `DEBUG_RASTER_BORDER=1`  | Visual debug markers | `caption.preview.routes.js:1465` |
| `DEBUG_PARITY=1`         | Parity border on PNG | `caption.preview.routes.js:1478` |

### Render-Side Flags

| Flag                     | Purpose           | Location              |
| ------------------------ | ----------------- | --------------------- |
| `DEBUG_CAPTION_PARITY=1` | Parity debug logs | `ffmpeg.video.js:466` |

---

## Parity Test Functions

### Client-Side Tests

**Function**: `compareMetaParity()`  
**File**: `public/js/caption-overlay.js`  
**Location**: Lines 1566-1689  
**Exports**: `export function compareMetaParity`

**Usage**:

```javascript
// In browser console
const { compareMetaParity } = await import('./caption-overlay.js');
const result = compareMetaParity();
// Returns: true (match) | false (mismatch) | 'SKIP' (stage not measurable)
```

**Function**: `runYpxFirstLineSmoke()`  
**File**: `public/js/caption-overlay.js`  
**Location**: Lines 1817-1868  
**Exports**: `export function runYpxFirstLineSmoke`

**Usage**:

```javascript
// In browser console
const { runYpxFirstLineSmoke } = await import('./caption-overlay.js');
const result = runYpxFirstLineSmoke();
// Returns: { ok: boolean, reason: string, yPxFirstLine, yPx_png, rasterPadding }
```

**Function**: `runCaptionParityTest({ text })`  
**File**: `public/js/caption-overlay.js`  
**Location**: Lines 1882-2045  
**Exports**: `export async function runCaptionParityTest`

**Usage**:

```javascript
// In browser console
const { runCaptionParityTest } = await import('./caption-overlay.js');
const result = await runCaptionParityTest({ text: 'Test caption' });
// Returns: { stageRect, previewOk, parityResult }
```

---

## How to Verify Parity End-to-End

### Step 1: Generate Preview

```javascript
// In browser console
const { generateBeatCaptionPreview } = await import('./caption-preview.js');
const result = await generateBeatCaptionPreview('beat-1', 'Test caption', {
  fontPx: 48,
  fontFamily: 'DejaVu Sans',
  weightCss: 'bold',
  yPct: 0.5,
  wPct: 0.8,
});
console.log('Preview meta:', result.meta);
```

**Check**:

- `result.meta.rasterUrl` exists (PNG data URL)
- `result.meta.rasterW`, `result.meta.rasterH` are reasonable (< 600px)
- `result.meta.yPx_png` is in range (0-1920)
- `result.meta.rasterHash` exists

---

### Step 2: Verify Render Input

```javascript
// Check session storage (if available)
const overlayCaption = window.currentStorySession?.overlayCaption;
console.log('Render overlayCaption:', overlayCaption);
```

**Check**:

- `overlayCaption.rasterUrl` matches preview `meta.rasterUrl`
- `overlayCaption.rasterW`, `overlayCaption.rasterH` match preview
- `overlayCaption.yPx_png` matches preview (unchanged)
- `overlayCaption.rasterHash` matches preview (PNG integrity)

---

### Step 3: Check FFmpeg Overlay

**Server logs** (during render):

```
[ffmpeg:overlay] { overlay: "overlay=${xExpr}:${y}:format=auto" }
[v3:parity] Using preview dimensions verbatim: { rasterW, rasterH, xExpr, y }
```

**Check**:

- `y` matches `overlayCaption.yPx_png`
- `rasterW`, `rasterH` match preview
- No scaling applied to overlay (Design A)

---

### Step 4: Compare Visual Output

1. Extract frame from rendered video at caption timestamp
2. Extract PNG from preview response (`meta.rasterUrl`)
3. Compare visually (should match exactly)
4. Compare pixel-by-pixel (should be bit-identical if same PNG used)

**Note**: If ASS subtitles are enabled, render will have additional karaoke highlighting on top of PNG.

---

## Cleanup Candidates

**Documentation only** - no code changes:

1. **Debug-only test functions**: `runYpxFirstLineSmoke()`, `runCaptionParityTest()`
   - **Status**: Debug-only, not used in production
   - **Issue**: Adds code complexity
   - **Action**: Keep for debugging, document as debug-only

2. **Excessive debug logs**: Multiple parity log prefixes
   - **Status**: Useful for debugging but verbose
   - **Issue**: May impact performance in production
   - **Action**: Gate behind debug flags (already implemented)

3. **Visual debug markers**: `DEBUG_RASTER_BORDER`, `DEBUG_PARITY`
   - **Status**: Useful for visual verification
   - **Issue**: Adds red border to PNG (not production-ready)
   - **Action**: Keep for debugging, ensure disabled in production
