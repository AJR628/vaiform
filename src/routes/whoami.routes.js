import { Router } from 'express';
import requireAuth from '../middleware/requireAuth.js';

const r = Router();

/**
 * GET /api/whoami
 * Returns authenticated user info
 */
r.get('/', requireAuth, (req, res) => {
  res.json({
    success: true,
    user: {
      uid: req.user.uid,
      email: req.user.email,
    },
  });
});

export default r;
