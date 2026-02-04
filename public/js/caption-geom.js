// caption-geom.js - Shared geometry utilities for caption overlay positioning
(function () {
  const SAFE_TOP_PX = 24;
  const SAFE_BOTTOM_PX = 36;
  const DESCENDER_PAD = 8;
  const SHADOW_BLUR_DEFAULT = 12;
  const SHADOW_OFFSET_Y_DEFAULT = 2;

  function computeRasterH({ totalTextH, padTop, padBottom, shadowBlur, shadowOffsetY }) {
    const blur = Number.isFinite(shadowBlur) ? shadowBlur : SHADOW_BLUR_DEFAULT;
    const offY = Number.isFinite(shadowOffsetY) ? shadowOffsetY : SHADOW_OFFSET_Y_DEFAULT;
    return Math.round(totalTextH + padTop + padBottom + DESCENDER_PAD + blur + Math.max(0, offY));
  }

  function computeYPxFromPlacement(placement, rasterH) {
    const { H: FRAME_H } = getFrameDims();
    if (placement === 'top') return SAFE_TOP_PX;
    if (placement === 'center') return Math.round((FRAME_H - rasterH) / 2);
    return Math.round(FRAME_H - rasterH - SAFE_BOTTOM_PX);
  }

  function getFrameDims() {
    const m = window.currentCaptionMeta || window.__overlayMeta || {};
    return { W: m.frameW || 1080, H: m.frameH || 1920 };
  }

  function parseShadow(textShadow) {
    if (!textShadow || textShadow === 'none') {
      return { blur: 0, y: 0 };
    }
    const parts = (textShadow || '').split(',').map(s => s.trim());
    let maxBlur = 0, maxY = 0;
    for (const p of parts) {
      const m = p.match(/(-?\d+\.?\d*)px\s+(-?\d+\.?\d*)px(?:\s+(\d+\.?\d*)px)?/);
      if (m) {
        const y = parseFloat(m[2]) || 0;
        const blur = parseFloat(m[3]) || 0;
        maxY = Math.max(maxY, y);
        maxBlur = Math.max(maxBlur, blur);
      }
    }
    return { blur: maxBlur, y: maxY };
  }

  function yPctFromPlacement(placement) {
    switch (String(placement || 'bottom').toLowerCase()) {
      case 'top': return 0.10;
      case 'center': 
      case 'middle': return 0.50;
      case 'bottom': 
      default: return 0.90;
    }
  }

  window.CaptionGeom = {
    SAFE_TOP_PX,
    SAFE_BOTTOM_PX,
    DESCENDER_PAD,
    SHADOW_BLUR_DEFAULT,
    SHADOW_OFFSET_Y_DEFAULT,
    computeRasterH,
    computeYPxFromPlacement,
    getFrameDims,
    parseShadow,
    yPctFromPlacement
  };
})();
