// src/routes/checkout.routes.js
import { Router } from 'express';
import requireAuth from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.middleware.js';
import { checkoutSessionSchema, subscriptionSessionSchema } from '../schemas/checkout.schema.js';
import {
  createCheckoutSession,
  createSubscriptionSession,
  createBillingPortalSession,
} from '../controllers/checkout.controller.js';
import { startPlanCheckout } from '../controllers/checkout.controller.js';

const router = Router();

// New Plans & Pricing checkout
router.post('/start', requireAuth, startPlanCheckout);

// Legacy credit pack routes (keep alive but hidden)
// One-time (single charge)
router.post('/session', requireAuth, validate(checkoutSessionSchema), createCheckoutSession);

// Monthly (recurring)
router.post(
  '/subscription',
  requireAuth,
  validate(subscriptionSessionSchema),
  createSubscriptionSession
);

// Billing Portal (manage subscription/payment methods)
router.post('/portal', requireAuth, createBillingPortalSession);

export default router;
