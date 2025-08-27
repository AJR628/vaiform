import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import { validate } from "../middleware/validate.middleware.js";
import { enhanceController } from "../controllers/enhance.controller.js";

const r = Router();

// Auth required; NO idempotency
r.post("/enhance-image", requireAuth, validate({prompt: String, strength: (val) => val == null || (val >= 0 && val <= 1) }), enhanceController);

export default r;
