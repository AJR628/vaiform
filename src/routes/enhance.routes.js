import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import { enhanceController } from "../controllers/enhance.controller.js";

const router = Router();

// Auth required; NO idempotency
router.post("/enhance", requireAuth, enhanceController);

export default router;
