import {
  CAPTION_DEFAULTS,
  CAPTION_LIMITS,
  FRAME_DIMS,
  ENFORCED_FONT_MIN,
  ENFORCED_FONT_MAX,
} from './constants.js';
import { wrapTextWithFont } from '../utils/caption.wrap.js';
import { deriveCaptionWrapWidthPx } from '../utils/caption.wrapWidth.js';
import { extractStyleOnly } from '../utils/caption-style-helper.js';
import crypto from 'crypto';

/**
 * Compile caption SSOT - single source of truth for caption compilation
 * @param {Object} payload
 * @param {string} payload.textRaw - Raw text (authoritative)
 * @param {Object} [payload.style] - Partial style (user intent)
 * @param {number} [payload.frameW] - Frame width (default: 1080)
 * @param {number} [payload.frameH] - Frame height (default: 1920)
 * @returns {Object} CaptionMeta with effectiveStyle, lines, hashes, etc.
 */
export function compileCaptionSSOT(payload) {
  // 1. Sanitize style input (only allow known style keys) - MANDATORY
  const sanitizedStyle = extractStyleOnly(payload.style ?? {});

  // 2. Resolve effectiveStyle (merge sanitized style with defaults)
  const effectiveStyle = {
    ...CAPTION_DEFAULTS,
    ...sanitizedStyle,
  };

  // 3. Clamp fontPx to enforced range (32-120) - NOT validation range (8-400)
  if (effectiveStyle.fontPx) {
    effectiveStyle.fontPx = Math.max(
      ENFORCED_FONT_MIN,
      Math.min(ENFORCED_FONT_MAX, effectiveStyle.fontPx)
    );
  }

  // 4. Compute maxWidthPx
  const frameW = payload.frameW || FRAME_DIMS.W;
  const frameH = payload.frameH || FRAME_DIMS.H;
  const { maxWidthPx } = deriveCaptionWrapWidthPx({
    frameW,
    wPct: effectiveStyle.wPct,
    internalPaddingPx: effectiveStyle.internalPaddingPx,
  });

  // 5. Compute authoritative lines[]
  const wrapResult = wrapTextWithFont(payload.textRaw, {
    fontPx: effectiveStyle.fontPx,
    weightCss: effectiveStyle.weightCss,
    fontStyle: effectiveStyle.fontStyle,
    fontFamily: effectiveStyle.fontFamily,
    maxWidthPx,
    letterSpacingPx: effectiveStyle.letterSpacingPx,
    lineSpacingPx: effectiveStyle.lineSpacingPx,
  });

  // 6. Compute hashes
  const styleHash = hashStyle(effectiveStyle);
  // wrapHash must include all factors affecting wrap: text, maxWidthPx, font metrics, letterSpacingPx
  const wrapHash = hashWrap(
    payload.textRaw.trim().toLowerCase(), // Normalized text
    maxWidthPx,
    effectiveStyle.fontFamily,
    effectiveStyle.fontPx,
    effectiveStyle.weightCss,
    effectiveStyle.fontStyle,
    effectiveStyle.letterSpacingPx // ✅ Critical: affects measurement
  );

  // 7. Return canonical meta
  return {
    effectiveStyle,
    maxWidthPx,
    lines: wrapResult.lines,
    totalTextH: wrapResult.totalTextH,
    styleHash,
    wrapHash,
    // Geometry fields (for compatibility)
    frameW,
    frameH,
  };
}

/**
 * Hash style object for staleness detection
 */
function hashStyle(style) {
  const keys = Object.keys(style).sort();
  const str = keys.map((k) => `${k}:${style[k]}`).join('|');
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}

/**
 * Hash wrap factors for staleness detection
 */
function hashWrap(textRaw, maxWidthPx, fontFamily, fontPx, weightCss, fontStyle, letterSpacingPx) {
  const str = `${textRaw}|${maxWidthPx}|${fontFamily}|${fontPx}|${weightCss}|${fontStyle}|${letterSpacingPx}`;
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 16);
}
