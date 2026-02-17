import { Router } from 'express';
import requireAuth from '../middleware/requireAuth.js';
import { enforceCreditsForRender, enforceWatermarkFlag } from '../middleware/planGuards.js';
import {
  createShort,
  getShortById,
  getMyShorts,
  deleteShort,
} from '../controllers/shorts.controller.js';

const r = Router();

// PHASE 1: Unmounted legacy shorts creation endpoint (code preserved)
// r.post("/create", requireAuth, enforceCreditsForRender(), enforceWatermarkFlag(), createShort);

// Core My Shorts library endpoints (KEEP MOUNTED)
r.get('/mine', requireAuth, getMyShorts);
r.get('/:jobId', requireAuth, getShortById);

// PHASE 1: Unmounted optional cleanup endpoint (code preserved)
// r.delete("/:jobId", requireAuth, deleteShort);

export default r;
