import { Router } from 'express';
import { stripeWebhook } from '../controllers/webhook.controller.js';

const router = Router();

// POST /webhook
router.post('/', stripeWebhook);

export default router;
