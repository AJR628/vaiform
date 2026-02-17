import { Router } from 'express';
import requireAuth from '../middleware/requireAuth.js';
import { getCredits } from '../controllers/credits.controller.js';

const router = Router();

/**
 * Authenticated credits endpoint
 * GET /credits   → { email, credits }
 */
router.get('/', requireAuth, getCredits);

export default router;
