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
  
  // Use server's yPct directly for precise positioning (not hardcoded placement logic)
  let topCss;
  if (captionData.meta?.yPct !== undefined && captionData.meta?.yPct !== null) {
    // Use server's precise yPct positioning
    topCss = captionData.meta.yPct * previewH;
    console.debug('[preview-overlay] Using server yPct:', {
      yPct: captionData.meta.yPct,
      previewH: previewH,
      topCss: topCss
    });
  } else {
    // Fallback to placement-based positioning
    const padPx = 24; // Small pixel padding
    switch (placement.toLowerCase()) {
      case 'top':
        topCss = padPx;
        break;
      case 'bottom':
        topCss = previewH - (captionData.meta?.hPx || 1920) * scaleY - padPx;
        break;
      case 'center':
      default:
        topCss = (previewH - (captionData.meta?.hPx || 1920) * scaleY) / 2;
        break;
    }
  }
  
  // Clamp within frame bounds
  topCss = Math.max(0, Math.min(topCss, previewH - (captionData.meta?.hPx || 1920) * scaleY));
  
  // Always size the overlay to the *preview frame* (same aspect 1080x1920)
  overlay.style.cssText = `
    position: absolute;
    left: 0;
    top: 0;
    width: ${previewW}px;
    height: ${previewH}px;
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
