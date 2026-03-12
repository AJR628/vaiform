import { Router } from 'express';
import requireAuth from '../middleware/requireAuth.js';
import { getCredits } from '../controllers/credits.controller.js';

const router = Router();

/**
 * Deprecated credits endpoint
 * GET /api/credits   -> 410 CREDITS_REMOVED
 */
router.get('/', requireAuth, getCredits);

export default router;
