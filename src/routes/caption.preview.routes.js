import express from "express";
import pkg from "@napi-rs/canvas";
const { createCanvas } = pkg;

const router = express.Router();

router.post("/caption/preview", express.json(), async (req, res) => {
  try {
    const {
      text,
      width = 1080,
      height = 1920,
      fontFamily = "DejaVu Sans Local",
      weightCss = "bold",
      fontPx = 48,
      color = "#FFFFFF",
      opacity = 0.85,
      shadow = true,
      showBox = false,              // default OFF to remove gray box
      boxColor = "rgba(0,0,0,0.35)",
      placement = "center",         // 'top' | 'center' | 'bottom'
      yPct,                         // Optional precise Y position (0..1)
      lineHeight = 1.1,
      padding = 24,
      maxWidthPct = 0.8,
      borderRadius = 16
    } = req.body || {};

    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ success:false, error:"INVALID_INPUT", detail:"text required" });
    }

    // Server-side font clamping to prevent overflow
    const ABS_MAX_FONT = 200; // Keep UX reasonable
    const clampedFontPx = Math.min(Number(fontPx) || 48, ABS_MAX_FONT);

    const W = Math.round(width), H = Math.round(height);
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);

    const maxW = Math.round(W * Number(maxWidthPct));
    ctx.font = `${weightCss} ${clampedFontPx}px "${fontFamily}"`;
    ctx.fillStyle = color;
    ctx.globalAlpha = Number(opacity);

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

    let y;
    if (yPct !== undefined && yPct !== null) {
      // Use precise Y position from client (0..1 range)
      y = Math.round(H * Number(yPct)) + clampedFontPx;
    } else {
      // Fallback to placement-based positioning
      if (placement === "top") y = padding + clampedFontPx;
      else if (placement === "bottom") y = H - padding - textH + clampedFontPx;
      else if (placement === "center") y = Math.round((H - textH) / 2) + clampedFontPx;
      else y = Math.round((H - textH) / 2) + clampedFontPx; // fallback to center
    }

    const boxW = maxW + padding * 2;
    const boxH = textH + padding * 2;
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
    ctx.textBaseline = "alphabetic";
    if (shadow) { ctx.shadowColor = "rgba(0,0,0,0.6)"; ctx.shadowBlur = 12; ctx.shadowOffsetY = 2; }
    else { ctx.shadowColor = "transparent"; }

    let cy = y;
    for (const line of lines) { ctx.fillText(line, W/2, cy); cy += lh; }

    const dataUrl = canvas.toDataURL("image/png");
    
    // Include meta information for render reuse
    const meta = {
      splitLines: lines,
      fontPx: clampedFontPx, // Use clamped font size
      lineSpacing: lh,
      xPct: 50, // centered
      yPct: yPct !== undefined ? Number(yPct) : Math.round((y - clampedFontPx) / H * 100) / 100, // Use provided yPct or calculate
      align: "center",
      vAlign: placement === "top" ? "top" : placement === "bottom" ? "bottom" : "center",
      previewHeightPx: H,
      opacity: Number(opacity)
    };
    
    return res.json({ success:true, dataUrl, width:W, height:H, meta });
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
