// src/routes/users.routes.js
import { Router } from 'express';
import requireAuth from '../middleware/requireAuth.js';
import { ok, fail } from '../http/respond.js';
import { ensureUserDocByUid } from '../services/user-doc.service.js';
import { ensureCanonicalUsageState } from '../services/usage.service.js';
import logger from '../observability/logger.js';
import { setRequestContextFromReq } from '../observability/request-context.js';

const r = Router();

/**
 * POST /api/users/ensure - Ensure user document exists (server-side creation)
 * Called after Firebase Auth sign-in to create/merge user doc with defaults.
 *
 * Security: Does NOT trust request body. Derives everything from req.user (auth token).
 */
r.post('/ensure', requireAuth, async (req, res) => {
  try {
    setRequestContextFromReq(req);
    const uid = req.user.uid;
    const email = req.user.email ?? null;

    if (!uid) {
      return fail(req, res, 400, 'INVALID_REQUEST', 'User ID not found in auth token');
    }

    const { ref } = await ensureUserDocByUid(uid, email);
    const usageState = await ensureCanonicalUsageState(uid, email);
    const snap = await ref.get();
    const doc = snap.data() || {};
    logger.info('auth.bootstrap.user_ensured', {
      routeStatus: `${req.method} ${req.originalUrl}`,
      plan: usageState?.data?.plan || 'free',
      hasEmail: Boolean(doc.email ?? email),
    });
    return ok(req, res, {
      uid,
      email: doc.email ?? email ?? null,
      plan: usageState?.data?.plan || 'free',
      freeShortsUsed: Number.isInteger(doc.freeShortsUsed) ? doc.freeShortsUsed : 0,
    });
  } catch (e) {
    logger.error('auth.bootstrap.ensure.failed', {
      routeStatus: `${req.method} ${req.originalUrl}`,
      error: e,
    });
    return fail(req, res, 500, 'ENSURE_FAILED', e?.message || 'Failed to ensure user document');
  }
});

export default r;
