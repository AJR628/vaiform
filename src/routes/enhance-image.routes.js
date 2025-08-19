import { Router } from "express";
import requireAuth from "../middleware/auth.js";
import { validate } from "../middleware/validate.middleware.js";
import { enhanceImageController } from "../controllers/enhance-image.controller.js";
import { EnhanceImageSchema } from "../schemas/enhance-image.schema.js";

const router = Router();

/**
 * POST /enhance-image
 * Body: { "prompt": string, "strength"?: number }
 */
router.post("/", requireAuth, validate(EnhanceImageSchema), enhanceImageController);

export default router;