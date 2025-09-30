import express from "express";
import pkg from "@napi-rs/canvas";
const { createCanvas } = pkg;

const router = express.Router();

router.post("/caption/preview", express.json(), async (req, res) => {
  try {
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
      const fontMap = {
        'DejaVuSans': 'DejaVu Sans',
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
    const weightUsed = (weightCss === 'bold' || weightCss === 700) ? 'bold' : 'normal';
    const opacityUsed = clamp01(opacity);
    
    console.log(`[caption] Derived values: yPctUsed=${yPctUsed}, fontFamilyUsed=${fontFamilyUsed}, weightUsed=${weightUsed}, opacityUsed=${opacityUsed}`);

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);

    const maxW = Math.round(W * Number(maxWidthPct));
    console.log(`[caption] Using maxWidthPct=${maxWidthPct}, maxW=${maxW}`);
    
    // Apply derived values to canvas
    const fontString = `${weightUsed} ${clampedFontPx}px "${fontFamilyUsed}"`;
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
    const y = Math.round(H * yPctUsed);
    
    console.log(`[caption] placement=${placement}, fontPx=${clampedFontPx}, totalTextH=${totalTextH}, yPct=${yPctUsed}, y=${y}`);
    console.log(`[caption] effective values: fontFamilyUsed=${fontFamilyUsed}, weightUsed=${weightUsed}, opacityUsed=${opacityUsed}`);

    // Add internal padding to the text box to prevent clipping
    const internalPadding = 32; // 32px padding on all sides
    const boxW = maxW + internalPadding * 2;
    const boxH = textH + internalPadding * 2;
    const x = Math.round((W - boxW) / 2);

    if (showBox) {
      ctx.save();
      ctx.globalAlpha = 1.0;
      ctx.fillStyle = boxColor;
      roundRect(ctx, x, y - clampedFontPx - padding, boxW, boxH, borderRadius);
      ctx.fill();
      ctx.restore();
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "top";      // IMPORTANT: Use top baseline for proper positioning
    if (shadow) { ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 12; ctx.shadowOffsetY = 2; }
    else { ctx.shadowColor = "transparent"; }

    // Position text within the padded box
    const textStartY = y + internalPadding;
    let cy = textStartY;
    for (const line of lines) { ctx.fillText(line, W/2, cy); cy += lh; }

    const dataUrl = canvas.toDataURL("image/png");
    
    // Include meta information for render reuse with proper height data
    const meta = {
      splitLines: lines,
      fontPx: clampedFontPx, // Use clamped font size
      lineSpacing: lh,
      xPct: 50, // centered
      yPct: yPctUsed, // Use derived yPct
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
      safeBottomMarginPct: 0.1
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
        yPx: y,
        meta: meta
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

export default router;
