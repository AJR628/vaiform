# Beat Preview Drift Audit Report

## Problem Statement

Beat caption preview overlays drift upward as text wraps/gets longer:
- 1 line: looks okay
- 2 lines: drifts upward
- 3+ lines: goes off the top
- Drift is gradual as characters are added (wrap changes)

---

## Task 1: Current Client Positioning Audit

### A) CSS Positioning Rules

**File**: `public/creative.html:289-300`

```css
.beat-caption-overlay {
    position: absolute;
    left: 50%;
    top: calc(var(--y-pct) * 100%);
    width: calc(var(--raster-w-ratio) * 100%);
    height: calc(var(--raster-h-ratio) * 100%);
    transform: translateX(-50%) translateY(-50%);
    pointer-events: none;
    z-index: 10;
    object-fit: contain;
    image-rendering: -webkit-optimize-contrast;
    image-rendering: crisp-edges;
}
```

**Analysis**:
- `top: calc(var(--y-pct) * 100%)` - positions element at `yPct` percentage of parent height
- `transform: translateY(-50%)` - **CENTERS the element vertically** (moves it up by 50% of its own height)
- **Conclusion**: CSS interprets `--y-pct` as a **CENTER anchor point**, not top

---

### B) Client yPct Calculation

**File**: `public/js/caption-preview.js:915-916`

```javascript
const meta = result.meta;
// Prefer server meta.yPct if present, else derive from yPx_png/frameH
const yPct = Number.isFinite(meta.yPct) ? meta.yPct : (meta.yPx_png / meta.frameH);
```

**Analysis**:
- **Branch 1**: Uses `meta.yPct` if present and finite
- **Branch 2**: Falls back to `meta.yPx_png / meta.frameH` (derived calculation)

**Current Status**: Need to verify which branch is used (requires debug logging - see Task 2)

---

### C) Server Meta Contract

**File**: `src/routes/caption.preview.routes.js:258-308`

**V3 Raster Mode Response** (`ssotMeta` object):
```javascript
const ssotMeta = {
  ssotVersion: 3,
  mode: 'raster',
  frameW: data.frameW,
  frameH: data.frameH,
  rasterUrl: rasterResult.rasterUrl,
  rasterW: data.rasterW,
  rasterH: data.rasterH,
  rasterPadding: data.rasterPadding,
  xExpr_png: data.xExpr_png,
  yPx_png: data.yPx_png,  // ✅ ECHOED FROM CLIENT
  // ... typography, color, effects ...
  lines: lines,
  lineSpacingPx,
  totalTextH: totalTextH,
  // ❌ NO yPct field in response
};
```

**Key Finding**: 
- Server **DOES NOT** include `yPct` in V3 raster mode response
- Server only echoes back `yPx_png` (which client sent)
- Client **ALWAYS** falls back to derived calculation: `yPx_png / frameH`

---

### D) yPx_png Meaning (Anchor Point)

**File**: `public/js/caption-overlay.js:1502`

```javascript
const yPx_png = Math.round(yPct * frameH);
```

**Source of yPct** (line 1489):
```javascript
const yPct = (boxRect.top - stageRect.top) / stageHeight;
```

**Analysis**:
- `yPct` is computed from **box top position** (not center)
- `yPx_png = yPct * frameH` represents the **TOP of the caption box** in frame coordinates
- **NOT the center** of the box

**Server Comment** (line 663, legacy path):
```javascript
yPx_png: rasterResult.yPx,  // PNG top-left anchor (NOT text baseline)
```

**Conclusion**: `yPx_png` is the **TOP of the PNG raster**, not the center.

---

## Task 2: Debug-Only Meta Exposure

### Implementation

**File**: `public/js/caption-preview.js`

**Location**: Inside `applyPreviewResultToBeatCard()` function, after line 933 (inside existing debug block)

**Change**:
```javascript
if (window.__beatPreviewDebug) {
  console.log('[beat-preview] Overlay applied:', {
    identifier: beatCardEl.getAttribute('data-beat-id') || beatCardEl.getAttribute('data-sentence-index'),
    rasterUrl: result.rasterUrl.substring(0, 50) + '...'
  });
  
  // Store meta for debugging (only if debug flag enabled)
  if (!window.__lastBeatPreviewMeta) {
    window.__lastBeatPreviewMeta = {};
  }
  const identifier = beatCardEl.getAttribute('data-beat-id') || beatCardEl.getAttribute('data-sentence-index');
  if (identifier && result.meta) {
    window.__lastBeatPreviewMeta[identifier] = result.meta;
  }
}
```

**Additional Debug Logging** (for branch detection):

**Location**: `public/js/caption-preview.js:915-922` (add after line 916)

```javascript
const meta = result.meta;
// Prefer server meta.yPct if present, else derive from yPx_png/frameH
const yPct = Number.isFinite(meta.yPct) ? meta.yPct : (meta.yPx_png / meta.frameH);

if (window.__beatPreviewDebug) {
  console.log('[beat-preview] yPct calculation:', {
    hasMetaYPct: Number.isFinite(meta.yPct),
    metaYPct: meta.yPct,
    yPx_png: meta.yPx_png,
    frameH: meta.frameH,
    derivedYPct: meta.yPx_png / meta.frameH,
    finalYPct: yPct,
    rasterH: meta.rasterH,
    centerYPct: (meta.yPx_png + meta.rasterH / 2) / meta.frameH
  });
}
```

---

## Task 3: Diagnosis + Minimal Fix Proposal

### A) Which Branch Is Used?

**Answer**: **Branch 2 (fallback)** is always used because:
- Server V3 raster mode does NOT include `meta.yPct` in response (line 258-308)
- Client always falls back to: `yPct = meta.yPx_png / meta.frameH`

**Evidence**: Server response structure (line 258-308) shows no `yPct` field in `ssotMeta`.

---

### B) yPx_png Anchor Point Confirmation

**Answer**: `yPx_png` is the **TOP of the PNG raster** in frame coordinates.

**Evidence**:
1. Client computation (line 1502): `yPx_png = Math.round(yPct * frameH)` where `yPct` comes from box top (line 1489)
2. Server comment (line 663): `// PNG top-left anchor (NOT text baseline)`
3. Server echo (line 275): Server trusts client `yPx_png` value (no recomputation)

---

### C) Root Cause: Anchor Mismatch

**Problem**:
- CSS uses **CENTER anchor**: `transform: translateY(-50%)` centers the element
- Fallback calculation uses **TOP anchor**: `yPct = yPx_png / frameH` (top position)
- As `rasterH` increases (more lines), the center shifts upward more

**Mathematical Proof**:
- If `yPx_png = 960` (top of box at 50% of frame)
- And `rasterH = 100` (1 line)
- Center position = `960 + 50 = 1010px` → `1010/1920 = 0.526` (52.6%)

- If `rasterH = 200` (2 lines)
- Center position = `960 + 100 = 1060px` → `1060/1920 = 0.552` (55.2%)

- If `rasterH = 300` (3 lines)
- Center position = `960 + 150 = 1110px` → `1110/1920 = 0.578` (57.8%)

**Drift**: As `rasterH` increases, the center moves further down, but we're using the top position, causing upward drift.

---

### D) Minimal Fix Proposal

**Option 1: Fix Client Fallback (Preferred - SSOT Compliant)**

**File**: `public/js/caption-preview.js:916`

**Change**:
```javascript
// Before
const yPct = Number.isFinite(meta.yPct) ? meta.yPct : (meta.yPx_png / meta.frameH);

// After
// Prefer server meta.yPct if present, else derive CENTER from yPx_png (top) + rasterH/2
const yPct = Number.isFinite(meta.yPct) 
  ? meta.yPct 
  : ((meta.yPx_png + meta.rasterH / 2) / meta.frameH);
```

**Rationale**:
- CSS uses center anchor (`translateY(-50%)`)
- Fallback should compute center position: `(top + height/2) / frameH`
- Server `yPct` (if present) should already be center-based (SSOT)
- Minimal change (1 line)
- No server changes needed

**Option 2: Server Always Returns yPct (Alternative - More Robust)**

**File**: `src/routes/caption.preview.routes.js:258-308`

**Change**: Add `yPct` to `ssotMeta`:

```javascript
const ssotMeta = {
  // ... existing fields ...
  yPx_png: data.yPx_png,
  yPct: data.yPct ?? ((data.yPx_png + data.rasterH / 2) / data.frameH),  // NEW: center-based yPct
  // ... rest of fields ...
};
```

**Rationale**:
- Server becomes authoritative for `yPct` (SSOT principle)
- Client can always use `meta.yPct` (no fallback needed)
- More robust (server computes once, client trusts)

**Recommendation**: **Option 1** (client fix) is simpler and doesn't require server changes. Option 2 is more robust long-term.

---

## Summary

### Root Cause
- CSS uses **center anchor** (`translateY(-50%)`)
- Fallback uses **top anchor** (`yPx_png / frameH`)
- As `rasterH` increases, center shifts but calculation doesn't account for it

### Fix
- Change fallback to compute center: `(yPx_png + rasterH/2) / frameH`
- Server `yPct` (if present) should already be center-based

### Files to Change
1. `public/js/caption-preview.js:916` - Fix fallback calculation
2. `public/js/caption-preview.js:928-933` - Add debug meta storage (Task 2)
3. `public/js/caption-preview.js:916-922` - Add debug logging (Task 2)

### Verification Steps
1. Hard refresh page
2. Enable debug: `window.__beatPreviewDebug = true;`
3. Type caption text (1 line) → verify position
4. Add more text (2 lines) → verify no upward drift
5. Add more text (3+ lines) → verify no upward drift
6. Check console logs for `yPct calculation` to confirm branch used

---

## Minimal Diff

```diff
--- a/public/js/caption-preview.js
+++ b/public/js/caption-preview.js
@@ -913,7 +913,8 @@ export function applyPreviewResultToBeatCard(beatCardEl, result) {
   // Set CSS variables for positioning
   const meta = result.meta;
-  // Prefer server meta.yPct if present, else derive from yPx_png/frameH
-  const yPct = Number.isFinite(meta.yPct) ? meta.yPct : (meta.yPx_png / meta.frameH);
+  // Prefer server meta.yPct if present, else derive CENTER from yPx_png (top) + rasterH/2
+  const yPct = Number.isFinite(meta.yPct) ? meta.yPct : ((meta.yPx_png + meta.rasterH / 2) / meta.frameH);
   const rasterWRatio = meta.rasterW / meta.frameW;
   const rasterHRatio = meta.rasterH / meta.frameH;
   
@@ -928,6 +929,15 @@ export function applyPreviewResultToBeatCard(beatCardEl, result) {
   if (window.__beatPreviewDebug) {
     console.log('[beat-preview] Overlay applied:', {
       identifier: beatCardEl.getAttribute('data-beat-id') || beatCardEl.getAttribute('data-sentence-index'),
       rasterUrl: result.rasterUrl.substring(0, 50) + '...'
     });
+    
+    // Store meta for debugging (only if debug flag enabled)
+    if (!window.__lastBeatPreviewMeta) {
+      window.__lastBeatPreviewMeta = {};
+    }
+    const identifier = beatCardEl.getAttribute('data-beat-id') || beatCardEl.getAttribute('data-sentence-index');
+    if (identifier && result.meta) {
+      window.__lastBeatPreviewMeta[identifier] = result.meta;
+    }
   }
 }
```

