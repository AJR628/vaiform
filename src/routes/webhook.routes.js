import { Router } from 'express';
import { stripeWebhook } from '../controllers/webhook.controller.js';

const router = Router();

// GET /webhook - Test endpoint to verify webhook URL is accessible
router.get('/', (req, res) => {
  console.log(`[webhook] GET request received - webhook URL is accessible`);
  res.json({ 
    status: 'ok', 
    message: 'Webhook endpoint is accessible',
    timestamp: new Date().toISOString(),
    method: 'GET'
  });
});

// POST /webhook
router.post('/', stripeWebhook);

export default router;
