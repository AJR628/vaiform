/**
 * Caption Preview API Integration
 * Provides functions to generate caption PNG previews using the new JSON API
 */

// Import API helpers to use same backend as other endpoints
import { apiFetch } from "../api.mjs";

let lastCaptionPNG = null; // { dataUrl, width, height }

// Make lastCaptionPNG globally accessible
if (typeof window !== 'undefined') {
  window.lastCaptionPNG = lastCaptionPNG;
}

/**
 * V3 Migration: Clear legacy storage keys and ensure only v3 data persists
 * Run this immediately on module load before any other code accesses localStorage
 */
(function migrateOverlayMetaToV3() {
  const V3_KEY = 'overlayMetaV3';
  const LEGACY_KEYS = ['overlayMeta', 'overlayMetaV2', 'overlayMetaSaved', 'captionMeta', 'overlayMetaTimestamp', '_previewSavedForCurrentText'];
  
  try {
    // Check if we already have valid v3 data
    const v3Str = localStorage.getItem(V3_KEY);
    if (v3Str) {
      const v3 = JSON.parse(v3Str);
      if (v3?.ssotVersion === 3) {
        console.log('[v3:migration] Valid v3 data exists - keeping it');
        // Clear legacy keys anyway to avoid confusion
        for (const k of LEGACY_KEYS) {
          if (localStorage.getItem(k)) {
            console.log('[v3:migration] Removing legacy key:', k);
            localStorage.removeItem(k);
          }
        }
        return;
      }
    }
    
    // No valid v3 data - nuke everything legacy or v2
    console.log('[v3:migration] No valid v3 data found - clearing all legacy keys');
    for (const k of LEGACY_KEYS) {
      localStorage.removeItem(k);
    }
    localStorage.removeItem(V3_KEY); // Clear invalid v3 data too
  } catch (e) {
    console.warn('[v3:migration] Error during migration:', e);
    // On error, nuke everything to be safe
    for (const k of LEGACY_KEYS) {
      localStorage.removeItem(k);
    }
    localStorage.removeItem(V3_KEY);
  }
})();

/**
 * Generate a caption preview PNG using the new JSON API
 * @param {Object} opts - Caption style options
 * @param {string} opts.text - Caption text
 * @param {string} [opts.fontFamily='DejaVu Sans Local'] - Font family
 * @param {string} [opts.weight='bold'] - Font weight
 * @param {number} [opts.sizePx=48] - Font size in pixels
 * @param {string} [opts.color='#FFFFFF'] - Text color
 * @param {number} [opts.opacity=0.85] - Text opacity
 * @param {boolean} [opts.shadow=true] - Enable text shadow
 * @param {boolean} [opts.showBox=false] - Show background box
 * @param {string} [opts.boxColor='rgba(0,0,0,0.35)'] - Box color
 * @param {string} [opts.placement='center'] - Text placement
 * @param {number} [opts.lineHeight=1.1] - Line height
 * @param {number} [opts.padding=24] - Padding
 * @param {number} [opts.maxWidthPct=0.8] - Max width percentage
 * @param {number} [opts.borderRadius=16] - Border radius
 * @returns {Promise<void>}
 */
// @test-plan
// - With overlayV2=1: request payload includes v2:true; preview respects server yPct/totalTextH; no client re-anchoring.
// - Defaults: xPct/yPct fallback to 0.5; no integer 50 fallback.
// - Legacy (flag off): behavior unchanged.

function detectOverlayV2() {
  try {
    const params = new URLSearchParams(location.search || '');
    const urlOn = params.get('overlayV2') === '1';
    const urlOff = params.get('overlayV2') === '0';
    const lsOn = (localStorage.getItem('overlayV2') || '') === '1';
    const v2 = urlOff ? false : (urlOn || lsOn || true);
    
    // V3 migration handles clearing legacy keys - no need to check here anymore
    
    if (typeof window !== 'undefined') window.__overlayV2 = !!v2;
    return !!v2;
  } catch { return false; }
}

/**
 * Validate that totalTextH matches the correct SSOT formula
 * @param {Object} meta - Overlay meta object to validate
 * @returns {boolean} true if formula is correct, false if invalid
 */
function validateTotalTextHFormula(meta) {
  if (!meta || typeof meta !== 'object') return false;
  
  const { fontPx, lineSpacingPx, totalTextH, splitLines } = meta;
  
  // Must have all required fields
  if (!Number.isFinite(fontPx) || !Number.isFinite(lineSpacingPx) || 
      !Number.isFinite(totalTextH) || !Array.isArray(splitLines) || splitLines.length === 0) {
    return false;
  }
  
  // Validate formula: totalTextH = lines * fontPx + (lines-1) * lineSpacingPx
  const expectedTotalTextH = (splitLines.length * fontPx) + ((splitLines.length - 1) * lineSpacingPx);
  const isValid = Math.abs(totalTextH - expectedTotalTextH) <= 0.5;
  
  if (!isValid) {
    console.warn('[caption-preview] Invalid totalTextH formula:', {
      actual: totalTextH,
      expected: expectedTotalTextH,
      formula: `${splitLines.length}*${fontPx} + ${splitLines.length-1}*${lineSpacingPx}`,
      splitLines: splitLines.length,
      fontPx,
      lineSpacingPx
    });
  }
  
  return isValid;
}

export async function generateCaptionPreview(opts) {
  // Clear overlay if text is empty
  if (!opts.text || !opts.text.trim()) {
    if (typeof window !== 'undefined') {
      window.__lastCaptionOverlay = null;
    }
    return;
  }

  // Clear previous caption to force regeneration
  lastCaptionPNG = null;
  if (typeof window !== 'undefined') {
    window.lastCaptionPNG = null;
    window.__lastCaptionOverlay = null;
  }

  // TASK 1: Clamp fontPx and lineSpacingPx to prevent HTTP 400 errors
  // If fontPx wasn't provided by caller, pull the current slider-mapped px from UI.
  // This preserves SSOT (server still clamps), but avoids the 48px server default.
  const ensureFontPx =
    Number.isFinite(opts?.fontPx) ? opts.fontPx
    : (typeof window?.getCaptionPx === 'function' ? Number(window.getCaptionPx()) : undefined);

  const fontPx = Math.max(24, Math.min(200, Number(ensureFontPx || opts.sizePx || (typeof window?.__overlayMeta?.fontPx === 'number' ? window.__overlayMeta.fontPx : 48))));
  
  // Line spacing calculation - lineHeight is a multiplier (e.g., 1.15), not pixels
  const lineHeightMul = 1.15;  // FIXED multiplier, ignore opts.lineHeight
  const lineHeightPx = Math.round(fontPx * lineHeightMul);   // baseline-to-baseline (62px)
  const lineSpacingPx = Math.max(0, Math.round(lineHeightPx - fontPx)); // gap (8px)
  
  // Use server-compatible payload structure
  const overlayV2 = detectOverlayV2();
  const payload = overlayV2
    ? {
        // V3 overlay format – schema validated server-side with invariant validation
        ssotVersion: 3,  // ← Bumped version to invalidate stale data
        text: opts.text,
        placement: 'custom',
        xPct: Number.isFinite(opts?.xPct) ? Number(opts.xPct) : 0.5,
        yPct: Number.isFinite(opts?.yPct) ? Number(opts.yPct) : 0.5,
        wPct: Number.isFinite(opts?.wPct) ? Number(opts.wPct) : 0.8,
        sizePx: fontPx,  // ← Use computed fontPx, not opts
        lineSpacingPx: lineSpacingPx,  // ← Always use fresh computed (server will recompute anyway)
        fontFamily: opts.fontFamily || 'DejaVuSans',
        weightCss: opts.weight || 'normal',
        color: opts.color || '#FFFFFF',
        opacity: Number(opts.opacity ?? 0.85),
      }
    : {
        style: {
          text: opts.text,
          fontFamily: opts.fontFamily || "DejaVuSans",
          weight: opts.weight || "normal",
          fontPx: fontPx,
          lineSpacingPx: lineSpacingPx,
          opacity: Number(opts.opacity ?? 0.85),
          placement: opts.placement || 'center',
          yPct: Number.isFinite(opts?.yPct) ? Number(opts.yPct) : 0.5,
          ssotVersion: 3,  // ← Bumped version to invalidate stale data
          _cacheBuster: Date.now()
        }
      };

  console.log("[caption-overlay] POST /preview/caption with placement:", opts.placement, "yPct:", opts.yPct);
  // Always call API-prefixed path to avoid 404 from /caption/preview
  const data = await apiFetch("/caption/preview", {
    method: "POST",
    body: payload
  });
  if (!data?.ok) throw new Error(data?.detail || data?.reason || "Preview generation failed");

  // Convert the response to the expected format
  const imageUrl = data.data?.imageUrl;
  if (!imageUrl) throw new Error("No image URL in response");

  // CRITICAL: Read from correct locations
  const resp = data?.data || {};
  const meta = resp.meta || {};

  // SSOT v3: Use server response VERBATIM when ssotVersion=3 (no rebuilding!)
  let normalizedMeta;
  if (meta.ssotVersion === 3) {
    // Server is SSOT - use its response verbatim, no modifications
    normalizedMeta = meta;
    console.log('[caption-preview] Using server SSOT v3 response verbatim (no client rebuild)');
    
    // Log differently based on mode
    if (meta.mode === 'raster') {
      console.log('[caption-preview] RASTER mode - PNG overlay:', {
        mode: meta.mode,
        rasterW: meta.rasterW,
        rasterH: meta.rasterH,
        yPx: meta.yPx,
        urlType: meta.rasterUrl?.startsWith('data:') ? 'data URL' : 'http(s)',
        urlLength: meta.rasterUrl?.length
      });
    } else {
      console.log('[caption-preview] DRAWTEXT mode - Server provided:', {
        fontPx: meta.fontPx,
        lineSpacingPx: meta.lineSpacingPx,
        totalTextH: meta.totalTextH,
        yPxFirstLine: meta.yPxFirstLine,
        splitLines: Array.isArray(meta.splitLines) ? meta.splitLines.length : 0
      });
      
      // Only validate totalTextH formula for drawtext mode
      if (!validateTotalTextHFormula(meta)) {
        console.error('[caption-preview] Server returned invalid totalTextH formula - regenerating preview');
        throw new Error('Server returned invalid totalTextH - please regenerate preview');
      }
    }
  } else {
    // Legacy fallback for non-v2 responses
    const totalTextH = Number(meta.totalTextH ?? meta.totalTextHPx);
    const yPxFirstLine = Number(resp.yPx);  // ← top-level!

    normalizedMeta = {
      ssotVersion: 3,  // ← Bumped version to invalidate stale data
      mode: 'raster',  // ← V3 always uses raster mode
      text: meta.text || opts.text,
      xPct: Number(meta.xPct ?? 0.5),
      yPct: Number(meta.yPct ?? 0.5),
      wPct: Number(meta.wPct ?? 0.8),
      fontPx: Number(meta.fontPx || opts.fontPx || opts.sizePx || 48),
      lineSpacingPx: Number(meta.lineSpacingPx ?? 0),
      color: meta.color || opts.color || '#ffffff',
      opacity: Number(meta.opacity ?? opts.opacity ?? 1.0),
      fontFamily: meta.fontFamily || opts.fontFamily || 'DejaVuSans',
      weightCss: meta.weightCss || opts.weight || opts.weightCss || 'normal',
      placement: meta.placement || 'custom',
      internalPadding: Number(meta.internalPadding ?? 32),
      
      // SSOT fields - must match server response
      splitLines: Array.isArray(meta.splitLines) ? meta.splitLines : [],
      totalTextH: totalTextH,
      totalTextHPx: totalTextH,
      yPxFirstLine: yPxFirstLine,
      
      // Raster fields for v3
      rasterUrl: imageUrl,
      rasterDataUrl: imageUrl,
      rasterPng: imageUrl,
      rasterW: data.data?.wPx || 1080,
      rasterH: data.data?.hPx || 1920,
      xExpr: '(W-overlay_w)/2',
      yPx: yPxFirstLine
    };
  }
  
  lastCaptionPNG = { 
    dataUrl: imageUrl, 
    width: data.data?.wPx || 1080, 
    height: data.data?.hPx || 1920,
    meta: normalizedMeta
  };
  
  // Update global references (SSOT)
  if (typeof window !== 'undefined') {
    window.lastCaptionPNG = lastCaptionPNG;
    
    // Store normalized overlay meta for render (SSOT)
    window._overlayMeta = normalizedMeta;
    
    // Also keep legacy reference for backward compatibility
    window.__lastCaptionOverlay = {
      dataUrl: imageUrl,
      width: data.data?.wPx || 1080,
      height: data.data?.hPx || 1920,
      meta: normalizedMeta
    };
    
    // Persist to localStorage for "Save Preview" workflow (V3 storage key)
    try {
      localStorage.setItem('overlayMetaV3', JSON.stringify(normalizedMeta));
      console.log('[v3:savePreview] saved', { 
        v: normalizedMeta.ssotVersion, 
        mode: normalizedMeta.mode,
        keys: Object.keys(normalizedMeta),
        hasRaster: !!normalizedMeta.rasterUrl || !!normalizedMeta.rasterDataUrl
      });
    } catch (err) {
      console.warn('[caption-preview] Failed to save to localStorage:', err.message);
    }
  }

  const el = document.getElementById("caption-overlay");
  if (el) {
    // If it's an <img>, use src. If it's a <div>, use background-image.
    if (el.tagName === "IMG") {
      el.src = imageUrl;
    } else {
      el.style.backgroundImage = `url(${imageUrl})`;
      el.style.backgroundRepeat = "no-repeat";
      el.style.backgroundPosition = "center";
      el.style.backgroundSize = "contain";
    }
    el.style.display = "block";
    el.style.position = "absolute";
    el.style.left = "0";
    el.style.top = "0";
    el.style.width = "100%";
    el.style.height = "100%";
    el.style.zIndex = "2";
    el.style.pointerEvents = "none";
  }
  
  // Expose preview canvas height for scaling calculations
  if (typeof window !== 'undefined') {
    window.__vaiform_previewHeightPx = data.data?.hPx || 1920;
  }
}

export function getLastCaptionPNG(){ return lastCaptionPNG; }

/**
 * Get saved overlay meta (from memory or localStorage)
 * @returns {Object|null} Saved overlay meta or null if none exists
 */
export function getSavedOverlayMeta() {
  if (typeof window === 'undefined') return null;
  
  // Try memory first
  if (window._overlayMeta) {
    return window._overlayMeta;
  }
  
  // Fall back to localStorage (V3 storage key only)
  try {
    const stored = localStorage.getItem('overlayMetaV3');
    if (stored) {
      const meta = JSON.parse(stored);
      
      // Validate ssotVersion === 3
      if (meta.ssotVersion !== 3) {
        console.warn('[caption-preview] Ignoring saved meta with wrong ssotVersion:', meta.ssotVersion);
        localStorage.removeItem('overlayMetaV3');
        return null;
      }
      
      window._overlayMeta = meta;
      return meta;
    }
  } catch (err) {
    console.warn('[caption-preview] Failed to load from localStorage:', err.message);
  }
  
  return null;
}

/**
 * Validate overlay caption contract (client-side pre-POST check)
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
 * Create a caption overlay element for preview (legacy compatibility)
 * @param {Object} captionData - Caption image data from generateCaptionPreview
 * @param {HTMLElement} container - Container element for the overlay
 * @param {Object} [scaling] - Scaling options for different preview sizes
 * @param {number} [scaling.previewW=1080] - Preview container width
 * @param {number} [scaling.previewH=1920] - Preview container height
 * @returns {HTMLImageElement} The created overlay image element
 */
export function createCaptionOverlay(captionData, container, scaling = {}) {
  const { previewW = 1080, previewH = 1920, placement = 'center' } = scaling;
  
  // TASK 4: Ensure container has proper dimensions
  if (!container) {
    console.warn('[caption-overlay] No container provided');
    return null;
  }
  
  // Get actual container dimensions if not provided
  const actualW = container.clientWidth || previewW;
  const actualH = container.clientHeight || previewH;
  
  // TASK 4: Use actual container dimensions for proper scaling
  const finalW = actualW || previewW;
  const finalH = actualH || previewH;
  
  // Single scale from server frame (1080x1920) to container CSS px
  const serverFrameW = 1080;
  const serverFrameH = 1920;
  const sx = finalW / serverFrameW;
  const sy = finalH / serverFrameH;
  const s = Math.min(sx, sy);
  
  // Create overlay image element
  const overlay = document.createElement('img');
  overlay.src = captionData.dataUrl || captionData.imageUrl;
  overlay.className = 'caption-overlay';
  
  // Convert all overlay geometry to CSS with single scale factor
  const dispW = (captionData.meta?.wPx || 1080) * s;
  const dispH = (captionData.meta?.hPx || 1920) * s;
  
  // SSOT: Use server-computed positioning directly
  const overlayV2 = detectOverlayV2();
  const xPct = 0.5; // center horizontally for preview image
  const yPct = Number.isFinite(captionData.meta?.yPct) ? captionData.meta.yPct : 0.5;
  const totalTextH = captionData.meta?.totalTextH || 0;
  const align = 'center';
  const internalPadding = captionData.meta?.internalPadding || 0;
  const lineSpacingPx = captionData.meta?.lineSpacingPx ?? 0;

  // TASK 2: Scale totalTextH with single scale factor
  const scaledTotalTextH = totalTextH * s;

  // Define safe margins to prevent clipping (5% top, 8% bottom)
  const safeTopMargin = previewH * 0.05;
  const safeBottomMargin = previewH * 0.08;

  // Calculate anchor points
  const anchorX = (xPct) * finalW;

  // Calculate position based on alignment - use text-aware positioning
  let left = anchorX;

  // Horizontal alignment
  if (align === 'center') left -= dispW / 2;
  else if (align === 'right') left -= dispW;

  // SSOT clamp formula based solely on yPct
  const targetTop = (yPct * finalH) - (scaledTotalTextH / 2);
  let top = Math.max(safeTopMargin, Math.min(targetTop, finalH - safeBottomMargin - scaledTotalTextH));

  // Clamp horizontal positioning
  left = Math.max(0, Math.min(left, finalW - dispW));

  const finalDispW = dispW;
  const finalDispH = dispH;
  const finalScaledTextH = scaledTotalTextH;

  // TASK 4: Debug logging with actual container dimensions
  console.log('[preview-overlay] positioning:', {
    W: finalW, H: finalH, iw: captionData.meta?.wPx, iH: captionData.meta?.hPx,
    dispW: finalDispW, dispH: finalDispH, align, yPct,
    finalScale: s, scaledTotalTextH, totalTextH, left, top, targetTop,
    safeTopMargin, safeBottomMargin
  });

  // Apply calculated position and size
  overlay.style.cssText = `
    position: absolute;
    left: ${left}px;
    top: ${top}px;
    width: ${finalDispW}px;
    height: ${finalDispH}px;
    pointer-events: none;
    z-index: 10;
    object-fit: contain;
    user-select: none;
  `;

  // Structured log
  try {
    if (typeof window !== 'undefined' && window.__overlayV2 && window.__debugOverlay) {
      const log = { tag: 'preview:apply', v2: true, left, top, finalDispW, finalDispH, s };
      console.log(JSON.stringify(log));
    }
  } catch {}
  
  // Remove any existing caption overlays
  const existingOverlays = container.querySelectorAll('.caption-overlay');
  existingOverlays.forEach(el => el.remove());
  
  // Add to container
  container.appendChild(overlay);
  
  return overlay;
}

/**
 * Debounced caption preview generator
 * @param {Function} callback - Function to call with generated caption data
 * @param {number} [delay=300] - Debounce delay in milliseconds
 * @returns {Function} Debounced function
 */
export function createDebouncedCaptionPreview(callback, delay = 300) {
  let timeoutId;
  
  return function(options) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(async () => {
      try {
        await generateCaptionPreview(options);
        const result = getLastCaptionPNG();
        callback(null, result);
      } catch (error) {
        callback(error, null);
      }
    }, delay);
  };
}

/**
 * Force clear all preview-related localStorage data
 * Call this when you need to ensure clean state
 */
export function forceClearPreviewCache() {
  if (typeof window === 'undefined') return;
  
  try {
    localStorage.removeItem('overlayMetaV3');
    localStorage.removeItem('_previewSavedForCurrentText');
    window._overlayMeta = null;
    window._previewSavedForCurrentText = false;
    console.log('[caption-preview] Force cleared all preview cache (v3)');
  } catch (err) {
    console.warn('[caption-preview] Failed to clear cache:', err.message);
  }
}

// Make functions globally available for legacy compatibility
if (typeof window !== 'undefined') {
  window.generateCaptionPreview = generateCaptionPreview;
  window.createCaptionOverlay = createCaptionOverlay;
  window.createDebouncedCaptionPreview = createDebouncedCaptionPreview;
  window.getSavedOverlayMeta = getSavedOverlayMeta;
  window.validateOverlayCaption = validateOverlayCaption;
  window.forceClearPreviewCache = forceClearPreviewCache;
}
