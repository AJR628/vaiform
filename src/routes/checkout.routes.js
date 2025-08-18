// src/routes/checkout.routes.js
import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import {
  createCheckoutSession,
  createSubscriptionSession,
  createBillingPortalSession,
} from "../controllers/checkout.controller.js";

const router = Router();

// One-time (single charge)
router.post("/session", requireAuth, createCheckoutSession);

// Monthly (recurring)
router.post("/subscription", requireAuth, createSubscriptionSession);

// Billing Portal (manage subscription/payment methods)
router.post("/portal", requireAuth, createBillingPortalSession);

export default router;