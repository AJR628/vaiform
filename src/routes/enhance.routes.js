import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import { validate } from "../middleware/validate.middleware.js";
import { enhanceController } from "../controllers/enhance.controller.js";

const r = Router();

r.post("/enhance-image", requireAuth, validate({
  prompt: (value) => typeof value === 'string' && value.length > 0,
  strength: (value) => value === undefined || (typeof value === 'number' && value >= 0 && value <= 1)
}), enhanceController);

export default r;
