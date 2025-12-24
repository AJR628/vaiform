# Final Truth Audit Report - Server & Client SSOT Verification

## PHASE 1: Server-Side Truth (RasterSchema V3 Mode)

### Location: `src/routes/caption.preview.routes.js`

### RasterSchema Definition (Lines 11-61)

**Required fields by schema**:
- `rasterW` (line 38): `z.coerce.number().int().min(100).max(1080)` ✅ REQUIRED
- `rasterH` (line 39): `z.coerce.number().int().min(50).max(1920)` ✅ REQUIRED  
- `yPx_png` (line 40): `z.coerce.number().int().min(0).max(1920)` ✅ REQUIRED
- `totalTextH` (line 53): `z.coerce.number().int().min(1)` ✅ REQUIRED
- `yPxFirstLine` (line 54): `z.coerce.number().int()` ✅ REQUIRED
- `lines` (line 52): `z.array(z.string()).min(1)` ✅ REQUIRED
- `rasterPadding` (line 42): `z.coerce.number().int().default(24)` (has default)

### Server Handling (V3 Raster Mode - Lines 149-151)

**Line 151**: 
```javascript
const yPxFirstLine = data.yPxFirstLine || (yPx_png + rasterPadding);
```

**CRITICAL FINDING**: 
- Server **TRUSTS** client `yPxFirstLine` if provided
- Falls back to `yPx_png + rasterPadding` if missing
- This fallback suggests the relationship: `yPxFirstLine = yPx_png + rasterPadding`

### Server Usage in renderCaptionRaster (Line 1254)

**Line 1254**:
```javascript
const yPx = meta.yPxFirstLine - padding;
```

**CRITICAL FINDING**:
- `yPx_png` (PNG top position) = `yPxFirstLine - padding`
- Therefore: `yPxFirstLine = yPx_png + padding`
- This confirms the fallback formula is correct

### Server Truth Table (V3 Raster Mode)

| Field | Required by Schema? | Computed Client? | Recomputed Server? | Used for Raster Placement? | Used for Text Baseline? |
|-------|---------------------|------------------|-------------------|----------------------------|-------------------------|
| `rasterW` | ✅ Yes (line 38) | ✅ Yes | ❌ No (line 115-116: trusts client) | ✅ Yes (PNG width) | ❌ No |
| `rasterH` | ✅ Yes (line 39) | ✅ Yes | ❌ No (line 116: trusts client) | ✅ Yes (PNG height) | ❌ No |
| `yPx_png` | ✅ Yes (line 40) | ✅ Yes | ❌ No (line 117: trusts client) | ✅ Yes (PNG top Y) | ❌ No |
| `totalTextH` | ✅ Yes (line 53) | ✅ Yes | ❌ No (line 150: trusts client, has fallback) | ❌ No | ✅ Yes |
| `yPxFirstLine` | ✅ Yes (line 54) | ✅ Yes | ❌ No (line 151: trusts client, has fallback) | ❌ No | ✅ Yes (first line baseline) |
| `lines` | ✅ Yes (line 52) | ✅ Yes | ❌ No (line 119: trusts client) | ❌ No | ✅ Yes (wrapped lines) |
| `rasterPadding` | ❌ No (has default) | ✅ Yes | ❌ No (line 118: trusts client) | ✅ Yes (PNG padding) | ❌ No |

**KEY INSIGHT**: 
- Server **TRUSTS** all client values in V3 raster mode
- `yPxFirstLine` fallback: `yPx_png + rasterPadding` is mathematically correct (confirmed by line 1254)
- No clamping happens in V3 raster mode (client provides final values)

---

## PHASE 1: Server-Side Truth (Legacy/Non-Raster Mode)

### Location: `src/routes/caption.preview.routes.js` (Lines 385-728)

**NOTE**: This is the **legacy fallback path** (non-V3-raster). We're using V3 raster, but documenting for completeness.

**Line 547-561**: Server computes `yPxFirstLine`:
```javascript
const anchorY = Math.round(yPctClamped * H);
let yPxFirstLine = Math.round(anchorY - (totalTextH / 2));

// Apply safe margins (clamps yPxFirstLine)
if (yPxFirstLine < SAFE_TOP_PX) {
  yPxFirstLine = SAFE_TOP_PX;
}
if (yPxFirstLine + totalTextH > H - SAFE_BOTTOM_PX) {
  yPxFirstLine = H - SAFE_BOTTOM_PX - totalTextH;
}
```

**However**: This path is NOT used for V3 raster mode (gate at line 68-70 prevents it).

---

## PHASE 2: Client Working Path Truth

### Location: `public/js/caption-overlay.js`

### emitCaptionState() Function (Lines 1203-1447)

### Field Computation (Current Working Path)

**lines** (Line 1266):
- Uses `extractRenderedLines(content)` helper
- Extracts from DOM using Range API + TreeWalker

**totalTextH** (Line 1316):
```javascript
const totalTextH = Math.round(content.getBoundingClientRect().height);
```
- Uses actual DOM height (includes line-height effects)

**rasterW** (Lines 1319-1320):
```javascript
const wPx = Math.round((boxRect.width / stageWidth) * frameW);
const rasterW = wPx;
```
- ✅ Box width scaled to frame space (NOT tight text width)

**rasterH** (Lines 1323-1329):
```javascript
const rasterH = window.CaptionGeom.computeRasterH({
  totalTextH,
  padTop: cssPaddingTop,
  padBottom: cssPaddingBottom,
  shadowBlur: shadow.blur,
  shadowOffsetY: shadow.y
});
```
- Uses shared helper

**rasterPadding** (Line 1330):
```javascript
const rasterPadding = Math.round((cssPaddingTop + cssPaddingBottom) / 2);
```
- Average of top/bottom padding

**yPct** (Line 1333):
```javascript
const yPct = (boxRect.top - stageRect.top) / stageHeight;
```
- Derived from box DOM position

**yPx_png** (Line 1344):
```javascript
const yPx_png = Math.round(yPct * frameH);
```
- Top of caption box in frame space (NOT baseline, NOT clamped)

**yPxFirstLine**: 
- ❌ **NOT COMPUTED** in `emitCaptionState()`
- ❌ **NOT PRESENT** in returned state object (lines 1378-1425)

**previewFontString** (Lines 1273-1274):
```javascript
const family = getVariantFamily(weightCss, fontStyle); // Always returns 'DejaVu Sans'
const previewFontString = `${fontStyle} ${weightCss === '700' ? 'bold' : 'normal'} ${fontPx}px "${family}"`;
```
- Manually constructed (does NOT use `cs.font` directly)

### caption-preview.js Fallback (Line 303)

**Current fallback**:
```javascript
yPxFirstLine: overlayMeta.yPxFirstLine || (overlayMeta.yPx_png + overlayMeta.rasterPadding),
```

**Analysis**: 
- This fallback matches server fallback formula (line 151)
- Server formula: `yPx = meta.yPxFirstLine - padding` (line 1254) confirms relationship
- ✅ Fallback is **mathematically correct**

---

## PHASE 2: Client Truth Summary

### Client Working Path Fields

| Field | Computation | Location | Notes |
|-------|-------------|----------|-------|
| `lines` | `extractRenderedLines(content)` | Line 1266 | DOM-based extraction |
| `totalTextH` | `content.getBoundingClientRect().height` | Line 1316 | Actual DOM height |
| `rasterW` | `(boxRect.width / stageWidth) * frameW` | Lines 1319-1320 | Box width scaled |
| `rasterH` | `CaptionGeom.computeRasterH(...)` | Lines 1323-1329 | Shared helper |
| `rasterPadding` | `(cssPaddingTop + cssPaddingBottom) / 2` | Line 1330 | Average padding |
| `yPct` | `(boxRect.top - stageRect.top) / stageHeight` | Line 1333 | From DOM position |
| `yPx_png` | `Math.round(yPct * frameH)` | Line 1344 | Box top in frame space |
| `yPxFirstLine` | ❌ **NOT COMPUTED** | N/A | Missing from overlayMeta |
| `previewFontString` | Manual construction | Lines 1273-1274 | `"${fontStyle} ${weight} ${fontPx}px \"${family}\""` |

---

## KEY FINDINGS

### 1. yPxFirstLine Truth

**Server behavior** (V3 raster mode):
- Accepts client `yPxFirstLine` if provided (line 151)
- Falls back to `yPx_png + rasterPadding` if missing
- Uses formula: `yPx_png = yPxFirstLine - padding` (line 1254)

**Client behavior**:
- Does NOT compute `yPxFirstLine` in `emitCaptionState()`
- Uses fallback in `caption-preview.js`: `yPx_png + rasterPadding` (line 303)

**Conclusion**: 
- ✅ Fallback formula is correct (matches server relationship)
- Client should compute `yPxFirstLine = yPx_png + rasterPadding` in shared helper
- This ensures consistency and removes fallback dependency

### 2. yPx_png Truth

**Definition**: Top of caption box in frame space (line 1344: `Math.round(yPct * frameH)`)
**NOT**: Text baseline, NOT clamped, NOT raster PNG top (that's `yPx_png - padding` via line 1254)

**Server uses**: PNG top = `yPxFirstLine - padding = yPx_png + padding - padding = yPx_png` ✅ Wait, that doesn't match...

Let me re-check line 1254:
```javascript
const yPx = meta.yPxFirstLine - padding;
```

So: `yPx_png` (PNG top) = `yPxFirstLine - padding`

If client sends `yPx_png` (box top) and `yPxFirstLine = yPx_png + padding`, then:
- Server computes PNG top = `(yPx_png + padding) - padding = yPx_png` ✅

**Conclusion**: 
- `yPx_png` from client = box top
- `yPxFirstLine = yPx_png + padding` (first line baseline)
- Server PNG top = `yPxFirstLine - padding = yPx_png` ✅ Consistent

### 3. rasterPadding Truth

**Computation**: Average of top and bottom CSS padding (line 1330)
**Used for**: PNG padding in raster generation

### 4. rasterW Truth

**Computation**: Box width scaled to frame space (NOT tight text width)
**Confirmed**: ✅ Correct approach (line 1319-1320)

### 5. previewFontString Truth

**Computation**: Manually constructed, does NOT use `cs.font` directly
**Format**: `"${fontStyle} ${weight === '700' ? 'bold' : 'normal'} ${fontPx}px \"DejaVu Sans\""`
**Note**: This matches server expectations (verified in audit logs)

---

## RECOMMENDATIONS

### 1. Compute yPxFirstLine in Shared Helper

**Action**: Add to `computeCaptionMetaFromElements()`:
```javascript
const yPxFirstLine = yPx_png + rasterPadding;
```

**Reason**: 
- Removes fallback dependency
- Ensures consistency
- Matches server formula relationship

### 2. Keep rasterW as Box Width

**Status**: ✅ Already correct (box width scaled)

### 3. Keep previewFontString Construction

**Status**: ✅ Already correct (manual construction matches server)

### 4. Position Box Before Compute

**Action**: Set `boxEl.style.top` from `style.yPct` BEFORE calling `computeCaptionMetaFromElements()`

**Reason**: 
- Ensures `yPct` is derived from DOM position (same as live overlay)
- No override needed after compute

---

## TRUTH TABLE SUMMARY

| Field | Client Computes? | Server Trusts? | Formula |
|-------|------------------|----------------|---------|
| `rasterW` | ✅ Yes (box width scaled) | ✅ Yes | `(boxRect.width / stageWidth) * frameW` |
| `rasterH` | ✅ Yes (CaptionGeom helper) | ✅ Yes | `computeRasterH(...)` |
| `yPx_png` | ✅ Yes (box top) | ✅ Yes | `Math.round(yPct * frameH)` |
| `totalTextH` | ✅ Yes (DOM height) | ✅ Yes | `content.getBoundingClientRect().height` |
| `yPxFirstLine` | ❌ No (missing) | ✅ Yes (with fallback) | `yPx_png + rasterPadding` (should compute) |
| `lines` | ✅ Yes (extractRenderedLines) | ✅ Yes | DOM Range API |
| `rasterPadding` | ✅ Yes (avg padding) | ✅ Yes | `(cssPaddingTop + cssPaddingBottom) / 2` |
| `previewFontString` | ✅ Yes (manual) | ✅ Yes | `"${fontStyle} ${weight} ${fontPx}px \"${family}\""` |




