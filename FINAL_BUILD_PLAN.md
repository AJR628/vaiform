# Final Build Plan - Beat Caption Preview (Parity-Safe)

## Audit Summary

✅ **Server trusts all client values in V3 raster mode** (no recomputation)  
✅ **yPxFirstLine formula confirmed**: `yPxFirstLine = yPx_png + rasterPadding`  
✅ **rasterW is box width scaled** (already correct)  
✅ **Client missing yPxFirstLine computation** (needs to be added)

---

## Implementation Plan

### Phase 1: Add Audit Logging (No Functional Changes)

**File**: `public/js/caption-preview.js`

**Action**: Add conditional logging before POST (line ~335):

```javascript
// Audit logging (dev-only, behind flag)
if (window.__parityAudit) {
  console.log('[PARITY-AUDIT] Payload before POST:', {
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
}
```

**After POST** (line ~355):

```javascript
if (window.__parityAudit) {
  console.log('[PARITY-AUDIT] Response meta:', {
    rasterW: meta.rasterW,
    rasterH: meta.rasterH,
    rasterPadding: meta.rasterPadding,
    totalTextH: meta.totalTextH,
    yPx_png: meta.yPx_png,
    yPxFirstLine: meta.yPxFirstLine,
    linesCount: meta.lines?.length,
    previewFontString: meta.previewFontString
  });
}
```

---

### Phase 2: Extract computeCaptionMetaFromElements Helper

**File**: `public/js/caption-overlay.js`

**Location**: Add before `initCaptionOverlay()` (around line 35)

**Action**: Extract exact logic from `emitCaptionState()` (lines 1203-1447) with ONE addition:

```javascript
/**
 * Compute caption meta from DOM elements (shared SSOT logic)
 * Extracted from emitCaptionState() - NO CHANGES to logic
 */
export function computeCaptionMetaFromElements({ stageEl, boxEl, contentEl, frameW = 1080, frameH = 1920 }) {
  const stageRect = stageEl.getBoundingClientRect();
  const boxRect = boxEl.getBoundingClientRect();
  
  // Logical stage size in CSS px
  let stageWidth = stageEl.clientWidth;
  let stageHeight = stageEl.clientHeight;
  if (!stageWidth || !stageHeight) {
    stageWidth = stageRect.width;
    stageHeight = stageRect.height;
  }
  
  const cs = getComputedStyle(contentEl);
  
  // Parse stroke (exact copy from emitCaptionState)
  const parseStroke = (str) => {
    if (!str || str === 'none' || str === '0px') return { px: 0, color: 'rgba(0,0,0,0.85)' };
    const match = str.match(/^([\d.]+)px\s+(.+)$/);
    return match ? { px: parseFloat(match[1]), color: match[2] } : { px: 0, color: 'rgba(0,0,0,0.85)' };
  };
  
  const stroke = parseStroke(cs.webkitTextStroke || cs.textStroke);
  const shadow = window.CaptionGeom.parseShadow(cs.textShadow);
  const shadowData = { x: 0, y: shadow.y, blur: shadow.blur, color: 'rgba(0,0,0,0.6)' };
  
  // Typography (exact copy)
  const fontFamily = (cs.fontFamily || 'DejaVu Sans').split(',')[0].replace(/['"]/g, '').trim();
  const fontPx = parseInt(cs.fontSize, 10);
  const lineHeightRaw = cs.lineHeight;
  const lineHeightPx = lineHeightRaw === 'normal' 
    ? Math.round(fontPx * 1.2) 
    : parseFloat(lineHeightRaw);
  const lineSpacingPx = Math.max(0, Math.round(lineHeightPx - fontPx));
  const letterSpacingPx = parseFloat(cs.letterSpacing) || 0;
  const rawWeight = String(cs.fontWeight);
  const weightCss = (rawWeight === 'bold' || parseInt(rawWeight, 10) >= 600) ? '700' : '400';
  const fontStyle = cs.fontStyle === 'italic' ? 'italic' : 'normal';
  const textAlign = cs.textAlign || 'center';
  const textTransform = cs.textTransform || 'none';
  
  // Extract lines (exact copy)
  const text = (contentEl.innerText || contentEl.textContent || '').replace(/\s+/g, ' ').trim();
  const lines = extractRenderedLines(contentEl);
  if (lines.length === 0) {
    throw new Error('No valid lines extracted');
  }
  
  // Font string (exact copy)
  const family = 'DejaVu Sans'; // getVariantFamily equivalent
  const previewFontString = `${fontStyle} ${weightCss === '700' ? 'bold' : 'normal'} ${fontPx}px "${family}"`;
  
  // Color & effects (exact copy)
  const color = cs.color || 'rgb(255,255,255)';
  const opacity = parseFloat(cs.opacity) || 1;
  
  // Geometry (exact copy)
  const cssPaddingLeft = parseInt(cs.paddingLeft, 10) || 0;
  const cssPaddingRight = parseInt(cs.paddingRight, 10) || 0;
  const cssPaddingTop = parseInt(cs.paddingTop, 10) || 0;
  const cssPaddingBottom = parseInt(cs.paddingBottom, 10) || 0;
  
  const contentTextW = contentEl.scrollWidth;
  const contentTextH = contentEl.scrollHeight;
  const boxInnerW = boxEl.clientWidth;
  const boxInnerH = boxEl.clientHeight;
  
  const rasterPaddingX = Math.max(cssPaddingLeft, cssPaddingRight, 
    Math.round((boxInnerW - contentTextW) / 2));
  const rasterPaddingY = Math.max(cssPaddingTop, cssPaddingBottom,
    Math.round((boxInnerH - contentTextH) / 2));
  
  const totalTextH = Math.round(contentEl.getBoundingClientRect().height);
  
  const wPx = Math.round((boxRect.width / stageWidth) * frameW);
  const rasterW = wPx;
  
  const rasterH = window.CaptionGeom.computeRasterH({
    totalTextH,
    padTop: cssPaddingTop,
    padBottom: cssPaddingBottom,
    shadowBlur: shadow.blur,
    shadowOffsetY: shadow.y
  });
  const rasterPadding = Math.round((cssPaddingTop + cssPaddingBottom) / 2);
  
  // Position (exact copy)
  const yPct = (boxRect.top - stageRect.top) / stageHeight;
  const xPct = (boxRect.left - stageRect.left) / stageWidth;
  const wPct = boxRect.width / stageWidth;
  
  const xPctClamped = Math.max(0, Math.min(1, xPct));
  const xPx_png = Math.round(xPctClamped * frameW);
  const yPx_png = Math.round(yPct * frameH);
  
  const xExpr_png = (textAlign === 'center') ? '(W-overlay_w)/2'
    : (textAlign === 'right') ? '(W-overlay_w)'
    : '0';
  
  // ✅ ADD THIS: Compute yPxFirstLine (matches server fallback formula)
  const yPxFirstLine = Math.round(yPx_png + rasterPadding);
  
  return {
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
    strokePx: stroke.px,
    strokeColor: stroke.color,
    shadowColor: shadowData.color,
    shadowBlur: shadowData.blur,
    shadowOffsetX: shadowData.x,
    shadowOffsetY: shadowData.y,
    
    // Geometry
    frameW,
    frameH,
    rasterW,
    rasterH,
    totalTextH,
    rasterPadding,
    rasterPaddingX,
    rasterPaddingY,
    xPct,
    yPct,
    wPct,
    yPx_png,
    xPx_png,
    xExpr_png,
    yPxFirstLine, // ✅ ADD THIS
    
    // Line breaks
    lines,
    
    // Metadata
    text: contentEl.textContent || '',
    textRaw: contentEl.textContent || '',
    ssotVersion: 3,
    mode: 'raster'
  };
}
```

---

### Phase 3: Refactor emitCaptionState to Use Helper

**File**: `public/js/caption-overlay.js`

**Action**: Replace `emitCaptionState()` body (lines 1203-1447) with:

```javascript
function emitCaptionState(reason = 'toolbar') {
  const { W: frameW, H: frameH } = window.CaptionGeom.getFrameDims();
  
  try {
    const state = computeCaptionMetaFromElements({
      stageEl: stage,
      boxEl: box,
      contentEl: content,
      frameW,
      frameH
    });
    
    // Add mode determination (specific to live overlay)
    state.mode = geometryDirty ? 'dom' : (savedPreview ? 'raster' : 'dom');
    state.reason = reason;
    
    // Guard against NaN/null
    Object.keys(state).forEach(k => {
      if (typeof state[k] === 'number' && !Number.isFinite(state[k])) {
        console.warn(`[emitCaptionState] Invalid number for ${k}:`, state[k]);
        state[k] = 0;
      }
    });
    
    // Cache for stable extraction (preserve existing behavior)
    lastGoodDOMCache = {
      text: state.text,
      lines: state.lines,
      contentWidth: content.clientWidth,
      fontPx: state.fontPx,
      lineSpacingPx: state.lineSpacingPx,
      timestamp: Date.now()
    };
    
    // Store and emit
    window.__overlayMeta = state;
    if (typeof window.updateCaptionState === 'function') {
      window.updateCaptionState(state);
    }
  } catch (e) {
    console.error('[emitCaptionState] Failed:', e);
  }
}
```

---

### Phase 4: Add Golden-Master Comparison

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
  
  if (!metaB) {
    console.error('[parity-check] getCaptionMeta() returned null');
    return false;
  }
  
  const fields = ['rasterW', 'rasterH', 'rasterPadding', 'totalTextH', 'yPx_png', 'yPxFirstLine', 'previewFontString'];
  const linesKey = 'lines';
  
  let match = true;
  const diffs = {};
  
  for (const field of fields) {
    const valA = metaA[field];
    const valB = metaB[field];
    if (typeof valA === 'number' && typeof valB === 'number') {
      if (Math.abs(valA - valB) > 0.1) {
        match = false;
        diffs[field] = { A: valA, B: valB, diff: Math.abs(valA - valB) };
      }
    } else if (valA !== valB) {
      match = false;
      diffs[field] = { A: valA, B: valB };
    }
  }
  
  if (metaA[linesKey].join('|') !== metaB[linesKey].join('|')) {
    match = false;
    diffs[linesKey] = { A: metaA[linesKey], B: metaB[linesKey] };
  }
  
  if (!match) {
    console.error('[parity-check] ❌ MISMATCH:', diffs);
    console.error('[parity-check] Full metaA:', metaA);
    console.error('[parity-check] Full metaB:', metaB);
  } else {
    console.log('[parity-check] ✅ MATCH - all fields identical');
  }
  
  return match;
}
```

---

### Phase 5: Update caption-preview.js to Use yPxFirstLine from Meta

**File**: `public/js/caption-preview.js`

**Action**: Update line 303 to use overlayMeta.yPxFirstLine directly (remove fallback):

```javascript
yPxFirstLine: overlayMeta.yPxFirstLine,  // Remove fallback - now computed in shared helper
```

---

### Phase 6: Implement measureBeatCaptionGeometry (Position Before Compute)

**File**: `public/js/caption-overlay.js`

**Action**: Add function that positions box BEFORE compute:

```javascript
/**
 * Measure beat caption geometry using offscreen DOM (reuses SSOT helper)
 * @param {string} text - Beat text
 * @param {object} style - Session-level caption style
 * @returns {object} overlayMeta object matching getCaptionMeta() shape
 */
export function measureBeatCaptionGeometry(text, style) {
  if (!text || !text.trim()) {
    throw new Error('Text is required');
  }
  
  // Create offscreen stage container (matches #stage structure)
  const stageEl = document.createElement('div');
  stageEl.style.cssText = `
    position: fixed;
    left: -99999px;
    top: 0;
    width: 360px;
    height: 640px;
    visibility: hidden;
  `;
  
  // Create box element (matches .caption-box class)
  const boxEl = document.createElement('div');
  boxEl.className = 'caption-box';
  
  // ✅ Set position from style BEFORE compute
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
  
  // Set width from style
  boxEl.style.width = `${(style.wPct || 0.8) * 100}%`;
  boxEl.style.minWidth = '140px';
  
  // Create content element (matches .caption-box .content class)
  const contentEl = document.createElement('div');
  contentEl.className = 'content';
  contentEl.textContent = text;
  contentEl.contentEditable = 'false';
  
  // Apply style properties via inline CSS (minimal overrides)
  if (style.fontFamily) contentEl.style.fontFamily = style.fontFamily;
  if (style.fontPx) contentEl.style.fontSize = `${style.fontPx}px`;
  if (style.weightCss) contentEl.style.fontWeight = style.weightCss;
  if (style.fontStyle) contentEl.style.fontStyle = style.fontStyle;
  if (style.letterSpacingPx !== undefined) contentEl.style.letterSpacing = `${style.letterSpacingPx}px`;
  if (style.textAlign) contentEl.style.textAlign = style.textAlign;
  if (style.color) contentEl.style.color = style.color;
  if (style.opacity !== undefined) contentEl.style.opacity = style.opacity;
  if (style.internalPadding !== undefined) {
    contentEl.style.padding = `${style.internalPadding}px`;
  }
  if (style.lineSpacingPx !== undefined && style.fontPx) {
    contentEl.style.lineHeight = `${style.fontPx + style.lineSpacingPx}px`;
  }
  
  boxEl.appendChild(contentEl);
  stageEl.appendChild(boxEl);
  document.body.appendChild(stageEl);
  
  try {
    // Force layout calculation
    void stageEl.offsetHeight;
    
    // Call shared helper - it derives yPct/yPx_png from positioned box
    const { W: frameW, H: frameH } = window.CaptionGeom.getFrameDims();
    const meta = computeCaptionMetaFromElements({
      stageEl,
      boxEl,
      contentEl,
      frameW,
      frameH
    });
    
    // ✅ NO OVERRIDE - meta.yPct/yPx_png are already correct from positioned box
    
    return meta;
  } finally {
    // Cleanup
    document.body.removeChild(stageEl);
  }
}
```

---

### Phase 7: Test Golden-Master Comparison

**Action**: After implementing Phases 1-6:

1. Open browser console
2. Ensure caption overlay is initialized
3. Run: `compareMetaParity()`
4. **Requirement**: Must return `true` (all fields match)

**If mismatch**: Do NOT proceed until fixed.

---

### Phase 8: Proceed with Wiring (After Parity Passes)

Only after `compareMetaParity()` returns `true`:

1. Add cache helpers (previous plan Step 4)
2. Add `buildPreviewPayloadFromOverlayMeta` helper
3. Add `generateBeatCaptionPreview` function
4. Wire up hooks in `creative.html`
5. Add overlay DOM/CSS for beat cards
6. Add feature flag

---

## Files Modified Summary

1. ✅ `public/js/caption-overlay.js` - Extract helper, add yPxFirstLine, refactor emitCaptionState, add comparison, add measureBeatCaptionGeometry
2. ✅ `public/js/caption-preview.js` - Add audit logging, remove yPxFirstLine fallback

**NO CHANGES TO SERVER** (confirmed safe)

---

## Definition of Done

✅ `compareMetaParity()` returns `true` on live overlay  
✅ Audit logs show correct payload values  
✅ `measureBeatCaptionGeometry()` produces valid overlayMeta  
✅ No regressions: existing overlay preview still works  
✅ No console errors  
✅ Feature flag works (can disable if issues)

---

## Manual Test Steps

1. Enable audit: `window.__parityAudit = true`
2. Trigger existing caption preview
3. Check console logs for payload/response
4. Run `compareMetaParity()` - must return `true`
5. Test beat preview generation with sample text
6. Verify preview PNG displays correctly on beat card


