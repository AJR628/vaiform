# Phase 1 Verification Audit

## 1. Exact Keys Produced by `window.getCaptionMeta()`

**Location**: `public/js/caption-overlay.js`, function `window.getCaptionMeta()` (line 856), returns `state` object (lines 1378-1425)

**Exact keys returned**:
```javascript
{
  // Typography
  fontFamily,
  fontPx,
  lineSpacingPx,
  letterSpacingPx,
  weightCss,
  fontStyle,
  textAlign,
  textTransform,
  previewFontString,
  
  // Color & effects
  color,
  opacity,
  strokePx,
  strokeColor,
  shadowColor,
  shadowBlur,
  shadowOffsetX,
  shadowOffsetY,
  
  // Geometry (frame-space pixels)
  frameW,           // ✅ Present
  frameH,           // ✅ Present
  rasterW,          // ✅ Present
  rasterH,          // ✅ Present
  totalTextH,       // ✅ Present
  rasterPadding,    // ✅ Present
  rasterPaddingX,
  rasterPaddingY,
  xPct,
  yPct,
  wPct,
  yPx_png,          // ✅ Present
  xPx_png,
  xExpr_png,
  
  // Line breaks
  lines,            // ✅ Present (array of strings)
  
  // Metadata
  text,
  textRaw,
  ssotVersion: 3,
  mode,
  reason
}
```

**Missing key**: `yPxFirstLine` is **NOT** present in `getCaptionMeta()` output.

**Where `yPxFirstLine` comes from in `generateCaptionPreview()`**:
- Location: `public/js/caption-preview.js` line 303
- Computation: `overlayMeta.yPxFirstLine || (overlayMeta.yPx_png + overlayMeta.rasterPadding)`
- **Fallback formula**: `yPx_png + rasterPadding` (first line baseline = PNG top + padding)

**Conclusion**: For beat previews, compute `yPxFirstLine = yPx_png + rasterPadding` as fallback.

---

## 2. apiFetch AbortController Signal Support

**Location**: `public/api.mjs`, function `apiFetch()` (line 112)

**Code at line 156**:
```javascript
let res = await fetch(urlApi, { ...opts, body, headers, credentials: "omit" });
```

**Analysis**: 
- ✅ `apiFetch` spreads `opts` into fetch call: `{ ...opts, body, headers, credentials: "omit" }`
- ✅ If `opts.signal` is provided, it will be passed through to `fetch()`
- ✅ AbortController signal forwarding is **supported**

**Verification**: Line 156 shows `opts` is spread before `body` and `headers`, so any `opts.signal` will be included.

**Conclusion**: ✅ Can use AbortController with apiFetch by passing `{ signal }` in opts.

---

## 3. `/api/caption/preview` Auth Requirements

**Location**: `src/routes/caption.preview.routes.js` line 65

**Route definition**:
```javascript
router.post("/caption/preview", express.json(), async (req, res) => {
```

**Auth middleware check**:
- ✅ **NO** `requireAuth` middleware on the route
- ✅ Route handler directly processes request without auth check

**apiFetch behavior** (from `public/api.mjs` line 125):
- Path `/caption/` is in `needsAuth` list
- apiFetch will attempt to add `Authorization: Bearer <token>` header
- But server route does **NOT** require it

**Conclusion**: 
- ✅ Route is **public** (no auth required)
- ✅ apiFetch may send auth token, but server ignores it
- ✅ Beat previews will work without auth (no silent failures)

---

## Summary

1. ✅ `getCaptionMeta()` includes: `lines`, `totalTextH`, `rasterW`, `rasterH`, `yPx_png`, `rasterPadding`, `frameW`, `frameH`
2. ✅ `yPxFirstLine` is computed as: `yPx_png + rasterPadding` (fallback formula)
3. ✅ `apiFetch` supports AbortController signal (passed through to fetch)
4. ✅ `/api/caption/preview` is public (no auth required)

