import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import { validate } from "../middleware/validate.middleware.js";
import { EnhanceSchema } from "../schemas/enhance.schema.js";
import { enhanceController } from "../controllers/enhance.controller.js";

const router = Router();

// Auth required; NO idempotency
router.post("/enhance", requireAuth, validate(EnhanceSchema), enhanceController);

export default router;
