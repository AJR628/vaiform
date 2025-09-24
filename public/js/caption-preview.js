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

  const payload = {
    style: {
      text: opts.text,
      fontFamily: opts.fontFamily || "DejaVuSans",
      fontWeight: opts.weight === "bold" ? 700 : 400,
      fontPx: Number(opts.sizePx || 48),
      lineSpacingPx: Math.min(100, Math.round(Number(opts.sizePx || 48) * Number(opts.lineHeight || 1.1))),
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
  
  // Calculate scale factors for CSS size scaling (not canvas backing size)
  const scaleX = previewW / 1080; // CSS size to PNG native size
  const scaleY = previewH / 1920;
  
  // Create overlay image element
  const overlay = document.createElement('img');
  overlay.src = captionData.dataUrl || captionData.imageUrl;
  overlay.className = 'caption-overlay';
  
  // Scale overlay size with scale = previewW / 1080
  // Use consistent scaling to match the background image
  const scale = previewW / 1080;
  const scaleFactor = scale; // Use exact scale to match background
  const dispW = (captionData.meta?.wPx || 1080) * scaleFactor;
  const dispH = (captionData.meta?.hPx || 1920) * scaleFactor;
  
  // Use server-provided dimensions for accurate positioning
  const xPct = captionData.meta?.xPct || 50;
  const yPct = captionData.meta?.yPct || 0.5;
  const totalTextH = captionData.meta?.totalTextH || captionData.meta?.hPx || 0;
  const align = captionData.meta?.align || 'center';
  const vAlign = captionData.meta?.vAlign || 'center';
  const internalPadding = captionData.meta?.internalPadding || 0;
  
  // Scale totalTextH with preview scale for proper height calculation
  const scaledTotalTextH = totalTextH * scaleFactor;
  
  // Define safe margins to prevent clipping (5% top, 8% bottom)
  const safeTopMargin = previewH * 0.05;
  const safeBottomMargin = previewH * 0.08;
  
  // Calculate anchor points using server-computed positioning
  const anchorX = (xPct / 100) * previewW;
  const anchorY = yPct * previewH;
  
  // Calculate position based on alignment - use text-aware positioning
  let left = anchorX;
  let top = anchorY;
  
  // Horizontal alignment
  if (align === 'center') left -= dispW / 2;
  else if (align === 'right') left -= dispW;
  
  // Vertical alignment - use text height for proper centering, accounting for internal padding
  const scaledPadding = internalPadding * scaleFactor;
  if (vAlign === 'center') {
    top = anchorY - (scaledTotalTextH / 2) - scaledPadding;
  } else if (vAlign === 'bottom') {
    top = anchorY - scaledTotalTextH - scaledPadding;
  } else {
    // top alignment
    top = anchorY - scaledPadding;
  }
  
  // Clamp positioning using safe margins and text height
  left = Math.max(0, Math.min(left, previewW - dispW));
  
  // Use safe margins and text height for proper clamping
  const minTop = safeTopMargin;
  const maxTop = previewH - safeBottomMargin - scaledTotalTextH;
  top = Math.max(minTop, Math.min(maxTop, top));
  
  // Add final visual clamp if overlay is larger than frame
  let finalScale = 1;
  if (dispW > previewW || dispH > previewH) {
    finalScale = Math.min(previewW / dispW, previewH / dispH);
  }
  
  const finalDispW = dispW * finalScale;
  const finalDispH = dispH * finalScale;
  
  // Recalculate position with final scale using text-aware positioning
  left = anchorX;
  top = anchorY;
  
  // Horizontal alignment
  if (align === 'center') left -= finalDispW / 2;
  else if (align === 'right') left -= finalDispW;
  
  // Vertical alignment using scaled text height and padding
  const finalScaledTextH = scaledTotalTextH * finalScale;
  const finalScaledPadding = scaledPadding * finalScale;
  if (vAlign === 'center') top -= (finalScaledTextH / 2) + finalScaledPadding;
  else if (vAlign === 'bottom') top -= finalScaledTextH + finalScaledPadding;
  
  // Final clamp with safe margins
  left = Math.max(0, Math.min(left, previewW - finalDispW));
  top = Math.max(safeTopMargin, Math.min(top, previewH - safeBottomMargin - finalScaledTextH));
  
  // Debug logging to verify calculations
  console.log('[preview-overlay] positioning:', {
    W: previewW, H: previewH,
    iW: captionData.meta?.wPx || 1080, iH: captionData.meta?.hPx || 1920,
    dispW: finalDispW, dispH: finalDispH,
    scaledTotalTextH, finalScaledTextH,
    scaleFactor, finalScale,
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
