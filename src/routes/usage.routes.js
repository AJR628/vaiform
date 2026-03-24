import { Router } from 'express';
import requireAuth from '../middleware/requireAuth.js';
import { getUsage } from '../controllers/usage.controller.js';

const router = Router();

router.get('/', requireAuth, getUsage);

export default router;
