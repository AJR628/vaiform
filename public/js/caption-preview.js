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
  const fontPx = Math.max(24, Math.min(200, Number(opts.sizePx || 48)));
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
      canvasH: 1920
    }
  };

  console.log("[caption-overlay] POST /preview/caption");
  const data = await apiFetch("/preview/caption", {
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

  const img = document.getElementById("captionOverlay");
  if (img) { img.src = imageUrl; img.style.display = "block"; }
  
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
  
  // TASK 2: Scale totalTextH with single scale factor
  const scaledTotalTextH = totalTextH * s;
  
  // Define safe margins to prevent clipping (5% top, 8% bottom)
  const safeTopMargin = previewH * 0.05;
  const safeBottomMargin = previewH * 0.08;
  
  // TASK 3: Correct vertical placement math with clamping
  // Calculate anchor points using server-computed positioning
  const anchorX = (xPct / 100) * finalW;
  const anchorY = yPct * finalH;
  
  // Calculate position based on alignment - use text-aware positioning
  let left = anchorX;
  let top = anchorY;
  
  // Horizontal alignment
  if (align === 'center') left -= dispW / 2;
  else if (align === 'right') left -= dispW;
  
  // TASK 3: Vertical alignment with proper clamping
  const scaledPadding = internalPadding * s;
  const pad = 48 * s; // Server px padding scaled to CSS
  
  if (vAlign === 'center') {
    // Center the text block at anchorY by subtracting half the height
    top = anchorY - (scaledTotalTextH / 2) - scaledPadding;
  } else if (vAlign === 'bottom') {
    // Position text block above anchorY
    top = anchorY - scaledTotalTextH - scaledPadding;
  } else {
    // top alignment - position text block below anchorY
    top = anchorY - scaledPadding;
  }
  
  // TASK 3: Clamp with padding to prevent off-screen positioning
  const minTop = pad;
  const maxTop = finalH - pad - scaledTotalTextH;
  top = Math.max(minTop, Math.min(maxTop, top));
  
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
  top = anchorY;
  
  // Horizontal alignment
  if (align === 'center') left -= finalDispW / 2;
  else if (align === 'right') left -= finalDispW;
  
  // TASK 2: Vertical alignment using single scale factor
  const finalScaledTextH = scaledTotalTextH * finalScale;
  const finalScaledPadding = scaledPadding * finalScale;
  if (vAlign === 'center') top -= (finalScaledTextH / 2) + finalScaledPadding;
  else if (vAlign === 'bottom') top -= finalScaledTextH + finalScaledPadding;
  
  // TASK 4: Final clamp with safe margins using actual container dimensions
  left = Math.max(0, Math.min(left, finalW - finalDispW));
  top = Math.max(safeTopMargin, Math.min(top, finalH - safeBottomMargin - finalScaledTextH));
  
  // TASK 4: Debug logging with actual container dimensions
  console.log('[preview-overlay] positioning:', {
    W: finalW, H: finalH, // Actual container dimensions
    iW: captionData.meta?.wPx || 1080, iH: captionData.meta?.hPx || 1920,
    dispW: finalDispW, dispH: finalDispH,
    scaledTotalTextH, finalScaledTextH,
    s, finalScale, // Single scale factor
    safeTopMargin, safeBottomMargin,
    xPct, yPct, align, vAlign,
    left, top,
    computedYPct: yPct,
    totalTextH: totalTextH,
    placement: captionData.meta?.placement
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
