import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import { validate } from "../middleware/validate.middleware.js";
import { planGuard } from "../middleware/planGuard.js";
import { AssetsOptionsSchema, AiImagesSchema } from "../schemas/quotes.schema.js";
import { getAssetsOptions, generateAiImages } from "../controllers/assets.controller.js";

const r = Router();

r.post("/options", requireAuth, validate(AssetsOptionsSchema), getAssetsOptions);
// [AI_IMAGES] Route left in place but hard-disabled for v1 (no backend calls to providers)
r.post("/ai-images", requireAuth, planGuard('pro'), validate(AiImagesSchema), (req, res) => {
  return res.status(410).json({
    success: false,
    error: "FEATURE_DISABLED",
    detail: "AI image generation is not available in this version of Vaiform.",
  });
});

export default r;
