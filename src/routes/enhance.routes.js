import { Router } from 'express';
import { enhanceImage } from '../controllers/enhance.controller.js';

const router = Router();

router.post('/enhance-image', enhanceImage);

export default router;