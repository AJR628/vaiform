# Beat Caption Preview - Final Implementation Plan (SSOT Refactor)

**Based on**: Phase 1 Audit Report findings

**Principle**: Zero new math - extract shared helper from `getCaptionMeta()`, reuse for beat previews

---

## Phase 2: Refactor to Extract Shared Helper

### Step 1: Extract `computeCaptionMetaFromElements()` Helper

**File**: `public/js/caption-overlay.js`

**Action**: Extract core meta computation logic from `emitCaptionState()` into a pure helper function:

```javascript
/**
 * Compute caption meta from DOM elements (shared SSOT logic)
 * @param {HTMLElement} stageEl - Stage container element (for stage dimensions)
 * @param {HTMLElement} boxEl - Caption box element (.caption-box)
 * @param {HTMLElement} contentEl - Content element (.caption-box .content)
 * @param {number} frameW - Frame width (default 1080)
 * @param {number} frameH - Frame height (default 1920)
 * @returns {object} overlayMeta object with all SSOT fields
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
  
  // Parse stroke
  const parseStroke = (str) => {
    if (!str || str === 'none' || str === '0px') return { px: 0, color: 'rgba(0,0,0,0.85)' };
    const match = str.match(/^([\d.]+)px\s+(.+)$/);
    return match ? { px: parseFloat(match[1]), color: match[2] } : { px: 0, color: 'rgba(0,0,0,0.85)' };
  };
  
  const stroke = parseStroke(cs.webkitTextStroke || cs.textStroke);
  const shadow = window.CaptionGeom.parseShadow(cs.textShadow);
  const shadowData = { x: 0, y: shadow.y, blur: shadow.blur, color: 'rgba(0,0,0,0.6)' };
  
  // Typography (browser truth)
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
  
  // Extract lines
  const text = (contentEl.innerText || contentEl.textContent || '').replace(/\s+/g, ' ').trim();
  const lines = extractRenderedLines(contentEl);
  if (lines.length === 0) {
    throw new Error('No valid lines extracted');
  }
  
  // Font string
  const family = 'DejaVu Sans'; // getVariantFamily equivalent
  const previewFontString = `${fontStyle} ${weightCss === '700' ? 'bold' : 'normal'} ${fontPx}px "${family}"`;
  
  // Color & effects
  const color = cs.color || 'rgb(255,255,255)';
  const opacity = parseFloat(cs.opacity) || 1;
  
  // Geometry
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
  
  // Position
  const yPct = (boxRect.top - stageRect.top) / stageHeight;
  const xPct = (boxRect.left - stageRect.left) / stageWidth;
  const wPct = boxRect.width / stageWidth;
  
  const xPctClamped = Math.max(0, Math.min(1, xPct));
  const xPx_png = Math.round(xPctClamped * frameW);
  const yPx_png = Math.round(yPct * frameH);
  
  const xExpr_png = (textAlign === 'center') ? '(W-overlay_w)/2'
    : (textAlign === 'right') ? '(W-overlay_w)'
    : '0';
  
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

**Location**: Add before `initCaptionOverlay()` function (around line 35), after `extractRenderedLines()` export

---

### Step 2: Refactor `emitCaptionState()` to Use Helper

**File**: `public/js/caption-overlay.js`

**Action**: Update `emitCaptionState()` to call the shared helper:

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
    
    // Cache for stable extraction
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

**Location**: Replace `emitCaptionState()` function body (lines 1203-1447)

---

### Step 3: Implement `measureBeatCaptionGeometry()` Using Shared Helper

**File**: `public/js/caption-overlay.js`

**Action**: Create function that builds offscreen DOM with SAME classes/CSS, then calls shared helper:

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
  // Apply style from session (width/height will be determined by content)
  boxEl.style.left = '6%';
  boxEl.style.top = '5%';
  boxEl.style.width = `${(style.wPct || 0.8) * 100}%`;
  boxEl.style.minWidth = '140px';
  
  // Create content element (matches .caption-box .content class)
  const contentEl = document.createElement('div');
  contentEl.className = 'content';
  contentEl.textContent = text;
  contentEl.contentEditable = 'false';
  
  // Apply style properties via CSS (matching initCaptionOverlay CSS rules)
  // Note: CSS class already sets defaults, but we override with style object values
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
  
  boxEl.appendChild(contentEl);
  stageEl.appendChild(boxEl);
  document.body.appendChild(stageEl);
  
  try {
    // Force layout calculation
    void stageEl.offsetHeight;
    
    // Override yPct if provided in style
    const frameW = 1080;
    const frameH = 1920;
    const meta = computeCaptionMetaFromElements({
      stageEl,
      boxEl,
      contentEl,
      frameW,
      frameH
    });
    
    // Override yPct/yPx_png if style.yPct is provided (for placement presets)
    if (style.yPct !== undefined) {
      meta.yPct = style.yPct;
      meta.yPx_png = Math.round(style.yPct * frameH);
    }
    
    return meta;
  } finally {
    // Cleanup
    document.body.removeChild(stageEl);
  }
}
```

**Location**: Add after `computeCaptionMetaFromElements()` export

**Note**: This reuses the EXACT same CSS classes (`.caption-box`, `.content`) and calls the shared helper. No new math.

---

## Phase 3: Implementation Wiring

### Step 4: Add Preview Cache & Performance Guards

**File**: `public/js/caption-preview.js`

**Action**: Add module-level cache and helper functions at top of file (after imports, before first function):

```javascript
// Module-level cache for beat previews
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
  if (cached && Date.now() - cached.timestamp < 60000) { // 1min TTL
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

**Location**: Add near top of file (around line 20, after imports)

---

### Step 5: Export Payload Builder Helper

**File**: `public/js/caption-preview.js`

**Action**: Extract payload building logic into reusable function (reuses existing logic from lines 259-314):

```javascript
/**
 * Build V3 raster preview payload from overlayMeta (reuses existing logic)
 * @param {string} text - Caption text (fallback if not in overlayMeta)
 * @param {object} overlayMeta - overlayMeta object from getCaptionMeta() or measureBeatCaptionGeometry()
 * @returns {object} Payload ready for POST /api/caption/preview
 */
export function buildPreviewPayloadFromOverlayMeta(text, overlayMeta) {
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
    previewFontString: overlayMeta.previewFontString,
    
    // Optional textRaw
    textRaw: overlayMeta.textRaw || text
  };
}
```

**Location**: Add after `generateCaptionPreview()` function (around line 553)

---

### Step 6: Add Beat Preview Generation Function

**File**: `public/js/caption-preview.js`

**Action**: Create function that uses offscreen measurement + payload builder + cache:

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
  
  // Check cache first
  const cached = getCachedPreview(style, text);
  if (cached) {
    return { beatId, ...cached };
  }
  
  // Cancel previous request for this beat
  const prev = previewControllers.get(beatId);
  if (prev) prev.abort();
  
  const controller = new AbortController();
  if (signal) {
    signal.addEventListener('abort', () => controller.abort());
  }
  previewControllers.set(beatId, controller);
  
  try {
    // Import offscreen measurement function
    const { measureBeatCaptionGeometry } = await import('./caption-overlay.js');
    
    // Measure geometry using offscreen DOM (reuses SSOT helper)
    const overlayMeta = measureBeatCaptionGeometry(text, style);
    
    // Build payload using existing helper
    const payload = buildPreviewPayloadFromOverlayMeta(text, overlayMeta);
    
    // Call preview endpoint
    const { apiFetch } = await import('./api.mjs');
    const data = await apiFetch('/caption/preview', {
      method: 'POST',
      body: payload,
      signal: controller.signal
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
    setCachedPreview(style, text, result);
    
    return result;
  } catch (err) {
    if (err.name === 'AbortError') {
      return null; // Request was cancelled
    }
    console.warn('[beat-preview] Failed:', err);
    throw err;
  } finally {
    previewControllers.delete(beatId);
  }
}
```

**Location**: Add after `buildPreviewPayloadFromOverlayMeta()` function

---

### Step 7: Add Debounced Beat Preview Manager

**File**: `public/js/caption-preview.js`

**Action**: Add debounced wrapper function:

```javascript
/**
 * Debounced beat preview generation
 * @param {string} beatId - Beat identifier
 * @param {string} text - Beat text
 * @param {object} style - Session-level caption style
 * @param {number} delayMs - Debounce delay (default 300ms)
 * @returns {Promise<object>} Preview result
 */
export async function generateBeatCaptionPreviewDebounced(beatId, text, style, delayMs = 300) {
  // Clear existing timeout
  const existing = previewDebounceTimers.get(beatId);
  if (existing) clearTimeout(existing);
  
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(async () => {
      previewDebounceTimers.delete(beatId);
      try {
        const result = await generateBeatCaptionPreview(beatId, text, style);
        resolve(result);
      } catch (err) {
        reject(err);
      }
    }, delayMs);
    
    previewDebounceTimers.set(beatId, timeoutId);
  });
}
```

**Location**: Add after `generateBeatCaptionPreview()` function

---

### Step 8: Wire Up Hooks in creative.html

**File**: `public/creative.html`

**Actions**:
1. Import beat preview functions in script section
2. Add preview manager object
3. Wire up hooks at identified locations:
   - `commitBeatTextEdit()` - after text update (draft mode)
   - `renderDraftStoryboard()` - after storyboard render (draft mode)
   - `updateBeatText` response handler - after text update (session mode)
   - `renderStoryboard()` - after storyboard render (session mode)
   - Clip selection/swap handlers - after clip change (both modes)

**Implementation details**: See `docs/caption/01-pipeline-overview.md` (Stage 4: Client Preview Application) and `docs/caption/03-debugging-parity.md` (Beat Preview Parity) for current SSOT documentation. Note: Specific hook locations (commitBeatTextEdit, renderDraftStoryboard, etc.) are implementation details that may have changed since the original audit.

---

### Step 9: Add Overlay DOM/CSS for Beat Cards

**File**: `public/creative.html`

**Actions**:
1. Add CSS for `.beat-caption-overlay` class (normalized positioning)
2. Add overlay `<img>` element to beat card template
3. Apply overlay when preview is available

**CSS**:
```css
.beat-caption-overlay {
  position: absolute;
  left: 50%;
  top: calc(var(--y-pct) * 100%);
  width: calc(var(--raster-w-ratio) * 100%);
  height: calc(var(--raster-h-ratio) * 100%);
  transform: translateX(-50%) translateY(0);
  pointer-events: none;
  z-index: 10;
  object-fit: contain;
}
```

---

### Step 10: Add Feature Flag

**File**: `public/creative.html`

**Action**: Add feature flag check at start of preview generation:

```javascript
const BEAT_PREVIEW_ENABLED = true; // Feature flag
```

Use flag to early-return if disabled.

---

## Summary

**Files Modified**:
1. `public/js/caption-overlay.js` - Extract `computeCaptionMetaFromElements()`, refactor `emitCaptionState()`, add `measureBeatCaptionGeometry()`
2. `public/js/caption-preview.js` - Add cache, `buildPreviewPayloadFromOverlayMeta()`, `generateBeatCaptionPreview()`, debounced function
3. `public/creative.html` - Wire up hooks, add overlay DOM/CSS, feature flag

**Key Principle**: Zero new math - all geometry computation reuses shared helper extracted from working `getCaptionMeta()` path.

