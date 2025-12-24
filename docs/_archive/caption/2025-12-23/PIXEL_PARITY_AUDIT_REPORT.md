# PIXEL PARITY AUDIT REPORT
**Overlay Preview ↔ PNG Rendering Geometry & Line Extraction**

---

## EXECUTIVE SUMMARY

Found **4 critical issues** causing pixel-parity failures between HTML overlay preview and server-rendered PNG:

1. **Server renderer guard rejects `0` padding** (falsy check instead of numeric check)
2. **Client hardcodes `rasterPadding: 0`** instead of reading actual overlay geometry
3. **Client normalization has duplicate/conflicting `clientRasterPadding` assignments**
4. **Baseline calculation (`yPxFirstLine`) doesn't account for padding** when padding is intended to be non-zero

**Result**: When overlay has visual padding, the PNG renderer throws an error or receives incorrect geometry, causing misalignment.

---

## FINDINGS TABLE

| # | File | Function/Lines | Issue | Impact |
|---|------|----------------|-------|--------|
| **1** | `src/routes/caption.preview.routes.js` | `renderCaptionRaster()`, line **1064** | Falsy guard: `if (!meta.clientRasterW \|\| !meta.clientRasterH \|\| !meta.clientRasterPadding)` **rejects `0` as falsy** | Throws `'RASTER: clientRasterW/H/Padding required but missing'` when padding is legitimately `0` |
| **2** | `public/creative.html` | `buildRasterFromBrowser()`, line **3515** | Hardcoded: `rasterPadding: 0` with comment `// set >0 only if your overlay shows extra pad visually` | Always sends `0` regardless of actual overlay padding; if overlay box has internal padding, PNG won't match |
| **3** | `public/creative.html` | `normalizeRasterPayload()`, lines **3327-3329** and **3348-3350** | **Duplicate assignment**: `clientRasterPadding` set twice:<br>• L3329: `int(p.clientRasterPadding \|\| p.rasterPadding \|\| 0)`<br>• L3350: `int(p.rasterPadding \|\| 0)` | Second assignment **overwrites** the first; if `p.rasterPadding` is `0` (from finding #2), final value is `0` |
| **4** | `public/creative.html` | `buildRasterFromBrowser()`, line **3501** | `yPxFirstLine: toFramePx(firstLineTopCss, ...)` uses box top, **not** `yPx_png + rasterPadding` | When padding > 0, first line baseline is wrong; server expects `yPxFirstLine = yPx_png + padding` for text rendering |

---

## CALL-FLOW DIAGRAM

```
┌─────────────────────────────────────────────────────────────────────┐
│ BROWSER (public/creative.html)                                      │
├─────────────────────────────────────────────────────────────────────┤
│ 1. User clicks "Save Preview" → savePreview()                       │
│    ├─ Calls: buildRasterFromBrowser({ stageEl, contentEl, ... })   │
│    │   ├─ Reads: stageEl.getBoundingClientRect() → box             │
│    │   ├─ Calls: window.extractRenderedLines(contentEl) → lines[]  │
│    │   │          ↑ imported from caption-overlay.js (SSOT)        │
│    │   ├─ Converts CSS → frame pixels (fontPx, lineSpacing, etc.)  │
│    │   └─ RETURNS:                                                  │
│    │       • lines: string[] (DOM-measured)                         │
│    │       • splitLines: lines.length                               │
│    │       • rasterW, rasterH (frame px)                            │
│    │       • rasterPadding: 0  ❌ HARDCODED                         │
│    │       • yPxFirstLine: toFramePx(box.top)  ❌ NO PADDING        │
│    │       • fontPx, lineSpacingPx, letterSpacingPx                 │
│    │       • previewFontString                                      │
│    │       • totalTextH                                             │
│    ├─ Builds payload:                                               │
│    │   {                                                             │
│    │     lines: browserGeometry.lines,                              │
│    │     rasterW: browserGeometry.rasterW,                          │
│    │     rasterH: browserGeometry.rasterH,                          │
│    │     rasterPadding: browserGeometry.rasterPadding, // = 0      │
│    │     clientRasterW: browserGeometry.rasterW,                    │
│    │     clientRasterH: browserGeometry.rasterH,                    │
│    │     clientRasterPadding: browserGeometry.rasterPadding, // =0 │
│    │     yPxFirstLine: browserGeometry.yPxFirstLine, // box.top    │
│    │     ...                                                         │
│    │   }                                                             │
│    └─ Calls: normalizeRasterPayload(payload)                        │
│        ├─ L3323: rasterPadding: int(p.rasterPadding || 0) → 0      │
│        ├─ L3329: clientRasterPadding: int(...|| p.rasterPadding||0)│
│        └─ L3350: clientRasterPadding: int(p.rasterPadding||0) ❌ DUP│
│            → Final clientRasterPadding = 0                          │
│                                                                      │
│ 2. POST /api/caption/preview with normalizedPayload                 │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ SERVER (src/routes/caption.preview.routes.js)                       │
├─────────────────────────────────────────────────────────────────────┤
│ 3. Route handler: POST /caption/preview                             │
│    ├─ Detects: ssotVersion=3, mode='raster' → V3 RASTER path       │
│    ├─ Extracts from req.body:                                       │
│    │   • rasterW = data.rasterW                                     │
│    │   • rasterH = data.rasterH                                     │
│    │   • rasterPadding = data.rasterPadding  (= 0)                 │
│    │   • lines = data.lines (browser truth)                         │
│    ├─ Validation (L158-164):                                        │
│    │   if (!Number.isFinite(rasterPadding) || rasterPadding < 0)   │
│    │   ❌ PASSES when rasterPadding=0 (Number.isFinite(0)=true)    │
│    │                                                                 │
│    └─ Calls: renderCaptionRaster({                                  │
│         clientRasterW: rasterW,                                     │
│         clientRasterH: rasterH,                                     │
│         clientRasterPadding: rasterPadding, // = 0                 │
│         splitLines: lines,                                          │
│         previewFontString,                                          │
│         ...                                                          │
│       })                                                             │
└─────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────┐
│ RENDERER (src/routes/caption.preview.routes.js)                     │
├─────────────────────────────────────────────────────────────────────┤
│ 4. async function renderCaptionRaster(meta)                         │
│    ├─ L1064: Guard condition:                                       │
│    │   if (!meta.clientRasterW || !meta.clientRasterH ||           │
│    │       !meta.clientRasterPadding) {                             │
│    │   ❌ PROBLEM: !0 === true, so guard triggers when padding=0   │
│    │   throw new Error('RASTER: clientRasterW/H/Padding required') │
│    │   }                                                             │
│    ├─ L1068-1070: Extract values (if guard passes)                  │
│    │   padding = meta.clientRasterPadding                           │
│    │   rasterW = meta.clientRasterW                                 │
│    │   rasterH = meta.clientRasterH                                 │
│    ├─ L1115: Draw text starting at:                                 │
│    │   let currentY = padding;  // top padding                      │
│    │   // For each line: render at (x, currentY)                    │
│    │   // currentY += fontPx + lineSpacingPx                        │
│    └─ Returns PNG data URL                                          │
└─────────────────────────────────────────────────────────────────────┘
```

### Variable Mapping

| Client Field | Payload Field | Server Field | Renderer Variable |
|--------------|---------------|--------------|-------------------|
| `browserGeometry.lines` | `lines` | `data.lines` | `meta.splitLines` |
| `browserGeometry.rasterW` | `rasterW` → `clientRasterW` | `rasterW` → `clientRasterW` | `rasterW` |
| `browserGeometry.rasterH` | `rasterH` → `clientRasterH` | `rasterH` → `clientRasterH` | `rasterH` |
| `browserGeometry.rasterPadding` (=0) | `rasterPadding` → `clientRasterPadding` (=0) | `rasterPadding` → `clientRasterPadding` (=0) | `padding` (❌ rejected if 0) |
| `browserGeometry.yPxFirstLine` | `yPxFirstLine` | `data.yPxFirstLine` | (unused in renderer) |
| `browserGeometry.previewFontString` | `previewFontString` | `data.previewFontString` | `meta.previewFontString` |
| `browserGeometry.fontPx` | `fontPx` | `fontPx` | `meta.fontPx` |
| `browserGeometry.lineSpacingPx` | `lineSpacingPx` | `lineSpacingPx` | (implicit) |
| `browserGeometry.letterSpacingPx` | `letterSpacingPx` | `letterSpacingPx` | `meta.letterSpacingPx` |

---

## ROOT CAUSE ANALYSIS

### Issue #1: Server Guard Uses Falsy Check Instead of Numeric Check

**File**: `src/routes/caption.preview.routes.js`  
**Function**: `renderCaptionRaster(meta)`  
**Lines**: 1064-1066

```javascript
if (!meta.clientRasterW || !meta.clientRasterH || !meta.clientRasterPadding) {
  throw new Error('RASTER: clientRasterW/H/Padding required but missing');
}
```

**Problem**: `!meta.clientRasterPadding` evaluates to `true` when `meta.clientRasterPadding === 0`, incorrectly treating legitimate zero padding as missing.

**Expected**: Numeric check that allows `0`:
```javascript
if (!Number.isFinite(meta.clientRasterW) || !Number.isFinite(meta.clientRasterH) || 
    meta.clientRasterPadding === undefined || meta.clientRasterPadding === null) {
```

---

### Issue #2: Client Hardcodes `rasterPadding: 0`

**File**: `public/creative.html`  
**Function**: `buildRasterFromBrowser()`  
**Line**: 3515

```javascript
// Raster box (tight to the content box)
rasterW: rW,
rasterH: rH,
rasterPadding: 0,                 // set >0 only if your overlay shows extra pad visually
```

**Problem**: Always returns `0`, regardless of actual overlay padding. If the overlay `.caption-box` or `.content` element has CSS padding, this doesn't capture it.

**Expected**: Measure actual padding from computed styles or box model:
```javascript
const contentPadding = parseFloat(getComputedStyle(contentEl).paddingTop) || 0;
const paddingFramePx = toFramePx(contentPadding, { frameW, previewCssW });
```

---

### Issue #3: Duplicate Assignment in `normalizeRasterPayload()`

**File**: `public/creative.html`  
**Function**: `normalizeRasterPayload(p)`  
**Lines**: 3327-3329, 3348-3350

```javascript
// Client canonical values (required for V3 raster)
clientRasterW: int(p.clientRasterW || p.rasterW),
clientRasterH: int(p.clientRasterH || p.rasterH),
clientRasterPadding: int(p.clientRasterPadding || p.rasterPadding || 0),
```

**Then later**:

```javascript
// CRITICAL: Map client fields to server-expected field names
clientRasterW: int(p.rasterW),
clientRasterH: int(p.rasterH),
clientRasterPadding: int(p.rasterPadding || 0),
```

**Problem**: Second assignment overwrites the first. Since `p.rasterPadding` is already `0` (from issue #2), the fallback `|| 0` doesn't help.

**Expected**: Remove the duplicate block (lines 3347-3350) and rely on the first assignment.

---

### Issue #4: `yPxFirstLine` Doesn't Include Padding

**File**: `public/creative.html`  
**Function**: `buildRasterFromBrowser()`  
**Line**: 3501

```javascript
yPxFirstLine: toFramePx(firstLineTopCss, { frameW, previewCssW }),
```

Where `firstLineTopCss = box.top` (line 3479).

**Problem**: If padding exists, the first text baseline should be `yPx_png + padding`, not just the box top. The renderer draws text starting at `currentY = padding` (line 1115 in renderer), so the baseline coordinate sent to the server must account for this.

**Expected**:
```javascript
yPxFirstLine: yPx_png + paddingFramePx,
```

---

## LINES SSOT VERIFICATION

✅ **Single Source of Truth Confirmed**

- **Source**: `public/js/caption-overlay.js` exports `extractRenderedLines(element)` (lines 1033-1105)
- **Import**: `public/creative.html` line 107-108:
  ```javascript
  import { extractRenderedLines } from './js/caption-overlay.js';
  window.extractRenderedLines = extractRenderedLines;
  ```
- **Usage**: `buildRasterFromBrowser()` calls `window.extractRenderedLines(contentEl)` at line 3474
- **Duplicate Check**: The inline `extractLines()` function at lines 3418-3460 exists but is **not used** by `savePreview()` or `buildRasterFromBrowser()`

**Conclusion**: No duplication issue; SSOT is maintained. However, the unused `extractLines()` function could be removed to avoid confusion.

---

## MINIMAL-DIFF PLAN

### 1. Server: Fix Renderer Guard (Allow `0` Padding)

**File**: `src/routes/caption.preview.routes.js`  
**Function**: `renderCaptionRaster()`  
**Lines**: 1064-1066

**Current**:
```javascript
if (!meta.clientRasterW || !meta.clientRasterH || !meta.clientRasterPadding) {
  throw new Error('RASTER: clientRasterW/H/Padding required but missing');
}
```

**Proposed**:
```javascript
if (
  !Number.isFinite(meta.clientRasterW) || meta.clientRasterW <= 0 ||
  !Number.isFinite(meta.clientRasterH) || meta.clientRasterH <= 0 ||
  meta.clientRasterPadding === undefined || meta.clientRasterPadding === null || !Number.isFinite(meta.clientRasterPadding)
) {
  throw new Error('RASTER: clientRasterW/H/Padding required but missing or invalid');
}
```

**Rationale**: Allows `clientRasterPadding: 0` while still rejecting `undefined`, `null`, `NaN`.

---

### 2. Route: Validation Already Correct (No Change Needed)

**File**: `src/routes/caption.preview.routes.js`  
**Lines**: 158-164

The route's validation is already correct:
```javascript
if (!Number.isFinite(rasterPadding) || rasterPadding < 0) {
  console.error('[raster] clientRasterPadding is missing or invalid:', rasterPadding);
  return res.status(400).json({ ... });
}
```

✅ This correctly allows `0` and only rejects negative/non-finite values.

---

### 3. Client: Read Actual Padding from Overlay Geometry

**File**: `public/creative.html`  
**Function**: `buildRasterFromBrowser()`  
**Lines**: 3515, 3501

**Current**:
```javascript
// Raster box (tight to the content box)
rasterW: rW,
rasterH: rH,
rasterPadding: 0,                 // set >0 only if your overlay shows extra pad visually

// Placement in frame space
xPx_png,                          // or use xExpr_png='(W-overlay_w)/2' if you center
yPx_png,

// Frame (unchanged)
frameW, frameH,
```

**Proposed**:
```javascript
// 6a) Read actual padding from content element (if any)
const contentPaddingTop = parseFloat(getComputedStyle(contentEl).paddingTop) || 0;
const paddingFramePx = Math.round(toFramePx(contentPaddingTop, { frameW, previewCssW }));

// 6b) Baseline calculation: first line starts at yPx_png + padding
const yPxFirstLineCalculated = yPx_png + paddingFramePx;

return {
  // DOM truth - correct field names for server
  lines,                    // string[] - the actual line text
  splitLines: lines.length,  // number - the count
  totalTextH: totalTextHFrame,      // Frame pixels
  yPxFirstLine: yPxFirstLineCalculated,  // ✅ FIX: account for padding

  // Fonts & spacing (converted to frame space)
  fontPx: fontPxFrame,
  lineSpacingPx: lineSpacingPxFrame,
  letterSpacingPx: letterSpacingPxFrame,
  fontFamily: s.fontFamily,
  fontStyle: s.fontStyle,
  weightCss: s.weightCss,
  previewFontString: `${s.fontStyle} ${s.weightCss} ${fontPxFrame}px "${s.fontFamily.split(',')[0].replace(/["']/g,'').trim()}"`,

  // Raster box (tight to the content box)
  rasterW: rW,
  rasterH: rH,
  rasterPadding: paddingFramePx,  // ✅ FIX: read from DOM, not hardcoded 0

  // Placement in frame space
  xPx_png,
  yPx_png,

  // Frame (unchanged)
  frameW, frameH,
};
```

**Lines to change**:
- Insert new lines after 3494 to compute `paddingFramePx` and `yPxFirstLineCalculated`
- Update line 3501: `yPxFirstLine: yPxFirstLineCalculated,`
- Update line 3515: `rasterPadding: paddingFramePx,`

---

### 4. Client: Remove Duplicate `clientRasterPadding` Assignment

**File**: `public/creative.html`  
**Function**: `normalizeRasterPayload()`  
**Lines**: 3347-3350

**Current** (duplicate block):
```javascript
// CRITICAL: Map client fields to server-expected field names
clientRasterW: int(p.rasterW),
clientRasterH: int(p.rasterH),
clientRasterPadding: int(p.rasterPadding || 0),
```

**Proposed**: **Delete lines 3347-3350** (the comment and three assignments).

The first assignment (lines 3327-3329) already handles this correctly:
```javascript
clientRasterW: int(p.clientRasterW || p.rasterW),
clientRasterH: int(p.clientRasterH || p.rasterH),
clientRasterPadding: int(p.clientRasterPadding || p.rasterPadding || 0),
```

---

### 5. Optional: Remove Unused `extractLines()` Function

**File**: `public/creative.html`  
**Lines**: 3418-3460

The inline `extractLines()` function is not used by `savePreview()`. To avoid confusion:

**Proposed**: Delete lines 3416-3460 (function definition and comment).

**Rationale**: Reduces code duplication and clarifies that `window.extractRenderedLines` (from `caption-overlay.js`) is the single source of truth.

---

### 6. Error Shape Consistency (Optional Enhancement)

**Current**: Renderer errors bubble up as exceptions; route catches and returns various shapes (`{ok:false}` vs `{success:false}`).

**Proposed** (optional): Wrap renderer call in try-catch at route level:

```javascript
try {
  const rasterResult = await renderCaptionRaster({ ... });
  // ... success path
} catch (err) {
  console.error('[raster] Render failed:', err);
  return res.status(400).json({ 
    ok: false, 
    reason: 'RENDER_FAILED', 
    detail: err.message 
  });
}
```

---

## ACCEPTANCE CHECKLIST

After applying fixes, verify:

### Client-Side (Browser Console)
- [ ] **Payload logs**: `[savePreview] Final payload (before normalization)` shows:
  - `rasterPadding: 12` (or actual padding, not `0`)
  - `clientRasterPadding: 12` (matches `rasterPadding`)
  - `lines.length` matches visual line count
  - `yPxFirstLine = yPx_png + rasterPadding`

- [ ] **Normalized payload**: `[savePreview:normalized]` shows same values (integers)

### Server-Side (Node Logs)
- [ ] **Route logs**: `[raster] Using client canonical values:` shows:
  - `clientRasterW: 864` (or actual width)
  - `clientRasterH: 200` (or actual height)
  - `clientRasterPadding: 12` (or actual padding)
  - `linesCount: 3` (or actual line count)

- [ ] **No errors**: `[raster] clientRasterPadding is missing or invalid` does NOT appear
- [ ] **Renderer logs**: `[raster] Using client canonical values (no computation):` shows `{ padding: 12, rasterW: 864, rasterH: 200 }`

### Visual Verification
- [ ] **PNG matches overlay**: Font size, line breaks, letter spacing, line spacing, alignment all identical
- [ ] **Baseline alignment**: First line of text in PNG appears at same Y position as in HTML overlay
- [ ] **No cropping**: All text lines visible in PNG (not cut off at edges)

### Edge Cases
- [ ] **Zero padding**: When overlay has no padding, `rasterPadding: 0` is accepted (no error)
- [ ] **Non-zero padding**: When overlay has padding, PNG includes equivalent padding and baseline shifts accordingly

---

## SUMMARY

**4 Issues Found**:
1. Server guard uses falsy check (`!meta.clientRasterPadding`) → rejects `0`
2. Client hardcodes `rasterPadding: 0` → ignores actual padding
3. Client normalization duplicates `clientRasterPadding` assignment → overwrites correct value
4. Client `yPxFirstLine` doesn't add padding → baseline misalignment

**4 Fixes Proposed** (minimal diff):
1. Change renderer guard to numeric check (allow `0`)
2. Read padding from `contentEl` computed styles and convert to frame pixels
3. Delete duplicate `clientRasterPadding` assignment block
4. Calculate `yPxFirstLine = yPx_png + paddingFramePx`

**Lines SSOT**: ✅ Verified single source (`caption-overlay.js`); inline duplicate exists but is unused (can be removed for clarity).

**Error Shape**: Route already returns `{ok:false}` consistently; optional enhancement to catch renderer errors.

---

**End of Audit Report**

