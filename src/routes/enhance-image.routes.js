import { Router } from 'express';
import requireAuth from '../middleware/auth.js';
import { enhanceController } from '../controllers/enhance.controller.js';

const router = Router();

router.post('/', requireAuth, enhanceController);

export default router;
