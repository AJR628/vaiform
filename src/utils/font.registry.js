/**
 * Font SSOT (Single Source of Truth) Registry
 * 
 * Provides consistent font resolution across preview (canvas) and render (ffmpeg)
 * to ensure bold/italic weights are applied identically in both paths.
 */

import fs from 'node:fs';
import path from 'node:path';

export const FONT_FAMILY = 'DejaVu Sans';

// Resolve font path with fallback locations (same logic as canvas-fonts.js)
function resolveFontPath(filename) {
  const candidates = [
    path.resolve(process.cwd(), 'assets', 'fonts', filename),
    path.resolve(process.cwd(), 'src', 'assets', 'fonts', filename)
  ];
  
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  
  return null;
}

/**
 * Normalize weight input to standard number
 * @param {string|number} weightCss - Weight value ('bold', '700', 700, etc.)
 * @returns {number} Normalized weight (400 or 700)
 */
export function normalizeWeight(weightCss) {
  const lower = String(weightCss ?? '').toLowerCase();
  if (lower === 'bold') return 700;
  const n = Number(weightCss);
  return Number.isFinite(n) ? (n >= 600 ? 700 : 400) : 400;
}

/**
 * Normalize font style input to standard string
 * @param {string} fontStyle - Style value ('italic', 'Italic', 'ITALIC', etc.)
 * @returns {string} Normalized style ('italic' or 'normal')
 */
export function normalizeFontStyle(fontStyle) {
  return String(fontStyle).toLowerCase() === 'italic' ? 'italic' : 'normal';
}

/**
 * Resolve font file path based on weight and style
 * @param {string|number} weightCss - Font weight
 * @param {string} fontStyle - Font style
 * @returns {string} Full path to font file
 */
export function resolveFontFile(weightCss, fontStyle) {
  const w = normalizeWeight(weightCss);
  const s = normalizeFontStyle(fontStyle);
  
  let filename;
  if (w >= 700 && s === 'italic') filename = 'DejaVuSans-BoldOblique.ttf';
  else if (w >= 700)               filename = 'DejaVuSans-Bold.ttf';
  else if (s === 'italic')        filename = 'DejaVuSans-Oblique.ttf';
  else                            filename = 'DejaVuSans.ttf';
  
  const resolvedPath = resolveFontPath(filename);
  if (!resolvedPath) {
    throw new Error(`Font file not found: ${filename}`);
  }
  
  return resolvedPath;
}

/**
 * Font resolution test matrix:
 * - resolveFontFile('400', 'normal')  → /absolute/path/to/assets/fonts/DejaVuSans.ttf
 * - resolveFontFile('700', 'normal')  → /absolute/path/to/assets/fonts/DejaVuSans-Bold.ttf
 * - resolveFontFile('400', 'italic')  → /absolute/path/to/assets/fonts/DejaVuSans-Oblique.ttf
 * - resolveFontFile('700', 'italic')  → /absolute/path/to/assets/fonts/DejaVuSans-BoldOblique.ttf
 * 
 * Canvas usage (preview):
 * - canvasFontString('700', 'italic', 57) → "italic bold 57px \"DejaVu Sans\""
 * 
 * FFmpeg usage (render):
 * - escapeFontPath(resolveFontFile('700', 'italic')) → fontfile=/absolute/path/to/assets/fonts/DejaVuSans-BoldOblique.ttf
 */

/**
 * Get variant-specific family name based on weight and style
 * @param {string} baseFamily - Base font family name
 * @param {string|number} weightCss - Font weight
 * @param {string} fontStyle - Font style
 * @returns {string} Variant-specific family name
 */
export function getVariantFamily(baseFamily, weightCss, fontStyle) {
  const w = normalizeWeight(weightCss);
  const s = normalizeFontStyle(fontStyle);

  if (w === 700 && s === 'italic') return `${baseFamily} Bold Italic`;
  if (w === 700 && s === 'normal') return `${baseFamily} Bold`;
  if (w === 400 && s === 'italic') return `${baseFamily} Italic`;
  return baseFamily; // 400 + normal
}

/**
 * Build canvas font string for @napi-rs/canvas
 * @param {string|number} weightCss - Font weight
 * @param {string} fontStyle - Font style
 * @param {number} px - Font size in pixels
 * @param {string} baseFamily - Base font family name
 * @returns {string} Canvas font string
 */
export function canvasFontString(weightCss, fontStyle, px, baseFamily = 'DejaVu Sans') {
  const w = normalizeWeight(weightCss) >= 700 ? 'bold' : 'normal';
  const s = normalizeFontStyle(fontStyle);
  return `${s} ${w} ${px}px "${baseFamily}"`;  // Always use base family + descriptors
}

/**
 * Assert font file exists and return path
 * @param {string} fontfile - Font file path
 * @returns {string} Font file path if exists
 * @throws {Error} If font file doesn't exist
 */
export function assertFontExists(fontfile) {
  if (!fs.existsSync(fontfile)) {
    throw new Error(`Font file missing: ${fontfile}`);
  }
  return fontfile;
}

/**
 * Escape font file path for ffmpeg drawtext
 * @param {string} fontfile - Font file path
 * @returns {string} Escaped path safe for ffmpeg
 */
export function escapeFontPath(fontfile) {
  return fontfile.replace(/:/g, '\\:');
}

/**
 * Build consistent canvas font string for @napi-rs/canvas
 * Normalizes weight and style to ensure parity between client and server
 * @param {Object} options - Font options
 * @param {string} [options.fontStyle='normal'] - Font style ('italic' or 'normal')
 * @param {string|number} [options.weightCss='700'] - Font weight
 * @param {number} options.fontPx - Font size in pixels
 * @param {string} [options.family='DejaVu Sans'] - Font family
 * @returns {string} Canvas font string
 */
export function toCanvasFont({fontStyle='normal', weightCss='700', fontPx, family='DejaVu Sans'}) {
  const weight = (weightCss+'').toLowerCase()==='bold' ? 'bold' : 'normal';
  const style = fontStyle === 'italic' ? 'italic' : 'normal';
  return `${style} ${weight} ${fontPx}px "${family}"`;  // Always use base family + descriptors
}