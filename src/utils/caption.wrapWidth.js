/**
 * Caption Wrap Width SSOT (Single Source of Truth)
 * 
 * Derives maxLineWidthPx for text wrapping, ensuring preview and render use identical width calculations.
 * 
 * Rules:
 * - If rasterW is provided (preview V3 path), use it as box width
 * - Else derive from overlay geometry (frameW * wPct)
 * - Subtract 2 * padding to get maxLineWidthPx
 */

/**
 * Derive caption wrap width from overlay geometry
 * @param {Object} options
 * @param {number} [options.frameW] - Frame width in pixels (default: 1080)
 * @param {number} [options.wPct] - Width percentage (0-1, default: 0.8)
 * @param {number} [options.internalPaddingPx] - Internal padding in pixels (default: 24)
 * @param {number} [options.rasterW] - Raster canvas width (preview V3 path)
 * @param {number} [options.rasterPaddingPx] - Raster padding (preview V3 path)
 * @returns {Object} { boxW, pad, maxWidthPx }
 */
export function deriveCaptionWrapWidthPx({
  frameW = 1080,
  wPct = 0.8,
  internalPaddingPx,
  rasterW,
  rasterPaddingPx
}) {
  let boxW;
  let pad;
  let maxWidthPx;
  
  // Rule A: If rasterW is provided (preview V3 path), treat it as the box width
  if (rasterW && Number.isFinite(rasterW) && rasterW > 0) {
    boxW = rasterW;
    pad = rasterPaddingPx ?? internalPaddingPx ?? 24;
    maxWidthPx = Math.max(0, boxW - 2 * pad);
    
    console.log('[wrapwidth] preview', {
      rasterW,
      pad,
      maxWidthPx: Math.round(maxWidthPx)
    });
  } else {
    // Rule B: Else derive from overlay geometry
    boxW = Math.round((wPct ?? 0.8) * frameW);
    pad = internalPaddingPx ?? 24;
    maxWidthPx = Math.max(0, boxW - 2 * pad);
    
    console.log('[wrapwidth] render', {
      frameW,
      wPct: wPct ?? 0.8,
      pad,
      maxWidthPx: Math.round(maxWidthPx)
    });
  }
  
  return {
    boxW: Math.round(boxW),
    pad: Math.round(pad),
    maxWidthPx: Math.round(maxWidthPx)
  };
}

