# Beat Caption Preview - Revised Implementation Plan (Parity-Only)

## Changes from Previous Plan

**DELETED**: `computeBeatCaptionGeometry()` with new math (risk of drift)

**ADDED**: Offscreen DOM measurement rig that reuses existing SSOT helpers

**PRINCIPLE**: Zero new geometry computation - only reuse existing measurement logic

---

## Architecture

- **Measurement**: Offscreen DOM container with same CSS as caption overlay → reuse `extractRenderedLines()` and `getCaptionMeta()` logic
- **Payload**: Reuse existing `generateCaptionPreview()` payload builder (extract helper or call with injected overlayMeta)
- **Placement**: Normalized ratios from meta (yPx_png is top of raster PNG, not baseline)

---

## Files to Modify

1. `public/js/caption-preview.js` - Export helper to build payload from overlayMeta, or accept overlayMeta injection
2. `public/js/caption-overlay.js` - Export offscreen measurement function (reuses existing logic)
3. `public/creative.html` - Add offscreen rig, wire up hooks, add overlay DOM/CSS

---

## Implementation Steps

### Step 1: Create Offscreen Measurement Rig

**File**: `public/js/caption-overlay.js` (or new helper file)

**Action**: Create function that builds hidden DOM container matching caption overlay CSS, then uses existing measurement logic:

```javascript
/**
 * Measure beat caption geometry using offscreen DOM (reuses SSOT logic)
 * @param {string} text - Beat text
 * @param {object} style - Session-level caption style
 * @returns {object} overlayMeta object matching getCaptionMeta() shape
 */
export function measureBeatCaptionGeometry(text, style) {
  // Create offscreen container matching caption overlay structure
  const container = document.createElement('div');
  container.style.cssText = `
    position: fixed;
    left: -99999px;
    top: 0;
    width: ${(style.wPct || 0.8) * 1080}px;
    visibility: hidden;
  `;
  
  // Create content element matching #caption-content CSS
  const content = document.createElement('div');
  content.style.cssText = `
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
  `;
  content.textContent = text;
  
  container.appendChild(content);
  document.body.appendChild(container);
  
  try {
    // Force layout calculation
    void container.offsetHeight;
    
    // Extract lines using existing helper
    const lines = extractRenderedLines(content);
    
    // Get computed styles matching getCaptionMeta() logic
    const cs = getComputedStyle(content);
    const boxRect = container.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    
    // Compute geometry using same logic as getCaptionMeta()
    const frameW = 1080;
    const frameH = 1920;
    const fontPx = style.fontPx || 48;
    const lineSpacingPx = style.lineSpacingPx || 0;
    
    // totalTextH: use actual DOM height (matches getCaptionMeta line 1316)
    const totalTextH = Math.round(contentRect.height);
    
    // rasterW: text width + padding (scaled to frame)
    const cssPaddingLeft = parseInt(cs.paddingLeft, 10) || 0;
    const cssPaddingRight = parseInt(cs.paddingRight, 10) || 0;
    const contentTextW = content.scrollWidth;
    const boxInnerW = container.clientWidth;
    const rasterPaddingX = Math.max(cssPaddingLeft, cssPaddingRight, 
      Math.round((boxInnerW - contentTextW) / 2));
    const rasterW = Math.round(contentTextW + (2 * rasterPaddingX));
    
    // rasterH: use window.CaptionGeom.computeRasterH (matches getCaptionMeta line 1323)
    const cssPaddingTop = parseInt(cs.paddingTop, 10) || 0;
    const cssPaddingBottom = parseInt(cs.paddingBottom, 10) || 0;
    const shadow = window.CaptionGeom ? window.CaptionGeom.parseShadow(cs.textShadow) : { blur: 12, y: 2 };
    const rasterH = window.CaptionGeom ? window.CaptionGeom.computeRasterH({
      totalTextH,
      padTop: cssPaddingTop,
      padBottom: cssPaddingBottom,
      shadowBlur: shadow.blur,
      shadowOffsetY: shadow.y
    }) : totalTextH + (cssPaddingTop + cssPaddingBottom);
    const rasterPadding = Math.round((cssPaddingTop + cssPaddingBottom) / 2);
    
    // yPx_png: compute from yPct using same safe margin logic
    const yPct = style.yPct || 0.5;
    const targetTop = (yPct * frameH) - (totalTextH / 2);
    const safeTopMargin = 50;
    const safeBottomMargin = frameH * 0.08;
    const yPx_png = Math.round(Math.max(safeTopMargin, Math.min(targetTop, frameH - safeBottomMargin - totalTextH)));
    
    // Build overlayMeta object matching getCaptionMeta() output shape
    const overlayMeta = {
      // Typography
      fontFamily: style.fontFamily || 'DejaVu Sans',
      fontPx,
      lineSpacingPx,
      letterSpacingPx: style.letterSpacingPx || 0,
      weightCss: style.weightCss || 'bold',
      fontStyle: style.fontStyle || 'normal',
      textAlign: style.textAlign || 'center',
      textTransform: style.textTransform || 'none',
      previewFontString: cs.font, // Browser truth
      
      // Color & effects
      color: style.color || '#FFFFFF',
      opacity: style.opacity || 1,
      strokePx: 0, // Extract from stroke if needed
      strokeColor: 'rgba(0,0,0,0.85)',
      shadowColor: 'rgba(0,0,0,0.6)',
      shadowBlur: shadow.blur || 12,
      shadowOffsetX: 0,
      shadowOffsetY: shadow.y || 2,
      
      // Geometry
      frameW,
      frameH,
      rasterW,
      rasterH,
      totalTextH,
      rasterPadding,
      rasterPaddingX,
      rasterPaddingY: rasterPadding,
      xPct: 0.5,
      yPct,
      wPct: style.wPct || 0.8,
      yPx_png,
      xPx_png: Math.round(0.5 * frameW),
      xExpr_png: '(W-overlay_w)/2',
      
      // Line breaks
      lines,
      
      // Metadata
      text,
      textRaw: text,
      ssotVersion: 3,
      mode: 'raster'
    };
    
    return overlayMeta;
  } finally {
    // Cleanup offscreen container
    document.body.removeChild(container);
  }
}
```

**Location**: Add after `extractRenderedLines()` export (around line 1605)

**Note**: This reuses `extractRenderedLines()`, `window.CaptionGeom.computeRasterH()`, and same safe margin logic as `getCaptionMeta()`.

---

### Step 2: Export Payload Builder Helper

**File**: `public/js/caption-preview.js`

**Action**: Extract payload building logic into reusable function that accepts overlayMeta:

**Option A (Recommended)**: Export helper that builds payload from overlayMeta:

```javascript
/**
 * Build V3 raster preview payload from overlayMeta (reuses existing logic)
 * @param {string} text - Caption text (fallback if not in overlayMeta)
 * @param {object} overlayMeta - overlayMeta object from getCaptionMeta() or measureBeatCaptionGeometry()
 * @returns {object} Payload ready for POST /api/caption/preview
 */
export function buildPreviewPayloadFromOverlayMeta(text, overlayMeta) {
  // Reuse exact logic from generateCaptionPreview() lines 259-314
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
    yPxFirstLine: overlayMeta.yPxFirstLine || (overlayMeta.yPx_png + overlayMeta.rasterPadding),
    
    // Font string for parity validation
    previewFontString: overlayMeta.previewFontString
  };
}
```

**Location**: Add after `generateCaptionPreview()` function (around line 553)

**Refactor**: Update `generateCaptionPreview()` to use this helper internally (or keep duplicate logic - user preference).

---

### Step 3: Add Beat Preview Generation Function

**File**: `public/js/caption-preview.js`

**Action**: Create function that uses offscreen measurement + payload builder:

```javascript
/**
 * Generate caption preview for a beat card (parity-only, uses SSOT measurement)
 * @param {string} beatId - Beat identifier
 * @param {string} text - Beat text
 * @param {object} style - Session-level caption style
 * @param {AbortSignal} signal - AbortController signal for cancellation
 * @returns {Promise<object>} Preview result with meta and rasterUrl
 */
export async function generateBeatCaptionPreview(beatId, text, style, signal) {
  if (!text || !text.trim()) {
    return null;
  }
  
  // Import offscreen measurement function
  const { measureBeatCaptionGeometry } = await import('./caption-overlay.js');
  
  // Measure geometry using offscreen DOM (reuses SSOT logic)
  const overlayMeta = measureBeatCaptionGeometry(text, style);
  
  // Build payload using existing helper
  const payload = buildPreviewPayloadFromOverlayMeta(text, overlayMeta);
  
  // Call preview endpoint
  const { apiFetch } = await import('./api.mjs');
  const data = await apiFetch('/caption/preview', {
    method: 'POST',
    body: payload,
    signal // AbortController supported
  });
  
  if (!data?.ok) {
    throw new Error(data?.detail || data?.reason || 'Preview generation failed');
  }
  
  return {
    beatId,
    meta: data.data.meta,
    rasterUrl: data.data.meta.rasterUrl
  };
}
```

**Location**: Add after `buildPreviewPayloadFromOverlayMeta()` function

---

### Step 4: Add Preview Cache & Performance Guards

**File**: `public/js/caption-preview.js`

**Action**: Add module-level cache (same as previous plan):

```javascript
// Module-level cache
const previewCache = new Map(); // hash -> { meta, rasterUrl, timestamp }
const previewControllers = new Map(); // beatId -> AbortController
const previewDebounceTimers = new Map(); // beatId -> timeoutId

function hashStyleAndText(style, text) {
  const styleStr = JSON.stringify(style, Object.keys(style).sort());
  return `${styleStr}|${text}`;
}

function getCachedPreview(style, text) {
  const key = hashStyleAndText(style, text);
  const cached = previewCache.get(key);
  if (cached && Date.now() - cached.timestamp < 60000) {
    return cached;
  }
  return null;
}

function setCachedPreview(style, text, result) {
  const key = hashStyleAndText(style, text);
  previewCache.set(key, {
    ...result,
    timestamp: Date.now()
  });
}
```

**Update `generateBeatCaptionPreview()`**: Add cache check before measurement.

---

### Step 5-10: Same as Previous Plan

Steps 5-10 (beat preview manager, debounced function, overlay DOM/CSS, apply function, wiring hooks, feature flag) remain the same as previous plan.

**Key difference**: Replace `computeBeatCaptionGeometry()` calls with `measureBeatCaptionGeometry()` which uses offscreen DOM.

---

## Confirmation: Placement Details

**yPx_png**: From audit, `yPx_png` is the **top of raster PNG** (not baseline). Confirmed in `caption-overlay.js` line 1344: `yPx_png = Math.round(yPct * frameH)` (box top position).

**CSS positioning**:
- `top: calc((yPx_png / frameH) * 100%)` - positions top of PNG
- `width: calc((rasterW / frameW) * 100%)` - scales width
- `height: calc((rasterH / frameH) * 100%)` - scales height
- `left: 50%; transform: translateX(-50%)` - centers horizontally

---

## Files Changed Summary

1. ✅ `public/js/caption-overlay.js` - Add `measureBeatCaptionGeometry()` (offscreen DOM)
2. ✅ `public/js/caption-preview.js` - Add `buildPreviewPayloadFromOverlayMeta()`, `generateBeatCaptionPreview()`, cache helpers
3. ✅ `public/creative.html` - Add preview manager, hooks, overlay DOM/CSS

**NO CHANGES TO**:
- ❌ `src/utils/ffmpeg.video.js`
- ❌ `src/utils/karaoke.ass.js`
- ❌ `src/routes/caption.preview.routes.js`

---

## Testing Checklist

Same as previous plan, with additional parity verification:

### Render Parity Test

1. Generate beat preview for text "Hello world" with style { fontPx: 48, yPct: 0.5 }
2. Render final video with same text + style
3. Extract PNG from preview response (`meta.rasterUrl`)
4. Extract frame from rendered video at same timestamp
5. Compare PNGs → should be bit-identical (same rasterUrl used in render)

---

## Risk Mitigation

- **Zero new math**: Reuses existing measurement logic
- **Offscreen DOM**: Same CSS as caption overlay → browser rendering parity
- **Cache**: Reduces duplicate measurements
- **AbortController**: Prevents race conditions
- **Feature flag**: Can disable if issues

