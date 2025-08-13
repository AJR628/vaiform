import { Router } from 'express';
import { balance, grant } from '../controllers/credits.controller.js';

const router = Router();

// GET /credits/balance?email=you@example.com
router.get('/balance', balance);

// POST /credits/grant { email, credits }
router.post('/grant', grant);

export default router;
