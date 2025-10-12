/**
 * Shared overlay placement computation for SSOT between preview and render
 * 
 * This module ensures that overlay captions are positioned identically in preview and final render.
 * All positioning uses percentages (0..1) and top-left box coordinates.
 * 
 * @module render/overlay.helpers
 */

/**
 * Split text into lines based on wrapping rules
 * @param {string} text - Text to split (may include explicit \n)
 * @returns {string[]} Array of text lines
 */
function splitIntoLines(text) {
  if (!text || typeof text !== 'string') return [''];
  // Preserve explicit line breaks; browser wrapping is handled separately
  return text.split('\n').map(line => line.trim()).filter(Boolean);
}

/**
 * Compute overlay placement for drawtext or positioning
 * 
 * @param {Object} overlay - Overlay metadata with SSOT fields
 * @param {string} overlay.text - Caption text with explicit \n for line breaks
 * @param {number} overlay.xPct - Box left position (0..1)
 * @param {number} overlay.yPct - Box top position (0..1)
 * @param {number} overlay.wPct - Box width (0..1)
 * @param {number} overlay.hPct - Box height (0..1)
 * @param {number} overlay.fontPx - Font size in pixels
 * @param {number} [overlay.lineHeight=1.15] - Line height multiplier
 * @param {number} [overlay.lineSpacingPx=0] - Explicit line spacing in pixels
 * @param {string} [overlay.align='center'] - Text alignment (left|center|right)
 * @param {number} W - Canvas width (e.g., 1080)
 * @param {number} H - Canvas height (e.g., 1920)
 * @returns {Object} Placement data with {xExpr, y, fontPx, lineSpacingPx, boxLeft, boxTop, boxW, boxH, totalTextH}
 */
export function computeOverlayPlacement(overlay, W, H) {
  if (!overlay || typeof overlay !== 'object') {
    throw new Error('Invalid overlay object');
  }
  
  // Flexible schema detection - accepts either V2 or legacy format
  const num = v => (typeof v === 'string' ? Number(v) : v);

  const hasFirst = Number.isFinite(num(overlay?.yPxFirstLine));
  const hasBlock = Number.isFinite(num(overlay?.totalTextH ?? overlay?.totalTextHPx)) &&
                   Array.isArray(overlay?.splitLines);

  if (hasFirst || hasBlock) {
    console.log('[overlay] incoming keys:', Object.keys(overlay || {}));
    console.log('[overlay] USING SAVED PREVIEW - SSOT mode, no recompute');
    console.log('[overlay] detection:', { hasFirst, hasBlock });
    
    const Hpx = H ?? 1920;
    const Wpx = W ?? 1080;
    const yPct = num(overlay?.yPct) ?? 0.1;
    const xPct = num(overlay?.xPct) ?? 0.022;
    const wPct = num(overlay?.wPct) ?? 0.956;
    const internalPadding = num(overlay?.internalPadding) ?? 32;
    
    // Accept both totalTextH and totalTextHPx
    const totalTextH = num(overlay?.totalTextH ?? overlay?.totalTextHPx);
    
    // Use saved first-line baseline if provided, otherwise derive it
    const y = hasFirst 
      ? Math.round(num(overlay.yPxFirstLine))
      : Math.round(yPct * Hpx - totalTextH / 2);
    
    const splitLines = overlay.splitLines;
    const fontPx = num(overlay?.fontPx);
    let lineSpacingPx = num(overlay?.lineSpacingPx) ?? 0;
    
    // Validate and guard
    if (!splitLines || !Array.isArray(splitLines) || splitLines.length === 0) {
      throw new Error('Saved preview meta missing or invalid splitLines');
    }
    
    if (typeof fontPx !== 'number' || fontPx <= 0) {
      throw new Error('Saved preview meta missing or invalid fontPx');
    }
    
    // Single-line consistency guard
    if (splitLines.length === 1 && lineSpacingPx !== 0) {
      console.warn('[render] Single-line text should have lineSpacingPx=0, correcting');
      lineSpacingPx = 0;
    }
    
    // Horizontal window from preview
    const safeLeft = Math.round((1 - wPct) * Wpx / 2);
    const windowW = Math.round(wPct * Wpx) - internalPadding * 2;
    const leftPx = safeLeft + internalPadding;
    
    const out = {
      fromSavedPreview: true,
      leftPx, 
      windowW, 
      xPct: String(xPct), 
      yPct: String(yPct), 
      wPct: String(wPct),
      placement: overlay?.placement || 'custom',
      internalPadding,
      fontPx,
      lineSpacingPx,
      totalTextH,
      splitLines: overlay.splitLines,
      yPx: y,  // Use computed/saved baseline
      y,       // FFmpeg uses this
      xExpr: `${leftPx} + (${windowW} - text_w)/2`,
      lines: overlay.splitLines.length,
      safeTopMargin: Math.round(Hpx * 0.05),
      safeBottomMargin: Math.round(Hpx * 0.08)
    };
    
    console.log('[overlay] USING SAVED PREVIEW META ->', out);
    return out;
  }
  
  // Legacy path: recompute from scratch
  const {
    text = '',
    xPct = 0.5,
    yPct = 0.5,
    wPct = 0.8,
    hPct = 0.3,
    fontPx = 48,
    lineHeight = 1.15,
    lineSpacingPx = 0,
    align = 'center'
  } = overlay;
  
  // Validate inputs
  if (typeof W !== 'number' || typeof H !== 'number' || W <= 0 || H <= 0) {
    throw new Error('Invalid canvas dimensions');
  }
  
  // Convert percentages to pixels (top-left box)
  const boxLeft = Math.round(clamp01(xPct) * W);
  const boxTop = Math.round(clamp01(yPct) * H);
  const boxW = Math.round(clamp01(wPct) * W);
  const boxH = Math.round(clamp01(hPct) * H);
  
  // Split text into lines (preserves explicit \n)
  const lines = splitIntoLines(text);
  
  // Calculate total text height
  // Use lineSpacingPx if provided, otherwise derive from lineHeight
  const effectiveLineSpacing = lineSpacingPx > 0 
    ? lineSpacingPx 
    : Math.round(fontPx * (lineHeight - 1));
  
  const totalTextH = Math.round(
    lines.length * fontPx + 
    (lines.length - 1) * effectiveLineSpacing
  );
  
  // Horizontal placement expression (for FFmpeg drawtext or CSS)
  let xExpr;
  switch (align) {
    case 'left':
      xExpr = `${boxLeft}`;
      break;
    case 'right':
      xExpr = `${boxLeft} + ${boxW} - text_w`;
      break;
    case 'center':
    default:
      xExpr = `${boxLeft} + (${boxW} - text_w)/2`;
      break;
  }
  
  // Vertical placement: center text in box, with clamping to frame
  const unclampedY = boxTop + Math.max(0, Math.floor((boxH - totalTextH) / 2));
  
  // Safe margins (match server-side rendering)
  const safeTopMargin = Math.max(50, H * 0.05);
  const safeBottomMargin = Math.max(50, H * 0.08);
  
  // Clamp to safe area
  const y = Math.max(
    safeTopMargin,
    Math.min(unclampedY, H - safeBottomMargin - totalTextH)
  );
  
  return {
    xExpr,                    // FFmpeg expression or CSS calc
    y: Math.round(y),         // Numeric Y position
    fontPx: Math.round(fontPx),
    lineSpacingPx: Math.round(effectiveLineSpacing),
    boxLeft: Math.round(boxLeft),
    boxTop: Math.round(boxTop),
    boxW: Math.round(boxW),
    boxH: Math.round(boxH),
    totalTextH: Math.round(totalTextH),
    lines: lines.length,
    safeTopMargin: Math.round(safeTopMargin),
    safeBottomMargin: Math.round(safeBottomMargin)
  };
}

/**
 * Normalize overlay caption object to SSOT format
 * Ensures all fields are in correct format and range
 * 
 * @param {Object} overlay - Raw overlay object
 * @returns {Object} Normalized overlay with SSOT fields
 */
export function normalizeOverlayCaption(overlay) {
  if (!overlay || typeof overlay !== 'object') {
    return null;
  }
  
  const {
    text = '',
    xPct = 0.5,
    yPct = 0.5,
    wPct = 0.8,
    hPct = 0.3,
    fontPx = 48,
    sizePx, // alias for fontPx
    lineHeight = 1.15,
    lineSpacingPx = 0,
    align = 'center',
    color = '#ffffff',
    opacity = 1.0,
    fontFamily = 'DejaVuSans',
    weightCss = 'normal',
    showBox = false
  } = overlay;
  
  // Use sizePx if fontPx not provided
  const finalFontPx = fontPx || sizePx || 48;
  
  return {
    text: String(text || '').trim(),
    xPct: clamp01(xPct),
    yPct: clamp01(yPct),
    wPct: clamp01(wPct),
    hPct: clamp01(hPct),
    fontPx: Math.max(10, Math.min(200, Math.round(finalFontPx))),
    lineHeight: Math.max(0.9, Math.min(2.0, Number(lineHeight) || 1.15)),
    lineSpacingPx: Math.max(0, Math.min(200, Math.round(lineSpacingPx || 0))),
    align: ['left', 'center', 'right'].includes(align) ? align : 'center',
    color: String(color),
    opacity: clamp01(opacity),
    fontFamily: String(fontFamily || 'DejaVuSans'),
    weightCss: String(weightCss || 'normal'),
    showBox: Boolean(showBox)
  };
}

/**
 * Validate overlay caption contract (client-side pre-POST check)
 * 
 * @param {Object} overlay - Overlay object to validate
 * @returns {Object} { valid: boolean, errors: string[] }
 */
export function validateOverlayCaption(overlay) {
  const errors = [];
  
  if (!overlay || typeof overlay !== 'object') {
    return { valid: false, errors: ['Overlay must be an object'] };
  }
  
  // Required fields
  if (!overlay.text || typeof overlay.text !== 'string' || !overlay.text.trim()) {
    errors.push('text is required and must be non-empty');
  }
  
  // Validate percentages (0..1)
  ['xPct', 'yPct', 'wPct', 'hPct'].forEach(key => {
    const val = overlay[key];
    if (typeof val === 'number') {
      if (val < 0 || val > 1) {
        errors.push(`${key} must be between 0 and 1 (got ${val})`);
      }
    }
  });
  
  // Validate fontPx
  const fontPx = overlay.fontPx || overlay.sizePx;
  if (typeof fontPx === 'number' && (fontPx <= 0 || fontPx > 200)) {
    errors.push(`fontPx must be between 1 and 200 (got ${fontPx})`);
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Clamp number to 0..1 range
 * @param {*} x - Value to clamp
 * @returns {number} Clamped value between 0 and 1
 */
function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

// Export helper functions
export { splitIntoLines };

