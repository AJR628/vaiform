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
 * V3 Migration: Clear legacy storage keys and ensure only v3 data persists
 * Run this immediately on module load before any other code accesses localStorage
 */
(function migrateOverlayMetaToV3() {
  const V3_KEY = 'overlayMetaV3';
  const LEGACY_KEYS = ['overlayMeta', 'overlayMetaV2', 'overlayMetaSaved', 'captionMeta', 'overlayMetaTimestamp', '_previewSavedForCurrentText'];
  
  try {
    // Check if we already have valid v3 data
    const v3Str = localStorage.getItem(V3_KEY);
    if (v3Str) {
      const v3 = JSON.parse(v3Str);
      if (v3?.ssotVersion === 3) {
        console.log('[v3:migration] Valid v3 data exists - keeping it');
        // Clear legacy keys anyway to avoid confusion
        for (const k of LEGACY_KEYS) {
          if (localStorage.getItem(k)) {
            console.log('[v3:migration] Removing legacy key:', k);
            localStorage.removeItem(k);
          }
        }
        return;
      }
    }
    
    // No valid v3 data - nuke everything legacy or v2
    console.log('[v3:migration] No valid v3 data found - clearing all legacy keys');
    for (const k of LEGACY_KEYS) {
      localStorage.removeItem(k);
    }
    localStorage.removeItem(V3_KEY); // Clear invalid v3 data too
  } catch (e) {
    console.warn('[v3:migration] Error during migration:', e);
    // On error, nuke everything to be safe
    for (const k of LEGACY_KEYS) {
      localStorage.removeItem(k);
    }
    localStorage.removeItem(V3_KEY);
  }
})();

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
    const urlOff = params.get('overlayV2') === '0';
    const lsOn = (localStorage.getItem('overlayV2') || '') === '1';
    const v2 = urlOff ? false : (urlOn || lsOn || true);
    
    // V3 migration handles clearing legacy keys - no need to check here anymore
    
    if (typeof window !== 'undefined') window.__overlayV2 = !!v2;
    return !!v2;
  } catch { return false; }
}

/**
 * Validate that totalTextH matches the correct SSOT formula
 * @param {Object} meta - Overlay meta object to validate
 * @returns {boolean} true if formula is correct, false if invalid
 */
function validateTotalTextHFormula(meta) {
  if (!meta || typeof meta !== 'object') return false;
  
  const { fontPx, lineSpacingPx, totalTextH, lines } = meta;
  
  // Must have all required fields
  if (!Number.isFinite(fontPx) || !Number.isFinite(lineSpacingPx) || 
      !Number.isFinite(totalTextH) || !Array.isArray(lines) || lines.length === 0) {
    return false;
  }
  
  // Validate formula: totalTextH = lines * fontPx + (lines-1) * lineSpacingPx
  const expectedTotalTextH = (lines.length * fontPx) + ((lines.length - 1) * lineSpacingPx);
  const isValid = Math.abs(totalTextH - expectedTotalTextH) <= 0.5;
  
  if (!isValid) {
    console.warn('[caption-preview] Invalid totalTextH formula:', {
      actual: totalTextH,
      expected: expectedTotalTextH,
      formula: `${lines.length}*${fontPx} + ${lines.length-1}*${lineSpacingPx}`,
      lines: lines.length,
      fontPx,
      lineSpacingPx
    });
  }
  
  return isValid;
}

export async function generateCaptionPreview(opts) {
  // DEBUG ONLY: If called with no args, read from DOM
  if (!opts || Object.keys(opts).length === 0) {
    const stage = document.querySelector('#stage');
    const content = stage?.querySelector('.caption-box .content');
    const text = content?.textContent?.trim() || '';
    
    if (!stage) {
      const result = { ok: false, reason: 'No #stage element found' };
      if (typeof window !== 'undefined') window.__lastCaptionPreview = result;
      return result;
    }
    
    if (!text) {
      const result = { ok: false, reason: 'No text in overlay caption box' };
      if (typeof window !== 'undefined') window.__lastCaptionPreview = result;
      return result;
    }
    
    // Get overlay meta
    let overlayMeta = null;
    try {
      const { getCaptionMeta } = await import('./caption-overlay.js');
      overlayMeta = getCaptionMeta();
    } catch (e) {
      overlayMeta = typeof window.getCaptionMeta === 'function' ? window.getCaptionMeta() : null;
    }
    
    if (!overlayMeta) {
      const result = { ok: false, reason: 'No overlay meta available (overlay not initialized)' };
      if (typeof window !== 'undefined') window.__lastCaptionPreview = result;
      return result;
    }
    
    // Build opts from DOM + meta
    opts = {
      text: text,
      fontFamily: overlayMeta.fontFamily,
      weight: overlayMeta.weightCss,
      fontPx: overlayMeta.fontPx,
      lineSpacingPx: overlayMeta.lineSpacingPx,
      color: overlayMeta.color,
      opacity: overlayMeta.opacity,
      xPct: overlayMeta.xPct,
      yPct: overlayMeta.yPct,
      wPct: overlayMeta.wPct,
      placement: overlayMeta.placement || 'custom'
    };
  }
  
  // Clear overlay if text is empty
  if (!opts.text || !opts.text.trim()) {
    if (typeof window !== 'undefined') {
      window.__lastCaptionOverlay = null;
      window.__lastCaptionPreview = { ok: false, reason: 'Empty text' };
    }
    return { ok: false, reason: 'Empty text' };
  }

  // Clear previous caption to force regeneration
  lastCaptionPNG = null;
  if (typeof window !== 'undefined') {
    window.lastCaptionPNG = null;
    window.__lastCaptionOverlay = null;
  }

  // Shared constant - mirrors server MAX_FONT_PX
  const MAX_FONT_PX = 400;
  const clamp = (n, min, max) => Math.max(min, Math.min(n, max));

  // TASK 1: Clamp fontPx and lineSpacingPx to prevent HTTP 400 errors
  // If fontPx wasn't provided by caller, pull the current slider-mapped px from UI.
  // This preserves SSOT (server still clamps), but avoids the 48px server default.
  const ensureFontPx =
    Number.isFinite(opts?.fontPx) ? opts.fontPx
    : (typeof window?.getCaptionPx === 'function' ? Number(window.getCaptionPx()) : undefined);

  // Clamp once with consistent bounds
  const fontPx = clamp(
    Number(ensureFontPx || opts.sizePx || opts.fontPx || 48),
    8,
    MAX_FONT_PX
  );
  
  // Line spacing calculation - lineHeight is a multiplier (e.g., 1.15), not pixels
  const lineHeightMul = 1.15;  // FIXED multiplier, ignore opts.lineHeight
  const lineHeightPx = Math.round(fontPx * lineHeightMul);   // baseline-to-baseline (62px)
  const lineSpacingPx = clamp(
    Math.max(0, Math.round(lineHeightPx - fontPx)),
    0,
    MAX_FONT_PX
  );
  
  // Extract style fields from DOM if content element exists
  const extractDOMStyles = () => {
    if (typeof window === 'undefined') return {};
    
    const content = document.getElementById('caption-content');
    if (!content) return {};
    
    const cs = getComputedStyle(content);
    
    // Helper to parse webkitTextStroke: "3px rgb(0, 0, 0)" → {px: 3, color: "rgb(0,0,0)"}
    const parseStroke = (str) => {
      if (!str || str === 'none' || str === '0px') return { px: 0, color: 'rgba(0,0,0,0.85)' };
      const match = str.match(/^([\d.]+)px\s+(.+)$/);
      if (!match) return { px: 0, color: 'rgba(0,0,0,0.85)' };
      return { px: parseFloat(match[1]), color: match[2] };
    };
    
    // Helper to parse textShadow: "0px 2px 12px rgba(0,0,0,0.65)" → {x,y,blur,color}
    const parseShadow = (str) => {
      if (!str || str === 'none') return { x: 0, y: 2, blur: 12, color: 'rgba(0,0,0,0.6)' };
      const match = str.match(/([-\d.]+)px\s+([-\d.]+)px\s+([-\d.]+)px\s+(.+)/);
      if (!match) return { x: 0, y: 2, blur: 12, color: 'rgba(0,0,0,0.6)' };
      return {
        x: parseFloat(match[1]),
        y: parseFloat(match[2]),
        blur: parseFloat(match[3]),
        color: match[4]
      };
    };
    
    const stroke = parseStroke(cs.webkitTextStroke || cs.textStroke);
    const shadow = parseShadow(cs.textShadow);
    
    const extractedStyles = {
      fontStyle: cs.fontStyle === 'italic' ? 'italic' : 'normal',
      textAlign: cs.textAlign || 'center',
      letterSpacingPx: parseFloat(cs.letterSpacing) || 0,
      strokePx: stroke.px,
      strokeColor: stroke.color,
      shadowColor: shadow.color,
      shadowBlur: shadow.blur,
      shadowOffsetX: shadow.x,
      shadowOffsetY: shadow.y,
    };
    
    // Log fontStyle extraction for debugging
    console.log('[caption-preview] DOM styles extracted:', {
      fontStyle: extractedStyles.fontStyle,
      webkitFontStyle: cs.fontStyle,
      fontFamily: cs.fontFamily
    });
    
    return extractedStyles;
  };
  
  const domStyles = extractDOMStyles();
  
  // Compute xPx_png and yPx_png (avoid variable shadowing)
  // Get frame dimensions FIRST
  const { W: frameW, H: frameH } = window.CaptionGeom?.getFrameDims?.() || { W: 1080, H: 1920 };
  
  // Then compute absolute positions
  const xPct = Number.isFinite(opts?.xPct) ? Number(opts.xPct) : 0.5;
  const yPct = Number.isFinite(opts?.yPct) ? Number(opts.yPct) : 0.5;
  const xPx_png = Math.round(xPct * frameW);
  const yPx_png = Math.round(yPct * frameH);
  
  // Use server-compatible payload structure
  const overlayV2 = detectOverlayV2();
  
  // Get overlay meta for V3 raster fields
  const overlayMeta = typeof window !== 'undefined' && (
    window.__overlayMeta || 
    (typeof window.getCaptionMeta === 'function' ? window.getCaptionMeta() : null)
  );
  
  // Only build V3 raster payload if overlayV2 is enabled AND we have required raster fields
  const hasRasterFields = overlayMeta && 
    Number.isFinite(overlayMeta.rasterW) && 
    Number.isFinite(overlayMeta.rasterH) && 
    Number.isFinite(overlayMeta.rasterPadding) &&
    Array.isArray(overlayMeta.lines) && overlayMeta.lines.length > 0 &&
    Number.isFinite(overlayMeta.totalTextH) &&
    Number.isFinite(overlayMeta.yPx_png);
  
  const payload = (overlayV2 && hasRasterFields)
    ? {
        // V3 raster format – complete payload with all required fields
        ssotVersion: 3,
        mode: 'raster',  // ← REQUIRED for V3 raster detection
        text: opts.text || overlayMeta.text,
        placement: 'custom',
        xPct: Number.isFinite(opts?.xPct) ? opts.xPct : (overlayMeta?.xPct ?? 0.5),
        yPct: Number.isFinite(opts?.yPct) ? opts.yPct : (overlayMeta?.yPct ?? 0.5),
        wPct: Number.isFinite(opts?.wPct) ? opts.wPct : (overlayMeta?.wPct ?? 0.8),
        
        // Typography
        fontPx,  // ← Already clamped
        lineSpacingPx,  // ← Already clamped
        fontFamily: opts.fontFamily || overlayMeta?.fontFamily || 'DejaVu Sans',
        weightCss: opts.weight || overlayMeta?.weightCss || 'normal',
        fontStyle: domStyles.fontStyle || overlayMeta?.fontStyle || 'normal',
        textAlign: domStyles.textAlign || overlayMeta?.textAlign || 'center',
        letterSpacingPx: domStyles.letterSpacingPx ?? overlayMeta?.letterSpacingPx ?? 0,
        textTransform: overlayMeta?.textTransform || 'none',
        
        // Color & effects
        color: opts.color || overlayMeta?.color || '#FFFFFF',
        opacity: Number(opts.opacity ?? overlayMeta?.opacity ?? 0.85),
        strokePx: domStyles.strokePx ?? overlayMeta?.strokePx ?? 0,
        strokeColor: domStyles.strokeColor || overlayMeta?.strokeColor || 'rgba(0,0,0,0.85)',
        shadowColor: domStyles.shadowColor || overlayMeta?.shadowColor || 'rgba(0,0,0,0.6)',
        shadowBlur: domStyles.shadowBlur ?? overlayMeta?.shadowBlur ?? 12,
        shadowOffsetX: domStyles.shadowOffsetX ?? overlayMeta?.shadowOffsetX ?? 0,
        shadowOffsetY: domStyles.shadowOffsetY ?? overlayMeta?.shadowOffsetY ?? 2,
        
        // Geometry - required V3 raster fields
        frameW: overlayMeta.frameW || frameW,
        frameH: overlayMeta.frameH || frameH,
        rasterW: overlayMeta.rasterW,
        rasterH: overlayMeta.rasterH,
        rasterPadding: overlayMeta.rasterPadding,
        xPx_png: Number.isFinite(opts?.xPx_png) ? opts.xPx_png : (overlayMeta?.xPx_png ?? xPx_png),
        yPx_png: Number.isFinite(opts?.yPx_png) ? opts.yPx_png : (overlayMeta?.yPx_png ?? yPx_png),
        xExpr_png: overlayMeta?.xExpr_png || '(W-overlay_w)/2',
        
        // Browser-rendered line data (REQUIRED)
        lines: overlayMeta.lines,
        totalTextH: overlayMeta.totalTextH,
        yPxFirstLine: overlayMeta.yPxFirstLine,
        
        // Font string for parity validation
        previewFontString: overlayMeta.previewFontString || (
          typeof window !== 'undefined' && document.getElementById('caption-content')
            ? getComputedStyle(document.getElementById('caption-content')).font
            : undefined
        ),
        
        // Optional textRaw
        textRaw: overlayMeta.textRaw || opts.text
      }
    : (() => {
        // Legacy payload branch - should not execute in overlay mode
        console.warn('[caption-preview] Building payload without V3 raster fields - overlayV2:', overlayV2, 'hasRasterFields:', hasRasterFields);
        return {
          ssotVersion: 3,
          mode: 'raster',
          style: {
            text: opts.text,
            fontFamily: opts.fontFamily || "DejaVu Sans",
            weight: opts.weight || "normal",
            fontPx: fontPx,
            lineSpacingPx: lineSpacingPx,
            opacity: Number(opts.opacity ?? 0.85),
            placement: opts.placement || 'center',
            yPct: Number.isFinite(opts?.yPct) ? Number(opts.yPct) : 0.5,
            _cacheBuster: Date.now()
          }
        };
      })();

  // Conditional audit logging (behind __parityAudit flag)
  if (window.__parityAudit && overlayV2 && hasRasterFields) {
    if (!overlayMeta.yPxFirstLine) {
      console.warn('[__parityAudit] missing yPxFirstLine in overlayMeta; preview request may fail schema');
    }
    console.log('[__parityAudit] payload:', {
      linesCount: payload.lines?.length || 0,
      rasterW: payload.rasterW,
      rasterH: payload.rasterH,
      rasterPadding: payload.rasterPadding,
      totalTextH: payload.totalTextH,
      yPx_png: payload.yPx_png,
      yPxFirstLine: payload.yPxFirstLine,
      previewFontString: payload.previewFontString,
      frameW: payload.frameW,
      frameH: payload.frameH
    });
  }

  console.log("[caption-overlay] POST /preview/caption with placement:", opts.placement, "yPct:", opts.yPct);
  console.log("[caption-overlay] payload:", payload); // Log full payload for debugging
  
  // Specifically log fontStyle for debugging
  if (payload.fontStyle !== undefined) {
    console.log("[caption-overlay] fontStyle in payload:", payload.fontStyle);
  }
  if (payload.style?.fontStyle !== undefined) {
    console.log("[caption-overlay] fontStyle in payload.style:", payload.style.fontStyle);
  }
  
  // Always call API-prefixed path to avoid 404 from /caption/preview
  const data = await apiFetch("/caption/preview", {
    method: "POST",
    body: payload
  });
  if (!data?.ok) throw new Error(data?.detail || data?.reason || "Preview generation failed");

  // Conditional audit logging (response)
  if (window.__parityAudit && data?.data?.meta) {
    const meta = data.data.meta;
    console.log('[__parityAudit] response:', {
      ok: data.ok,
      linesCount: meta.lines?.length || 0,
      rasterW: meta.rasterW,
      rasterH: meta.rasterH,
      rasterPadding: meta.rasterPadding,
      totalTextH: meta.totalTextH,
      yPx_png: meta.yPx_png,
      previewFontString: meta.previewFontString,
      frameW: meta.frameW,
      frameH: meta.frameH
    });
  }

  // Convert the response to the expected format
  // V3 raster mode returns PNG in meta.rasterUrl, not data.imageUrl
  const resp = data?.data || {};
  const meta = resp.meta || {};
  
  const imageUrl = meta.mode === 'raster' 
    ? (meta.rasterUrl || data.data?.imageUrl)
    : data.data?.imageUrl;
  
  if (!imageUrl) {
    if (meta.mode === 'raster') {
      throw new Error("V3 raster mode requires meta.rasterUrl in response");
    }
    throw new Error("No image URL in response");
  }

  // SSOT v3: Use server response VERBATIM when ssotVersion=3 (no rebuilding!)
  let normalizedMeta;
  if (meta.ssotVersion === 3) {
    // Server is SSOT - use its response verbatim, no modifications
    normalizedMeta = meta;
    console.log('[caption-preview] Using server SSOT v3 response verbatim (no client rebuild)');
    
    // Log differently based on mode
    if (meta.mode === 'raster') {
      console.log('[caption-preview] RASTER mode - PNG overlay:', {
        mode: meta.mode,
        rasterW: meta.rasterW,
        rasterH: meta.rasterH,
        yPx_png: meta.yPx_png,
        urlType: meta.rasterUrl?.startsWith('data:') ? 'data URL' : 'http(s)',
        urlLength: meta.rasterUrl?.length
      });
      
      // CLIENT ASSERTION: Check for missing style keys
      const keysWeCareAbout = [
        'fontPx','lineSpacingPx','color','opacity','fontFamily','weightCss',
        'textAlign','letterSpacingPx','strokePx','shadowBlur',
        'fontStyle','strokeColor','shadowColor'
      ];
      const missing = keysWeCareAbout.filter(k => !(k in meta));
      if (missing.length > 0) {
        console.warn('[preview-meta] missing style keys:', missing);
      }
      
      // Additional assertions for raster geometry
      if (meta.rasterW >= 1080 || meta.rasterH >= 1920) {
        console.warn('[preview-meta] raster dimensions suspiciously large:', {
          rasterW: meta.rasterW,
          rasterH: meta.rasterH,
          expected: 'tight PNG < 600px'
        });
      }
      
      // Comprehensive diagnostic log for render parity debugging
      console.log('[preview:raster:FINAL]', {
        boxW: Math.round((meta.wPct ?? 0.8) * 1080),
        rasterW: meta.rasterW,
        rasterH: meta.rasterH,
        yPx_png: meta.yPx_png,
        wPct: meta.wPct,
        // Typography
        fontFamily: meta.fontFamily,
        fontStyle: meta.fontStyle,
        weightCss: meta.weightCss,
        textAlign: meta.textAlign,
        letterSpacingPx: meta.letterSpacingPx,
        textTransform: meta.textTransform,
        // Effects
        strokePx: meta.strokePx,
        strokeColor: meta.strokeColor,
        shadowBlur: meta.shadowBlur,
        shadowColor: meta.shadowColor,
        shadowOffsetX: meta.shadowOffsetX,
        shadowOffsetY: meta.shadowOffsetY,
        // Color
        color: meta.color,
        opacity: meta.opacity,
        // Layout
        rasterPadding: meta.rasterPadding,
        lineSpacingPx: meta.lineSpacingPx
      });
    } else {
      console.log('[caption-preview] DRAWTEXT mode - Server provided:', {
        fontPx: meta.fontPx,
        lineSpacingPx: meta.lineSpacingPx,
        totalTextH: meta.totalTextH,
        yPxFirstLine: meta.yPxFirstLine,
        lines: Array.isArray(meta.lines) ? meta.lines.length : 0
      });
      
      // Only validate totalTextH formula for drawtext mode
      if (!validateTotalTextHFormula(meta)) {
        console.error('[caption-preview] Server returned invalid totalTextH formula - regenerating preview');
        throw new Error('Server returned invalid totalTextH - please regenerate preview');
      }
    }
  } else {
    // Legacy fallback for non-v3 responses (should not occur with strict V3 gate)
    console.warn('[caption-preview] Legacy fallback path - ssotVersion !== 3');
    const totalTextH = Number(meta.totalTextH ?? meta.totalTextHPx);
    
    normalizedMeta = {
      ssotVersion: 3,  // ← Bumped version to invalidate stale data
      mode: 'raster',  // ← V3 always uses raster mode
      text: meta.text || opts.text,
      xPct: Number(meta.xPct ?? 0.5),
      yPct: Number(meta.yPct ?? 0.5),
      wPct: Number(meta.wPct ?? 0.8),
      fontPx: Number(meta.fontPx || opts.fontPx || opts.sizePx || 48),
      lineSpacingPx: Number(meta.lineSpacingPx ?? 0),
      color: meta.color || opts.color || '#ffffff',
      opacity: Number(meta.opacity ?? opts.opacity ?? 1.0),
      fontFamily: meta.fontFamily || opts.fontFamily || 'DejaVu Sans',
      weightCss: meta.weightCss || opts.weight || opts.weightCss || 'normal',
      placement: meta.placement || 'custom',
      rasterPadding: Number(meta.rasterPadding ?? meta.internalPadding ?? 32),
      
      // SSOT fields - must match server response
      lines: Array.isArray(meta.lines) ? meta.lines : [],
      totalTextH: totalTextH,
      yPx_png: Number.isFinite(meta.yPx_png) ? meta.yPx_png : (Number.isFinite(meta.yPx) ? meta.yPx : undefined),
      
      // Raster fields for v3
      rasterUrl: imageUrl,
      rasterDataUrl: imageUrl,
      rasterPng: imageUrl,
      rasterW: data.data?.wPx || 1080,
      rasterH: data.data?.hPx || 1920,
      xExpr: '(W-overlay_w)/2',
      yPx: yPxFirstLine
    };
  }
  
  lastCaptionPNG = { 
    dataUrl: imageUrl, 
    width: data.data?.wPx || 1080, 
    height: data.data?.hPx || 1920,
    meta: normalizedMeta
  };
  
  // Update global references (SSOT)
  if (typeof window !== 'undefined') {
    window.lastCaptionPNG = lastCaptionPNG;
    
    // Store normalized overlay meta for render (SSOT)
    window._overlayMeta = normalizedMeta;
    
    // Store server meta for live preview system
    window.__serverCaptionMeta = normalizedMeta;
    
    // Store for parity testing (DEBUG ONLY)
    window.__lastCaptionPreview = {
      ok: true,
      meta: data.data?.meta || normalizedMeta,
      response: data
    };
    
    // Also keep legacy reference for backward compatibility
    window.__lastCaptionOverlay = {
      dataUrl: imageUrl,
      width: data.data?.wPx || 1080,
      height: data.data?.hPx || 1920,
      meta: normalizedMeta
    };
    
    // Persist to localStorage for "Save Preview" workflow (V3 storage key)
    try {
      localStorage.setItem('overlayMetaV3', JSON.stringify(normalizedMeta));
      console.log('[v3:savePreview] saved', { 
        v: normalizedMeta.ssotVersion, 
        mode: normalizedMeta.mode,
        frameW: normalizedMeta.frameW,
        frameH: normalizedMeta.frameH,
        rasterHash: normalizedMeta.rasterHash?.slice(0, 8) + '...',
        keys: Object.keys(normalizedMeta),
        hasRaster: !!normalizedMeta.rasterUrl || !!normalizedMeta.rasterDataUrl
      });
    } catch (err) {
      console.warn('[caption-preview] Failed to save to localStorage:', err.message);
    }
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
  
  // Return success result (for parity testing)
  return {
    ok: true,
    meta: normalizedMeta,
    imageUrl
  };
}

export function getLastCaptionPNG(){ return lastCaptionPNG; }

// Beat preview cache and controllers (behind feature flag)
const beatPreviewCache = new Map(); // hash(style+text) -> { meta, rasterUrl, timestamp }
const beatPreviewControllers = new Map(); // beatId -> AbortController
const beatPreviewDebounceTimers = new Map(); // beatId -> timeoutId

function hashStyleAndText(style, text) {
  const styleStr = JSON.stringify(style, Object.keys(style).sort());
  return `${styleStr}|${text}`;
}

function getCachedBeatPreview(style, text) {
  const key = hashStyleAndText(style, text);
  const cached = beatPreviewCache.get(key);
  if (cached && Date.now() - cached.timestamp < 60000) { // 1min TTL
    return cached;
  }
  return null;
}

function setCachedBeatPreview(style, text, result) {
  const key = hashStyleAndText(style, text);
  beatPreviewCache.set(key, {
    ...result,
    timestamp: Date.now()
  });
}

/**
 * Build V3 raster preview payload from overlayMeta (reuses existing logic)
 * @param {string} text - Caption text
 * @param {object} overlayMeta - overlayMeta object from measureBeatCaptionGeometry()
 * @returns {object} Payload ready for POST /api/caption/preview
 */
function buildBeatPreviewPayload(text, overlayMeta) {
  return {
    ssotVersion: 3,
    mode: 'raster',
    text: overlayMeta.text || text,
    placement: 'custom',
    xPct: overlayMeta.xPct ?? 0.5,
    yPct: overlayMeta.yPct ?? 0.5,
    wPct: overlayMeta.wPct ?? 0.8,
    
    // Typography
    fontPx: overlayMeta.fontPx,
    lineSpacingPx: overlayMeta.lineSpacingPx,
    fontFamily: overlayMeta.fontFamily,
    weightCss: overlayMeta.weightCss,
    fontStyle: overlayMeta.fontStyle,
    textAlign: overlayMeta.textAlign,
    letterSpacingPx: overlayMeta.letterSpacingPx,
    textTransform: overlayMeta.textTransform,
    
    // Color & effects
    color: overlayMeta.color,
    opacity: overlayMeta.opacity,
    strokePx: overlayMeta.strokePx,
    strokeColor: overlayMeta.strokeColor,
    shadowColor: overlayMeta.shadowColor,
    shadowBlur: overlayMeta.shadowBlur,
    shadowOffsetX: overlayMeta.shadowOffsetX,
    shadowOffsetY: overlayMeta.shadowOffsetY,
    
    // Geometry - required V3 raster fields
    frameW: overlayMeta.frameW || 1080,
    frameH: overlayMeta.frameH || 1920,
    rasterW: overlayMeta.rasterW,
    rasterH: overlayMeta.rasterH,
    rasterPadding: overlayMeta.rasterPadding,
    xPx_png: overlayMeta.xPx_png,
    yPx_png: overlayMeta.yPx_png,
    xExpr_png: overlayMeta.xExpr_png || '(W-overlay_w)/2',
    
    // Browser-rendered line data (REQUIRED)
    lines: overlayMeta.lines,
    totalTextH: overlayMeta.totalTextH,
    yPxFirstLine: overlayMeta.yPxFirstLine, // Now always present from helper
    
    // Font string for parity validation
    previewFontString: overlayMeta.previewFontString,
    
    // Optional textRaw
    textRaw: overlayMeta.textRaw || text
  };
}

/**
 * Generate caption preview for a beat card (parity-only, uses SSOT measurement)
 * @param {string} beatId - Beat identifier
 * @param {string} text - Beat text
 * @param {object} style - Session-level caption style
 * @returns {Promise<object|null>} Preview result with meta and rasterUrl, or null if disabled/skipped
 */
export async function generateBeatCaptionPreview(beatId, text, style) {
  // Feature flag check
  if (!window.BEAT_PREVIEW_ENABLED) {
    return null;
  }
  
  if (!text || !text.trim()) {
    return null;
  }
  
  // Check cache first
  const cached = getCachedBeatPreview(style, text);
  if (cached) {
    return { beatId, ...cached };
  }
  
  // Cancel previous request for this beat
  const prevController = beatPreviewControllers.get(beatId);
  if (prevController) {
    prevController.abort();
  }
  
  const controller = new AbortController();
  beatPreviewControllers.set(beatId, controller);
  
  try {
    // Import offscreen measurement function
    const { measureBeatCaptionGeometry } = await import('./caption-overlay.js');
    
    // Measure geometry using offscreen DOM (reuses SSOT logic)
    const overlayMeta = measureBeatCaptionGeometry(text, style);
    if (!overlayMeta) {
      return null;
    }
    
    // Build payload using helper
    const payload = buildBeatPreviewPayload(text, overlayMeta);
    
    // Call preview endpoint (using already-imported apiFetch from line 7)
    const data = await apiFetch('/caption/preview', {
      method: 'POST',
      body: payload,
      signal: controller.signal // AbortController supported
    });
    
    if (!data?.ok) {
      throw new Error(data?.detail || data?.reason || 'Preview generation failed');
    }
    
    const result = {
      beatId,
      meta: data.data.meta,
      rasterUrl: data.data.meta.rasterUrl
    };
    
    // Cache result
    setCachedBeatPreview(style, text, result);
    
    return result;
  } catch (err) {
    if (err.name === 'AbortError') {
      // Request cancelled, ignore
      return null;
    }
    if (window.__parityAudit || window.__parityDebug) {
      console.warn('[beat-preview] Failed:', err);
    }
    // Graceful degradation - don't block UI
    return null;
  } finally {
    beatPreviewControllers.delete(beatId);
  }
}

/**
 * Debounced beat preview generation
 * @param {string} beatId - Beat identifier
 * @param {string} text - Beat text
 * @param {object} style - Session-level caption style
 * @param {number} delay - Debounce delay in ms (default 300)
 */
export function generateBeatCaptionPreviewDebounced(beatId, text, style, delay = 300) {
  if (!window.BEAT_PREVIEW_ENABLED) {
    return;
  }
  
  // Normalize identifier to string
  const id = String(beatId);
  
  if (window.__beatPreviewDebug) {
    console.log('[beat-preview] Debounce triggered:', { identifier: id, textLength: text?.length || 0 });
  }
  
  // Clear existing timer
  const existingTimer = beatPreviewDebounceTimers.get(id);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  
  const timer = setTimeout(async () => {
    const result = await generateBeatCaptionPreview(id, text, style);
    beatPreviewDebounceTimers.delete(id);
    
    // Apply preview to DOM
    if (result && result.rasterUrl) {
      // Find beat card: try both selector patterns (draft vs session mode)
      const beatCardEl = document.querySelector(`[data-beat-id="${id}"]`) || 
                         document.querySelector(`[data-sentence-index="${id}"]`);
      
      if (beatCardEl) {
        if (window.__beatPreviewDebug) {
          console.log('[beat-preview] Card found:', { identifier: id, found: true });
        }
        applyPreviewResultToBeatCard(beatCardEl, result);
      } else {
        if (window.__beatPreviewDebug) {
          console.warn('[beat-preview] Card not found:', { identifier: id, found: false });
        }
      }
    }
  }, delay);
  
  beatPreviewDebounceTimers.set(id, timer);
}

/**
 * Apply preview result to beat card DOM (shared SSOT logic)
 * Extracted from BeatPreviewManager.applyPreview() - single source of truth
 * 
 * @param {HTMLElement} beatCardEl - Beat card DOM element
 * @param {object} result - Preview result from generateBeatCaptionPreview
 * @returns {void}
 */
export function applyPreviewResultToBeatCard(beatCardEl, result) {
  if (!result || !result.rasterUrl) {
    if (window.__beatPreviewDebug) {
      console.warn('[beat-preview] No result or rasterUrl to apply');
    }
    return;
  }
  
  if (!beatCardEl) {
    if (window.__beatPreviewDebug) {
      console.warn('[beat-preview] beatCardEl is null/undefined');
    }
    return;
  }
  
  // Find or create overlay img element
  let overlayImg = beatCardEl.querySelector('.beat-caption-overlay');
  if (!overlayImg) {
    overlayImg = document.createElement('img');
    overlayImg.className = 'beat-caption-overlay';
    // Insert into video container (reuse exact selector from BeatPreviewManager)
    const videoContainer = beatCardEl.querySelector('.relative.w-full.h-40');
    if (videoContainer) {
      videoContainer.appendChild(overlayImg);
    } else {
      beatCardEl.appendChild(overlayImg);
    }
  }
  
  // Set CSS variables for positioning
  const meta = result.meta;
  // Prefer server meta.yPct if present, else derive from yPx_png/frameH
  const yPct = Number.isFinite(meta.yPct) ? meta.yPct : (meta.yPx_png / meta.frameH);
  const rasterWRatio = meta.rasterW / meta.frameW;
  const rasterHRatio = meta.rasterH / meta.frameH;
  
  overlayImg.style.setProperty('--y-pct', yPct);
  overlayImg.style.setProperty('--raster-w-ratio', rasterWRatio);
  overlayImg.style.setProperty('--raster-h-ratio', rasterHRatio);
  
  // Set image source
  overlayImg.src = result.rasterUrl;
  overlayImg.style.display = 'block';
  
  if (window.__beatPreviewDebug) {
    console.log('[beat-preview] Overlay applied:', {
      identifier: beatCardEl.getAttribute('data-beat-id') || beatCardEl.getAttribute('data-sentence-index'),
      rasterUrl: result.rasterUrl.substring(0, 50) + '...'
    });
  }
}

/**
 * Get saved overlay meta (from memory or localStorage)
 * @returns {Object|null} Saved overlay meta or null if none exists
 */
export function getSavedOverlayMeta() {
  if (typeof window === 'undefined') return null;
  
  // Try memory first
  if (window._overlayMeta) {
    return window._overlayMeta;
  }
  
  // Fall back to localStorage (V3 storage key only)
  try {
    const stored = localStorage.getItem('overlayMetaV3');
    if (stored) {
      const meta = JSON.parse(stored);
      
      // Validate ssotVersion === 3
      if (meta.ssotVersion !== 3) {
        console.warn('[caption-preview] Ignoring saved meta with wrong ssotVersion:', meta.ssotVersion);
        localStorage.removeItem('overlayMetaV3');
        return null;
      }
      
      window._overlayMeta = meta;
      return meta;
    }
  } catch (err) {
    console.warn('[caption-preview] Failed to load from localStorage:', err.message);
  }
  
  return null;
}

/**
 * Validate overlay caption contract (client-side pre-POST check)
 * @param {Object} overlay - Overlay object to validate
 * @returns {Object} { valid: boolean, errors: string[] }
 */
export function validateOverlayCaption(overlay) {
  const errors = [];
  
  if (!overlay || typeof overlay !== 'object') {
    return { valid: false, errors: ['Overlay must be an object'] };
  }
  
  const isRaster = overlay?.mode === 'raster';
  
  // In raster mode, the text is already baked into the PNG.
  // fontPx/lineSpacingPx are informational only; skip numeric bounds.
  if (isRaster) {
    return { valid: true, errors: [] };
  }
  
  // Required fields (non-raster only)
  if (!overlay.text || typeof overlay.text !== 'string' || !overlay.text.trim()) {
    errors.push('text is required and must be non-empty');
  }
  
  // Validate percentages (0..1)
  ['xPct', 'yPct', 'wPct', 'hPct'].forEach(key => {
    const val = overlay[key];
    if (typeof val === 'number') {
      if (val < 0 || val > 1) {
        errors.push(`${key} must be between 0 and 1 (got ${val})`);
      }
    }
  });
  
  // Validate fontPx (non-raster, caps match Zod schemas)
  const fontPx = overlay.fontPx || overlay.sizePx;
  const fp = Number(fontPx);
  if (Number.isFinite(fp) && (fp < 1 || fp > 400)) {
    errors.push(`fontPx must be between 1 and 400 (got ${fontPx})`);
  }
  
  // Validate lineSpacingPx (non-raster)
  const lineSpacingPx = overlay.lineSpacingPx;
  const lsp = Number(lineSpacingPx);
  if (Number.isFinite(lsp) && (lsp < 0 || lsp > 600)) {
    errors.push(`lineSpacingPx must be between 0 and 600 (got ${lineSpacingPx})`);
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

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
  const xPct = 0.5; // center horizontally for preview image
  const yPct = Number.isFinite(captionData.meta?.yPct) ? captionData.meta.yPct : 0.5;
  const totalTextH = captionData.meta?.totalTextH || 0;
  const align = 'center';
  const internalPadding = captionData.meta?.internalPadding || 0;
  const lineSpacingPx = captionData.meta?.lineSpacingPx ?? 0;

  // TASK 2: Scale totalTextH with single scale factor
  const scaledTotalTextH = totalTextH * s;

  // Define safe margins to prevent clipping (5% top, 8% bottom)
  const safeTopMargin = previewH * 0.05;
  const safeBottomMargin = previewH * 0.08;

  // Calculate anchor points
  const anchorX = (xPct) * finalW;

  // Calculate position based on alignment - use text-aware positioning
  let left = anchorX;

  // Horizontal alignment
  if (align === 'center') left -= dispW / 2;
  else if (align === 'right') left -= dispW;

  // SSOT clamp formula based solely on yPct
  const targetTop = (yPct * finalH) - (scaledTotalTextH / 2);
  let top = Math.max(safeTopMargin, Math.min(targetTop, finalH - safeBottomMargin - scaledTotalTextH));

  // Clamp horizontal positioning
  left = Math.max(0, Math.min(left, finalW - dispW));

  const finalDispW = dispW;
  const finalDispH = dispH;
  const finalScaledTextH = scaledTotalTextH;

  // TASK 4: Debug logging with actual container dimensions
  console.log('[preview-overlay] positioning:', {
    W: finalW, H: finalH, iw: captionData.meta?.wPx, iH: captionData.meta?.hPx,
    dispW: finalDispW, dispH: finalDispH, align, yPct,
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

/**
 * Force clear all preview-related localStorage data
 * Call this when you need to ensure clean state
 */
export function forceClearPreviewCache() {
  if (typeof window === 'undefined') return;
  
  try {
    localStorage.removeItem('overlayMetaV3');
    localStorage.removeItem('_previewSavedForCurrentText');
    window._overlayMeta = null;
    window._previewSavedForCurrentText = false;
    console.log('[caption-preview] Force cleared all preview cache (v3)');
  } catch (err) {
    console.warn('[caption-preview] Failed to clear cache:', err.message);
  }
}

// Make functions globally available for legacy compatibility
if (typeof window !== 'undefined') {
  window.generateCaptionPreview = generateCaptionPreview;
  window.createCaptionOverlay = createCaptionOverlay;
  window.createDebouncedCaptionPreview = createDebouncedCaptionPreview;
  window.getSavedOverlayMeta = getSavedOverlayMeta;
  window.validateOverlayCaption = validateOverlayCaption;
  window.forceClearPreviewCache = forceClearPreviewCache;
}
