# Phase 1 Audit Report - Current Truth Verification

## Question 1: overlayMeta shape and yPxFirstLine source

**Location**: `public/js/caption-overlay.js` lines 1378-1425 (state object), `public/js/caption-preview.js` line 303

**Finding**: `yPxFirstLine` is **NOT** present in `getCaptionMeta()` output.

The state object returned by `emitCaptionState()` (which `getCaptionMeta()` exposes) contains:
- `yPx_png` (line 1412)
- `rasterPadding` (line 1406)
- But **NOT** `yPxFirstLine`

**Where yPxFirstLine comes from**:
```303:303:public/js/caption-preview.js
        yPxFirstLine: overlayMeta.yPxFirstLine || (overlayMeta.yPx_png + overlayMeta.rasterPadding),
```

**Conclusion**: `yPxFirstLine` is computed as a **fallback formula** in `generateCaptionPreview()`: `yPx_png + rasterPadding`. This is the baseline Y position for the first line of text.

---

## Question 2: yPx_png meaning and safe margin clamping

**Location**: `public/js/caption-overlay.js` lines 1332-1344

**Formula**:
```1344:1344:public/js/caption-overlay.js
    const yPx_png = Math.round(yPct * frameH);
```

Where `yPct` is computed from:
```1333:1333:public/js/caption-overlay.js
    const yPct = (boxRect.top - stageRect.top) / stageHeight;
```

**Meaning**: `yPx_png` is the **top of the caption box** in frame-space pixels (1080×1920), computed from the box's position on the stage.

**Safe margin clamping**: 
- **Client-side**: No clamping happens in `getCaptionMeta()`. The yPct is computed directly from DOM positions.
- **Server-side**: Safe margins are applied during PNG raster generation (see `src/routes/caption.preview.routes.js` and `src/render/overlay.helpers.js`).

**Conclusion**: `yPx_png` represents the box top position. Safe margin clamping happens server-side during preview generation, not in the client meta computation.

---

## Question 3: apiFetch AbortController.signal forwarding

**Location**: `public/api.mjs` lines 112-156

**Code**:
```156:156:public/api.mjs
  let res = await fetch(urlApi, { ...opts, body, headers, credentials: "omit" });
```

**Analysis**: Since `opts` is spread first, any `opts.signal` (AbortController signal) will be passed through to `fetch()`. The signal is forwarded correctly.

**Conclusion**: ✅ AbortController.signal is supported. Can use AbortController for request cancellation.

---

## Question 4: Correct endpoint path

**Location**: `public/api.mjs` lines 9, 154-155, `src/routes/caption.preview.routes.js` line 65

**apiFetch behavior**:
```154:155:public/api.mjs
  const urlApi = `${API_ROOT}${path}`;
  dlog("fetch →", urlApi);
```

Where `API_ROOT = BACKEND_URL` (line 9) which includes `/api`.

**Route definition**:
```65:65:src/routes/caption.preview.routes.js
router.post("/caption/preview", express.json(), async (req, res) => {
```

**Conclusion**: When calling `apiFetch('/caption/preview', ...)`, the full URL becomes `${API_ROOT}/caption/preview` which resolves to `/api/caption/preview` on the server. ✅ Correct path.

---

## Summary

1. ✅ `yPxFirstLine` is NOT in overlayMeta - use fallback: `yPx_png + rasterPadding`
2. ✅ `yPx_png` = top of caption box in frame space (no client-side clamping)
3. ✅ `apiFetch` forwards AbortController.signal correctly
4. ✅ Endpoint path: `/caption/preview` (apiFetch adds `/api` prefix)





