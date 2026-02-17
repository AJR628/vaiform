// Single source of truth for all caption defaults
export const CAPTION_DEFAULTS = {
  fontFamily: 'DejaVu Sans',
  fontPx: 64,
  weightCss: 'normal',
  fontStyle: 'normal',
  letterSpacingPx: 0.5, // ✅ Unified default
  lineSpacingPx: 0,
  color: '#FFFFFF',
  opacity: 1.0,
  strokePx: 3,
  strokeColor: 'rgba(0,0,0,0.85)',
  shadowBlur: 0,
  shadowOffsetX: 1,
  shadowOffsetY: 1,
  shadowColor: 'rgba(0,0,0,0.6)',
  textAlign: 'center',
  textTransform: 'none',
  wPct: 0.8,
  internalPaddingPx: 24, // ✅ Canonical name (alias: rasterPadding for backwards compat)
};

export const CAPTION_LIMITS = {
  fontPx: { min: 8, max: 400 }, // Validation range (schema accepts 8-400)
  lineSpacingPx: { min: 0, max: 400 },
  safeTopMarginPct: 0.1,
  safeBottomMarginPct: 0.1,
};

// Enforced font range (matches preview route ABS_MIN/MAX_FONT)
// Values in validation range (8-400) are clamped to this enforced range (32-120)
export const ENFORCED_FONT_MIN = 32;
export const ENFORCED_FONT_MAX = 120;

export const FRAME_DIMS = {
  W: 1080,
  H: 1920,
};
