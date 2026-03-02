import { Router } from 'express';
import requireAuth from '../middleware/requireAuth.js';
import { getShortById, getMyShorts } from '../controllers/shorts.controller.js';

const r = Router();

// Core My Shorts library endpoints (KEEP MOUNTED)
r.get('/mine', requireAuth, getMyShorts);
r.get('/:jobId', requireAuth, getShortById);

export default r;
