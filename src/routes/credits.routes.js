import { Router } from "express";
import requireAuth from "../middleware/requireAuth.js";

// Tolerant validate import
import * as Validate from "../middleware/validate.middleware.js";
const validate = Validate.validate ?? Validate.default;

import { balanceQuerySchema, grantBodySchema } from "../schemas/credits.schema.js";
import { getCredits, balance, grant } from "../controllers/credits.controller.js";

const router = Router();

/**
 * Authenticated credits endpoint
 * GET /credits   → { email, credits }
 */
router.get("/", requireAuth, getCredits);

/**
 * Legacy helpers (keep for testing/backwards-compat)
 * GET  /credits/balance?email=you@example.com
 * POST /credits/grant { email, credits }
 */
router.get("/balance", validate(balanceQuerySchema, 'query'), balance);
router.post("/grant", validate(grantBodySchema), grant);

export default router;
