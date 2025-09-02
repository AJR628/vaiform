import { Router } from 'express';
import { enhanceController } from '../controllers/enhance.controller.js';
import requireAuth from '../middleware/requireAuth.js';

const router = Router();

router.post('/enhance-image', requireAuth, enhanceController);

export default router;
