// src/routes/user.routes.js
import { Router } from 'express';
import requireAuth from '../middleware/requireAuth.js';
import { ensureFreeUser, getUserData } from '../services/user.service.js';
import { ok, fail } from '../http/respond.js';

const r = Router();

/**
 * POST /user/setup - Ensure user document exists after signup
 * Called after Firebase Auth sign-in to create/update user doc
 */
r.post('/setup', requireAuth, async (req, res) => {
  try {
    const { uid, email } = req.user;

    const result = await ensureFreeUser(uid, email);

    return ok(req, res, {
      uid,
      email,
      plan: 'free',
      isMember: false,
    });
  } catch (e) {
    console.error('[user/setup] error', e);
    return fail(req, res, 500, 'SETUP_FAILED', e?.message || 'User setup failed');
  }
});

/**
 * GET /user/me - Get current user data
 */
r.get('/me', requireAuth, async (req, res) => {
  try {
    const { uid } = req.user;

    const userData = await getUserData(uid);

    if (!userData) {
      return fail(req, res, 404, 'USER_NOT_FOUND', 'User document not found');
    }

    return ok(req, res, {
      uid,
      email: userData.email,
      plan: userData.plan || 'free',
      isMember: userData.isMember || false,
      credits: userData.credits || 0,
      membership: userData.membership || null,
    });
  } catch (e) {
    console.error('[user/me] error', e);
    return fail(req, res, 500, 'FETCH_FAILED', e?.message || 'Failed to fetch user data');
  }
});

export default r;
