import { Router } from 'express';
import requireAuth from '../middleware/requireAuth.js';
import { ok } from '../http/respond.js';

const r = Router();

/**
 * GET /api/whoami
 * Returns authenticated user info
 */
r.get('/', requireAuth, (req, res) => {
  return ok(req, res, {
    uid: req.user.uid,
    email: req.user.email,
  });
});

export default r;
