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
 * Create and update debug HUD when ?debug=1 is present
 */
function createDebugHUD() {
  if (!window.location.search.includes('debug=1')) return null;
  
  let hud = document.getElementById('preview-debug-watermark');
  if (hud) return hud;
  
  hud = document.createElement('div');
  hud.id = 'preview-debug-watermark';
  hud.style.cssText = `
    position: fixed; top: 10px; right: 10px;
    background: rgba(0,0,0,0.85); color: #0f0;
    font-family: monospace; font-size: 11px;
    padding: 8px 12px; border-radius: 4px;
    z-index: 999999; pointer-events: none; line-height: 1.4;
  `;
  
  hud.innerHTML = `
    <div><strong>🔍 Caption Parity Debug</strong></div>
    <div>scale: <span id="dbg-scale">-</span></div>
    <div>fontPx: <span id="dbg-fontPx">-</span></div>
    <div>lineSpacingPx: <span id="dbg-lineSpacingPx">-</span></div>
    <div>yPx_png: <span id="dbg-yPx">-</span></div>
    <div>rasterW: <span id="dbg-rasterW">-</span></div>
    <div>rasterPadding: <span id="dbg-padding">-</span></div>
    <div>---</div>
    <div>Live CSS:</div>
    <div>width: <span id="dbg-live-width">-</span>px</div>
    <div>top: <span id="dbg-live-top">-</span>px</div>
    <div>fontSize: <span id="dbg-live-fontSize">-</span>px</div>
    <div>lineHeight: <span id="dbg-live-lineHeight">-</span>px</div>
    <div>padding: <span id="dbg-live-padding">-</span></div>
  `;
  
  document.body.appendChild(hud);
  return hud;
}

function updateDebugHUD(element, serverMeta, scale) {
  // Only run in debug mode
  if (!window.location.search.includes('debug=1')) return;
  
  const hud = document.getElementById('preview-debug-watermark');
  if (!hud) return;
  
  // Guard each lookup; if any are missing, bail silently
  const needIds = ['dbg-scale', 'dbg-fontPx', 'dbg-lineSpacingPx', 'dbg-yPx', 
                   'dbg-rasterW', 'dbg-padding', 'dbg-live-width', 'dbg-live-top', 
                   'dbg-live-fontSize', 'dbg-live-lineHeight'];
  for (const id of needIds) {
    if (!document.getElementById(id)) return;
  }
  
  const cs = getComputedStyle(element);
  
  document.getElementById('dbg-scale').textContent = scale.toFixed(3);
  document.getElementById('dbg-fontPx').textContent = serverMeta?.fontPx ?? '-';
  document.getElementById('dbg-lineSpacingPx').textContent = serverMeta?.lineSpacingPx ?? '-';
  document.getElementById('dbg-yPx').textContent = serverMeta?.yPx_png ?? '-';
  document.getElementById('dbg-rasterW').textContent = serverMeta?.rasterW ?? '-';
  document.getElementById('dbg-padding').textContent = serverMeta?.rasterPadding ?? serverMeta?.internalPadding ?? '-';
  
  document.getElementById('dbg-live-width').textContent = Math.round(parseFloat(cs.width));
  document.getElementById('dbg-live-top').textContent = Math.round(parseFloat(cs.top));
  document.getElementById('dbg-live-fontSize').textContent = Math.round(parseFloat(cs.fontSize));
  document.getElementById('dbg-live-lineHeight').textContent = Math.round(parseFloat(cs.lineHeight));
}

/**
 * Apply caption styles to live text element using server SSOT values
 */
function applyStylesToLiveText(element, captionState, serverMeta) {
  const scale = computePreviewScale();
  
  // ========== RASTER MODE: Mirror PNG rectangle exactly ==========
  if (serverMeta?.mode === 'raster') {
    console.log('[parity:usingRaster]', {
      rasterW: serverMeta.rasterW,
      rasterH: serverMeta.rasterH,
      yPx_png: serverMeta.yPx_png,
      rasterPadding: serverMeta.rasterPadding || serverMeta.internalPadding || 24
    });
    
    // Warn if percentage fields leak into raster mode
    if (serverMeta.wPct !== undefined || serverMeta.xPct !== undefined || serverMeta.yPct !== undefined) {
      console.warn('[parity:warning] Ignoring %-based fields in raster mode:', {
        wPct: serverMeta.wPct, xPct: serverMeta.xPct, yPct: serverMeta.yPct
      });
    }
    
    // Extract server SSOT values
    const fontPx = serverMeta.fontPx;
    const lineSpacingPx = serverMeta.lineSpacingPx;
    const rasterW = serverMeta.rasterW;
    const yPx_png = serverMeta.yPx_png;
    const P = serverMeta.rasterPadding ?? serverMeta.internalPadding ?? 24;
    const letterSpacingPx = serverMeta.letterSpacingPx || 0;
    
    // Scale all geometry to CSS pixels
    const cssWidthPx = rasterW * scale;
    const cssFontSizePx = fontPx * scale;
    const cssLineHeightPx = (fontPx + lineSpacingPx) * scale; // PIXEL value, not unitless
    const cssTopPx = yPx_png * scale;
    const cssPaddingPx = P * scale;
    const cssLetterSpacingPx = letterSpacingPx * scale;
    
    // Box sizing: border-box so padding is included in width
    element.style.boxSizing = 'border-box';
    
    // Width: exact PNG rectangle width
    element.style.width = `${cssWidthPx}px`;
    
    // Padding: top/right/left = P, bottom = 0 (matches server canvas rendering)
    // This makes text area = rasterW - 2*P (same as server)
    element.style.padding = `${cssPaddingPx}px ${cssPaddingPx}px 0 ${cssPaddingPx}px`;
    
    // Typography: exact pixel values
    element.style.fontSize = `${cssFontSizePx}px`;
    element.style.lineHeight = `${cssLineHeightPx}px`; // NOT unitless!
    element.style.letterSpacing = `${cssLetterSpacingPx}px`;
    
    // Position: PNG's top-left corner as anchor
    element.style.position = 'absolute';
    element.style.top = `${cssTopPx}px`;
    
    // Center horizontally (matches ffmpeg: xExpr_png='(W-overlay_w)/2')
    element.style.left = '50%';
    element.style.transform = 'translateX(-50%)';
    
    // Font: must match server registration
    element.style.fontFamily = '"DejaVu Sans", sans-serif';
    element.style.fontWeight = '700'; // bold
    element.style.fontStyle = serverMeta.fontStyle || 'normal';
    
    // Text properties
    element.style.textAlign = serverMeta.textAlign || 'center';
    element.style.textTransform = serverMeta.textTransform || 'none';
    element.style.color = serverMeta.color || 'white';
    element.style.opacity = serverMeta.opacity || 1;
    
    // Effects: scale stroke and shadow
    if (serverMeta.strokePx > 0) {
      const scaledStrokePx = serverMeta.strokePx * scale;
      element.style.webkitTextStroke = `${scaledStrokePx}px ${serverMeta.strokeColor}`;
      element.style.textStroke = `${scaledStrokePx}px ${serverMeta.strokeColor}`;
    } else {
      element.style.webkitTextStroke = 'none';
      element.style.textStroke = 'none';
    }
    
    if (serverMeta.shadowBlur > 0) {
      const shadowX = (serverMeta.shadowOffsetX || 0) * scale;
      const shadowY = (serverMeta.shadowOffsetY || 0) * scale;
      const shadowBlur = serverMeta.shadowBlur * scale;
      element.style.textShadow = `${shadowX}px ${shadowY}px ${shadowBlur}px ${serverMeta.shadowColor}`;
    } else {
      element.style.textShadow = 'none';
    }
    
    // Log parity diagnostics
    console.log('[parity:applied]', {
      scale: scale.toFixed(3),
      serverFontPx: fontPx,
      cssFontSizePx: Math.round(cssFontSizePx),
      serverLineSpacing: lineSpacingPx,
      cssLineHeightPx: Math.round(cssLineHeightPx),
      serverYPx: yPx_png,
      cssTopPx: Math.round(cssTopPx),
      serverRasterW: rasterW,
      cssWidthPx: Math.round(cssWidthPx),
      effectiveTextWidth: Math.round(cssWidthPx - 2 * cssPaddingPx)
    });
    
    // Update debug HUD
    createDebugHUD();
    updateDebugHUD(element, serverMeta, scale);
    
    return;
  }
  
  // ========== LEGACY MODE: percentage-based (for backward compat) ==========
  console.warn('[parity:legacy] Using legacy %-based positioning');
  const frameW = 1080;
  const wPct = serverMeta?.wPct || captionState.wPct || 0.8;
  const yPct = serverMeta?.yPct || captionState.yPct || 0.5;
  const fontPx = serverMeta?.fontPx || captionState.fontPx;
  const lineSpacingPx = serverMeta?.lineSpacingPx || captionState.lineSpacingPx;
  const letterSpacingPx = captionState.letterSpacingPx || 0;
  
  const cssWidthPx = wPct * frameW * scale;
  const cssFontSizePx = fontPx * scale;
  const cssLineHeightPx = (fontPx + lineSpacingPx) * scale;
  const cssLetterSpacingPx = letterSpacingPx * scale;
  
  element.style.position = 'absolute';
  element.style.width = `${cssWidthPx}px`;
  element.style.fontSize = `${cssFontSizePx}px`;
  element.style.lineHeight = `${cssLineHeightPx}px`;
  element.style.letterSpacing = `${cssLetterSpacingPx}px`;
  element.style.left = '50%';
  element.style.transform = 'translateX(-50%)';
  
  // Legacy uses yPct for vertical centering
  const cssTopPct = yPct * 100;
  element.style.top = `${cssTopPct}%`;
  
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

  // ========== PARITY GATE: Compare against PNG rectangle ==========
  const scale = computePreviewScale();
  
  // Get live element computed styles
  const liveCS = getComputedStyle(liveEl);
  const liveCssWidth = parseFloat(liveCS.width);
  const liveCssFontSize = parseFloat(liveCS.fontSize);
  const liveCssLineHeight = parseFloat(liveCS.lineHeight);
  const liveCssTop = parseFloat(liveCS.top);
  
  // Expected values: from PNG rectangle (NOT percentages)
  const expectedWidth = meta.rasterW * scale;
  const expectedFontSize = meta.fontPx * scale;
  const expectedLineHeight = (meta.fontPx + meta.lineSpacingPx) * scale;
  const expectedTop = meta.yPx_png * scale;
  
  // Tolerances: layout ±2px, typography ±1px
  const layoutTolerance = 2;
  const typoTolerance = 1;
  
  const widthMatch = Math.abs(liveCssWidth - expectedWidth) <= layoutTolerance;
  const fontMatch = Math.abs(liveCssFontSize - expectedFontSize) <= typoTolerance;
  const lineHeightMatch = Math.abs(liveCssLineHeight - expectedLineHeight) <= typoTolerance;
  const topMatch = Math.abs(liveCssTop - expectedTop) <= layoutTolerance;
  
  if (!widthMatch || !fontMatch || !lineHeightMatch || !topMatch) {
    console.warn('[parity:gate:FAIL] Geometry mismatch - keeping live text', {
      width: { live: Math.round(liveCssWidth), expected: Math.round(expectedWidth), match: widthMatch },
      fontSize: { live: Math.round(liveCssFontSize), expected: Math.round(expectedFontSize), match: fontMatch },
      lineHeight: { live: Math.round(liveCssLineHeight), expected: Math.round(expectedLineHeight), match: lineHeightMatch },
      top: { live: Math.round(liveCssTop), expected: Math.round(expectedTop), match: topMatch }
    });
    return; // Keep live text
  }
  
  console.log('[parity:gate:PASS] Geometry matches - swapping to PNG');

  // Swap to PNG
  const pngEl = document.getElementById('preview-raster-img');
  if (pngEl && imageUrl) {
    pngEl.src = imageUrl;
    const container = document.getElementById('live-preview-container');
    if (container) {
      const containerRect = container.getBoundingClientRect();
      const imgScale = containerRect.width / (meta.frameW || 1080);
      
      pngEl.style.width = `${meta.rasterW * imgScale}px`;
      pngEl.style.height = `${meta.rasterH * imgScale}px`;
      pngEl.style.left = `${(containerRect.width - meta.rasterW * imgScale) / 2}px`;
      pngEl.style.top = `${meta.yPx_png * imgScale}px`;
    }
    
    showPngPreview();
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
