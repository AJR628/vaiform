# Beat Caption Preview - Final Implementation Plan (Full Specs)

## Overview

This plan implements still caption previews on storyboard beat cards that match final render captions exactly. All geometry computation reuses the existing SSOT v3 raster preview pipeline with zero new math.

**Principle**: Extract shared helper from working `getCaptionMeta()` path, reuse for beat previews.

---

## Audit Findings (From FINAL_TRUTH_AUDIT_REPORT.md)

### Key Truths

1. **Server trusts all client values** in V3 raster mode (no recomputation)
2. **yPxFirstLine formula**: `yPxFirstLine = yPx_png + rasterPadding` (confirmed by server fallback)
3. **rasterW**: Box width scaled to frame space (already correct)
4. **Client missing**: `yPxFirstLine` computation in `emitCaptionState()` (needs to be added)

### Server Behavior (V3 Raster Mode)

- Accepts `yPxFirstLine` from client if provided
- Falls back to `yPx_png + rasterPadding` if missing (line 151)
- Uses formula: PNG top = `yPxFirstLine - padding` (line 1254)
- No clamping in V3 raster mode (client provides final values)

---

## Implementation Steps

### Step 1: Add Audit Logging (No Functional Changes)

**File**: `public/js/caption-preview.js`

**Location**: After payload construction (around line 335, before POST)

**Action**: Add conditional logging behind dev flag:

```javascript
// Add after line 334 (after console.log for placement)
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
    xPct: payload.xPct,
    wPct: payload.wPct,
    frameW: payload.frameW,
    frameH: payload.frameH
  });
}
```

**Location**: After POST response (around line 355, after `const meta = resp.meta || {};`)

**Action**: Add response logging:

```javascript
// Add after line 355 (after const meta = resp.meta || {};)
if (window.__parityAudit) {
  console.log('[PARITY-AUDIT] Response meta:', {
    rasterW: meta.rasterW,
    rasterH: meta.rasterH,
    rasterPadding: meta.rasterPadding,
    totalTextH: meta.totalTextH,
    yPx_png: meta.yPx_png,
    yPxFirstLine: meta.yPxFirstLine,
    linesCount: meta.lines?.length,
    previewFontString: meta.previewFontString,
    rasterUrl: meta.rasterUrl ? 'present' : 'missing'
  });
}
```

**Purpose**: Capture actual values sent/received in working path for verification

---

### Step 2: Extract computeCaptionMetaFromElements Helper

**File**: `public/js/caption-overlay.js`

**Location**: Add before `initCaptionOverlay()` function (around line 35, after imports/declarations)

**Action**: Create shared helper by extracting exact logic from `emitCaptionState()` (lines 1203-1447) with ONE addition (`yPxFirstLine`):

```javascript
/**
 * Compute caption meta from DOM elements (shared SSOT logic)
 * Extracted from emitCaptionState() - exact same computation
 * @param {HTMLElement} stageEl - Stage container element
 * @param {HTMLElement} boxEl - Caption box element (.caption-box)
 * @param {HTMLElement} contentEl - Content element (.caption-box .content)
 * @param {number} frameW - Frame width (default 1080)
 * @param {number} frameH - Frame height (default 1920)
 * @returns {object} overlayMeta object with all SSOT fields including yPxFirstLine
 */
export function computeCaptionMetaFromElements({ stageEl, boxEl, contentEl, frameW = 1080, frameH = 1920 }) {
  const stageRect = stageEl.getBoundingClientRect();
  const boxRect = boxEl.getBoundingClientRect();
  
  // Logical stage size in CSS px (not affected by DPR/viewport scaling)
  let stageWidth = stageEl.clientWidth;
  let stageHeight = stageEl.clientHeight;
  if (!stageWidth || !stageHeight) {
    stageWidth = stageRect.width;
    stageHeight = stageRect.height;
  }
  
  const cs = getComputedStyle(contentEl);
  
  // Parse stroke from webkitTextStroke: "3px rgba(0,0,0,0.85)"
  const parseStroke = (str) => {
    if (!str || str === 'none' || str === '0px') return { px: 0, color: 'rgba(0,0,0,0.85)' };
    const match = str.match(/^([\d.]+)px\s+(.+)$/);
    return match ? { px: parseFloat(match[1]), color: match[2] } : { px: 0, color: 'rgba(0,0,0,0.85)' };
  };
  
  const stroke = parseStroke(cs.webkitTextStroke || cs.textStroke);
  const shadow = window.CaptionGeom.parseShadow(cs.textShadow);
  // Convert to legacy format for state
  const shadowData = { x: 0, y: shadow.y, blur: shadow.blur, color: 'rgba(0,0,0,0.6)' };
  
  // Read ACTUAL computed values from browser (visual truth)
  const fontFamily = (cs.fontFamily || 'DejaVu Sans').split(',')[0].replace(/['"]/g, '').trim();
  const fontPx = parseInt(cs.fontSize, 10);
  
  const lineHeightRaw = cs.lineHeight;
  const lineHeightPx = lineHeightRaw === 'normal' 
    ? Math.round(fontPx * 1.2) 
    : parseFloat(lineHeightRaw);
  const lineSpacingPx = Math.max(0, Math.round(lineHeightPx - fontPx));
  const letterSpacingPx = parseFloat(cs.letterSpacing) || 0;
  // Normalize weight to numeric tokens (400/700) for server consistency
  const rawWeight = String(cs.fontWeight);
  const weightCss = (rawWeight === 'bold' || parseInt(rawWeight, 10) >= 600) ? '700' : '400';
  const fontStyle = cs.fontStyle === 'italic' ? 'italic' : 'normal';
  const textAlign = cs.textAlign || 'center';
  const textTransform = cs.textTransform || 'none';
  
  // Extract actual line breaks as rendered by browser
  const text = (contentEl.innerText || contentEl.textContent || '').replace(/\s+/g, ' ').trim();
  const lines = extractRenderedLines(contentEl);
  if (lines.length === 0) {
    throw new Error('No valid lines extracted');
  }
  
  // Build exact font string the browser used with variant-specific family
  const family = 'DejaVu Sans'; // getVariantFamily equivalent
  const previewFontString = `${fontStyle} ${weightCss === '700' ? 'bold' : 'normal'} ${fontPx}px "${family}"`;
  
  // Color & effects
  const color = cs.color || 'rgb(255,255,255)';
  const opacity = parseFloat(cs.opacity) || 1;
  
  // Geometry: tight to rendered text + visible padding
  const cssPaddingLeft = parseInt(cs.paddingLeft, 10) || 0;
  const cssPaddingRight = parseInt(cs.paddingRight, 10) || 0;
  const cssPaddingTop = parseInt(cs.paddingTop, 10) || 0;
  const cssPaddingBottom = parseInt(cs.paddingBottom, 10) || 0;

  // If user dragged box taller/wider, preserve that airy look
  const contentTextW = contentEl.scrollWidth;
  const contentTextH = contentEl.scrollHeight;
  const boxInnerW = boxEl.clientWidth;
  const boxInnerH = boxEl.clientHeight;

  // rasterPadding: use the visual padding the user sees
  const rasterPaddingX = Math.max(cssPaddingLeft, cssPaddingRight, 
    Math.round((boxInnerW - contentTextW) / 2));
  const rasterPaddingY = Math.max(cssPaddingTop, cssPaddingBottom,
    Math.round((boxInnerH - contentTextH) / 2));

  // Use actual DOM height for totalTextH (includes line-height effects)
  const totalTextH = Math.round(contentEl.getBoundingClientRect().height);
  
  // Raster dimensions: text + padding (what user sees)
  const wPx = Math.round((boxRect.width / stageWidth) * frameW);
  const rasterW = wPx;
  
  // Use shared helper for rasterH
  const rasterH = window.CaptionGeom.computeRasterH({
    totalTextH,
    padTop: cssPaddingTop,
    padBottom: cssPaddingBottom,
    shadowBlur: shadow.blur,
    shadowOffsetY: shadow.y
  });
  const rasterPadding = Math.round((cssPaddingTop + cssPaddingBottom) / 2); // average for legacy
  
  // Position: box top-left in frame space (no %) - compute from fresh rects
  const yPct = (boxRect.top - stageRect.top) / stageHeight;
  
  // Compute xPct and wPct from fresh rects too
  const xPct = (boxRect.left - stageRect.left) / stageWidth;
  const wPct = boxRect.width / stageWidth;
  
  // Compute absolute pixel positions with proper clamping and rounding
  const xPctClamped = Math.max(0, Math.min(1, xPct));
  const xPx_png = Math.round(xPctClamped * frameW);
  const yPx_png = Math.round(yPct * frameH);
  
  const xExpr_png = (textAlign === 'center') ? '(W-overlay_w)/2'
    : (textAlign === 'right') ? '(W-overlay_w)'
    : '0';
  
  // ✅ ADD THIS: Compute yPxFirstLine (matches server fallback formula from line 151)
  // Server uses: yPxFirstLine || (yPx_png + rasterPadding)
  // Server PNG top: yPxFirstLine - padding = (yPx_png + rasterPadding) - padding = yPx_png
  const yPxFirstLine = Math.round(yPx_png + rasterPadding);
  
  return {
    // Typography (browser truth)
    fontFamily,
    fontPx,
    lineSpacingPx,
    letterSpacingPx,
    weightCss,
    fontStyle,
    textAlign,
    textTransform,
    previewFontString, // CRITICAL: exact font string browser used
    
    // Color & effects
    color,
    opacity,
    strokePx: stroke.px,
    strokeColor: stroke.color,
    shadowColor: shadowData.color,
    shadowBlur: shadowData.blur,
    shadowOffsetX: shadowData.x,
    shadowOffsetY: shadowData.y,
    
    // Geometry (frame-space pixels, authoritative)
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
    xPx_png,      // absolute X position (clamped)
    xExpr_png,    // fallback expression
    yPxFirstLine, // ✅ ADD THIS: first line baseline Y
    
    // Line breaks (browser truth)
    lines: lines,
    
    // Metadata
    text: contentEl.textContent || '',
    textRaw: contentEl.textContent || '',
    ssotVersion: 3,
    mode: 'raster'
  };
}
```

**Key Points**:
- Exact copy of logic from `emitCaptionState()` lines 1203-1447
- Only addition: `yPxFirstLine = yPx_png + rasterPadding` computation
- Returns same shape as `emitCaptionState()` output (plus `yPxFirstLine`)

---

### Step 3: Refactor emitCaptionState to Use Shared Helper

**File**: `public/js/caption-overlay.js`

**Location**: Replace function body (lines 1203-1447)

**Action**: Replace entire `emitCaptionState()` function body:

```javascript
// Emit unified caption state to live preview system
function emitCaptionState(reason = 'toolbar') {
  // Get frame dimensions FIRST (before any usage)
  const { W: frameW, H: frameH } = window.CaptionGeom.getFrameDims();
  
  try {
    // Use shared helper - extracts all meta computation
    const state = computeCaptionMetaFromElements({
      stageEl: stage,
      boxEl: box,
      contentEl: content,
      frameW,
      frameH
    });
    
    // Add mode determination (specific to live overlay - not in shared helper)
    state.mode = geometryDirty ? 'dom' : (savedPreview ? 'raster' : 'dom');
    state.reason = reason;
    
    // Guard against NaN/null (preserve existing behavior)
    Object.keys(state).forEach(k => {
      if (typeof state[k] === 'number' && !Number.isFinite(state[k])) {
        console.warn(`[emitCaptionState] Invalid number for ${k}:`, state[k]);
        state[k] = 0;
      }
    });
    
    // Cache successful DOM extraction for stable extraction reuse (preserve existing behavior)
    lastGoodDOMCache = {
      text: state.text,
      lines: state.lines,
      contentWidth: content.clientWidth,
      fontPx: state.fontPx,
      lineSpacingPx: state.lineSpacingPx,
      timestamp: Date.now()
    };
    
    // Store and emit (preserve existing behavior)
    window.__overlayMeta = state;
    if (typeof window.updateCaptionState === 'function') {
      window.updateCaptionState(state);
    }
  } catch (e) {
    console.error('[emitCaptionState] Failed:', e);
  }
}
```

**Key Points**:
- Removes ~240 lines of duplicate logic
- Preserves existing behavior (mode determination, caching, emission)
- Calls shared helper for all computation

---

### Step 4: Add Golden-Master Comparison Function

**File**: `public/js/caption-overlay.js`

**Location**: Add after `extractRenderedLines()` export (around line 1605)

**Action**: Add dev-only comparison function:

```javascript
/**
 * Golden-master comparison: verify computeCaptionMetaFromElements matches getCaptionMeta()
 * DEV ONLY - call manually for verification: compareMetaParity()
 * @returns {boolean} true if all fields match, false otherwise
 */
export function compareMetaParity() {
  const stage = document.querySelector('#stage');
  const box = stage?.querySelector('.caption-box');
  const content = box?.querySelector('.content');
  
  if (!stage || !box || !content) {
    console.error('[parity-check] Missing DOM elements:', { stage: !!stage, box: !!box, content: !!content });
    return false;
  }
  
  const { W: frameW, H: frameH } = window.CaptionGeom.getFrameDims();
  
  // Compute using shared helper
  let metaA;
  try {
    metaA = computeCaptionMetaFromElements({ stageEl: stage, boxEl: box, contentEl: content, frameW, frameH });
  } catch (e) {
    console.error('[parity-check] computeCaptionMetaFromElements failed:', e);
    return false;
  }
  
  // Get existing working path output
  const metaB = window.getCaptionMeta();
  if (!metaB) {
    console.error('[parity-check] getCaptionMeta() returned null');
    return false;
  }
  
  // Fields to compare (numeric fields use tolerance, strings exact match)
  const numericFields = ['rasterW', 'rasterH', 'rasterPadding', 'totalTextH', 'yPx_png', 'yPxFirstLine'];
  const stringFields = ['previewFontString'];
  const linesKey = 'lines';
  
  let match = true;
  const diffs = {};
  const tolerance = 0.1; // Allow small floating-point differences
  
  // Compare numeric fields
  for (const field of numericFields) {
    const valA = metaA[field];
    const valB = metaB[field];
    
    if (typeof valA === 'number' && typeof valB === 'number') {
      if (Math.abs(valA - valB) > tolerance) {
        match = false;
        diffs[field] = { A: valA, B: valB, diff: Math.abs(valA - valB) };
      }
    } else if (valA !== valB) {
      match = false;
      diffs[field] = { A: valA, B: valB };
    }
  }
  
  // Compare string fields
  for (const field of stringFields) {
    if (metaA[field] !== metaB[field]) {
      match = false;
      diffs[field] = { A: metaA[field], B: metaB[field] };
    }
  }
  
  // Compare lines array (exact join match)
  const linesA = metaA[linesKey] || [];
  const linesB = metaB[linesKey] || [];
  if (linesA.join('|') !== linesB.join('|')) {
    match = false;
    diffs[linesKey] = { A: linesA, B: linesB };
  }
  
  // Log results
  if (!match) {
    console.error('[parity-check] ❌ MISMATCH - Fields differ:', diffs);
    console.error('[parity-check] Full metaA (shared helper):', metaA);
    console.error('[parity-check] Full metaB (getCaptionMeta):', metaB);
  } else {
    console.log('[parity-check] ✅ MATCH - all fields identical');
    console.log('[parity-check] Verified fields:', {
      rasterW: metaA.rasterW,
      rasterH: metaA.rasterH,
      rasterPadding: metaA.rasterPadding,
      totalTextH: metaA.totalTextH,
      yPx_png: metaA.yPx_png,
      yPxFirstLine: metaA.yPxFirstLine,
      previewFontString: metaA.previewFontString,
      linesCount: linesA.length
    });
  }
  
  return match;
}
```

**Purpose**: Verify extracted helper produces identical output to existing working path

**Usage**: Call `compareMetaParity()` in browser console after implementation

---

### Step 5: Update caption-preview.js to Use yPxFirstLine from Meta

**File**: `public/js/caption-preview.js`

**Location**: Line 303 (in V3 raster payload construction)

**Current code** (line 303):
```javascript
yPxFirstLine: overlayMeta.yPxFirstLine || (overlayMeta.yPx_png + overlayMeta.rasterPadding),
```

**Action**: Remove fallback, use overlayMeta.yPxFirstLine directly:

```javascript
yPxFirstLine: overlayMeta.yPxFirstLine,  // Now computed in shared helper
```

**Rationale**: `yPxFirstLine` is now computed in `computeCaptionMetaFromElements()`, so fallback is no longer needed

---

### Step 6: Implement measureBeatCaptionGeometry (Position Before Compute)

**File**: `public/js/caption-overlay.js`

**Location**: Add after `compareMetaParity()` export (around line 1705)

**Action**: Add function that creates offscreen DOM and positions box BEFORE calling shared helper:

```javascript
/**
 * Measure beat caption geometry using offscreen DOM (reuses SSOT helper)
 * Creates offscreen DOM matching live overlay structure, positions box from style,
 * then calls computeCaptionMetaFromElements to derive all meta fields.
 * 
 * @param {string} text - Beat text
 * @param {object} style - Session-level caption style object with:
 *   - fontFamily, fontPx, weightCss, fontStyle, letterSpacingPx
 *   - textAlign, color, opacity, internalPadding, lineSpacingPx
 *   - xPct, yPct, wPct (for positioning)
 * @returns {object} overlayMeta object matching getCaptionMeta() shape
 * @throws {Error} if text is empty or DOM creation fails
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
  
  // Create box element (matches .caption-box class - CSS rules will apply)
  const boxEl = document.createElement('div');
  boxEl.className = 'caption-box';
  
  // ✅ CRITICAL: Set position from style BEFORE compute (so helper derives yPct/yPx_png from positioned box)
  if (style.yPct !== undefined) {
    boxEl.style.top = `${style.yPct * 100}%`;
  }
  if (style.xPct !== undefined) {
    boxEl.style.left = `${style.xPct * 100}%`;
  } else {
    // Default center horizontally
    boxEl.style.left = '50%';
    boxEl.style.transform = 'translateX(-50%)';
  }
  
  // Set width from style
  boxEl.style.width = `${(style.wPct || 0.8) * 100}%`;
  boxEl.style.minWidth = '140px';
  
  // Create content element (matches .caption-box .content class - CSS rules will apply)
  const contentEl = document.createElement('div');
  contentEl.className = 'content';
  contentEl.textContent = text;
  contentEl.contentEditable = 'false';
  
  // Apply style properties via inline CSS (minimal overrides - CSS class provides defaults)
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
    // lineSpacingPx = lineHeight - fontPx, so lineHeight = fontPx + lineSpacingPx
    contentEl.style.lineHeight = `${style.fontPx + style.lineSpacingPx}px`;
  }
  
  // Assemble DOM hierarchy
  boxEl.appendChild(contentEl);
  stageEl.appendChild(boxEl);
  document.body.appendChild(stageEl);
  
  try {
    // Force layout calculation (ensure computed styles are available)
    void stageEl.offsetHeight;
    void boxEl.offsetHeight;
    void contentEl.offsetHeight;
    
    // Call shared helper - it derives yPct/yPx_png from positioned box position
    const { W: frameW, H: frameH } = window.CaptionGeom.getFrameDims();
    const meta = computeCaptionMetaFromElements({
      stageEl,
      boxEl,
      contentEl,
      frameW,
      frameH
    });
    
    // ✅ NO OVERRIDE - meta.yPct/yPx_png are already correct from positioned box
    // The helper computed these from boxRect.top/left relative to stageRect
    
    return meta;
  } catch (e) {
    console.error('[measureBeatCaptionGeometry] Failed:', e);
    throw e;
  } finally {
    // Cleanup offscreen DOM
    if (stageEl.parentNode) {
      document.body.removeChild(stageEl);
    }
  }
}
```

**Key Points**:
- Uses same CSS classes (`.caption-box`, `.content`) as live overlay
- Positions box from `style.yPct/xPct` BEFORE calling helper
- Helper derives `yPct/yPx_png` from positioned box (same as live overlay)
- No override of meta values after compute

---

### Step 7: Test Golden-Master Comparison

**Action**: Manual verification step (no code changes)

**Steps**:
1. Open browser console
2. Ensure caption overlay is initialized (must have `#stage`, `.caption-box`, `.content` elements)
3. Run: `compareMetaParity()`
4. **Requirement**: Must return `true` (all fields match)

**If mismatch**:
- Do NOT proceed with wiring
- Debug differences logged in console
- Fix any logic errors in `computeCaptionMetaFromElements()`
- Re-test until `compareMetaParity()` returns `true`

**Expected output**:
```
[parity-check] ✅ MATCH - all fields identical
[parity-check] Verified fields: { rasterW: ..., rasterH: ..., ... }
```

---

### Step 8: Proceed with Beat Preview Wiring (After Parity Passes)

**Prerequisite**: `compareMetaParity()` must return `true`

**Files to modify**:
1. `public/js/caption-preview.js` - Add cache helpers, payload builder, preview generation
2. `public/creative.html` - Wire up hooks, add overlay DOM/CSS

**Note**: Detailed implementation of Step 8 will be provided in a separate document after parity verification passes.

---

## Files Modified Summary

### Phase 1 (Audit & Extraction)
1. ✅ `public/js/caption-preview.js` - Add audit logging (Step 1, Step 5)
2. ✅ `public/js/caption-overlay.js` - Extract helper (Step 2), refactor emitCaptionState (Step 3), add comparison (Step 4), add measureBeatCaptionGeometry (Step 6)

### Phase 2 (After Parity Passes)
3. `public/js/caption-preview.js` - Add cache helpers, payload builder, preview generation
4. `public/creative.html` - Wire hooks, add overlay DOM/CSS

**NO CHANGES TO SERVER** (confirmed safe - server trusts client values)

---

## Definition of Done

### Pre-Wiring Checklist
✅ `compareMetaParity()` returns `true` on live overlay  
✅ Audit logs show correct payload values (enable `window.__parityAudit = true`)  
✅ No console errors  
✅ Existing overlay preview still works  
✅ No CSS/layout regressions

### Post-Wiring Checklist
✅ Beat previews generate and display correctly  
✅ Preview PNG matches render output  
✅ Feature flag works (can disable if issues)  
✅ Graceful failure (preview failure doesn't break storyboard)  
✅ Performance acceptable (debounce, cache, AbortController working)

---

## Manual Test Steps

### Test 1: Parity Verification
1. Open browser console
2. Ensure caption overlay is initialized
3. Run: `compareMetaParity()`
4. Verify: Returns `true`, no mismatches logged

### Test 2: Audit Logging
1. Enable audit: `window.__parityAudit = true`
2. Trigger existing caption preview (via UI)
3. Check console for `[PARITY-AUDIT]` logs
4. Verify payload fields match expected values

### Test 3: Existing Functionality (Regression Test)
1. Open caption overlay UI
2. Type text, change styles
3. Verify preview still generates correctly
4. Verify no console errors

### Test 4: Beat Preview (After Wiring)
1. Create/edit storyboard beat
2. Enter caption text
3. Verify preview PNG appears on beat card
4. Verify preview matches final render

---

## Risk Mitigation

1. **Zero new math**: All computation reuses existing logic
2. **Golden-master test**: Catches regressions before wiring
3. **Feature flag**: Can disable if issues arise
4. **Graceful failure**: Preview failure doesn't break storyboard
5. **Audit logging**: Verifies values match expectations

---

## Notes

- All code extraction is copy/paste from existing working path (no logic changes)
- Only addition: `yPxFirstLine` computation (confirmed correct formula)
- Box positioning happens BEFORE compute (ensures correct yPct/yPx_png derivation)
- No server changes needed (server trusts client values)





