import { Router } from "express";
import requireAuth from "../middleware/auth.js";
import { validate } from "../middleware/validate.middleware.js";
import idempotency from "../middleware/idempotency.firestore.js";
import { enhanceController } from "../controllers/enhance.controller.js";
import { EnhanceSchema } from "../schemas/enhance.schema.js";

const router = Router();

router.post(
  "/",
  requireAuth,
  validate(EnhanceSchema),
  idempotency({ ttlMinutes: 60 }),
  enhanceController
);

export default router;
