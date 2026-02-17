import { Router } from 'express';
import requireAuth from '../middleware/requireAuth.js';
import { getUsageLimits } from '../controllers/limits.controller.js';

const r = Router();

r.get('/usage', requireAuth, getUsageLimits);

export default r;
