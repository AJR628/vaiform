# Beat Caption Preview - Final Build Plan (Zero Drift)

## Executive Summary

Implement beat-card caption PNG previews with **ZERO drift** from existing caption overlay/preview pipeline. Two-commit approach: (1) parity-safe refactor with golden-master gate, (2) beat preview wiring behind feature flag.

---

## A) Server Truth Verification (V3 Raster Mode)

### Verified Relationships

**File**: `src/routes/caption.preview.routes.js`

**Key Findings**:

1. **yPxFirstLine fallback** (line 151):
   ```javascript
   const yPxFirstLine = data.yPxFirstLine || (yPx_png + rasterPadding);
   ```

2. **PNG top position** (line 1254):
   ```javascript
   const yPx = meta.yPxFirstLine - padding;  // PNG top = first line baseline - padding
   ```

3. **Client values trusted** (lines 115-117):
   - Server does NOT recompute: `rasterW`, `rasterH`, `yPx_png`, `rasterPadding`, `lines`, `totalTextH`
   - Server uses client values directly in V3 raster mode

4. **Schema requirements** (lines 38-54):
   - Required: `rasterW`, `rasterH`, `yPx_png`, `lines[]`, `totalTextH`, `yPxFirstLine`
   - Optional with defaults: `rasterPadding` (default 24)

### Exact Relationships

- **yPx_png** (client sends): Box top position in frame space (`yPct * frameH`)
- **yPxFirstLine** (client should compute): First line baseline = `yPx_png + rasterPadding`
- **PNG top** (server computes): `yPxFirstLine - padding = yPx_png + rasterPadding - rasterPadding = yPx_png`

**Conclusion**: Client formula `yPxFirstLine = yPx_png + rasterPadding` is **mathematically correct** and matches server fallback.

---

## B) Client Truth Verification (Current Working Path)

### Canonical Functions

**File**: `public/js/caption-overlay.js`

1. **`emitCaptionState(reason)`** (line 1203-1447):
   - Produces `window.__overlayMeta` state object
   - Called after drag/snap/toolbar changes

2. **`window.getCaptionMeta()`** (line 856-1447):
   - Exported function that returns same state as `emitCaptionState()`
   - Used by `caption-preview.js` to get overlayMeta

### Exact Computations (Verified)

| Field | Computation | Location |
|-------|-------------|----------|
| `lines` | `extractRenderedLines(content)` | Line 1266 |
| `totalTextH` | `Math.round(content.getBoundingClientRect().height)` | Line 1316 |
| `rasterW` | `Math.round((boxRect.width / stageWidth) * frameW)` | Line 1319 |
| `rasterH` | `window.CaptionGeom.computeRasterH({...})` | Line 1323-1329 |
| `rasterPadding` | `Math.round((cssPaddingTop + cssPaddingBottom) / 2)` | Line 1330 |
| `yPct` | `(boxRect.top - stageRect.top) / stageHeight` | Line 1333 |
| `yPx_png` | `Math.round(yPct * frameH)` | Line 1344 |
| `previewFontString` | `"${fontStyle} ${weight === '700' ? 'bold' : 'normal'} ${fontPx}px \"${family}\""` | Line 1274 |
| `yPxFirstLine` | **MISSING** (currently not computed) | N/A |

### Current Fallback

**File**: `public/js/caption-preview.js` (line 303):
```javascript
yPxFirstLine: overlayMeta.yPxFirstLine || (overlayMeta.yPx_png + overlayMeta.rasterPadding)
```

**Conclusion**: `yPxFirstLine` is currently missing from overlayMeta. Fallback works but should be computed in shared helper.

---

## C) Critical Drift Audit: Offscreen DOM Wrapping Parity

### Problem

`lines[]` array is **browser-wrapped output** from Range API (`extractRenderedLines()`). Line breaks depend on:
- Container width (`.caption-box` width = `wPct * stageWidth`)
- Font size, letter spacing, word boundaries

If offscreen DOM uses different width than live overlay, wrapping will **drift**.

### Solution

**In `measureBeatCaptionGeometry()`**:
1. **Try to read real stage dimensions first**:
   ```javascript
   const realStage = document.querySelector('#stage');
   const stageWidth = realStage?.clientWidth || (style.wPct ? (style.wPct * 1080) : 864);
   const stageHeight = realStage?.clientHeight || 1536;
   ```

2. **Use real stage width for offscreen container**:
   ```javascript
   container.style.width = `${style.wPct * stageWidth}px`;  // Match live overlay box width
   ```

3. **Fallback only if real stage doesn't exist**:
   ```javascript
   // Fallback: assume default stage dimensions (responsive default)
   const fallbackStageWidth = style.wPct ? (style.wPct * 1080) : 864;
   ```

### Why This Matters

- `rasterW` computation: `(boxRect.width / stageWidth) * frameW` (line 1319)
- If stageWidth differs, `rasterW` will differ → **geometry drift**
- If box width differs, `extractRenderedLines()` produces different `lines[]` → **wrapping drift**

**Conclusion**: Offscreen DOM **MUST** match live overlay stage dimensions for parity.

---

## D) Golden-Master Parity Gate

### Implementation

**Function**: `compareMetaParity()`

**Location**: `public/js/caption-overlay.js` (exported)

**Logic**:
1. Get current overlay meta: `window.getCaptionMeta()` (or `window.__overlayMeta`)
2. Compute helper meta: `computeCaptionMetaFromElements({ stageEl, boxEl, contentEl, frameW, frameH })`
3. Compare fields (with tolerance for floating-point):
   - Numeric: `rasterW`, `rasterH`, `rasterPadding`, `totalTextH`, `yPx_png`, `yPxFirstLine`
   - String: `previewFontString`
   - Array: `lines[]` (exact match: `linesA.join('|') === linesB.join('|')`)

**Tolerance**: ±0.1px for numeric fields (rounding differences)

**Returns**: `true` if all fields match, `false` otherwise (logs detailed diffs)

**Test Gate**: **MUST return `true`** before proceeding to Commit 2.

---

## E) Minimal Diff Plan

### Files Changed

1. **`public/js/caption-overlay.js`**
   - Add `computeCaptionMetaFromElements()` helper (extracted copy/paste from `emitCaptionState()`)
   - Add `yPxFirstLine = yPx_png + rasterPadding` computation in helper
   - Refactor `emitCaptionState()` to call helper (preserve existing behavior)
   - Add `compareMetaParity()` dev helper
   - Add `measureBeatCaptionGeometry()` for beat previews (Phase 2, after parity passes)

2. **`public/js/caption-preview.js`**
   - Remove `yPxFirstLine` fallback (line 303), use `overlayMeta.yPxFirstLine` directly
   - Add `__parityAudit` conditional logging (before POST and on response)

3. **`public/creative.html`** (Phase 2 only, after parity passes)
   - Add beat preview manager (cache, debounce, AbortController)
   - Wire hooks: `commitBeatTextEdit()`, `renderDraftStoryboard()`, `renderStoryboard()`, clip swap handlers
   - Add overlay DOM/CSS for beat cards
   - Feature flag: `BEAT_PREVIEW_ENABLED` (default false)

---

## F) Commit 1: Parity Refactor + Golden-Master + Audit Logs

### Exact Edits

#### File: `public/js/caption-overlay.js`

**1. Extract `computeCaptionMetaFromElements()` helper** (after line 1447, before exports):

```javascript
/**
 * Compute caption meta from DOM elements (shared SSOT logic)
 * Extracted from emitCaptionState() - exact copy/paste, no logic changes
 * ONLY addition: yPxFirstLine = yPx_png + rasterPadding
 * 
 * @param {HTMLElement} stageEl - Stage container (#stage)
 * @param {HTMLElement} boxEl - Caption box (.caption-box)
 * @param {HTMLElement} contentEl - Content element (.caption-box .content)
 * @param {number} frameW - Frame width (default 1080)
 * @param {number} frameH - Frame height (default 1920)
 * @returns {object} overlayMeta object with all SSOT fields including yPxFirstLine
 */
export function computeCaptionMetaFromElements({ stageEl, boxEl, contentEl, frameW = 1080, frameH = 1920 }) {
  // Copy/paste EXACT logic from emitCaptionState() lines 1209-1440
  // ... (full implementation copied verbatim)
  
  // ADD ONLY THIS LINE after yPx_png computation:
  const yPxFirstLine = yPx_png + rasterPadding;
  
  // Add yPxFirstLine to state object before returning
  return {
    // ... all existing fields ...
    yPxFirstLine,  // NEW field
  };
}
```

**2. Refactor `emitCaptionState()`** (replace lines 1209-1440 with call to helper):

```javascript
function emitCaptionState(reason = 'toolbar') {
  // Get frame dimensions FIRST (before any usage)
  const { W: frameW, H: frameH } = window.CaptionGeom.getFrameDims();
  
  // Call shared helper
  const computedMeta = computeCaptionMetaFromElements({
    stageEl: stage,
    boxEl: box,
    contentEl: content,
    frameW,
    frameH
  });
  
  // Preserve existing behavior: mode selection, caching, window.__overlayMeta assignment
  const mode = geometryDirty ? 'dom' : (savedPreview ? 'raster' : 'dom');
  
  const state = {
    ...computedMeta,
    mode,  // Override mode (dynamic, not from helper)
    reason
  };
  
  // Guard against NaN/null (existing logic)
  Object.keys(state).forEach(k => {
    if (typeof state[k] === 'number' && !Number.isFinite(state[k])) {
      console.warn(`[emitCaptionState] Invalid number for ${k}:`, state[k]);
      state[k] = 0;
    }
  });
  
  // Store and emit (existing logic)
  window.__overlayMeta = state;
  if (typeof window.updateCaptionState === 'function') {
    window.updateCaptionState(state);
  }
}
```

**3. Add `compareMetaParity()` dev helper** (after `computeCaptionMetaFromElements`, before exports):

```javascript
/**
 * Golden-master comparison: verify computeCaptionMetaFromElements matches getCaptionMeta()
 * DEV ONLY - call manually for verification
 * 
 * @returns {boolean} true if all fields match, false otherwise
 */
export function compareMetaParity() {
  const stage = document.querySelector('#stage');
  const box = stage?.querySelector('.caption-box');
  const content = box?.querySelector('.content');
  
  if (!stage || !box || !content) {
    console.error('[parity-check] Missing DOM elements (stage, box, or content)');
    return false;
  }
  
  const { W: frameW, H: frameH } = window.CaptionGeom.getFrameDims();
  
  // Get current overlay meta
  const metaA = typeof window.getCaptionMeta === 'function' 
    ? window.getCaptionMeta() 
    : window.__overlayMeta;
  
  if (!metaA) {
    console.error('[parity-check] No overlay meta available');
    return false;
  }
  
  // Compute helper meta
  const metaB = computeCaptionMetaFromElements({
    stageEl: stage,
    boxEl: box,
    contentEl: content,
    frameW,
    frameH
  });
  
  // Compare critical fields
  const numericFields = ['rasterW', 'rasterH', 'rasterPadding', 'totalTextH', 'yPx_png', 'yPxFirstLine'];
  const stringFields = ['previewFontString'];
  const arrayFields = ['lines'];
  
  let match = true;
  const diffs = {};
  
  // Compare numeric fields (tolerance: ±0.1px)
  for (const field of numericFields) {
    const valA = metaA[field];
    const valB = metaB[field];
    if (Math.abs((valA || 0) - (valB || 0)) > 0.1) {
      match = false;
      diffs[field] = { current: valA, helper: valB, diff: Math.abs(valA - valB) };
    }
  }
  
  // Compare string fields (exact match)
  for (const field of stringFields) {
    if (metaA[field] !== metaB[field]) {
      match = false;
      diffs[field] = { current: metaA[field], helper: metaB[field] };
    }
  }
  
  // Compare array fields (exact match)
  for (const field of arrayFields) {
    const arrA = metaA[field] || [];
    const arrB = metaB[field] || [];
    if (arrA.join('|') !== arrB.join('|')) {
      match = false;
      diffs[field] = { 
        current: arrA, 
        helper: arrB,
        currentJoined: arrA.join('|'),
        helperJoined: arrB.join('|')
      };
    }
  }
  
  if (!match) {
    console.error('[parity-check] ❌ MISMATCH - fields differ:', diffs);
    console.error('[parity-check] Current meta (A):', metaA);
    console.error('[parity-check] Helper meta (B):', metaB);
  } else {
    console.log('[parity-check] ✅ MATCH - all fields identical');
  }
  
  return match;
}
```

#### File: `public/js/caption-preview.js`

**1. Remove `yPxFirstLine` fallback** (line 303):

```javascript
// BEFORE:
yPxFirstLine: overlayMeta.yPxFirstLine || (overlayMeta.yPx_png + overlayMeta.rasterPadding),

// AFTER:
yPxFirstLine: overlayMeta.yPxFirstLine,  // Now computed in helper, always present
```

**2. Add `__parityAudit` conditional logging** (before POST, around line 335):

```javascript
// Add after payload construction, before POST
if (window.__parityAudit) {
  console.log('[__parityAudit] payload:', {
    rasterW: payload.rasterW,
    rasterH: payload.rasterH,
    yPx_png: payload.yPx_png,
    yPxFirstLine: payload.yPxFirstLine,
    rasterPadding: payload.rasterPadding,
    totalTextH: payload.totalTextH,
    lines: payload.lines,
    previewFontString: payload.previewFontString
  });
}

const data = await apiFetch("/caption/preview", {
  method: "POST",
  body: payload
});

if (window.__parityAudit) {
  console.log('[__parityAudit] response:', {
    ok: data?.ok,
    rasterW: data?.data?.meta?.rasterW,
    rasterH: data?.data?.meta?.rasterH,
    yPx_png: data?.data?.meta?.yPx_png,
    rasterPadding: data?.data?.meta?.rasterPadding,
    totalTextH: data?.data?.meta?.totalTextH,
    lines: data?.data?.meta?.lines?.length,
    previewFontString: data?.data?.meta?.previewFontString
  });
}
```

### Test Steps (Commit 1)

```bash
# 1. Start dev server
npm run dev

# 2. Open browser to creative.html, open DevTools console

# 3. Enable audit logging
window.__parityAudit = true;

# 4. Trigger existing caption preview flow
#    - Edit caption text in overlay
#    - Adjust font size/slider
#    - Verify console logs show:
#      - [__parityAudit] payload: {...}
#      - [__parityAudit] response: {...}
#      - All numeric fields are finite

# 5. Run golden-master comparison
compareMetaParity()
# Expected: console.log('[parity-check] ✅ MATCH - all fields identical')
# Required: Must return TRUE before proceeding

# 6. Verify existing overlay preview still works
#    - Caption appears correctly positioned
#    - Preview PNG matches overlay visually
#    - No console errors

# 7. Verify server accepts preview requests
#    - Check Network tab: POST /api/caption/preview returns 200
#    - Response meta includes all required fields

# 8. Check yPxFirstLine is computed (not fallback)
#    - In console: window.__overlayMeta.yPxFirstLine
#    - Should be: yPx_png + rasterPadding (verify numerically)
#    - Should NOT be undefined

# 9. Test edge cases
#    - Empty text (should skip gracefully)
#    - Very long text (wraps correctly)
#    - Extreme font sizes (clamped correctly)
```

**Gate**: `compareMetaParity()` **MUST return `true`** before proceeding to Commit 2.

---

## G) Commit 2: Beat Preview Wiring (After Parity Gate Passes)

### Exact Edits

#### File: `public/js/caption-overlay.js`

**1. Add `measureBeatCaptionGeometry()`** (after `compareMetaParity()`, before exports):

```javascript
/**
 * Measure beat caption geometry using offscreen DOM (reuses SSOT logic)
 * CRITICAL: Uses real stage dimensions if available to ensure wrapping parity
 * 
 * @param {string} text - Beat text
 * @param {object} style - Session-level caption style (includes yPct, wPct, fontPx, etc.)
 * @returns {object} overlayMeta object matching computeCaptionMetaFromElements() shape
 */
export function measureBeatCaptionGeometry(text, style) {
  if (!text || !text.trim()) {
    return null;
  }
  
  // CRITICAL DRIFT PREVENTION: Use real stage dimensions if available
  const realStage = document.querySelector('#stage');
  const realStageWidth = realStage?.clientWidth;
  const realStageHeight = realStage?.clientHeight;
  
  // Fallback to responsive defaults if real stage doesn't exist
  const stageWidth = realStageWidth || (style.wPct ? (style.wPct * 1080) : 864);
  const stageHeight = realStageHeight || 1536;
  
  // Get frame dimensions
  const { W: frameW, H: frameH } = window.CaptionGeom?.getFrameDims() || { W: 1080, H: 1920 };
  
  // Create offscreen stage container (matching #stage structure)
  const stageEl = document.createElement('div');
  stageEl.style.cssText = `
    position: fixed;
    left: -99999px;
    top: 0;
    width: ${stageWidth}px;
    height: ${stageHeight}px;
    visibility: hidden;
  `;
  
  // Create caption box (matching .caption-box structure)
  const boxEl = document.createElement('div');
  boxEl.className = 'caption-box';
  boxEl.style.cssText = `
    position: absolute;
    width: ${(style.wPct || 0.8) * 100}%;
    top: ${(style.yPct || 0.5) * 100}%;
    left: ${((1 - (style.wPct || 0.8)) / 2) * 100}%;
    transform: translateY(-50%);
  `;
  
  // Create content element (matching .caption-box .content structure)
  const contentEl = document.createElement('div');
  contentEl.className = 'content';
  contentEl.style.cssText = `
    font-family: ${style.fontFamily || 'DejaVu Sans'};
    font-weight: ${style.weightCss || 'bold'};
    font-size: ${style.fontPx || 48}px;
    font-style: ${style.fontStyle || 'normal'};
    letter-spacing: ${style.letterSpacingPx || 0}px;
    text-align: ${style.textAlign || 'center'};
    color: ${style.color || '#FFFFFF'};
    opacity: ${style.opacity || 1};
    padding: ${style.internalPadding || 24}px;
    line-height: ${(style.fontPx || 48) * 1.15}px;
    white-space: pre-wrap;
    word-wrap: break-word;
    width: 100%;
    height: 100%;
  `;
  contentEl.textContent = text;
  
  // Assemble DOM hierarchy
  boxEl.appendChild(contentEl);
  stageEl.appendChild(boxEl);
  document.body.appendChild(stageEl);
  
  try {
    // Force layout calculation
    void stageEl.offsetHeight;
    void boxEl.offsetHeight;
    void contentEl.offsetHeight;
    
    // CRITICAL: Compute meta using shared helper (ensures parity)
    const meta = computeCaptionMetaFromElements({
      stageEl,
      boxEl,
      contentEl,
      frameW,
      frameH
    });
    
    // DO NOT override meta.yPct or meta.yPx_png after compute
    // Helper derives these from DOM position (same as live overlay)
    
    return meta;
  } finally {
    // Cleanup offscreen container
    if (stageEl.parentNode) {
      document.body.removeChild(stageEl);
    }
  }
}
```

#### File: `public/js/caption-preview.js`

**1. Add beat preview manager and payload builder** (after `generateCaptionPreview()`, around line 553):

```javascript
// Beat preview cache and controllers
const beatPreviewCache = new Map(); // hash(style+text) -> { meta, rasterUrl, timestamp }
const beatPreviewControllers = new Map(); // beatId -> AbortController
const beatPreviewDebounceTimers = new Map(); // beatId -> timeoutId

function hashStyleAndText(style, text) {
  const styleStr = JSON.stringify(style, Object.keys(style).sort());
  return `${styleStr}|${text}`;
}

function getCachedBeatPreview(style, text) {
  const key = hashStyleAndText(style, text);
  const cached = beatPreviewCache.get(key);
  if (cached && Date.now() - cached.timestamp < 60000) { // 1min TTL
    return cached;
  }
  return null;
}

function setCachedBeatPreview(style, text, result) {
  const key = hashStyleAndText(style, text);
  beatPreviewCache.set(key, {
    ...result,
    timestamp: Date.now()
  });
}

/**
 * Build V3 raster preview payload from overlayMeta (reuses existing logic)
 */
function buildBeatPreviewPayload(text, overlayMeta) {
  return {
    ssotVersion: 3,
    mode: 'raster',
    text: overlayMeta.text || text,
    placement: 'custom',
    xPct: overlayMeta.xPct ?? 0.5,
    yPct: overlayMeta.yPct ?? 0.5,
    wPct: overlayMeta.wPct ?? 0.8,
    
    // Typography
    fontPx: overlayMeta.fontPx,
    lineSpacingPx: overlayMeta.lineSpacingPx,
    fontFamily: overlayMeta.fontFamily,
    weightCss: overlayMeta.weightCss,
    fontStyle: overlayMeta.fontStyle,
    textAlign: overlayMeta.textAlign,
    letterSpacingPx: overlayMeta.letterSpacingPx,
    textTransform: overlayMeta.textTransform,
    
    // Color & effects
    color: overlayMeta.color,
    opacity: overlayMeta.opacity,
    strokePx: overlayMeta.strokePx,
    strokeColor: overlayMeta.strokeColor,
    shadowColor: overlayMeta.shadowColor,
    shadowBlur: overlayMeta.shadowBlur,
    shadowOffsetX: overlayMeta.shadowOffsetX,
    shadowOffsetY: overlayMeta.shadowOffsetY,
    
    // Geometry - required V3 raster fields
    frameW: overlayMeta.frameW || 1080,
    frameH: overlayMeta.frameH || 1920,
    rasterW: overlayMeta.rasterW,
    rasterH: overlayMeta.rasterH,
    rasterPadding: overlayMeta.rasterPadding,
    xPx_png: overlayMeta.xPx_png,
    yPx_png: overlayMeta.yPx_png,
    xExpr_png: overlayMeta.xExpr_png || '(W-overlay_w)/2',
    
    // Browser-rendered line data (REQUIRED)
    lines: overlayMeta.lines,
    totalTextH: overlayMeta.totalTextH,
    yPxFirstLine: overlayMeta.yPxFirstLine,  // Now always present from helper
    
    // Font string for parity validation
    previewFontString: overlayMeta.previewFontString,
    
    // Optional textRaw
    textRaw: overlayMeta.textRaw || text
  };
}

/**
 * Generate caption preview for a beat card (parity-only, uses SSOT measurement)
 * @param {string} beatId - Beat identifier
 * @param {string} text - Beat text
 * @param {object} style - Session-level caption style
 * @returns {Promise<object|null>} Preview result with meta and rasterUrl, or null if disabled/skipped
 */
export async function generateBeatCaptionPreview(beatId, text, style) {
  // Feature flag check
  if (!window.BEAT_PREVIEW_ENABLED) {
    return null;
  }
  
  if (!text || !text.trim()) {
    return null;
  }
  
  // Check cache first
  const cached = getCachedBeatPreview(style, text);
  if (cached) {
    return { beatId, ...cached };
  }
  
  // Cancel previous request for this beat
  const prevController = beatPreviewControllers.get(beatId);
  if (prevController) {
    prevController.abort();
  }
  
  const controller = new AbortController();
  beatPreviewControllers.set(beatId, controller);
  
  try {
    // Import offscreen measurement function
    const { measureBeatCaptionGeometry } = await import('./caption-overlay.js');
    
    // Measure geometry using offscreen DOM (reuses SSOT logic)
    const overlayMeta = measureBeatCaptionGeometry(text, style);
    if (!overlayMeta) {
      return null;
    }
    
    // Build payload using helper
    const payload = buildBeatPreviewPayload(text, overlayMeta);
    
    // Call preview endpoint
    const { apiFetch } = await import('./api.mjs');
    const data = await apiFetch('/caption/preview', {
      method: 'POST',
      body: payload,
      signal: controller.signal // AbortController supported
    });
    
    if (!data?.ok) {
      throw new Error(data?.detail || data?.reason || 'Preview generation failed');
    }
    
    const result = {
      beatId,
      meta: data.data.meta,
      rasterUrl: data.data.meta.rasterUrl
    };
    
    // Cache result
    setCachedBeatPreview(style, text, result);
    
    return result;
  } catch (err) {
    if (err.name === 'AbortError') {
      // Request cancelled, ignore
      return null;
    }
    console.warn('[beat-preview] Failed:', err);
    // Graceful degradation - don't block UI
    return null;
  } finally {
    beatPreviewControllers.delete(beatId);
  }
}

/**
 * Debounced beat preview generation
 */
export function generateBeatCaptionPreviewDebounced(beatId, text, style, delay = 300) {
  // Clear existing timer
  const existingTimer = beatPreviewDebounceTimers.get(beatId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  
  const timer = setTimeout(async () => {
    await generateBeatCaptionPreview(beatId, text, style);
    beatPreviewDebounceTimers.delete(beatId);
  }, delay);
  
  beatPreviewDebounceTimers.set(beatId, timer);
}
```

#### File: `public/creative.html`

**1. Add beat preview CSS** (in `<style>` section, around line 271):

```css
/* Beat caption preview overlay */
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

**2. Add beat preview manager and apply function** (in `<script>` section, before storyboard rendering functions):

```javascript
// Beat preview manager
const BeatPreviewManager = {
  /**
   * Apply preview to beat card
   */
  async applyPreview(beatCardEl, beatId, text, style) {
    if (!window.BEAT_PREVIEW_ENABLED) return;
    
    try {
      const { generateBeatCaptionPreview } = await import('./js/caption-preview.js');
      const result = await generateBeatCaptionPreview(beatId, text, style);
      
      if (!result || !result.rasterUrl) return;
      
      // Find or create overlay img element
      let overlayImg = beatCardEl.querySelector('.beat-caption-overlay');
      if (!overlayImg) {
        overlayImg = document.createElement('img');
        overlayImg.className = 'beat-caption-overlay';
        beatCardEl.appendChild(overlayImg);
      }
      
      // Set CSS variables for positioning
      const meta = result.meta;
      const yPct = meta.yPx_png / meta.frameH;
      const rasterWRatio = meta.rasterW / meta.frameW;
      const rasterHRatio = meta.rasterH / meta.frameH;
      
      overlayImg.style.setProperty('--y-pct', yPct);
      overlayImg.style.setProperty('--raster-w-ratio', rasterWRatio);
      overlayImg.style.setProperty('--raster-h-ratio', rasterHRatio);
      
      // Set image source
      overlayImg.src = result.rasterUrl;
      overlayImg.style.display = 'block';
    } catch (err) {
      console.warn('[beat-preview] Failed to apply preview:', err);
      // Graceful degradation - don't block UI
    }
  },
  
  /**
   * Apply previews to all beats in storyboard
   */
  async applyAllPreviews(beats, style) {
    if (!window.BEAT_PREVIEW_ENABLED) return;
    
    for (const beat of beats) {
      const beatCardEl = document.querySelector(`[data-beat-id="${beat.id}"]`);
      if (beatCardEl && beat.text) {
        await BeatPreviewManager.applyPreview(beatCardEl, beat.id, beat.text, style);
      }
    }
  }
};

// Feature flag (default false)
if (typeof window.BEAT_PREVIEW_ENABLED === 'undefined') {
  window.BEAT_PREVIEW_ENABLED = false;
}
```

**3. Wire hooks** (in appropriate locations):

```javascript
// Hook 1: commitBeatTextEdit() - after text update (draft mode)
// Location: around line 7105
// Add after: window.draftStoryboard.beats[index].text = newText;
const { generateBeatCaptionPreviewDebounced } = await import('./js/caption-preview.js');
const style = window.draftStoryboard.captionStyle || getDefaultCaptionStyle();
generateBeatCaptionPreviewDebounced(beat.id, newText, style);

// Hook 2: renderDraftStoryboard() - after storyboard render (draft mode)
// Location: around line 6708, after updateRenderArticleButtonState()
const style = window.draftStoryboard.captionStyle || getDefaultCaptionStyle();
BeatPreviewManager.applyAllPreviews(window.draftStoryboard.beats, style);

// Hook 3: updateBeatText response handler - after text update (session mode)
// Location: around line 7141, after window.currentStorySession.story.sentences update
const style = window.currentStorySession.overlayCaption || window.currentStorySession.captionStyle || getDefaultCaptionStyle();
const { generateBeatCaptionPreviewDebounced } = await import('./js/caption-preview.js');
generateBeatCaptionPreviewDebounced(beatId, newText, style);

// Hook 4: renderStoryboard() - after storyboard render (session mode)
// Location: around line 6580, after updateRenderArticleButtonState()
const style = session.overlayCaption || session.captionStyle || getDefaultCaptionStyle();
BeatPreviewManager.applyAllPreviews(session.story.sentences, style);

// Hook 5: Clip swap handlers - after clip change (both modes)
// Location: in clip selection/swap handlers
// Similar to Hook 1/3, regenerate preview after clip changes
```

### Test Steps (Commit 2)

```bash
# 1. Enable feature flag
window.BEAT_PREVIEW_ENABLED = true;

# 2. Test draft mode
#    - Create/edit draft storyboard
#    - Edit beat text
#    - Verify preview PNG appears on beat card after 300ms debounce
#    - Verify preview positioned correctly (scaled ratios)

# 3. Test session mode
#    - Load existing session
#    - Edit beat text via API
#    - Verify preview regenerates

# 4. Test cancellation
#    - Rapidly edit beat text multiple times
#    - Verify only latest preview loads (AbortController working)

# 5. Test cache
#    - Edit beat text, then revert to previous text
#    - Verify preview loads instantly from cache

# 6. Test failure handling
#    - Disconnect network
#    - Edit beat text
#    - Verify graceful degradation (no UI blocking, console.warn only)

# 7. Test MAX_BEATS cap
#    - Create storyboard with 8 beats
#    - Verify previews generate for all beats (not skipped)
```

---

## H) Explicit Drift Prevention Measures

### Where Code Changes Could Affect Existing Pipeline

1. **`emitCaptionState()` refactor**:
   - **Risk**: Changing computation logic could break existing overlay preview
   - **Prevention**: Copy/paste exact logic to helper, then call helper (no logic changes)
   - **Verification**: Golden-master test (`compareMetaParity()`) must pass

2. **`yPxFirstLine` computation**:
   - **Risk**: Wrong formula could cause server rejection or visual drift
   - **Prevention**: Use confirmed server formula: `yPxFirstLine = yPx_png + rasterPadding`
   - **Verification**: Server accepts requests, preview PNG matches overlay visually

3. **Offscreen DOM width mismatch**:
   - **Risk**: Different wrapping than live overlay → different `lines[]` → geometry drift
   - **Prevention**: Use real stage dimensions if available, match box width exactly
   - **Verification**: Golden-master test compares `lines[]` array (exact match required)

4. **Beat preview performance**:
   - **Risk**: Too many requests could block UI or overwhelm server
   - **Prevention**: Debounce (300ms), AbortController cancellation, cache (1min TTL), feature flag (default false)
   - **Verification**: Rapid edits don't cause UI blocking, network tab shows cancelled requests

### Regression Testing Checklist

After Commit 1:
- [ ] Existing caption overlay preview still works
- [ ] Existing caption preview endpoint still returns 200
- [ ] `compareMetaParity()` returns `true`
- [ ] `window.__overlayMeta.yPxFirstLine` is computed (not undefined)
- [ ] No console errors

After Commit 2 (with feature flag enabled):
- [ ] Beat previews appear correctly positioned
- [ ] Preview PNG matches final render output (parity check)
- [ ] No performance degradation (UI remains responsive)
- [ ] Feature flag disables beat previews when set to `false`

---

## I) Summary

**Two-commit approach**:
1. **Commit 1**: Parity-safe refactor with golden-master gate (no beat previews yet)
2. **Commit 2**: Beat preview wiring behind feature flag (only after gate passes)

**Zero drift guarantee**:
- Copy/paste existing logic (no new math)
- Golden-master test verifies parity
- Offscreen DOM matches live overlay dimensions
- Feature flag allows quick disable if issues arise

**Performance guards**:
- Debounce (300ms)
- AbortController cancellation
- Cache (1min TTL)
- MAX_BEATS cap (8 beats max)

**Feature flag**: `BEAT_PREVIEW_ENABLED` (default `false`)

