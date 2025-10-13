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
    
    // Clear old overlayMeta without ssotVersion to break stale-data loop
    try {
      const stored = localStorage.getItem('overlayMeta');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (!parsed.ssotVersion || parsed.ssotVersion < 2) {
          console.log('[caption-preview] Clearing old overlayMeta (no/old ssotVersion)');
          localStorage.removeItem('overlayMeta');
          localStorage.removeItem('overlayMetaTimestamp');
        }
      }
    } catch {}
    
    if (typeof window !== 'undefined') window.__overlayV2 = !!v2;
    return !!v2;
  } catch { return false; }
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
        // V2 overlay format – schema validated server-side
        ssotVersion: 2,  // ← Version flag MUST be first
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
        v2: true,
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
          ssotVersion: 2,  // ← ADD version flag here too
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

  // SSOT v2: Use server response VERBATIM when ssotVersion=2 (no rebuilding!)
  let normalizedMeta;
  if (meta.ssotVersion === 2) {
    // Server is SSOT - use its response verbatim, no modifications
    normalizedMeta = meta;
    console.log('[caption-preview] Using server SSOT v2 response verbatim (no client rebuild)');
    console.log('[caption-preview] Server provided:', {
      fontPx: meta.fontPx,
      lineSpacingPx: meta.lineSpacingPx,
      totalTextH: meta.totalTextH,
      yPxFirstLine: meta.yPxFirstLine,
      splitLines: Array.isArray(meta.splitLines) ? meta.splitLines.length : 0
    });
  } else {
    // Legacy fallback for non-v2 responses
    const totalTextH = Number(meta.totalTextH ?? meta.totalTextHPx);
    const yPxFirstLine = Number(resp.yPx);  // ← top-level!

    normalizedMeta = {
      ssotVersion: 2,  // ← Version flag MUST be first
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
      yPxFirstLine: yPxFirstLine
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
    
    // Persist to localStorage for "Save Preview" workflow
    try {
      localStorage.setItem('overlayMeta', JSON.stringify(normalizedMeta));
      localStorage.setItem('overlayMetaTimestamp', Date.now().toString());
      console.log('[caption-preview] Saved overlay meta to localStorage');
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
  
  // Fall back to localStorage
  try {
    const stored = localStorage.getItem('overlayMeta');
    if (stored) {
      const meta = JSON.parse(stored);
      const timestamp = parseInt(localStorage.getItem('overlayMetaTimestamp') || '0', 10);
      const age = Date.now() - timestamp;
      
      // Only use if saved within last hour (prevent stale data)
      if (age < 3600000) {
        window._overlayMeta = meta;
        return meta;
      } else {
        console.log('[caption-preview] Saved meta is stale, clearing');
        localStorage.removeItem('overlayMeta');
        localStorage.removeItem('overlayMetaTimestamp');
      }
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

// Make functions globally available for legacy compatibility
if (typeof window !== 'undefined') {
  window.generateCaptionPreview = generateCaptionPreview;
  window.createCaptionOverlay = createCaptionOverlay;
  window.createDebouncedCaptionPreview = createDebouncedCaptionPreview;
  window.getSavedOverlayMeta = getSavedOverlayMeta;
  window.validateOverlayCaption = validateOverlayCaption;
}
