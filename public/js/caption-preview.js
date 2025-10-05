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
    const lsOn = (localStorage.getItem('overlayV2') || '') === '1';
    if (typeof window !== 'undefined') window.__overlayV2 = !!(urlOn || lsOn);
    return !!(urlOn || lsOn);
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

  const fontPx = Math.max(24, Math.min(200, Number(ensureFontPx || opts.sizePx || 48)));
  const lineSpacingPx = Math.max(24, Math.min(200, Math.round(fontPx * Number(opts.lineHeight || 1.1))));
  
  // Use server-compatible payload structure
  const overlayV2 = detectOverlayV2();
  const payload = overlayV2
    ? {
        // V2 overlay format – schema validated server-side
        text: opts.text,
        placement: 'custom',
        xPct: Number.isFinite(opts?.xPct) ? Number(opts.xPct) : 0.5,
        yPct: Number.isFinite(opts?.yPct) ? Number(opts.yPct) : 0.5,
        wPct: Number.isFinite(opts?.wPct) ? Number(opts.wPct) : 0.8,
        sizePx: Math.max(32, Math.min(120, Number(opts.sizePx || fontPx))),
        lineSpacingPx: Number.isFinite(opts?.lineSpacingPx) ? Number(opts.lineSpacingPx) : lineSpacingPx,
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

  lastCaptionPNG = { 
    dataUrl: imageUrl, 
    width: data.data?.wPx || 1080, 
    height: data.data?.hPx || 1920,
    meta: {
      xPx: data.data?.xPx || 0,
      yPx: data.data?.yPx || 0,
      wPx: data.data?.wPx || 1080,
      hPx: data.data?.hPx || 1920,
      ...data.data?.meta
    }
  };
  
  // Update global reference
  if (typeof window !== 'undefined') {
    window.lastCaptionPNG = lastCaptionPNG;
    // Store as the new overlay format for render payload
    window.__lastCaptionOverlay = {
      dataUrl: imageUrl,
      width: data.data?.wPx || 1080,
      height: data.data?.hPx || 1920,
      meta: data.data?.meta || {}
    };
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
  const xPct = Number.isFinite(captionData.meta?.xPct) ? captionData.meta.xPct : 0.5;
  const yPct = Number.isFinite(captionData.meta?.yPct) ? captionData.meta.yPct : 0.5;
  const totalTextH = captionData.meta?.totalTextH || captionData.meta?.hPx || 0;
  const align = captionData.meta?.align || 'center';
  const vAlign = captionData.meta?.vAlign || 'center';
  const internalPadding = captionData.meta?.internalPadding || 0;
  const lineSpacingPx = captionData.meta?.lineSpacingPx ?? captionData.meta?.lineSpacing ?? 0;
  
  // SSOT: Use server-computed anchor positioning if available
  const serverAnchorY = captionData.meta?.anchorY;
  const serverTextBlockTop = captionData.meta?.textBlockTop;
  
  // TASK 2: Scale totalTextH with single scale factor
  const scaledTotalTextH = totalTextH * s;
  
  // Define safe margins to prevent clipping (5% top, 8% bottom)
  const safeTopMargin = previewH * 0.05;
  const safeBottomMargin = previewH * 0.08;
  
  // Calculate anchor points using server-computed positioning
  const anchorX = (xPct / 100) * finalW;
  
  // Calculate position based on alignment - use text-aware positioning
  let left = anchorX;
  
  // Horizontal alignment
  if (align === 'center') left -= dispW / 2;
  else if (align === 'right') left -= dispW;
  
  // SSOT: Use server-computed positioning directly, or fallback to client calculation
  let targetTop;
  if (overlayV2 && serverTextBlockTop !== undefined) {
    // V2: prefer server-computed block top
    targetTop = (serverTextBlockTop / serverFrameH) * finalH;
  } else {
    targetTop = (yPct * finalH) - (scaledTotalTextH / 2);
  }
  
  let top = Math.max(safeTopMargin, Math.min(targetTop, finalH - safeBottomMargin - scaledTotalTextH));
  
  console.log('[preview-overlay] positioning:', {
    W: finalW, H: finalH, iw: captionData.meta?.wPx, iH: captionData.meta?.hPx,
    dispw: dispW, dispH: dispH, align, placement, yPct,
    finalscale: s, scaledTotalTextH, totalTextH,
    left: left, top: top, targetTop, safeTopMargin, safeBottomMargin
  });
  
  // TASK 3: Clamp with padding to prevent off-screen positioning
  const minTop = safeTopMargin;
  const maxTop = finalH - safeBottomMargin - scaledTotalTextH;
  top = Math.max(minTop, Math.min(targetTop, maxTop));
  
  // Clamp horizontal positioning
  left = Math.max(0, Math.min(left, finalW - dispW));
  
  // V2: avoid finalScale double-correction; single scale factor only
  const finalDispW = dispW;
  const finalDispH = dispH;
  left = anchorX;
  top = targetTop;
  if (align === 'center') left -= finalDispW / 2;
  else if (align === 'right') left -= finalDispW;
  const finalScaledTextH = scaledTotalTextH;
  left = Math.max(0, Math.min(left, finalW - finalDispW));
  top = Math.max(safeTopMargin, Math.min(top, finalH - safeBottomMargin - finalScaledTextH));
  
  // TASK 4: Debug logging with actual container dimensions
  console.log('[preview-overlay] positioning:', {
    W: finalW, H: finalH, iw: captionData.meta?.wPx, iH: captionData.meta?.hPx,
    dispW: finalDispW, dispH: finalDispH, align, placement, yPct,
    finalScale: s, scaledTotalTextH, totalTextH, left, top, targetTop,
    safeTopMargin, safeBottomMargin,
    serverAnchorY, serverTextBlockTop, 'usingServerPositioning': serverTextBlockTop !== undefined
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
}
