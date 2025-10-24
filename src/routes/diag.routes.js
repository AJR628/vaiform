import { Router } from "express";
import { MODEL_REGISTRY, STYLE_PRESETS } from "../config/models.js";
import { getLastTtsState } from "../services/tts.service.js";
import { dump as storeDump } from "../studio/store.js";
import { renderCaptionImage } from "../caption/renderCaptionImage.js";
import crypto from "node:crypto";

const router = Router();

router.post("/echo", (req, res) => {
  res.json({
    ct: req.headers["content-type"] || null,
    body: req.body ?? null,
  });
});

router.get("/", (_req, res) => {
  const styles = Object.keys(STYLE_PRESETS || {});
  const models = Object.entries(MODEL_REGISTRY || {}).map(([id, m]) => ({
    id,
    provider: m.provider,
    kind: m.kind,
    maxImages: m.maxImages,
    providerRef: m.providerRef, // slug or version only (no secrets)
  }));

  res.json({
    success: true,
    env: {
      replicateToken: !!process.env.REPLICATE_API_TOKEN,
      diag: process.env.DIAG === "1",
      frontendUrl: process.env.FRONTEND_URL || null,
    },
    styles,
    models,
  });
});

router.get('/store', async (_req, res) => {
  try {
    const all = storeDump ? storeDump() : {};
    const sample = Object.values(all).slice(-5).reverse();
    return res.json({ ok:true, size: Object.keys(all).length, sample });
  } catch {
    return res.json({ ok:false, size: 0, sample: [] });
  }
});

router.get("/tts", (_req, res) => {
  const provider = (process.env.TTS_PROVIDER || "openai").toLowerCase();
  const configured = (provider === "openai" && !!process.env.OPENAI_API_KEY) ||
                     (provider === "elevenlabs" && !!process.env.ELEVENLABS_API_KEY && !!process.env.ELEVEN_VOICE_ID);
  const model = provider === "openai" ? (process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts") : (process.env.ELEVEN_TTS_MODEL || "eleven_flash_v2_5");
  const voiceOrVoiceId = provider === "openai" ? (process.env.OPENAI_TTS_VOICE || "alloy") : (process.env.ELEVEN_VOICE_ID || null);
  res.json({ ok: true, provider, configured, model, voiceOrVoiceId });
});

router.get("/tts_state", (_req, res) => {
  const provider = (process.env.TTS_PROVIDER || "openai");
  const configured = Boolean(process.env.OPENAI_API_KEY) || Boolean(process.env.ELEVENLABS_API_KEY);
  res.json({ ok: true, provider, configured, last: getLastTtsState() });
});

router.get("/caption-smoke", async (_req, res) => {
  try {
    const jobId = `smoke-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
    
    const testStyle = {
      text: "This is a test caption for smoke testing the new PNG overlay system.",
      fontFamily: 'DejaVu Sans',
      fontWeight: 700,
      fontPx: 44,
      lineSpacingPx: 52,
      align: 'center',
      textAlpha: 1.0,
      fill: 'rgba(255,255,255,1)',
      strokePx: 3,
      strokeColor: 'rgba(0,0,0,0.85)',
      shadowX: 0,
      shadowY: 2,
      shadowBlur: 4,
      shadowColor: 'rgba(0,0,0,0.55)',
      boxXPx: 42,
      boxYPx: 230,
      boxWPx: 996,
      boxHPx: 400,
      canvasW: 1080,
      canvasH: 1920,
    };

    const result = await renderCaptionImage(jobId, testStyle);
    
    res.json({
      ok: true,
      jobId,
      result: {
        pngPath: result.pngPath,
        xPx: result.xPx,
        yPx: result.yPx,
        wPx: result.wPx,
        hPx: result.hPx,
        meta: result.meta,
      },
      testStyle,
    });
  } catch (error) {
    console.error('[diag] Caption smoke test failed:', error);
    res.status(500).json({
      ok: false,
      error: error.message,
      stack: error.stack,
    });
  }
});

export default router;
