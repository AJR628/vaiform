import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import { validate } from "../middleware/validate.middleware.js";
import { enhanceController } from "../controllers/enhance.controller.js";

const router = Router();

router.post("/enhance-image", requireAuth, validate({
  prompt: (v) => typeof v === 'string',
  strength: (v) => v === undefined || (typeof v === 'number' && v >= 0 && v <= 1),
}), enhanceController);

export default router;
