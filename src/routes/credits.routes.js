import { Router } from "express";
import requireAuth from "../middleware/auth.js";
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
router.get("/balance", balance);
router.post("/grant", grant);

export default router;
