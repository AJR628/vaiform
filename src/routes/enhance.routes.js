import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import { validate } from "../middleware/validate.middleware.js";
import { enhanceController } from "../controllers/enhance.controller.js";

const router = Router();

router.post("/enhance-image", requireAuth, validate((obj) => {
  if (typeof obj.prompt === 'string' && obj.prompt && (obj.strength === undefined || (typeof obj.strength === 'number' && obj.strength >= 0 && obj.strength <= 1))) {
    return { valid: true, data: obj };
  }
  return { valid: false, error: 'Invalid input' };
}), enhanceController);

export default router;
