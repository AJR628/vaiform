import { Router } from "express";
import { MODEL_REGISTRY, STYLE_PRESETS } from "../config/models.js";
import { getLastTtsState } from "../services/tts.service.js";
import { dump as storeDump } from "../studio/store.js";

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

export default router;
