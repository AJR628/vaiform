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
    text: opts.text,
    width: 1080,
    height: 1920,
    fontFamily: opts.fontFamily || "DejaVu Sans Local",
    weightCss: opts.weight || "bold",
    fontPx: Number(opts.sizePx || 48),
    color: opts.color || "#FFFFFF",
    opacity: Number(opts.opacity ?? 0.85),
    shadow: !!opts.shadow,
    showBox: !!opts.showBox,            // keep false to remove gray box
    boxColor: opts.boxColor || "rgba(0,0,0,0.35)",
    placement: opts.placement || "center",
    lineHeight: Number(opts.lineHeight || 1.1),
    padding: Number(opts.padding || 24),
    maxWidthPct: Number(opts.maxWidthPct || 0.8),
    borderRadius: Number(opts.borderRadius || 16)
  };

  console.log("[caption-overlay] POST /caption/preview");
  const data = await apiFetch("/caption/preview", {
    method: "POST",
    body: payload
  });
  if (!data?.success) throw new Error(data?.detail || data?.error || "Preview generation failed");

  lastCaptionPNG = { 
    dataUrl: data.dataUrl, 
    width: data.width, 
    height: data.height,
    meta: data.meta 
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
  const scale = previewW / 1080;
  const dispW = (captionData.meta?.wPx || 1080) * scale;
  const dispH = (captionData.meta?.hPx || 1920) * scale;
  
  // Apply anchor-aware math using server meta
  const xPct = captionData.meta?.xPct || 50;
  const yPct = captionData.meta?.yPct || 0.5;
  const align = captionData.meta?.align || 'center';
  const vAlign = captionData.meta?.vAlign || 'center';
  
  // Calculate anchor points
  const anchorX = (xPct / 100) * previewW;
  const anchorY = yPct * previewH;
  
  // Calculate position based on alignment
  let left = anchorX;
  let top = anchorY;
  
  if (align === 'center') left -= dispW / 2;
  else if (align === 'right') left -= dispW;
  
  if (vAlign === 'center') top -= dispH / 2;
  else if (vAlign === 'bottom') top -= dispH;
  
  // Final clamp to keep overlay within frame bounds
  left = Math.max(0, Math.min(left, previewW - dispW));
  top = Math.max(0, Math.min(top, previewH - dispH));
  
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
    xPct, yPct, align, vAlign,
    left, top
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
