import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import { validate } from "../middleware/validate.middleware.js";
import { planGuard } from "../middleware/planGuard.js";
import { AssetsOptionsSchema, AiImagesSchema } from "../schemas/quotes.schema.js";
import { getAssetsOptions, generateAiImages } from "../controllers/assets.controller.js";

const r = Router();

r.post("/options", requireAuth, validate(AssetsOptionsSchema), getAssetsOptions);
r.post("/ai-images", requireAuth, planGuard('pro'), validate(AiImagesSchema), generateAiImages);

export default r;
