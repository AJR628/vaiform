// src/routes/enhance.routes.js
import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";
import { enhanceController } from "../controllers/enhance.controller.js";
import { z } from "zod";

const router = Router();

const enhanceSchema = z.object({
  prompt: z.string(),
  strength: z.number().min(0).max(1).optional(),
});

router.post("/enhance-image", requireAuth, (req, res, next) => {
  const parseResult = enhanceSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ success: false, error: "VALIDATION_ERROR", issues: parseResult.error.errors });
  }
  next();
}, enhanceController);

export default router;
