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
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
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
  const num = (v) => (v == null ? undefined : typeof v === 'string' ? Number(v) : v);

  const ssotVersion = overlay?.ssotVersion;
  const hasV3 = ssotVersion === 3;
  const mode = overlay?.mode;

  // Check for SSOT V3 raster mode
  if (hasV3 && mode === 'raster' && overlay.rasterUrl) {
    console.log('[overlay] USING RASTER MODE - PNG overlay from preview');

    // 🔒 GEOMETRY LOCK VALIDATION - ensure preview was made for same target
    if (overlay.frameW && overlay.frameW !== W) {
      throw new Error(`Preview frameW mismatch: ${overlay.frameW} != ${W}. Regenerate preview.`);
    }
    if (overlay.frameH && overlay.frameH !== H) {
      throw new Error(`Preview frameH mismatch: ${overlay.frameH} != ${H}. Regenerate preview.`);
    }

    const rasterW = num(overlay.rasterW);
    const rasterH = num(overlay.rasterH);
    const yPx = num(overlay.yPx);

    // CRITICAL: Log input dimensions to detect mutation
    console.log('[v3:placement:IN]', {
      inputRasterW: overlay.rasterW,
      parsedRasterW: rasterW,
      inputRasterH: overlay.rasterH,
      parsedRasterH: rasterH,
      inputYPx: overlay.yPx,
      parsedYPx: yPx,
      inputXExpr: overlay.xExpr,
      frameW: overlay.frameW,
      frameH: overlay.frameH,
    });

    // Validate raster fields - fail fast on missing PNG
    if (!overlay.rasterUrl || typeof overlay.rasterUrl !== 'string') {
      throw new Error('SSOT v3 raster mode requires valid rasterUrl - PNG overlay missing');
    }

    // Additional validation for data URLs vs file paths
    if (!overlay.rasterUrl.startsWith('data:') && !overlay.rasterUrl.startsWith('http')) {
      throw new Error('SSOT v3 raster mode requires valid data URL or HTTP URL for PNG overlay');
    }
    if (!Number.isFinite(rasterW) || rasterW <= 0) {
      throw new Error('SSOT v3 raster mode requires valid rasterW > 0');
    }
    if (!Number.isFinite(rasterH) || rasterH <= 0) {
      throw new Error('SSOT v3 raster mode requires valid rasterH > 0');
    }
    if (!Number.isFinite(yPx)) {
      throw new Error('SSOT v3 raster mode requires valid yPx');
    }

    // Reject full-canvas rasters (likely an error)
    if (rasterW >= 1080 || rasterH >= 1920) {
      console.error('[overlay] Raster dimensions suspiciously large:', { rasterW, rasterH });
      throw new Error('Raster PNG should be tight (not full canvas). Regenerate preview.');
    }

    // Warn if wPct is missing
    if (!overlay.wPct) {
      console.warn('[overlay] wPct missing, defaulting to 1.0');
    }

    console.log('[overlay] mode=raster v3', {
      hasRaster: !!overlay.rasterDataUrl || !!overlay.rasterUrl || !!overlay.rasterPng,
      rasterW,
      rasterH,
      yPx,
      xExpr: overlay.xExpr || '(W - overlay_w)/2',
      urlType: overlay.rasterUrl.startsWith('data:') ? 'data URL' : 'http(s)',
    });

    const result = {
      willUseSSOT: true,
      mode: 'raster',
      rasterUrl: overlay.rasterUrl,
      rasterDataUrl: overlay.rasterDataUrl,
      rasterPng: overlay.rasterPng,
      rasterW,
      rasterH,
      xExpr_png: (overlay.xExpr_png || '(W-overlay_w)/2').replace(/\s+/g, ''),
      yPx_png: Math.round(overlay.yPx_png),
      rasterPadding: overlay.rasterPadding,

      // Geometry lock
      frameW: overlay.frameW,
      frameH: overlay.frameH,
      bgScaleExpr: overlay.bgScaleExpr,
      bgCropExpr: overlay.bgCropExpr,

      // Integrity & typography freeze
      rasterHash: overlay.rasterHash,
      previewFontString: overlay.previewFontString,
      previewFontHash: overlay.previewFontHash,

      // Backward compatibility: also set y and xExpr for legacy paths
      y: Math.round(overlay.yPx_png),
      xExpr: (overlay.xExpr_png || '(W-overlay_w)/2').replace(/\s+/g, ''),
    };

    // CRITICAL: Log output to ensure no mutation
    console.log('[v3:placement:OUT]', {
      outputRasterW: result.rasterW,
      outputRasterH: result.rasterH,
      outputY: result.y,
      outputXExpr: result.xExpr,
    });

    // Assertion checks before ffmpeg
    console.log('[v3:assert]', {
      rasterW,
      rasterH,
      y: result.y,
      pngIsSmall: rasterW < 600 && rasterH < 600,
      hasStyles:
        Boolean(overlay.color) && Boolean(overlay.fontFamily) && Boolean(overlay.weightCss),
      hasAdvancedStyles: Boolean(
        overlay.fontStyle !== 'normal' ||
          overlay.letterSpacingPx !== 0 ||
          overlay.strokePx > 0 ||
          overlay.shadowBlur > 0
      ),
    });

    // Assert raster dimensions are sane
    if (!Number.isFinite(rasterW) || !Number.isFinite(rasterH) || rasterW <= 0 || rasterH <= 0) {
      throw new Error(`[v3:assert] Invalid raster dimensions: ${rasterW}x${rasterH}`);
    }
    if (rasterW > 1920 || rasterH > 1920) {
      console.warn(
        `[v3:assert] Suspiciously large raster: ${rasterW}x${rasterH} - expected tight PNG`
      );
    }

    return result;
  }

  // Check all required V3 SSOT fields (drawtext mode)
  const requiredFields = [
    'xPct',
    'yPct',
    'wPct',
    'fontPx',
    'lineSpacingPx',
    'totalTextH',
    'yPxFirstLine',
  ];
  const hasReq = requiredFields.every((k) => {
    const val = num(overlay[k]);
    return Number.isFinite(val);
  });

  // Also check lines separately
  const ssotLines = overlay?.lines;
  const hasLines = Array.isArray(ssotLines) && ssotLines.length > 0;

  const totalTextHVal = num(overlay?.totalTextH ?? overlay?.totalTextHPx);
  const yPxFirstLineVal = num(overlay?.yPxFirstLine);

  const willUseSSOT = !!(hasV3 && hasReq && hasLines);

  if (hasV3 && !willUseSSOT && mode !== 'raster') {
    console.warn(
      `[overlay] Ignoring saved preview with ssotVersion=3 but missing required fields. Has: ${Object.keys(overlay || {}).join(', ')}`
    );
  } else if (!hasV3 && ssotVersion !== undefined) {
    console.warn(`[overlay] Ignoring saved preview with old ssotVersion: ${ssotVersion}`);
  }

  console.log('[overlay] SSOT field detection:', {
    ssotVersion,
    hasV3,
    mode,
    hasReq,
    hasSplit,
    keys: Object.keys(overlay || {}),
    totalTextH: totalTextHVal,
    totalTextHPx: num(overlay?.totalTextHPx),
    yPxFirstLine: yPxFirstLineVal,
    lineSpacingPx: num(overlay?.lineSpacingPx),
    lines: Array.isArray(ssotLines) ? ssotLines.length : 0,
    willUseSSOT,
  });

  if (willUseSSOT) {
    console.log('[overlay] USING SAVED PREVIEW - SSOT mode, no recompute');

    const Hpx = H ?? 1920;
    const Wpx = W ?? 1080;
    const yPct = num(overlay?.yPct) ?? 0.1;
    const xPct = num(overlay?.xPct) ?? 0.5;
    const wPct = num(overlay?.wPct) ?? 0.96;
    const internalPadding = num(overlay?.internalPadding) ?? 32;

    const fontPx = num(overlay?.fontPx);
    const lineSpacingPx = num(overlay?.lineSpacingPx) ?? 0;
    const totalTextH = totalTextHVal;
    const y = yPxFirstLineVal; // Use exact first-line Y from preview

    // SSOT v2: Trust server values verbatim (no recomputation)
    // Only validate that values are finite numbers to prevent crashes
    if (!Number.isFinite(fontPx)) {
      console.error('[overlay-SSOT-ERROR] fontPx is not finite:', fontPx);
      throw new Error('SSOT fontPx invalid - regenerate preview');
    }
    if (!Number.isFinite(lineSpacingPx)) {
      console.error('[overlay-SSOT-ERROR] lineSpacingPx is not finite:', lineSpacingPx);
      throw new Error('SSOT lineSpacingPx invalid - regenerate preview');
    }
    if (!Number.isFinite(totalTextH)) {
      console.error('[overlay-SSOT-ERROR] totalTextH is not finite:', totalTextH);
      throw new Error('SSOT totalTextH invalid - regenerate preview');
    }
    if (!Number.isFinite(y)) {
      console.error('[overlay-SSOT-ERROR] yPxFirstLine is not finite:', y);
      throw new Error('SSOT yPxFirstLine invalid - regenerate preview');
    }

    // SSOT invariant check
    const expected = ssotLines.length * fontPx + (ssotLines.length - 1) * lineSpacingPx;
    const within = Math.abs(totalTextH - expected) <= 2;
    if (!within) {
      console.error('[ssot/v2:render:INVARIANT] mismatch', {
        totalTextH,
        expected,
        lines: ssotLines.length,
        fontPx,
        lineSpacingPx,
      });
      throw new Error(
        `[ssot/v2:render:INVARIANT] totalTextH=${totalTextH} != expected=${expected}`
      );
    }

    console.log('[overlay-SSOT] Using server values verbatim:', {
      fontPx,
      lineSpacingPx,
      totalTextH,
      y,
      lines: ssotLines.length,
    });

    console.log('[ssot/v2:render:IN]', {
      fontPx,
      lineSpacingPx,
      totalTextH,
      y: yPxFirstLineVal,
      lines: ssotLines.length,
      useSSOT: true,
      formula: `${ssotLines.length}*${fontPx} + ${ssotLines.length - 1}*${lineSpacingPx} = ${totalTextH}`,
    });

    // Horizontal window from preview
    const safeLeft = Math.round(((1 - wPct) * Wpx) / 2);
    const windowW = Math.round(wPct * Wpx) - internalPadding * 2;
    const leftPx = safeLeft + internalPadding;

    const result = {
      mode: 'ssot',
      willUseSSOT: true,
      fromSavedPreview: true,
      xPct,
      yPct,
      wPct,
      placement: overlay?.placement || 'custom',
      internalPadding,
      fontPx,
      lineSpacingPx,
      lines: ssotLines,
      totalTextH: totalTextHVal,
      y: y, // First line Y from preview
      xExpr: '(W - text_w)/2', // Center using frame width, not ad-hoc constants
      linesCount: ssotLines.length,
      leftPx,
      windowW,
      yPx: y,
      computedY: y, // for logging
    };

    console.log('[overlay] USING SAVED PREVIEW META ->', result);
    return result;
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
    align = 'center',
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
  const effectiveLineSpacing =
    lineSpacingPx > 0 ? lineSpacingPx : Math.round(fontPx * (lineHeight - 1));

  const totalTextH = Math.round(lines.length * fontPx + (lines.length - 1) * effectiveLineSpacing);

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
  const y = Math.max(safeTopMargin, Math.min(unclampedY, H - safeBottomMargin - totalTextH));

  return {
    xExpr, // FFmpeg expression or CSS calc
    y: Math.round(y), // Numeric Y position
    fontPx: Math.round(fontPx),
    lineSpacingPx: Math.round(effectiveLineSpacing),
    boxLeft: Math.round(boxLeft),
    boxTop: Math.round(boxTop),
    boxW: Math.round(boxW),
    boxH: Math.round(boxH),
    totalTextH: Math.round(totalTextH),
    lines: lines.length,
    safeTopMargin: Math.round(safeTopMargin),
    safeBottomMargin: Math.round(safeBottomMargin),
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

  // CRITICAL: Log input to detect any mutation at source
  console.log('[v3:normalize:IN]', {
    ssotVersion: overlay?.ssotVersion,
    mode: overlay?.mode,
    rasterW: overlay?.rasterW,
    rasterH: overlay?.rasterH,
    yPx_png: overlay?.yPx_png,
    xExpr_png: overlay?.xExpr_png,
    hasRasterUrl: !!overlay?.rasterUrl,
  });

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
    fontFamily = 'DejaVu Sans',
    weightCss = 'normal',
    showBox = false,
  } = overlay;

  // Use sizePx if fontPx not provided
  const finalFontPx = fontPx || sizePx || 48;

  // Helper to safely coerce to number
  const toNum = (v) => (v == null ? undefined : Number(v));

  // Detect SSOT fields from preview
  const hasV2 = overlay?.ssotVersion === 2;
  const hasV3 = overlay?.ssotVersion === 3;
  const isRaster = hasV3 && overlay?.mode === 'raster';

  // Helper for clamping (skip in raster mode)
  const clamp = (n, min, max) => Math.max(min, Math.min(n, max));
  const clampOrPreserve = (val, min, max) => {
    if (isRaster) return val; // Raster: preserve verbatim
    return clamp(Number(val), min, max);
  };

  // Base normalized fields (safe for legacy compute path)
  const base = {
    text: String(text || '').trim(),
    xPct: clamp01(xPct),
    yPct: clamp01(yPct),
    wPct: clamp01(wPct),
    hPct: clamp01(hPct),
    fontPx: isRaster ? finalFontPx : clamp(Math.round(finalFontPx), 10, 400),
    lineHeight: Math.max(0.9, Math.min(2.0, Number(lineHeight) || 1.15)),
    // lineSpacing clamp (skip in raster mode)
    lineSpacingPx: Number.isFinite(toNum(lineSpacingPx))
      ? clampOrPreserve(Math.round(toNum(lineSpacingPx)), 0, 600)
      : 0,
    align: ['left', 'center', 'right'].includes(align) ? align : 'center',
    color: String(color),
    opacity: clamp01(opacity),
    fontFamily: String(fontFamily || 'DejaVu Sans'),
    weightCss: String(weightCss || 'normal'),
    showBox: Boolean(showBox),
    placement: overlay?.placement,
    internalPadding: overlay?.internalPadding,
  };
  const hasFirst = overlay?.yPxFirstLine != null;
  const hasBlock =
    (overlay?.totalTextH != null || overlay?.totalTextHPx != null) &&
    Array.isArray(overlay?.lines) &&
    overlay.lines.length > 0;

  // If SSOT V3 raster mode, pass through all raster fields verbatim
  if (isRaster) {
    // Explicit priority order for field mapping (future-proof)
    const y = Number.isFinite(overlay.yPx_png)
      ? overlay.yPx_png
      : Number.isFinite(overlay.yPx)
        ? overlay.yPx
        : undefined;

    const xExpr = (overlay.xExpr_png ?? overlay.xExpr ?? '(W-overlay_w)/2').replace(/\s+/g, '');

    const normalized = {
      ...base,
      ssotVersion: 3,
      mode: 'raster',
      rasterUrl: overlay.rasterUrl,
      rasterDataUrl: overlay.rasterDataUrl,
      rasterPng: overlay.rasterPng,
      rasterW: toNum(overlay.rasterW),
      rasterH: toNum(overlay.rasterH),
      xExpr_png: overlay.xExpr_png,
      yPx_png: toNum(overlay.yPx_png),
      rasterPadding: overlay.rasterPadding,

      // Geometry lock
      frameW: toNum(overlay.frameW),
      frameH: toNum(overlay.frameH),
      bgScaleExpr: overlay.bgScaleExpr,
      bgCropExpr: overlay.bgCropExpr,

      // Integrity & typography freeze
      rasterHash: overlay.rasterHash,
      previewFontString: overlay.previewFontString,
      previewFontHash: overlay.previewFontHash,

      // Backward compatibility: also set y and xExpr for legacy paths
      y,
      xExpr,

      // Keep debug fields (but NOT used in raster mode)
      totalTextH: toNum(overlay.totalTextH),
      lineSpacingPx: toNum(overlay.lineSpacingPx),
      lines: Array.isArray(overlay.lines) ? overlay.lines : [],
    };

    // CRITICAL: Log raster dimensions to detect any mutation
    console.log('[v3:normalize:OUT]', {
      inputRasterW: overlay.rasterW,
      outputRasterW: normalized.rasterW,
      inputRasterH: overlay.rasterH,
      outputRasterH: normalized.rasterH,
      inputYPx_png: overlay.yPx_png,
      outputYPx_png: normalized.yPx_png,
      inputXExpr_png: overlay.xExpr_png,
      outputXExpr_png: normalized.xExpr_png,
      frameW: normalized.frameW,
      frameH: normalized.frameH,
      hasHash: !!normalized.rasterHash,
      hasFontString: !!normalized.previewFontString,
    });

    return normalized;
  }

  // If SSOT V2/V3 drawtext fields present, pass through verbatim (coerce to numbers)
  return hasV2 || hasV3 || hasFirst || hasBlock
    ? {
        ...base,
        ssotVersion: overlay.ssotVersion, // Pass through version
        mode: overlay.mode, // Pass through mode
        totalTextH: toNum(overlay.totalTextH ?? overlay.totalTextHPx),
        totalTextHPx: toNum(overlay.totalTextHPx ?? overlay.totalTextH),
        yPxFirstLine: toNum(overlay.yPxFirstLine),
        lines: Array.isArray(overlay.lines) ? overlay.lines : [],
      }
    : base;
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

  const isRaster = overlay?.mode === 'raster';

  // In raster mode, the text is already baked into the PNG.
  // fontPx/lineSpacingPx are informational only; skip numeric bounds.
  if (isRaster) {
    return { valid: true, errors: [] };
  }

  // Required fields (non-raster only)
  if (!overlay.text || typeof overlay.text !== 'string' || !overlay.text.trim()) {
    errors.push('text is required and must be non-empty');
  }

  // Validate percentages (0..1)
  ['xPct', 'yPct', 'wPct', 'hPct'].forEach((key) => {
    const val = overlay[key];
    if (typeof val === 'number') {
      if (val < 0 || val > 1) {
        errors.push(`${key} must be between 0 and 1 (got ${val})`);
      }
    }
  });

  // Validate fontPx (non-raster, caps match Zod schemas)
  const fontPx = overlay.fontPx || overlay.sizePx;
  const fp = Number(fontPx);
  if (Number.isFinite(fp) && (fp < 1 || fp > 400)) {
    errors.push(`fontPx must be between 1 and 400 (got ${fontPx})`);
  }

  // Validate lineSpacingPx (non-raster)
  const lineSpacingPx = overlay.lineSpacingPx;
  const lsp = Number(lineSpacingPx);
  if (Number.isFinite(lsp) && (lsp < 0 || lsp > 600)) {
    errors.push(`lineSpacingPx must be between 0 and 600 (got ${lineSpacingPx})`);
  }

  return {
    valid: errors.length === 0,
    errors,
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
