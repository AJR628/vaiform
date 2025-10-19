/**
 * Hybrid Caption Preview System
 * 
 * Provides live-editable text with debounced PNG swap for raster parity.
 * - Live text shows instantly while typing
 * - After 350ms pause, calls /api/caption/preview
 * - If response matches current inputs, swaps to PNG (no visual jump)
 * - Maintains font parity with server using DejaVu Sans
 */

import { apiFetch } from "../api.mjs";
// Use native Web Crypto API instead of crypto-js
const crypto = {
  SHA256: async (str) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return { toString: () => hashArray.map(b => b.toString(16).padStart(2, '0')).join('') };
  }
};

let debounceTimer = null;
let inFlightFingerprint = null;
let currentFingerprint = null;
let fontsReady = false;

// Font load gating - wait for DejaVu fonts before first layout
async function ensureFontsReady() {
  if (fontsReady) return true;
  
  try {
    console.log('[caption-live] Waiting for fonts to load...');
    await document.fonts.ready;
    fontsReady = true;
    console.log('[caption-live] fonts.ready=true before first layout');
    return true;
  } catch (error) {
    console.warn('[caption-live] Font loading failed:', error);
    fontsReady = true; // Continue anyway
    return true;
  }
}

/**
 * Generate fingerprint for current caption state
 */
function generateFingerprint(captionState) {
  const {
    text,
    fontPx,
    lineSpacingPx,
    letterSpacingPx,
    fontFamily,
    weightCss,
    textAlign,
    textTransform,
    color,
    opacity,
    strokePx,
    strokeColor,
    shadowColor,
    shadowBlur,
    shadowOffsetX,
    shadowOffsetY
  } = captionState;

  const fingerprintData = [
    text,
    fontPx,
    lineSpacingPx,
    letterSpacingPx,
    fontFamily,
    weightCss,
    textAlign,
    textTransform,
    color,
    opacity,
    strokePx,
    strokeColor,
    shadowColor,
    shadowBlur,
    shadowOffsetX,
    shadowOffsetY
  ].join('|');

  return crypto.SHA1(fingerprintData).toString();
}

/**
 * Apply caption styles to live text element
 */
function applyStylesToLiveText(element, captionState) {
  const {
    fontPx,
    lineSpacingPx,
    letterSpacingPx,
    fontFamily,
    weightCss,
    textAlign,
    textTransform,
    color,
    opacity,
    strokePx,
    strokeColor,
    shadowColor,
    shadowBlur,
    shadowOffsetX,
    shadowOffsetY
  } = captionState;

  // Base typography
  element.style.fontFamily = `"${fontFamily}", sans-serif`;
  element.style.fontSize = `${fontPx}px`;
  element.style.fontWeight = weightCss === 'bold' || weightCss === 700 ? '700' : '400';
  element.style.textAlign = textAlign || 'center';
  element.style.textTransform = textTransform || 'none';
  element.style.letterSpacing = `${letterSpacingPx}px`;
  element.style.lineHeight = lineSpacingPx > 0 ? `${fontPx + lineSpacingPx}px` : '1.15';
  
  // Color and opacity
  element.style.color = color || 'white';
  element.style.opacity = opacity || 1;
  
  // Stroke (CSS text-stroke approximation)
  if (strokePx > 0) {
    element.style.webkitTextStroke = `${strokePx}px ${strokeColor}`;
    element.style.textStroke = `${strokePx}px ${strokeColor}`;
  } else {
    element.style.webkitTextStroke = 'none';
    element.style.textStroke = 'none';
  }
  
  // Shadow
  if (shadowBlur > 0) {
    element.style.textShadow = `${shadowOffsetX}px ${shadowOffsetY}px ${shadowBlur}px ${shadowColor}`;
  } else {
    element.style.textShadow = 'none';
  }
}

/**
 * Show live text layer and hide PNG layer
 */
function showLiveText() {
  const liveEl = document.getElementById('caption-live');
  const pngEl = document.getElementById('preview-raster-img');
  
  if (liveEl) liveEl.style.display = 'block';
  if (pngEl) pngEl.style.display = 'none';
}

/**
 * Show PNG layer and hide live text layer
 */
function showPngPreview() {
  const liveEl = document.getElementById('caption-live');
  const pngEl = document.getElementById('preview-raster-img');
  
  if (liveEl) liveEl.style.display = 'none';
  if (pngEl) pngEl.style.display = 'block';
}

/**
 * Call server preview API with current caption state
 */
async function callPreviewAPI(captionState, fingerprint) {
  try {
    console.log('[v3:client:POST]', { 
      ssotVersion: 3, 
      mode: "raster", 
      hasRaster: true,
      fingerprint: fingerprint.slice(0, 8) + '...'
    });

    const payload = {
      ssotVersion: 3,
      text: captionState.text,
      placement: 'custom',
      xPct: captionState.xPct || 0.5,
      yPct: captionState.yPct || 0.5,
      wPct: captionState.wPct || 0.8,
      sizePx: captionState.fontPx,
      fontFamily: captionState.fontFamily,
      weightCss: captionState.weightCss,
      fontStyle: captionState.fontStyle || 'normal',
      color: captionState.color,
      opacity: captionState.opacity,
      textAlign: captionState.textAlign,
      letterSpacingPx: captionState.letterSpacingPx,
      textTransform: captionState.textTransform,
      strokePx: captionState.strokePx,
      strokeColor: captionState.strokeColor,
      shadowColor: captionState.shadowColor,
      shadowBlur: captionState.shadowBlur,
      shadowOffsetX: captionState.shadowOffsetX,
      shadowOffsetY: captionState.shadowOffsetY
    };

    const response = await apiFetch("/caption/preview", {
      method: "POST",
      body: payload
    });

    if (!response?.ok) {
      throw new Error(response?.detail || response?.reason || "Preview generation failed");
    }

    return response.data;
  } catch (error) {
    console.error('[caption-live] Preview API failed:', error);
    throw error;
  }
}

/**
 * Handle preview response and swap to PNG if fingerprint matches
 */
function handlePreviewResponse(response, fingerprint) {
  // Check if this response is still relevant
  if (fingerprint !== currentFingerprint) {
    console.log('[preview-swap] Fingerprint mismatch - discarding stale response');
    return;
  }

  const { imageUrl, meta } = response;
  
  // Validate response format
  if (!meta || meta.ssotVersion !== 3 || meta.mode !== 'raster') {
    console.warn('[preview-swap] Invalid response format:', meta);
    return;
  }

  // Check font hash if provided
  if (meta.previewFontHash) {
    // TODO: Compare with expected font hash if we implement font verification
  }

  // Swap to PNG
  const pngEl = document.getElementById('preview-raster-img');
  if (pngEl && imageUrl) {
    pngEl.src = imageUrl;
    
    // Scale and position the PNG to match the preview container
    const container = document.getElementById('live-preview-container');
    if (container) {
      const containerRect = container.getBoundingClientRect();
      const scale = containerRect.width / (meta.frameW || 1080);
      
      pngEl.style.width = `${(meta.rasterW || 400) * scale}px`;
      pngEl.style.height = `${(meta.rasterH || 200) * scale}px`;
      pngEl.style.left = `${(containerRect.width - (meta.rasterW || 400) * scale) / 2}px`;
      pngEl.style.top = `${(meta.yPx_png || 0) * scale}px`;
    }
    
    showPngPreview();
    console.log('[preview-swap] matching fingerprint → swapping to PNG');
  }
}

/**
 * Debounced preview generation
 */
function debouncedPreview(captionState) {
  // Clear existing timer
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  // Show live text immediately
  showLiveText();
  
  // Generate new fingerprint
  const fingerprint = generateFingerprint(captionState);
  currentFingerprint = fingerprint;

  // Start debounce timer
  debounceTimer = setTimeout(async () => {
    try {
      // Check if fonts are ready before calling API
      await ensureFontsReady();
      
      // Check if fingerprint is still current
      if (fingerprint !== currentFingerprint) {
        console.log('[preview-swap] Fingerprint changed during debounce - skipping');
        return;
      }

      inFlightFingerprint = fingerprint;
      const response = await callPreviewAPI(captionState, fingerprint);
      handlePreviewResponse(response, fingerprint);
    } catch (error) {
      console.error('[caption-live] Debounced preview failed:', error);
      // Keep showing live text on error
    } finally {
      inFlightFingerprint = null;
    }
  }, 350); // 350ms debounce
}

/**
 * Initialize hybrid caption preview system
 */
export async function initHybridCaptionPreview() {
  // Wait for fonts to be ready
  await ensureFontsReady();
  
  const liveEl = document.getElementById('caption-live');
  if (!liveEl) {
    console.warn('[caption-live] Live text element not found');
    return;
  }

  // Set up event listeners for live editing
  liveEl.addEventListener('input', (e) => {
    const captionState = {
      text: e.target.textContent || '',
      fontPx: 48, // Default - should be synced with actual caption settings
      lineSpacingPx: 8,
      letterSpacingPx: 0,
      fontFamily: 'DejaVu Sans',
      weightCss: 'bold',
      textAlign: 'center',
      textTransform: 'none',
      color: 'white',
      opacity: 0.85,
      strokePx: 3,
      strokeColor: 'rgba(0,0,0,0.85)',
      shadowColor: 'rgba(0,0,0,0.6)',
      shadowBlur: 12,
      shadowOffsetX: 0,
      shadowOffsetY: 2,
      xPct: 0.5,
      yPct: 0.5,
      wPct: 0.8
    };

    // Apply styles to live text
    applyStylesToLiveText(liveEl, captionState);
    
    // Trigger debounced preview
    debouncedPreview(captionState);
  });

  console.log('[caption-live] Hybrid preview system initialized');
}

/**
 * Update caption state from external source (e.g., caption overlay system)
 */
export function updateCaptionState(captionState) {
  const liveEl = document.getElementById('caption-live');
  if (!liveEl) return;

  // Update text content
  if (captionState.text !== undefined) {
    liveEl.textContent = captionState.text;
  }

  // Apply styles
  applyStylesToLiveText(liveEl, captionState);
  
  // Trigger debounced preview
  debouncedPreview(captionState);
}

/**
 * Show/hide hybrid preview layers
 */
export function setHybridPreviewVisible(visible) {
  const liveEl = document.getElementById('caption-live');
  const pngEl = document.getElementById('preview-raster-img');
  
  if (visible) {
    // Show live text by default
    showLiveText();
  } else {
    if (liveEl) liveEl.style.display = 'none';
    if (pngEl) pngEl.style.display = 'none';
  }
}

// Make functions globally available for integration
if (typeof window !== 'undefined') {
  window.initHybridCaptionPreview = initHybridCaptionPreview;
  window.updateCaptionState = updateCaptionState;
  window.setHybridPreviewVisible = setHybridPreviewVisible;
}
