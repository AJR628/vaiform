import express from "express";
import pkg from "@napi-rs/canvas";
import { CaptionMetaSchema } from '../schemas/caption.schema.js';
const { createCanvas } = pkg;

const router = express.Router();

router.post("/caption/preview", express.json(), async (req, res) => {
  try {
    // Check if this is the new overlay format
    const isOverlayFormat = req.body.placement === 'custom' && req.body.yPct !== undefined;
    
    if (isOverlayFormat) {
      // Handle new draggable overlay format
      const parsed = CaptionMetaSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ ok: false, reason: "INVALID_INPUT", detail: parsed.error.flatten() });
      }

      const meta = parsed.data;
      // SSOT clamp for yPct; keep 0..1
      const SAFE_TOP = 0.10, SAFE_BOTTOM = 0.90;
      const yPct = Math.min(Math.max(meta.yPct, SAFE_TOP), SAFE_BOTTOM);
      const payload = { ...meta, yPct };

      try {
        const previewUrl = await renderPreviewImage(payload);

        // Compute real text dimensions for SSOT meta
        const W = 1080, H = 1920;
        const canvas = createCanvas(W, H);
        const ctx = canvas.getContext("2d");
        
        // Setup font for measurement (match renderPreviewImage)
        const font = `${meta.weightCss || '800'} ${meta.sizePx}px ${pickFont(meta.fontFamily)}`;
        ctx.font = font;
        
        // Measure text wrapping using same width as preview
        const maxWidth = Math.round((meta.wPct ?? 0.80) * W);
        const words = meta.text.split(/\s+/);
        const lines = [];
        let line = "";
        
        for (const word of words) {
          const test = line ? line + " " + word : word;
          if (ctx.measureText(test).width > maxWidth && line) {
            lines.push(line);
            line = word;
          } else {
            line = test;
          }
        }
        if (line) lines.push(line);
        
        // Calculate metrics
        const lineHeight = meta.sizePx * 1.15;
        const totalTextH = lines.length * lineHeight;
        
        // Per-line spacing (gap between baselines minus font height)
        // Consistency guard: single line has no spacing
        const lineSpacingPx = lines.length === 1 ? 0 : Math.round(lineHeight - meta.sizePx);

        // Compute block-center positioning with clamping
        const anchorY = Math.round(payload.yPct * H);
        let yPxFirstLine = Math.round(anchorY - (totalTextH / 2));
        
        // Apply safe margins (same as legacy path)
        const SAFE_TOP = Math.max(50, H * 0.05);
        const SAFE_BOTTOM = Math.max(50, H * 0.08);
        
        // Clamp to safe area
        if (yPxFirstLine < SAFE_TOP) {
          yPxFirstLine = SAFE_TOP;
        }
        if (yPxFirstLine + totalTextH > H - SAFE_BOTTOM) {
          yPxFirstLine = H - SAFE_BOTTOM - totalTextH;
        }

        // Build SSOT meta with real computed values
        const ssotMeta = {
          xPct: payload.xPct,
          yPct: payload.yPct,
          wPct: payload.wPct,
          placement: 'custom',
          internalPadding: 32, // Standard padding
          splitLines: lines,
          fontPx: payload.sizePx,
          lineSpacingPx: lineSpacingPx, // per-line spacing
          totalTextHPx: totalTextH, // block height
          yPxFirstLine: yPxFirstLine, // first-line baseline after centering + clamp
          wPx: 1080,
          hPx: 1920,
        };

        console.log(`[caption-preview] V2 overlay computed: lines=${lines.length}, totalTextH=${totalTextH}, lineSpacingPx=${lineSpacingPx}, yPxFirstLine=${yPxFirstLine}, anchorY=${anchorY}`);

        return res.status(200).json({
          ok: true,
          data: {
            imageUrl: previewUrl,
            wPx: 1080,
            hPx: 1920,
            xPx: 0,
            yPx: 0,
            meta: ssotMeta,
          }
        });
      } catch (e) {
        console.error('[overlay-preview] Preview failed:', e);
        return res.status(500).json({ ok: false, reason: 'RENDER_FAILED', detail: e.message });
      }
    }
    
    // Legacy format handling
    const b = req.body || {};
    const s = b.style || {};

    // SSOT: prefer style.*, then fall back to top-level
    const text = (req.body?.style?.text ?? req.body?.text ?? "").toString().trim();
    if (!text) {
      return res.status(400).json({ success: false, error: "INVALID_INPUT", detail: "text required" });
    }

    const fontFamily = (s.fontFamily ?? b.fontFamily ?? "DejaVu Sans Local");
    const weightCss = (s.weightCss ?? b.weightCss ?? "bold");
    const fontPx = (s.fontPx ?? b.fontPx ?? 48);
    const color = (s.color ?? b.color ?? "#FFFFFF");
    const opacity = Number(s.opacity ?? b.opacity ?? 0.85);
    const shadow = (s.shadow ?? b.shadow ?? true);
    const showBox = (s.showBox ?? b.showBox ?? false);
    const boxColor = (s.boxColor ?? b.boxColor ?? "rgba(0,0,0,0.35)");
    const yPct = (s.yPct ?? b.yPct);
    const lineHeight = (s.lineHeight ?? b.lineHeight ?? 1.1);
    const padding = (s.padding ?? b.padding ?? 24);
    const maxWidthPct = (s.maxWidthPct ?? b.maxWidthPct ?? 0.8);
    const borderRadius = (s.borderRadius ?? b.borderRadius ?? 16);

    // Read placement from SSOT path first, then fallback, with validation
    const rawPlacement = (req.body?.style?.placement ?? req.body?.placement ?? 'center');
    const placement = ['top','center','bottom'].includes(String(rawPlacement).toLowerCase())
      ? String(rawPlacement).toLowerCase()
      : 'center';

    // Force consistent canvas dimensions for all caption previews
    const W = 1080; // Standard canvas width
    const H = 1920; // Standard canvas height

    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ success:false, error:"INVALID_INPUT", detail:"text required" });
    }

    // Server-side font clamping to prevent overflow (match frontend limits)
    const ABS_MAX_FONT = 120; // Match frontend API_MAX_PX for larger text
    const ABS_MIN_FONT = 32;  // Match frontend API_MIN_PX
    const clampedFontPx = Math.max(ABS_MIN_FONT, Math.min(Number(fontPx) || 48, ABS_MAX_FONT));

    // Validate required numeric inputs
    if (!Number.isFinite(clampedFontPx)) {
      return res.status(400).json({ success:false, error:"INVALID_INPUT", detail:"fontPx must be a valid number" });
    }

    // SSOT: Server derives effective values from client intent
    // Define helper functions FIRST before using them
    function resolveYpct(clientYPct, clientPlacement) {
      // If client provided yPct, use it (they know their intent)
      if (clientYPct !== undefined && clientYPct !== null) {
        return Math.max(0.1, Math.min(0.9, Number(clientYPct)));
      }
      // Otherwise derive from placement
      switch (clientPlacement) {
        case 'top': return 0.10;
        case 'center': return 0.50;
        case 'bottom': return 0.90;
        default: return 0.50;
      }
    }
    
    function resolveFontFamilyUsed(clientFontFamily) {
      // SSOT: Use consistent font family name that matches registration
      const fontMap = {
        'DejaVuSans': 'DejaVu Sans',
        'DejaVu Sans Local': 'DejaVu Sans',
        'DejaVu Serif Local': 'DejaVu Serif',
        'DejaVu Serif Bold Local': 'DejaVu Serif Bold'
      };
      return fontMap[clientFontFamily] || 'DejaVu Sans';
    }
    
    function clamp01(value) {
      return Math.max(0, Math.min(1, Number(value) || 0.85));
    }

    // Derive effective values AFTER function definitions
    const yPctUsed = resolveYpct(yPct, placement);
    const fontFamilyUsed = resolveFontFamilyUsed(fontFamily);
    // SSOT: Handle weight properly - we only have bold font file, so use bold for bold weight
    const weightUsed = (weightCss === 'bold' || weightCss === 700) ? 'bold' : 'normal';
    const opacityUsed = clamp01(opacity);
    
    console.log(`[caption] Derived values: yPctUsed=${yPctUsed}, fontFamilyUsed=${fontFamilyUsed}, weightUsed=${weightUsed}, opacityUsed=${opacityUsed}`);

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);

    const maxW = Math.round(W * Number(maxWidthPct));
    console.log(`[caption] Using maxWidthPct=${maxWidthPct}, maxW=${maxW}`);
    
    // Apply derived values to canvas
    // SSOT: Use proper weight handling - since we only have bold font, use bold for bold weight
    const fontWeight = (weightUsed === 'bold') ? 'bold' : 'normal';
    const fontString = `${fontWeight} ${clampedFontPx}px "${fontFamilyUsed}"`;
    console.log(`[caption] Font set to: ${fontString}`);
    ctx.font = fontString;
    ctx.fillStyle = color;
    ctx.globalAlpha = opacityUsed;

    // word-wrap
    function wrapLines(t) {
      const words = t.split(/\s+/);
      const lines = [];
      let line = "";
      for (const w of words) {
        const test = line ? line + " " + w : w;
        if (ctx.measureText(test).width > maxW && line) {
          lines.push(line); line = w;
        } else line = test;
      }
      if (line) lines.push(line);
      return lines;
    }
    const lines = wrapLines(text);
    const lh = Math.round(clampedFontPx * Number(lineHeight));
    const textH = lines.length * lh;
    
    // Ensure we have valid text dimensions
    if (!lines.length || !Number.isFinite(textH)) {
      return res.status(400).json({ success:false, error:"INVALID_INPUT", detail:"failed to compute text dimensions" });
    }
    
    // Variables already defined above
    
    // Calculate text dimensions
    const totalTextH = lines.length * lh;
    
    // SSOT: yPct is the anchor point along canvas height
    // placement: 'top' → anchor is top of text block
    // placement: 'center' → center of text block  
    // placement: 'bottom' → bottom of text block
    const anchorY = Math.round(H * yPctUsed);
    
    // Add internal padding to the text box to prevent clipping
    const internalPadding = 32; // 32px padding on all sides
    const boxW = maxW + internalPadding * 2;
    const boxH = textH + internalPadding * 2;
    const x = Math.round((W - boxW) / 2);
    
    // Calculate text block position based on anchor semantics
    let textBlockTop;
    if (placement === 'top') {
      // Anchor is top of text block
      textBlockTop = anchorY;
    } else if (placement === 'center') {
      // Anchor is center of text block
      textBlockTop = anchorY - (totalTextH / 2);
    } else if (placement === 'bottom') {
      // Anchor is bottom of text block
      textBlockTop = anchorY - totalTextH;
    } else {
      // Default to center
      textBlockTop = anchorY - (totalTextH / 2);
    }
    
    // Apply padding to get final text start position
    const textStartY = textBlockTop + internalPadding;
    
    console.log(`[caption] placement=${placement}, fontPx=${clampedFontPx}, totalTextH=${totalTextH}, yPct=${yPctUsed}, anchorY=${anchorY}, textBlockTop=${textBlockTop}, textStartY=${textStartY}`);
    console.log(`[caption] effective values: fontFamilyUsed=${fontFamilyUsed}, weightUsed=${weightUsed}, opacityUsed=${opacityUsed}`);

    if (showBox) {
      ctx.save();
      ctx.globalAlpha = 1.0;
      ctx.fillStyle = boxColor;
      roundRect(ctx, x, textBlockTop, boxW, boxH, borderRadius);
      ctx.fill();
      ctx.restore();
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "top";      // IMPORTANT: Use top baseline for proper positioning
    if (shadow) { ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 12; ctx.shadowOffsetY = 2; }
    else { ctx.shadowColor = "transparent"; }

    // Position text within the padded box
    let cy = textStartY;
    for (const line of lines) { ctx.fillText(line, W/2, cy); cy += lh; }

    const dataUrl = canvas.toDataURL("image/png");
    
    // Include meta information for render reuse with proper height data
    const meta = {
      splitLines: lines,
      fontPx: clampedFontPx, // Use clamped font size
      lineSpacing: lh,
      xPct: 50, // centered
      yPct: yPctUsed, // Use derived yPct (anchor point)
      align: "center",
      vAlign: placement === "top" ? "top" : placement === "bottom" ? "bottom" : "center",
      previewHeightPx: H,
      opacityUsed: opacityUsed, // Echo derived opacity
      totalTextH: totalTextH, // Total text height for positioning
      hPx: boxH, // Height of padded text box
      wPx: boxW, // Width of padded text box
      placement: placement, // Include placement for reference
      fontFamilyUsed: fontFamilyUsed, // Echo derived font family
      weightUsed: weightUsed, // Echo derived weight
      internalPadding: internalPadding, // Include padding info for frontend
      safeTopMarginPct: 0.1, // Document safe margins
      safeBottomMarginPct: 0.1,
      // SSOT: Include anchor positioning info for client
      anchorY: anchorY, // Server-computed anchor point
      textBlockTop: textBlockTop // Server-computed text block top position
    };
    
    // Debug logging
    console.log('[caption-overlay] meta:', {
      fontPx: clampedFontPx,
      lineSpacing: lh,
      xPct: 50,
      yPct: meta.yPct,
      vAlign: meta.vAlign,
      fontFamilyUsed: meta.fontFamilyUsed,
      weightUsed: meta.weightUsed,
      opacityUsed: meta.opacityUsed,
      frame: { W, H },
      safeW: Math.floor(W * 0.92),
      safeH: Math.floor(H * 0.84)
    });
    
    return res.json({
      ok: true,
      data: {
        imageUrl: dataUrl,
        wPx: W,
        hPx: H,
        xPx: 0,
        yPx: textStartY,
        meta: {
          // Restrict to SSOT meta keys for legacy branch too
          yPct: yPctUsed,
          totalTextH: totalTextH,
          lineSpacingPx: lh,
          fontPx: clampedFontPx,
          internalPadding,
          placement,
          wPx: W,
          hPx: H,
          splitLines: lines,
          baselines: undefined,
        }
      }
    });
  } catch (e) {
    return res.status(400).json({ success:false, error:"INVALID_INPUT", detail:String(e?.message || e) });
  }
});

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

// Smoke test route for quick debugging
router.get("/diag/caption-smoke", async (req, res) => {
  try {
    const W = 1080, H = 1920;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    
    // Simple test with DejaVu font
    ctx.font = `bold 48px "DejaVu Sans Local"`;
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("SMOKE TEST", W/2, H/2);
    
    const dataUrl = canvas.toDataURL("image/png");
    return res.json({ 
      ok: true, 
      message: "Caption smoke test passed",
      hasDataUrl: !!dataUrl,
      dataUrlLength: dataUrl.length 
    });
  } catch (e) {
    return res.status(500).json({ 
      ok: false, 
      error: String(e?.message || e),
      message: "Caption smoke test failed"
    });
  }
});

// New overlay format renderer
async function renderPreviewImage(meta) {
  const W = 1080, H = 1920; // Standard canvas dimensions
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, W, H);

  // Extract positioning from meta
  const x = Math.round((meta.xPct ?? 0.10) * W);
  const y = Math.round(meta.yPct * H);
  const maxWidth = Math.round((meta.wPct ?? 0.80) * W);
  
  // Font setup
  const font = `${meta.weightCss || '800'} ${meta.sizePx}px ${pickFont(meta.fontFamily)}`;
  const color = toRgba(meta.color, meta.opacity ?? 1);
  
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = meta.textAlign || 'center';
  ctx.textBaseline = 'top';
  
  // Text wrapping
  const words = meta.text.split(/\s+/);
  const lines = [];
  let line = "";
  
  for (const word of words) {
    const test = line ? line + " " + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  
  // Calculate text dimensions
  const lineHeight = meta.sizePx * 1.15;
  const totalTextH = lines.length * lineHeight;
  
  // Position text
  let textY = y;
  if (meta.textAlign === 'center') {
    textY = y - (totalTextH / 2);
  } else if (meta.textAlign === 'bottom') {
    textY = y - totalTextH;
  }
  
  // Draw text with shadow
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 2;
  
  lines.forEach((line, index) => {
    const lineY = textY + (index * lineHeight);
    ctx.fillText(line, x, lineY);
  });
  
  return canvas.toDataURL("image/png");
}

function pickFont(fontFamily) {
  const fontMap = {
    'DejaVuSans': 'DejaVu Sans',
    'DejaVu Sans Local': 'DejaVu Sans',
    'DejaVu Serif Local': 'DejaVu Serif',
    'DejaVu Serif Bold Local': 'DejaVu Serif Bold'
  };
  return fontMap[fontFamily] || 'DejaVu Sans';
}

function toRgba(color, opacity) {
  // Simple color conversion - in production you'd want a proper color parser
  if (color.startsWith('rgb')) {
    return color.replace('rgb', 'rgba').replace(')', `, ${opacity})`);
  }
  return `rgba(255, 255, 255, ${opacity})`;
}

export default router;
