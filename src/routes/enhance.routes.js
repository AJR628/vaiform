import { Router } from "express";
import requireAuth from "../middleware/auth.js";
import { validate } from "../middleware/validate.middleware.js";

// 🔒 Firestore-backed idempotency (prod-safe)
import idempotency from "../middleware/idempotency.firestore.js";
// For local/dev only, you could swap to in-memory:
// import idempotency from "../middleware/idempotency.js";

import { enhanceController } from "../controllers/enhance.controller.js";
import { EnhanceSchema } from "../schemas/enhance.schema.js";

const router = Router();

/**
 * POST /enhance
 * Headers:
 *  - Authorization: Bearer <ID_TOKEN>
 *  - X-Idempotency-Key: <unique-string-per-attempt>
 *
 * Body:
 *  { "prompt": string, "strength"?: number in [0,1] }
 */
router.post(
  "/",
  requireAuth,
  validate(EnhanceSchema),          // ✅ validate input first
  idempotency({ ttlMinutes: 60 }),  // ✅ prevent double charge/run
  enhanceController
);

export default router;