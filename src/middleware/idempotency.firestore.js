import admin, { db } from '../config/firebase.js';
import { ok, fail } from '../http/respond.js';
import { buildCanonicalUsageState, getAvailableSec } from '../services/usage.service.js';

const requestIdOf = (req) => req?.id ?? null;
const requestBillingOf = (settlement) => {
  if (!settlement) return null;
  const settledAt = settlement?.settledAt;
  const settledAtIso =
    typeof settledAt?.toDate === 'function'
      ? settledAt.toDate().toISOString()
      : settledAt instanceof Date
        ? settledAt.toISOString()
        : typeof settledAt === 'string'
          ? settledAt
          : null;

  return {
    billedSec: settlement?.billedSec ?? null,
    settledAt: settledAtIso,
  };
};
const attachBillingToSession = (session, settlement) => {
  if (!session || typeof session !== 'object') return session;
  const billing = requestBillingOf(settlement);
  if (!billing || !Number.isFinite(Number(billing.billedSec)) || Number(billing.billedSec) <= 0) {
    return session;
  }
  return {
    ...session,
    billing,
  };
};
const finalizeSuccess = (req, session, shortId) => ({
  success: true,
  data: session,
  shortId,
  requestId: requestIdOf(req),
});
const getEstimatedSecFromSession = (session) => {
  const estimatedSec = Number(session?.billingEstimate?.estimatedSec);
  return Number.isFinite(estimatedSec) && estimatedSec > 0 ? Math.ceil(estimatedSec) : null;
};
const getBilledSecFromSession = (session) => {
  const durationSec = Number(session?.finalVideo?.durationSec);
  return Number.isFinite(durationSec) && durationSec > 0 ? Math.ceil(durationSec) : null;
};

/**
 * Idempotency middleware for POST /api/story/finalize.
 * - Requires X-Idempotency-Key (400 if missing).
 * - Validates req.body.sessionId (non-empty string, min 3 chars) before any Firestore read/reserve; 400 INVALID_INPUT without reserving.
 * - Replay: if doc exists with state=done, fetches session via getSession and returns same response shape.
 * - Reserve: in one transaction creates idempotency doc (state=pending, usageReservation, sessionId) and reserves render seconds; 402 if insufficient.
 * - On success: stores minimal payload (shortId, sessionId) only; no full session (Firestore 1 MiB limit).
 * - On 5xx: releases reserved seconds and deletes doc.
 *
 * Verification (curl, no test framework):
 * 1) Missing header: POST without X-Idempotency-Key -> 400 MISSING_IDEMPOTENCY_KEY.
 * 2) Missing/invalid sessionId: POST with key but body {} or { "sessionId": "x" } -> 400 INVALID_INPUT; usage unchanged.
 * 3) Same key twice with valid sessionId: first request renders and settles once; second request replays (same shortId), no second settlement.
 *
 * @param {{ ttlMinutes?: number, getSession: (opts: { uid: string, sessionId: string }) => Promise<object|null> }} opts
 */
export function idempotencyFinalize({ ttlMinutes = 60, getSession } = {}) {
  if (typeof getSession !== 'function') {
    throw new Error('idempotencyFinalize requires getSession');
  }
  return async function middleware(req, res, next) {
    const key = req.get('X-Idempotency-Key');
    const uid = req.user?.uid;
    if (!key) {
      return fail(req, res, 400, 'MISSING_IDEMPOTENCY_KEY', 'Provide X-Idempotency-Key header.');
    }
    if (!uid) {
      return fail(req, res, 401, 'UNAUTHORIZED', 'Authentication required.');
    }

    // Validate sessionId before any Firestore read or reserve so invalid input never reserves usage
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

    const docRef = db.collection('idempotency').doc(`${uid}:${key}`);

    // Single read to decide replay vs reserve
    const snap = await docRef.get();
    if (snap.exists) {
      const d = snap.data();
      if (d.state === 'pending') {
        return fail(req, res, 409, 'IDEMPOTENT_IN_PROGRESS', 'Request in progress.');
      }
      if (d.state === 'done') {
        const status = d.status || 200;
        const shortId = d.shortId ?? null;
        const sid = d.sessionId || sessionId;
        const settlement = d.billingSettlement || null;
        let session = null;
        if (sid) {
          try {
            session = await getSession({ uid, sessionId: sid });
          } catch (err) {
            console.error('[idempotency][finalize] getSession on replay:', err);
          }
        }
        if (session == null) {
          return fail(
            req,
            res,
            404,
            'SESSION_NOT_FOUND',
            'Session no longer available for replay.'
          );
        }
        return res
          .status(status)
          .json(finalizeSuccess(req, attachBillingToSession(session, settlement), shortId));
      }
    }

    let reservationSession = null;
    try {
      reservationSession = await getSession({ uid, sessionId });
    } catch (err) {
      console.error('[idempotency][finalize] getSession before reserve:', err);
      return next(err);
    }
    if (reservationSession == null) {
      return fail(req, res, 404, 'SESSION_NOT_FOUND', 'Session not found');
    }

    const estimatedSec = getEstimatedSecFromSession(reservationSession);
    if (!estimatedSec) {
      return fail(
        req,
        res,
        409,
        'BILLING_ESTIMATE_UNAVAILABLE',
        'Render-time estimate is unavailable for this session.'
      );
    }

    // Create pending + reserve render time in one transaction
    try {
      await db.runTransaction(async (tx) => {
        const docSnap = await tx.get(docRef);
        if (docSnap.exists) {
          const d = docSnap.data();
          if (d.state === 'pending')
            throw Object.assign(new Error('IN_PROGRESS'), { _idemp: 'PENDING' });
          if (d.state === 'done') throw Object.assign(new Error('DONE'), { _idemp: d });
        }
        const userRef = db.collection('users').doc(uid);
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists) {
          const err = new Error('User not found');
          err.code = 'USER_NOT_FOUND';
          err.status = 404;
          throw err;
        }

        const userData = userSnap.data() || {};
        const accountState = buildCanonicalUsageState(userData);
        const usage = accountState.usage;
        if (getAvailableSec(usage) < estimatedSec) {
          const err = new Error(`Insufficient render time. You need ${estimatedSec} seconds to render.`);
          err.code = 'INSUFFICIENT_RENDER_TIME';
          err.status = 402;
          throw err;
        }

        tx.set(docRef, {
          state: 'pending',
          usageReservation: {
            estimatedSec,
            reservedSec: estimatedSec,
          },
          sessionId,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
        });

        tx.set(
          userRef,
          {
            plan: accountState.plan,
            membership: accountState.membership,
            usage: {
              ...usage,
              cycleReservedSec: usage.cycleReservedSec + estimatedSec,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      });
    } catch (e) {
      if (e._idemp === 'PENDING') {
        return fail(req, res, 409, 'IDEMPOTENT_IN_PROGRESS', 'Request in progress.');
      }
      if (e._idemp) {
        const status = e._idemp.status || 200;
        const shortId = e._idemp.shortId ?? null;
        const sid = e._idemp.sessionId || sessionId;
        const settlement = e._idemp.billingSettlement || null;
        if (!sid) {
          return fail(req, res, 404, 'SESSION_NOT_FOUND', 'Session id missing for replay.');
        }
        let session = null;
        try {
          session = await getSession({ uid, sessionId: sid });
        } catch (err) {
          console.error('[idempotency][finalize] getSession on replay (race):', err);
        }
        if (session == null) {
          return fail(
            req,
            res,
            404,
            'SESSION_NOT_FOUND',
            'Session no longer available for replay.'
          );
        }
        return res
          .status(status)
          .json(finalizeSuccess(req, attachBillingToSession(session, settlement), shortId));
      }
      if (
        e?.status === 402 ||
        e?.code === 'INSUFFICIENT_RENDER_TIME' ||
        e?.code === 'BILLING_ESTIMATE_UNAVAILABLE'
      ) {
        return fail(
          req,
          res,
          402,
          e?.code || 'INSUFFICIENT_RENDER_TIME',
          e?.message || 'Insufficient render time for render.'
        );
      }
      if (e?.status === 404 || e?.code === 'USER_NOT_FOUND') {
        return fail(req, res, 404, 'USER_NOT_FOUND', e?.message || 'User account not found.');
      }
      return next(e);
    }

    res._idempotencyReserved = true;
    res._idempotencyDocRef = docRef;
    res._idempotencySessionId = sessionId;
    res._idempotencyReservedSec = estimatedSec;
    res._idempotencyEstimatedSec = estimatedSec;
    res.finishIdempotentFinalize = async ({ session, shortId, status = 200 }) => {
      const billedSec = getBilledSecFromSession(session);
      if (!billedSec) {
        throw Object.assign(new Error('BILLING_DURATION_UNAVAILABLE'), {
          code: 'BILLING_DURATION_UNAVAILABLE',
          status: 500,
        });
      }
      if (billedSec > estimatedSec) {
        throw Object.assign(
          new Error(
            `Billed render time ${billedSec}s exceeded reserved estimate ${estimatedSec}s.`
          ),
          {
            code: 'BILLING_ESTIMATE_TOO_LOW',
            status: 500,
          }
        );
      }

      const settledAt = new Date();
      const shortRef = shortId ? db.collection('shorts').doc(shortId) : null;
      await db.runTransaction(async (tx) => {
        const userRef = db.collection('users').doc(uid);
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists) {
          const err = new Error('User not found');
          err.code = 'USER_NOT_FOUND';
          err.status = 404;
          throw err;
        }
        const userData = userSnap.data() || {};
        const accountState = buildCanonicalUsageState(userData);
        const usage = accountState.usage;
        const nextReservedSec = Math.max(0, usage.cycleReservedSec - estimatedSec);

        tx.set(
          userRef,
          {
            plan: accountState.plan,
            membership: accountState.membership,
            usage: {
              ...usage,
              cycleUsedSec: usage.cycleUsedSec + billedSec,
              cycleReservedSec: nextReservedSec,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        tx.set(
          docRef,
          {
            state: 'done',
            status,
            shortId: shortId ?? null,
            sessionId,
            billingSettlement: {
              billedSec,
              settledAt,
            },
            finishedAt: settledAt,
          },
          { merge: true }
        );
        if (shortRef) {
          tx.set(
            shortRef,
            {
              billing: {
                estimatedSec,
                billedSec,
                settledAt: admin.firestore.FieldValue.serverTimestamp(),
                source: 'finalVideo.durationSec',
              },
            },
            { merge: true }
          );
        }
      });

      const sessionWithBilling = attachBillingToSession(session, {
        billedSec,
        settledAt: settledAt.toISOString(),
      });
      return res.status(status).json(finalizeSuccess(req, sessionWithBilling, shortId ?? null));
    };

    res.on('finish', async () => {
      if (!res._idempotencyReserved || res.statusCode < 500) return;
      try {
        const userRef = db.collection('users').doc(uid);
        await db.runTransaction(async (tx) => {
          const userSnap = await tx.get(userRef);
          if (!userSnap.exists) return;
          const userData = userSnap.data() || {};
          const accountState = buildCanonicalUsageState(userData);
          const usage = accountState.usage;
          tx.set(
            userRef,
            {
              plan: accountState.plan,
              membership: accountState.membership,
              usage: {
                ...usage,
                cycleReservedSec: Math.max(
                  0,
                  usage.cycleReservedSec - (res._idempotencyReservedSec || 0)
                ),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
              },
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        });
        await docRef.delete();
        console.log('[idempotency][finalize] Released reserved render time after failure, key=', key);
      } catch (err) {
        console.error('[idempotency][finalize] Release/delete on failure:', err);
      }
    });

    next();
  };
}

export default function idempotencyFirestore({ ttlMinutes = 60 } = {}) {
  return async function middleware(req, res, next) {
    const key = req.get('X-Idempotency-Key');
    const uid = req.user?.uid || 'anon';
    if (!key)
      return fail(req, res, 400, 'MISSING_IDEMPOTENCY_KEY', 'Provide X-Idempotency-Key header.');

    const docRef = db.collection('idempotency').doc(`${uid}:${key}`);

    // Create "pending" if missing atomically
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(docRef);
        if (snap.exists) {
          const d = snap.data();
          if (d.state === 'pending')
            throw Object.assign(new Error('IN_PROGRESS'), { _idemp: 'PENDING' });
          if (d.state === 'done') throw Object.assign(new Error('DONE'), { _idemp: d });
          // else fallthrough to rewrite state if needed
        } else {
          tx.set(docRef, {
            state: 'pending',
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
          });
        }
      });
    } catch (e) {
      if (e._idemp === 'PENDING')
        return fail(req, res, 409, 'IDEMPOTENT_IN_PROGRESS', 'Request in progress.');
      if (e._idemp) {
        const status = e._idemp.status || 200;
        const body = e._idemp.body;
        if (body != null && typeof body === 'object') {
          return res.status(status).json({ ...body, requestId: requestIdOf(req) });
        }
        return ok(req, res, body ?? null);
      }
      // else real error
      return next(e);
    }

    const origJson = res.json.bind(res);
    res.json = async (body) => {
      const status = res.statusCode || 200;
      try {
        if (status < 500) {
          await docRef.set(
            { state: 'done', status, body, finishedAt: new Date() },
            { merge: true }
          );
        } else {
          await docRef.delete().catch(() => {});
        }
      } catch {}
      return origJson(body);
    };

    res.on('finish', async () => {
      if (res.headersSent && res.statusCode >= 500) {
        try {
          await docRef.delete();
        } catch {}
      }
    });

    next();
  };
}
