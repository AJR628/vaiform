/**
 * Font SSOT (Single Source of Truth) Registry
 * 
 * Provides consistent font resolution across preview (canvas) and render (ffmpeg)
 * to ensure bold/italic weights are applied identically in both paths.
 */

import fs from 'node:fs';

export const FONT_FAMILY = 'DejaVu Sans';
const SYS = '/usr/share/fonts/truetype/dejavu';

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
  
  if (w >= 700 && s === 'italic') return `${SYS}/DejaVuSans-BoldOblique.ttf`;
  if (w >= 700)                return `${SYS}/DejaVuSans-Bold.ttf`;
  if (s === 'italic')          return `${SYS}/DejaVuSans-Oblique.ttf`;
                               return `${SYS}/DejaVuSans.ttf`;
}

/**
 * Font resolution test matrix:
 * - resolveFontFile('400', 'normal')  → /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
 * - resolveFontFile('700', 'normal')  → DejaVuSans-Bold.ttf
 * - resolveFontFile('400', 'italic')  → DejaVuSans-Oblique.ttf
 * - resolveFontFile('700', 'italic')  → DejaVuSans-BoldOblique.ttf
 * 
 * Canvas usage (preview):
 * - canvasFontString('700', 'italic', 57) → "italic bold 57px \"DejaVu Sans\""
 * 
 * FFmpeg usage (render):
 * - escapeFontPath(resolveFontFile('700', 'italic')) → fontfile=/usr/share/.../DejaVuSans-BoldOblique.ttf
 */

/**
 * Build canvas font string for @napi-rs/canvas
 * @param {string|number} weightCss - Font weight
 * @param {string} fontStyle - Font style
 * @param {number} px - Font size in pixels
 * @returns {string} Canvas font string
 */
export function canvasFontString(weightCss, fontStyle, px) {
  const w = normalizeWeight(weightCss) >= 700 ? 'bold' : 'normal';
  const s = normalizeFontStyle(fontStyle) === 'italic' ? 'italic' : 'normal';
  return `${s} ${w} ${px}px "${FONT_FAMILY}"`;
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
