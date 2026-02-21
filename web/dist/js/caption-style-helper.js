/**
 * Extract style-only fields from any caption object (whitelist)
 * Strips all preview/geometry/mode fields
 *
 * Allowed fields:
 * - Typography: fontFamily, fontPx, weightCss, fontStyle, letterSpacingPx, lineSpacingPx
 * - Color & Effects: color, opacity, strokePx, strokeColor, shadowBlur, shadowOffsetX, shadowOffsetY, shadowColor
 * - Placement: placement, yPct, xPct, wPct
 *
 * Rejected fields (dangerous): mode, lines, rasterUrl, rasterHash, rasterW, rasterH, yPx_png, totalTextH, text, etc.
 */
export function extractStyleOnly(obj) {
  if (!obj || typeof obj !== 'object') return {};

  const allowed = [
    'fontFamily',
    'fontPx',
    'weightCss',
    'fontStyle',
    'letterSpacingPx',
    'lineSpacingPx',
    'color',
    'opacity',
    'strokePx',
    'strokeColor',
    'shadowBlur',
    'shadowOffsetX',
    'shadowOffsetY',
    'shadowColor',
    'placement',
    'yPct',
    'xPct',
    'wPct',
  ];

  const styleOnly = {};
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      styleOnly[key] = obj[key];
    }
  }

  return styleOnly;
}
