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
 * Compute single scale factor from container to frame space
 */
function computePreviewScale() {
  const container = document.getElementById('live-preview-container');
  if (!container) return 1;
  
  const containerCssW = container.clientWidth;
  const containerCssH = container.clientHeight;
  const frameW = 1080;
  const frameH = 1920;
  
  const scale = containerCssW / frameW;
  
  // Sanity check: aspect ratio should match
  const scaleH = containerCssH / frameH;
  if (Math.abs(scaleH - scale) > 0.01) {
    console.warn('[parity] Aspect ratio mismatch:', { scale, scaleH });
  }
  
  return scale;
}

/**
 * Apply caption styles to live text element using server SSOT values
 */
function applyStylesToLiveText(element, captionState, serverMeta) {
  const scale = computePreviewScale();
  const frameW = 1080;
  
  // Use server SSOT values when available
  const fontPx = serverMeta?.fontPx || captionState.fontPx;
  const lineSpacingPx = serverMeta?.lineSpacingPx || captionState.lineSpacingPx;
  const yPx_png = serverMeta?.yPx_png;
  const wPct = serverMeta?.wPct || captionState.wPct || 0.8;
  const letterSpacingPx = captionState.letterSpacingPx || 0;
  
  // Scale all values with single scalar
  const cssWidthPx = wPct * frameW * scale;
  const cssFontSizePx = fontPx * scale;
  const cssLetterSpacingPx = letterSpacingPx * scale;
  const cssLineHeightPx = (fontPx + lineSpacingPx) * scale; // PIXEL-BASED
  
  // Position using server's absolute yPx_png
  const cssTopPx = yPx_png !== undefined ? yPx_png * scale : undefined;
  
  // Log parity data
  console.log('[parity:preview]', {
    containerCssW: document.getElementById('live-preview-container')?.clientWidth,
    containerCssH: document.getElementById('live-preview-container')?.clientHeight,
    frameW, frameH, scale,
    wPct,
    computed: {
      cssWidthPx: Math.round(cssWidthPx),
      cssFontSizePx: Math.round(cssFontSizePx),
      cssLineHeightPx: Math.round(cssLineHeightPx),
      cssLetterSpacingPx: Math.round(cssLetterSpacingPx),
      cssTopPx_from_yPx_png: cssTopPx ? Math.round(cssTopPx) : 'N/A'
    },
    server: {
      fontPx, lineSpacingPx, yPx_png,
      rasterW: serverMeta?.rasterW,
      rasterH: serverMeta?.rasterH,
      previewFontString: serverMeta?.previewFontString
    }
  });
  
  // Apply CSS with exact pixel values
  element.style.position = 'absolute';
  element.style.width = `${cssWidthPx}px`;
  element.style.fontSize = `${cssFontSizePx}px`;
  element.style.lineHeight = `${cssLineHeightPx}px`; // NOT unitless
  element.style.letterSpacing = `${cssLetterSpacingPx}px`;
  
  if (cssTopPx !== undefined) {
    element.style.top = `${cssTopPx}px`;
  }
  
  // Center horizontally (match server's xExpr_png)
  element.style.left = '50%';
  element.style.transform = 'translateX(-50%)';
  
  // Font must match server exactly
  element.style.fontFamily = '"DejaVu Sans", sans-serif';
  element.style.fontWeight = '700'; // bold
  element.style.fontStyle = 'normal';
  
  // Other styles from captionState
  element.style.textAlign = captionState.textAlign || 'center';
  element.style.textTransform = captionState.textTransform || 'none';
  element.style.color = captionState.color || 'white';
  element.style.opacity = captionState.opacity || 1;
  
  // Effects - scale stroke and shadow values
  if (captionState.strokePx > 0) {
    const scaledStrokePx = captionState.strokePx * scale;
    element.style.webkitTextStroke = `${scaledStrokePx}px ${captionState.strokeColor}`;
    element.style.textStroke = `${scaledStrokePx}px ${captionState.strokeColor}`;
  } else {
    element.style.webkitTextStroke = 'none';
    element.style.textStroke = 'none';
  }
  
  if (captionState.shadowBlur > 0) {
    const shadowX = (captionState.shadowOffsetX || 0) * scale;
    const shadowY = (captionState.shadowOffsetY || 0) * scale;
    const shadowBlur = captionState.shadowBlur * scale;
    element.style.textShadow = `${shadowX}px ${shadowY}px ${shadowBlur}px ${captionState.shadowColor}`;
  } else {
    element.style.textShadow = 'none';
  }
  
  // Update debug watermark if present
  const watermark = document.getElementById('preview-debug-watermark');
  if (watermark && window.location.search.includes('debug=1')) {
    watermark.style.display = 'block';
    document.getElementById('dbg-scale').textContent = scale.toFixed(3);
    document.getElementById('dbg-fontPx').textContent = fontPx;
    document.getElementById('dbg-lineSpacingPx').textContent = lineSpacingPx;
    document.getElementById('dbg-yPx').textContent = yPx_png || 'N/A';
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

  // Store server SSOT for live layer
  window.__serverCaptionMeta = meta;
  
  // Apply server meta to live layer immediately
  const liveEl = document.getElementById('caption-live');
  if (liveEl && meta) {
    // Get current caption state for fallback values
    const currentState = {
      text: liveEl.textContent || '',
      fontPx: 48, // fallback
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
    
    applyStylesToLiveText(liveEl, currentState, meta);
  }

  // Geometry lock check before PNG swap
  const scale = computePreviewScale();
  const frameW = 1080;
  
  // Get current state for comparison
  const currentFontPx = 48; // TODO: Get from current state
  const currentLineSpacingPx = 8; // TODO: Get from current state
  const currentWPct = 0.8; // TODO: Get from current state
  
  const serverFontPx = meta.fontPx;
  const serverLineSpacingPx = meta.lineSpacingPx;
  const serverWPct = meta.wPct || 0.8;
  
  if (Math.abs(currentFontPx - serverFontPx) > 1 ||
      Math.abs(currentLineSpacingPx - serverLineSpacingPx) > 1 ||
      Math.abs(currentWPct - serverWPct) > 0.01) {
    console.log('[preview-swap] geometry mismatch, skipping', {
      current: { fontPx: currentFontPx, lineSpacingPx: currentLineSpacingPx, wPct: currentWPct },
      server: { fontPx: serverFontPx, lineSpacingPx: serverLineSpacingPx, wPct: serverWPct }
    });
    return; // Keep live text
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

    // Apply styles to live text - use server meta if available
    const serverMeta = window.__serverCaptionMeta;
    applyStylesToLiveText(liveEl, captionState, serverMeta);
    
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

  // Apply styles - use server meta if available
  const serverMeta = window.__serverCaptionMeta;
  applyStylesToLiveText(liveEl, captionState, serverMeta);
  
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
