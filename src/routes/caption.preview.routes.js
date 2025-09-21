import express from "express";
import pkg from "@napi-rs/canvas";
const { createCanvas } = pkg;

const router = express.Router();

router.post("/api/caption/preview", express.json(), async (req, res) => {
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
      lineHeight = 1.1,
      padding = 24,
      maxWidthPct = 0.8,
      borderRadius = 16
    } = req.body || {};

    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ success:false, error:"INVALID_INPUT", detail:"text required" });
    }

    const W = Math.round(width), H = Math.round(height);
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);

    const maxW = Math.round(W * Number(maxWidthPct));
    ctx.font = `${weightCss} ${Number(fontPx)}px "${fontFamily}"`;
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
    const lh = Math.round(Number(fontPx) * Number(lineHeight));
    const textH = lines.length * lh;

    let y;
    if (placement === "top") y = padding + Number(fontPx);
    else if (placement === "bottom") y = H - padding - textH + Number(fontPx);
    else y = Math.round((H - textH) / 2) + Number(fontPx);

    const boxW = maxW + padding * 2;
    const boxH = textH + padding * 2;
    const x = Math.round((W - boxW) / 2);

    if (showBox) {
      ctx.save();
      ctx.globalAlpha = 1.0;
      ctx.fillStyle = boxColor;
      roundRect(ctx, x, y - Number(fontPx) - padding, boxW, boxH, borderRadius);
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
    return res.json({ success:true, dataUrl, width:W, height:H });
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

export default router;
