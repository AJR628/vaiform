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
export async function generateCaptionPreview(opts) {
  // Clear overlay if text is empty
  if (!opts.text || !opts.text.trim()) {
    if (typeof window !== 'undefined') {
      window.__lastCaptionOverlay = null;
    }
    return;
  }

  // TASK 1: Clamp fontPx and lineSpacingPx to prevent HTTP 400 errors
  // If fontPx wasn't provided by caller, pull the current slider-mapped px from UI.
  // This preserves SSOT (server still clamps), but avoids the 48px server default.
  const ensureFontPx =
    Number.isFinite(opts?.fontPx) ? opts.fontPx
    : (typeof window?.getCaptionPx === 'function' ? Number(window.getCaptionPx()) : undefined);

  const fontPx = Math.max(24, Math.min(200, Number(ensureFontPx || opts.sizePx || 48)));
  const lineSpacingPx = Math.max(24, Math.min(200, Math.round(fontPx * Number(opts.lineHeight || 1.1))));
  
  const payload = {
    style: {
      text: opts.text,
      fontFamily: opts.fontFamily || "DejaVuSans",
      fontWeight: opts.weight === "bold" ? 700 : 400,
      fontPx: fontPx,
      lineSpacingPx: lineSpacingPx,
      align: "center",
      textAlpha: Number(opts.opacity ?? 0.85),
      fill: opts.color || "rgba(255,255,255,1)",
      strokePx: 3,
      strokeColor: "rgba(0,0,0,0.85)",
      shadowX: 0,
      shadowY: 2,
      shadowBlur: 4,
      shadowColor: "rgba(0,0,0,0.55)",
      boxXPx: 42,
      boxYPx: opts.placement === "top" ? 230 : opts.placement === "bottom" ? 1500 : 960,
      boxWPx: 996,
      boxHPx: 400,
      canvasW: 1080,
      canvasH: 1920,
      placement: opts.placement || 'center',
      yPct: opts.yPct || 0.5
    }
  };

  console.log("[caption-overlay] POST /preview/caption with placement:", opts.placement, "yPct:", opts.yPct);
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
  
  // TASK 2: Use one scale everywhere - compute single scale factor from server px to CSS px
  const serverFrameW = 1080;  // Server frame width in pixels
  const serverFrameH = Math.round(serverFrameW * (finalH / finalW)); // Server frame height maintaining aspect
  
  const sx = finalW / serverFrameW;
  const sy = finalH / serverFrameH;
  const s = Math.min(sx, sy); // Keep aspect safe; we're full-frame so sx≈sy
  
  // Create overlay image element
  const overlay = document.createElement('img');
  overlay.src = captionData.dataUrl || captionData.imageUrl;
  overlay.className = 'caption-overlay';
  
  // Convert all overlay geometry to CSS with single scale factor
  const dispW = (captionData.meta?.wPx || 1080) * s;
  const dispH = (captionData.meta?.hPx || 1920) * s;
  
  // Use server-provided dimensions for accurate positioning
  const xPct = captionData.meta?.xPct || 50;
  const yPct = captionData.meta?.yPct || 0.5;
  const totalTextH = captionData.meta?.totalTextH || captionData.meta?.hPx || 0;
  const align = captionData.meta?.align || 'center';
  const vAlign = captionData.meta?.vAlign || 'center';
  const internalPadding = captionData.meta?.internalPadding || 0;
  const lineSpacingPx = captionData.meta?.lineSpacingPx ?? captionData.meta?.lineSpacing ?? 0;
  
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
  
  // Use meta.yPct for precise vertical positioning (server-computed)
  const targetTop = (yPct * finalH) - (scaledTotalTextH / 2);
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
  
  // TASK 4: Add final visual clamp if overlay is larger than frame
  let finalScale = 1;
  if (dispW > finalW || dispH > finalH) {
    finalScale = Math.min(finalW / dispW, finalH / dispH);
  }
  
  const finalDispW = dispW * finalScale;
  const finalDispH = dispH * finalScale;
  
  // Recalculate position with final scale using text-aware positioning
  left = anchorX;
  top = targetTop; // Use computed targetTop instead of undefined anchorY
  
  // Horizontal alignment
  if (align === 'center') left -= finalDispW / 2;
  else if (align === 'right') left -= finalDispW;
  
  // TASK 2: Vertical alignment using single scale factor
  const finalScaledTextH = scaledTotalTextH * finalScale;
  const scaledPadding = internalPadding * s;
  const finalScaledPadding = scaledPadding * finalScale;
  if (vAlign === 'center') top -= (finalScaledTextH / 2) + finalScaledPadding;
  else if (vAlign === 'bottom') top -= finalScaledTextH + finalScaledPadding;
  
  // TASK 4: Final clamp with safe margins using actual container dimensions
  left = Math.max(0, Math.min(left, finalW - finalDispW));
  top = Math.max(safeTopMargin, Math.min(top, finalH - safeBottomMargin - finalScaledTextH));
  
  // TASK 4: Debug logging with actual container dimensions
  console.log('[preview-overlay] positioning:', {
    W: finalW, H: finalH, iw: captionData.meta?.wPx, iH: captionData.meta?.hPx,
    dispW: finalDispW, dispH: finalDispH, align, placement, yPct,
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
