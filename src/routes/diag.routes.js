import { Router } from "express";
import { MODEL_REGISTRY, STYLE_PRESETS } from "../config/models.js";

const router = Router();

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
    ok: true,
    env: {
      replicateToken: !!process.env.REPLICATE_API_TOKEN,
      diag: process.env.DIAG === "1",
      frontendUrl: process.env.FRONTEND_URL || null,
    },
    styles,
    models,
  });
});

export default router;
