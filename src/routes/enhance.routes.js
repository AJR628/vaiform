import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import { validate } from "../middleware/validate.middleware.js";
import { enhanceController } from "../controllers/enhance.controller.js";

const EnhanceSchema = {
  prompt: (val) => typeof val === 'string' && val.trim().length > 0,
  strength: (val) => val === undefined || (typeof val === 'number' && val >= 0 && val <= 1),
};

const router = Router();

router.post("/enhance-image", requireAuth, validate(EnhanceSchema), enhanceController);

export default router;
