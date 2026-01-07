/**
 * Caption Text Wrapping SSOT (Single Source of Truth)
 * 
 * Provides consistent text wrapping using canvas font measurement for both preview and render.
 * Ensures identical line breaks regardless of renderer (raster PNG vs ASS subtitles).
 */

import pkg from '@napi-rs/canvas';
import { canvasFontString } from './font.registry.js';
import { registerDejaVuFonts } from '../caption/canvas-fonts.js';

const { createCanvas } = pkg;

// Lazy font registration guard
let fontsRegistered = false;

/**
 * Ensure DejaVu fonts are registered for node-canvas
 * Idempotent - safe to call multiple times
 */
function ensureFontsRegistered() {
  if (fontsRegistered) return;
  
  try {
    registerDejaVuFonts();
    fontsRegistered = true;
    console.log('[fonts] node-canvas DejaVu registered');
  } catch (err) {
    console.warn('[fonts] Font registration failed (may use system fonts):', err.message);
    // Continue anyway - node-canvas may fall back to system fonts
  }
}

/**
 * Wrap text using canvas font measurement (SSOT for line wrapping)
 * 
 * Extracted from wrapLinesWithFont() in caption.preview.routes.js:1633-1662
 * Uses the same algorithm: word-by-word measurement with letter spacing accounting
 * 
 * @param {string} textRaw - Raw text to wrap
 * @param {Object} options
 * @param {number} options.fontPx - Font size in pixels
 * @param {string} options.weightCss - Font weight (CSS value: 'normal', 'bold', '400', '700', etc.)
 * @param {string} [options.fontStyle='normal'] - Font style ('normal' or 'italic')
 * @param {string} [options.fontFamily='DejaVu Sans'] - Font family name
 * @param {number} options.maxWidthPx - Maximum line width in pixels
 * @param {number} [options.letterSpacingPx=0] - Letter spacing in pixels
 * @param {number} [options.lineSpacingPx=0] - Line spacing in pixels
 * @returns {Object} { lines, linesCount, totalTextH, maxWidthPx }
 */
export function wrapTextWithFont(textRaw, {
  fontPx,
  weightCss,
  fontStyle = 'normal',
  fontFamily = 'DejaVu Sans',
  maxWidthPx,
  letterSpacingPx = 0,
  lineSpacingPx = 0
}) {
  if (!textRaw || typeof textRaw !== 'string') {
    return {
      lines: [],
      linesCount: 0,
      totalTextH: 0,
      maxWidthPx
    };
  }
  
  // Ensure fonts are registered before measurement
  ensureFontsRegistered();
  
  // Create temporary canvas for measurement
  const tempCanvas = createCanvas(1080, 1920);
  const ctx = tempCanvas.getContext('2d');
  
  // Build font string using same helper as preview
  const font = canvasFontString(weightCss, fontStyle, fontPx, fontFamily);
  ctx.font = font;
  ctx.textBaseline = 'alphabetic';
  
  // Helper to measure text width accounting for letter spacing
  // (Same logic as wrapLinesWithFont in caption.preview.routes.js:1639-1649)
  const measureWidth = (str) => {
    if (!letterSpacingPx || letterSpacingPx === 0) {
      return ctx.measureText(str).width;
    }
    let totalWidth = 0;
    for (let i = 0; i < str.length; i++) {
      totalWidth += ctx.measureText(str[i]).width;
      if (i < str.length - 1) totalWidth += letterSpacingPx;
    }
    return totalWidth;
  };
  
  // Wrap text word-by-word (same algorithm as wrapLinesWithFont)
  const words = textRaw.trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (measureWidth(test) > maxWidthPx && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  
  // Compute total text height (same formula as preview)
  const totalTextH = lines.length * fontPx + (lines.length - 1) * lineSpacingPx;
  
  return {
    lines,
    linesCount: lines.length,
    totalTextH: Math.round(totalTextH),
    maxWidthPx
  };
}

