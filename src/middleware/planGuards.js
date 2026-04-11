// src/middleware/planGuards.js
import admin from '../config/firebase.js';
import { getAvailableMs, getUsageSummary, secondsToBillingMs } from '../services/usage.service.js';
import { fail } from '../http/respond.js';

function parseIsoMillis(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasPaidEntitlement(usageSummary, nowMs = Date.now()) {
  if (!usageSummary || usageSummary.plan === 'free') return false;
  const membership = usageSummary.membership || {};
  const status = typeof membership.status === 'string' ? membership.status : '';
  if (!status || status === 'inactive') return false;

  if (status === 'canceled') {
    const expiresAtMs = parseIsoMillis(membership.expiresAt);
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) {
      return false;
    }
  }

  return true;
}

/**
 * Require membership (blocks free users from premium features)
 */
export function requireMember(plan = null) {
  return async (req, res, next) => {
    const uid = req.user?.uid;
    if (!uid) {
      return fail(req, res, 401, 'AUTH_REQUIRED', 'You need to sign in to use this feature.');
    }

    let usageSummary = null;
    try {
      usageSummary = await getUsageSummary(uid, req.user?.email || null);
    } catch (error) {
      console.error('[planGuards] requireMember usage lookup failed:', error);
      return fail(
        req,
        res,
        500,
        'MEMBERSHIP_LOOKUP_FAILED',
        'Something went wrong while checking membership status.'
      );
    }

    if (!hasPaidEntitlement(usageSummary)) {
      const canceledExpiryMs = parseIsoMillis(usageSummary?.membership?.expiresAt);
      if (
        usageSummary?.membership?.status === 'canceled' &&
        Number.isFinite(canceledExpiryMs) &&
        canceledExpiryMs <= Date.now()
      ) {
        return fail(req, res, 402, 'MEMBERSHIP_EXPIRED', 'Your paid access period has expired');
      }
      return fail(req, res, 402, 'MEMBERSHIP_REQUIRED', 'This feature requires a paid plan');
    }

    if (plan && usageSummary.plan !== plan) {
      return fail(
        req,
        res,
        403,
        'INSUFFICIENT_PLAN',
        `This feature requires ${plan} plan or higher`
      );
    }

    next();
  };
}

/**
 * Enforce free daily short limit (4 shorts per day for free users)
 */
export function enforceFreeDailyShortLimit(limit = 4) {
  return async (req, res, next) => {
    const u = req.user;
    if (!u?.uid) {
      return fail(req, res, 401, 'AUTH_REQUIRED', 'You need to sign in to create shorts.');
    }

    try {
      const usageSummary = await getUsageSummary(u.uid, u.email || null);
      if (hasPaidEntitlement(usageSummary)) return next();
    } catch (error) {
      console.error('[planGuards] free daily limit usage lookup failed:', error);
      return fail(
        req,
        res,
        500,
        'MEMBERSHIP_LOOKUP_FAILED',
        'Something went wrong while checking plan limits.'
      );
    }

    const userRef = admin.firestore().collection('users').doc(u.uid);
    const snap = await userRef.get();
    const doc = snap.data() || {};
    const now = Date.now();

    const dayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const currentDayKey = doc.shortDayKey;
    let count = doc.shortCountToday || 0;

    if (currentDayKey !== dayKey) {
      count = 0;
      await userRef.set({ shortDayKey: dayKey, shortCountToday: 0 }, { merge: true });
    }

    if (count >= limit) {
      return fail(
        req,
        res,
        429,
        'FREE_LIMIT_REACHED',
        `Free users can create up to ${limit} shorts per day. Upgrade to create unlimited shorts.`
      );
    }

    req.incrementShortCount = async () => {
      await userRef.set(
        {
          shortDayKey: dayKey,
          shortCountToday: count + 1,
          lastShortAt: now,
        },
        { merge: true }
      );
    };
    next();
  };
}

/**
 * Enforce free lifetime short limit (4 shorts total for free users)
 * Blocks both script generation and final rendering once limit is reached.
 */
export function enforceFreeLifetimeShortLimit(maxFree = 4) {
  return async (req, res, next) => {
    // Fail-safe: require authentication
    const uid = req.user?.uid || req.authUid;
    if (!uid) {
      return fail(req, res, 401, 'AUTH_REQUIRED', 'You need to sign in to create shorts.');
    }

    let usageSummary = null;
    try {
      usageSummary = await getUsageSummary(uid, req.user?.email || null);
    } catch (error) {
      console.error('[planGuards] free lifetime limit usage lookup failed:', error);
      return fail(
        req,
        res,
        500,
        'MEMBERSHIP_LOOKUP_FAILED',
        'Something went wrong while checking plan limits.'
      );
    }

    if (hasPaidEntitlement(usageSummary)) {
      return next();
    }

    const userRef = admin.firestore().collection('users').doc(uid);
    const snap = await userRef.get();
    if (!snap.exists) {
      return fail(req, res, 401, 'AUTH_REQUIRED', 'You need to sign in to create shorts.');
    }

    const doc = snap.data() || {};

    // User IS free - check lifetime limit
    const freeShortsUsed = doc.freeShortsUsed || 0;

    if (freeShortsUsed >= maxFree) {
      return fail(
        req,
        res,
        403,
        'FREE_LIMIT_REACHED',
        "You've used your 4 free shorts. Upgrade to keep creating."
      );
    }

    // User is free and under limit - allow request
    next();
  };
}

/**
 * Block AI quotes for free users (requires membership)
 */
export function blockAIQuotesForFree() {
  return async (req, res, next) => {
    const uid = req.user?.uid;
    if (!uid) {
      return fail(req, res, 401, 'AUTH_REQUIRED', 'You need to sign in to use this feature.');
    }

    let usageSummary = null;
    try {
      usageSummary = await getUsageSummary(uid, req.user?.email || null);
    } catch (error) {
      console.error('[planGuards] AI quotes membership lookup failed:', error);
      return fail(
        req,
        res,
        500,
        'MEMBERSHIP_LOOKUP_FAILED',
        'Something went wrong while checking membership status.'
      );
    }

    if (!hasPaidEntitlement(usageSummary)) {
      return fail(
        req,
        res,
        402,
        'AI_QUOTES_MEMBERSHIP_REQUIRED',
        'AI quote generation requires a Creator or Pro plan'
      );
    }
    next();
  };
}

/**
 * Force watermark for free users
 */
export function enforceWatermarkFlag() {
  return async (req, res, next) => {
    const uid = req.user?.uid;
    if (!uid) {
      req.body.forceWatermark = true;
      return next();
    }

    try {
      const usageSummary = await getUsageSummary(uid, req.user?.email || null);
      if (!hasPaidEntitlement(usageSummary)) {
        req.body.forceWatermark = true;
      }
    } catch (error) {
      console.error('[planGuards] watermark membership lookup failed:', error);
      req.body.forceWatermark = true;
    }
    next();
  };
}

/**
 * Enforce sufficient render time before render.
 * Pre-check only - does not reserve or settle usage.
 * Must be used after requireAuth middleware
 */
export function enforceRenderTimeForRender(getSession) {
  if (typeof getSession !== 'function') {
    throw new Error('enforceRenderTimeForRender requires getSession');
  }
  return async (req, res, next) => {
    const uid = req.user?.uid;
    if (!uid) {
      return fail(req, res, 401, 'AUTH_REQUIRED', 'You need to sign in to create shorts.');
    }

    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId.trim() : '';
    if (sessionId.length < 3) {
      return fail(
        req,
        res,
        400,
        'INVALID_INPUT',
        'sessionId required and must be at least 3 characters.'
      );
    }

    let session = null;
    try {
      session = await getSession({ uid, sessionId });
    } catch (error) {
      console.error('[planGuards] Failed to load session for render-time gate:', error);
      return fail(
        req,
        res,
        500,
        'RENDER_TIME_GATE_FAILED',
        'Something went wrong while checking render-time availability.'
      );
    }

    if (!session) {
      return fail(req, res, 404, 'SESSION_NOT_FOUND', 'Session not found');
    }

    const syncState = typeof session?.voiceSync?.state === 'string' ? session.voiceSync.state : 'never_synced';
    if (syncState === 'never_synced') {
      return fail(req, res, 409, 'VOICE_SYNC_REQUIRED', 'Sync voice and timing before render.');
    }
    if (syncState !== 'current') {
      return fail(req, res, 409, 'VOICE_SYNC_STALE', 'Voice timing is stale. Re-sync before render.');
    }

    const estimatedMs = secondsToBillingMs(session?.billingEstimate?.estimatedSec ?? 0);
    if (!(estimatedMs > 0)) {
      return fail(
        req,
        res,
        409,
        'BILLING_ESTIMATE_UNAVAILABLE',
        'Render-time estimate is unavailable for this session.'
      );
    }

    let usageSummary = null;
    try {
      usageSummary = await getUsageSummary(uid, req.user?.email || null);
    } catch (error) {
      console.error('[planGuards] Failed to load usage summary for render-time gate:', error);
      return fail(
        req,
        res,
        500,
        'RENDER_TIME_GATE_FAILED',
        'Something went wrong while checking render-time availability.'
      );
    }

    if (getAvailableMs(usageSummary?.usage || {}, usageSummary?.plan || 'free') < estimatedMs) {
      return fail(
        req,
        res,
        402,
        'INSUFFICIENT_RENDER_TIME',
        `Insufficient render time. You need ${session?.billingEstimate?.estimatedSec} seconds to render.`
      );
    }

    next();
  };
}

/**
 * Enforce daily script generation cap (prevents LLM abuse)
 * Uses Firestore transaction for atomic increment
 * Must be used after requireAuth middleware
 */
export function enforceScriptDailyCap(maxPerDay = 300) {
  return async (req, res, next) => {
    // Require authentication
    const uid = req.user?.uid || req.authUid;
    if (!uid) {
      return fail(req, res, 401, 'AUTH_REQUIRED', 'You need to sign in to generate scripts.');
    }

    const db = admin.firestore();
    const userRef = db.collection('users').doc(uid);
    const todayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    try {
      await db.runTransaction(async (t) => {
        const snap = await t.get(userRef);

        if (!snap.exists) {
          const err = new Error('USER_NOT_FOUND_TX');
          throw err;
        }

        const doc = snap.data() || {};
        let scriptDayKey = doc.scriptDayKey || null;
        let scriptCountToday = doc.scriptCountToday || 0;

        // Reset if day changed
        if (scriptDayKey !== todayKey) {
          scriptDayKey = todayKey;
          scriptCountToday = 0;
        }

        // Check limit
        if (scriptCountToday >= maxPerDay) {
          const err = new Error('SCRIPT_LIMIT_REACHED_TX');
          throw err;
        }

        // Increment count atomically
        t.update(userRef, {
          scriptDayKey: todayKey,
          scriptCountToday: scriptCountToday + 1,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      // Transaction succeeded - allow request
      next();
    } catch (error) {
      // Handle transaction errors
      if (error?.message === 'USER_NOT_FOUND_TX') {
        return fail(req, res, 404, 'USER_NOT_FOUND', 'User account not found.');
      }

      if (error?.message === 'SCRIPT_LIMIT_REACHED_TX') {
        return fail(
          req,
          res,
          429,
          'SCRIPT_LIMIT_REACHED',
          'Daily script generation limit reached. Try again tomorrow.'
        );
      }

      // Other errors
      console.error('[planGuards] Script cap check failed:', error);
      return fail(
        req,
        res,
        500,
        'SCRIPT_LIMIT_ERROR',
        'Something went wrong while checking script limits.'
      );
    }
  };
}

/**
 * Optional auth middleware that attaches user data if token present
 */
export async function requireAuthOptional(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (m) {
      const idToken = m[1];
      const decoded = await admin.auth().verifyIdToken(idToken);
      req.user = {
        uid: decoded.uid,
        email: decoded.email || null,
        email_verified: !!decoded.email_verified,
      };
    }
  } catch {
    // Ignore auth errors for optional auth
  }
  return next();
}
