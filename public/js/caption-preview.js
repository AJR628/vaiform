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
      dataUrl: data.dataUrl,
      width: data.width,
      height: data.height,
      meta: data.meta || {}
    };
  }

  const img = document.getElementById("captionOverlay");
  if (img) { img.src = data.dataUrl; img.style.display = "block"; }
  
  // Expose preview canvas height for scaling calculations
  if (typeof window !== 'undefined') {
    window.__vaiform_previewHeightPx = data.height;
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
  // Use a less aggressive scaling factor to maintain text legibility
  const scale = previewW / 1080;
  const scaleFactor = Math.max(0.5, scale); // Minimum 50% scale to keep text readable
  const dispW = (captionData.meta?.wPx || 1080) * scaleFactor;
  const dispH = (captionData.meta?.hPx || 1920) * scaleFactor;
  
  // Apply anchor-aware math using server meta
  const xPct = captionData.meta?.xPct || 50;
  // Compute yPct if missing from server meta (critical fix for positioning)
  const yPct = captionData.meta?.yPct ?? (typeof captionData.meta?.yPx === 'number' && previewH ? captionData.meta.yPx / previewH : 0.5);
  const totalTextH = captionData.meta?.totalTextH ?? (typeof captionData.meta?.hPx === 'number' ? captionData.meta.hPx : 0);
  const align = captionData.meta?.align || 'center';
  const vAlign = captionData.meta?.vAlign || 'center';
  
  // Scale totalTextH with preview scale for proper height calculation
  const scaledTotalTextH = totalTextH * scaleFactor;
  
  // Calculate anchor points using server-computed yPct
  const anchorX = (xPct / 100) * previewW;
  const anchorY = yPct * previewH;
  
  // Calculate position based on alignment
  let left = anchorX;
  let top = anchorY;
  
  if (align === 'center') left -= dispW / 2;
  else if (align === 'right') left -= dispW;
  
  // Use the server-computed yPct directly for positioning
  // The server already accounts for placement, so we just center the overlay
  top = anchorY - (dispH / 2);
  
  // Clamp positioning to prevent clipping above/below preview bounds
  left = Math.max(0, Math.min(left, previewW - dispW));
  top = Math.max(0, Math.min(top, previewH - dispH));
  
  // Additional clamp to ensure text doesn't get cut off at edges
  const minTop = Math.max(0, top);
  const maxTop = Math.min(previewH - scaledTotalTextH, top);
  top = Math.max(minTop, maxTop);
  
  // Add final visual clamp if overlay is larger than frame
  let finalScale = 1;
  if (dispW > previewW || dispH > previewH) {
    finalScale = Math.min(previewW / dispW, previewH / dispH);
  }
  
  const finalDispW = dispW * finalScale;
  const finalDispH = dispH * finalScale;
  
  // Recalculate position with final scale
  left = anchorX;
  top = anchorY;
  if (align === 'center') left -= finalDispW / 2;
  else if (align === 'right') left -= finalDispW;
  if (vAlign === 'center') top -= finalDispH / 2;
  else if (vAlign === 'bottom') top -= finalDispH;
  
  // Final clamp
  left = Math.max(0, Math.min(left, previewW - finalDispW));
  top = Math.max(0, Math.min(top, previewH - finalDispH));
  
  // Debug logging to verify calculations
  console.log('[preview-overlay] positioning:', {
    W: previewW, H: previewH,
    iW: captionData.meta?.wPx || 1080, iH: captionData.meta?.hPx || 1920,
    dispW: finalDispW, dispH: finalDispH,
    scaledTotalTextH,
    scaleFactor,
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
