# Parity Investigation Plan - Final Truth Verification

## Key Findings from Codebase Search

### A) yPxFirstLine Truth

**Server requirement**: `yPxFirstLine` is REQUIRED in RasterSchema (line 54) and computed server-side:
```javascript
// Server computes (caption.preview.routes.js:547-561):
const anchorY = Math.round(yPctClamped * H);
let yPxFirstLine = Math.round(anchorY - (totalTextH / 2));
// Then clamps with safe margins
```

**Client fallback**: `overlayMeta.yPxFirstLine || (overlayMeta.yPx_png + overlayMeta.rasterPadding)` (caption-preview.js:303)

**Problem**: Client fallback `yPx_png + rasterPadding` does NOT match server formula `anchorY - totalTextH/2`.

**Server formula**: `yPxFirstLine = (yPct * frameH) - (totalTextH / 2)` (before clamping)

**Correct client formula**: Should compute `yPxFirstLine = (yPct * frameH) - (totalTextH / 2)`, not `yPx_png + rasterPadding`.

### B) rasterW Truth

**Current computation** (caption-overlay.js:1319-1320):
```javascript
const wPx = Math.round((boxRect.width / stageWidth) * frameW);
const rasterW = wPx;
```

**Conclusion**: `rasterW` = box width scaled to frame space, NOT tight text width. This is correct.

### C) previewFontString Truth

**Current computation** (caption-overlay.js:1273-1274):
```javascript
const family = getVariantFamily(weightCss, fontStyle); // Always returns 'DejaVu Sans'
const previewFontString = `${fontStyle} ${weightCss === '700' ? 'bold' : 'normal'} ${fontPx}px "${family}"`;
```

**Alternative**: Could use `cs.font` directly for browser truth, but current approach is consistent.

### D) Box Positioning Truth

**applyCaptionMeta** (caption-overlay.js:990-991):
```javascript
if (typeof meta.yPct === 'number') box.style.top = (meta.yPct * 100) + '%';
```

**Conclusion**: Box position is set via percentage-based style BEFORE measurement.

---

## TASK 1: Add Payload Logging to Working Path

**File**: `public/js/caption-preview.js`

**Location**: Line 335 (after payload construction, before POST)

**Action**: Add detailed logging:

```javascript
console.log('[PARITY-AUDIT] Payload fields before POST:', {
  ssotVersion: payload.ssotVersion,
  mode: payload.mode,
  linesCount: payload.lines?.length,
  rasterW: payload.rasterW,
  rasterH: payload.rasterH,
  rasterPadding: payload.rasterPadding,
  totalTextH: payload.totalTextH,
  yPx_png: payload.yPx_png,
  yPxFirstLine: payload.yPxFirstLine,
  previewFontString: payload.previewFontString,
  yPct: payload.yPct,
  frameW: payload.frameW,
  frameH: payload.frameH
});
```

---

## TASK 2: Extract computeCaptionMetaFromElements with Exact Logic

**File**: `public/js/caption-overlay.js`

**Key corrections**:
1. **rasterW**: Use box width scaled (line 1319-1320) - already correct
2. **yPxFirstLine**: Compute as `(yPct * frameH) - (totalTextH / 2)` NOT `yPx_png + rasterPadding`
3. **previewFontString**: Use existing `getVariantFamily()` approach (line 1273-1274)

**Implementation**:
- Extract exact code from `emitCaptionState()` lines 1203-1447
- Compute `yPxFirstLine` as: `Math.round((yPct * frameH) - (totalTextH / 2))`
- Include in returned state object

---

## TASK 3: Fix measureBeatCaptionGeometry - Position Box Before Compute

**File**: `public/js/caption-overlay.js`

**Key change**: Set box position via style BEFORE calling `computeCaptionMetaFromElements`:

```javascript
// Set box dimensions from style
boxEl.style.width = `${(style.wPct || 0.8) * 100}%`;

// Set box position from style.yPct/xPct BEFORE compute
if (style.yPct !== undefined) {
  boxEl.style.top = `${style.yPct * 100}%`;
}
if (style.xPct !== undefined) {
  boxEl.style.left = `${style.xPct * 100}%`;
} else {
  // Default center
  boxEl.style.left = '50%';
  boxEl.style.transform = 'translateX(-50%)';
}

// THEN call compute - it will derive yPct/yPx_png from box position
const meta = computeCaptionMetaFromElements({...});
// DO NOT override meta.yPct or meta.yPx_png after this
```

---

## TASK 4: Golden-Master Comparison Function

**File**: `public/js/caption-overlay.js`

**Action**: Add dev-only comparison function:

```javascript
/**
 * Golden-master comparison: verify computeCaptionMetaFromElements matches getCaptionMeta()
 * DEV ONLY - call manually for verification
 */
export function compareMetaParity() {
  const stage = document.querySelector('#stage');
  const box = stage?.querySelector('.caption-box');
  const content = box?.querySelector('.content');
  
  if (!stage || !box || !content) {
    console.error('[parity-check] Missing DOM elements');
    return false;
  }
  
  const { W: frameW, H: frameH } = window.CaptionGeom.getFrameDims();
  const metaA = computeCaptionMetaFromElements({ stageEl: stage, boxEl: box, contentEl: content, frameW, frameH });
  const metaB = window.getCaptionMeta();
  
  const fields = ['rasterW', 'rasterH', 'rasterPadding', 'totalTextH', 'yPx_png', 'yPxFirstLine', 'previewFontString'];
  const linesKey = 'lines';
  
  let match = true;
  const diffs = {};
  
  for (const field of fields) {
    if (Math.abs((metaA[field] || 0) - (metaB[field] || 0)) > 0.1) {
      match = false;
      diffs[field] = { A: metaA[field], B: metaB[field] };
    }
  }
  
  if (metaA[linesKey].join('|') !== metaB[linesKey].join('|')) {
    match = false;
    diffs[linesKey] = { A: metaA[linesKey], B: metaB[linesKey] };
  }
  
  if (!match) {
    console.error('[parity-check] MISMATCH:', diffs);
    console.error('[parity-check] Full metaA:', metaA);
    console.error('[parity-check] Full metaB:', metaB);
  } else {
    console.log('[parity-check] ✅ MATCH - all fields identical');
  }
  
  return match;
}
```

---

## TASK 5: Fix yPxFirstLine Computation in Shared Helper

**File**: `public/js/caption-overlay.js` (in `computeCaptionMetaFromElements`)

**Change**: After computing `yPx_png` and `yPct`, add:

```javascript
// Compute yPxFirstLine using server formula (matches caption.preview.routes.js:547)
const yPxFirstLine = Math.round((yPct * frameH) - (totalTextH / 2));
```

**Include in return object**:
```javascript
return {
  // ... all other fields ...
  yPx_png,
  yPxFirstLine,  // ADD THIS
  // ... rest of fields ...
};
```

**Update caption-preview.js**: Remove fallback, use overlayMeta.yPxFirstLine directly:
```javascript
yPxFirstLine: overlayMeta.yPxFirstLine,  // Remove fallback
```

---

## Implementation Order

1. **TASK 5** - Fix yPxFirstLine in shared helper (must be done first)
2. **TASK 1** - Add payload logging (verify current truth)
3. **TASK 2** - Extract computeCaptionMetaFromElements (include yPxFirstLine)
4. **TASK 4** - Add golden-master comparison
5. **TASK 3** - Fix measureBeatCaptionGeometry positioning
6. Test golden-master comparison passes
7. THEN proceed with caption-preview.js helpers + wiring


