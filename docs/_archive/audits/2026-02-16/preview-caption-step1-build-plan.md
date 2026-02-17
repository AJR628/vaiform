# Preview Caption Step 1 Build Plan — Raster Dimension Fix

**Scope:** Single change only. Use cropped raster dims (rasterW × rasterH) for preview overlay img sizing instead of full-frame (wPx × hPx).  
**File:** [public/js/caption-preview.js](public/js/caption-preview.js) — `createCaptionOverlay()`  
**Status:** Audit complete. Ready for implementation.

---

## 1. Audit Verification

### 1.1 Server V3 Raster Contract

**Verified.** The server returns `rasterW` and `rasterH` in the V3 raster response:

- **Server-measured path** ([caption.preview.routes.js:264-265](src/routes/caption.preview.routes.js)): `ssotMeta` includes `rasterW`, `rasterH`
- **Client-measured path** ([caption.preview.routes.js:509-510](src/routes/caption.preview.routes.js)): `ssotMeta` includes `rasterW`, `rasterH`
- **renderCaptionRaster** produces PNG at `rasterW × rasterH` (cropped caption block), not 1080×1920

### 1.2 Client Meta Flow

**Verified.** Meta flows correctly:

- `generateCaptionPreview` → API → `data.data.meta` (ssotMeta)
- When `ssotVersion === 3`: `normalizedMeta = meta` (server verbatim, no rebuild)
- `lastCaptionPNG = { dataUrl, width, height, meta: normalizedMeta }`
- `createCaptionOverlay(result, ...)` receives `captionData.meta` = normalizedMeta with `rasterW`, `rasterH`
- Caption-meta-handshake persists `overlayMetaV3` to localStorage; same meta shape

### 1.3 Reference Implementation

**Verified.** [caption-live.js:526-550](public/js/caption-live.js) `showServerPNG()`:

```javascript
pngEl.style.width = `${meta.rasterW * previewScale}px`;
pngEl.style.height = `${meta.rasterH * previewScale}px`;
pngEl.style.top = `${meta.yPx_png * previewScale}px`;
```

Uses `rasterW`/`rasterH` for sizing and `yPx_png` for top. Step 1 aligns `createCaptionOverlay` with this pattern for the legacy path.

### 1.4 Gate: When Does createCaptionOverlay Run?

**Verified.** [creative.html:2144](public/creative.html):

```javascript
if (!useOverlayMode) {
  createCaptionOverlay(result, overlay, { previewW: geometry.cssW, previewH: geometry.cssH, placement });
}
```

- Default: `useOverlayMode = true` (draggable overlay)
- To test Step 1: **uncheck "Use Draggable Overlay"** so the legacy PNG path runs

### 1.5 Beat Preview Unaffected

**Verified.** Beat preview uses:

- `applyPreviewResultToBeatCard()` — sets CSS variables on `.beat-caption-overlay`
- `--raster-w-ratio`, `--raster-h-ratio` from `meta.rasterW/frameW`, `meta.rasterH/frameH`
- Does **not** call `createCaptionOverlay`

Step 1 does not touch beat preview.

### 1.6 Current Bug (Pre-Change)

**Lines 1343-1345** ([caption-preview.js](public/js/caption-preview.js)):

```javascript
const dispW = (captionData.meta?.wPx || 1080) * s;
const dispH = (captionData.meta?.hPx || 1920) * s;
```

- V3 `meta` from server has `frameW`/`frameH`, not `wPx`/`hPx`
- So `meta?.wPx` and `meta?.hPx` are `undefined` → fallback to 1080×1920
- PNG is cropped (e.g. 400×150); sizing as 1080×1920 with `object-fit: contain` centers the caption in a tall box and skews placement

---

## 2. Exact Diff

**File:** `public/js/caption-preview.js`

**Replace lines 1342-1345:**

```javascript
  // Convert all overlay geometry to CSS with single scale factor
  const dispW = (captionData.meta?.wPx || 1080) * s;
  const dispH = (captionData.meta?.hPx || 1920) * s;
```

**With:**

```javascript
  // Convert all overlay geometry to CSS with single scale factor
  // V3 raster: use cropped raster dims so PNG content isn't centered in oversized box
  const meta = captionData.meta || {};
  const hasRaster = Number.isFinite(meta.rasterW) && Number.isFinite(meta.rasterH);
  const baseW = hasRaster ? meta.rasterW : (meta.wPx || 1080);
  const baseH = hasRaster ? meta.rasterH : (meta.hPx || 1920);
  const dispW = baseW * s;
  const dispH = baseH * s;
```

**Update the debug log (lines 1388-1393)** to add raster path fields:

```javascript
  console.log('[preview-overlay] positioning:', {
    W: finalW, H: finalH, iw: captionData.meta?.wPx, iH: captionData.meta?.hPx,
    rasterW: meta.rasterW, rasterH: meta.rasterH, hasRaster, baseW, baseH,
    dispW: finalDispW, dispH: finalDispH, align, yPct,
    finalScale: s, scaledTotalTextH, totalTextH, left, top, targetTop,
    safeTopMargin, safeBottomMargin
  });
```

---

## 3. What NOT to Change

- **targetTop formula** (line 1377): leave `(yPct * finalH) - (scaledTotalTextH / 2)` as-is
- **Safe margins** (lines 1363-1365): keep 5% top, 8% bottom
- **Placement constants**: no changes in caption-geom.js or server

---

## 4. Verification Checklist

### 4.1 Enable Legacy Path

1. Open Creative Studio.
2. Uncheck **"Use Draggable Overlay"**.
3. Add a quote and background so preview generates.

### 4.2 Console Confirmation

Filter for `[preview-overlay]` in DevTools. Expected:

- `hasRaster: true` for V3
- `rasterW`, `rasterH` — cropped dims (e.g. ~400, ~150)
- `baseW`, `baseH` — same as rasterW/rasterH
- `dispW`, `dispH` — `rasterW * s`, `rasterH * s` (not 1920 * s)

**Before Step 1:** `dispH` ≈ 640 (for 360×640 container, s≈0.33, 1920*0.33≈640)  
**After Step 1:** `dispH` ≈ 50 (e.g. 150*0.33≈50)

### 4.3 Visual Checks

| Placement | Expected |
|-----------|----------|
| **Top** | Caption closer to top of view |
| **Center** | Less “low”, more centered |
| **Bottom** | Still within safe margin |

### 4.4 Beat Preview

- Change placement in beat cards; beat caption overlays should behave as before.

---

## 5. Risk

- **Low.** Same approach as `showServerPNG()`.
- **Fallback:** If `rasterW`/`rasterH` missing, `hasRaster` is false and old logic (wPx/hPx or 1080×1920) applies.

---

## 6. Revert

If needed, revert to:

```javascript
const dispW = (captionData.meta?.wPx || 1080) * s;
const dispH = (captionData.meta?.hPx || 1920) * s;
```

and remove the added log fields.
