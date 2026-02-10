import admin, { db } from '../config/firebase.js';

/**
 * Idempotency middleware for POST /api/story/finalize.
 * - Requires X-Idempotency-Key (400 if missing).
 * - Replay: if doc exists with state=done, fetches session via getSession and returns same response shape.
 * - Reserve: in one transaction creates idempotency doc (state=pending, reservedCredits) and debits user; 402 if insufficient.
 * - On success: stores minimal payload (shortId, sessionId) only; no full session (Firestore 1 MiB limit).
 * - On 5xx: refunds credits and deletes doc.
 * @param {{ ttlMinutes?: number, getSession: (uid: string, sessionId: string) => Promise<object|null>, creditCost: number }} opts
 */
export function idempotencyFinalize({ ttlMinutes = 60, getSession, creditCost } = {}) {
  if (typeof getSession !== 'function' || typeof creditCost !== 'number') {
    throw new Error('idempotencyFinalize requires getSession and creditCost');
  }
  return async function middleware(req, res, next) {
    const key = req.get('X-Idempotency-Key');
    const uid = req.user?.uid;
    if (!key) {
      return res.status(400).json({ success: false, error: 'MISSING_IDEMPOTENCY_KEY', detail: 'Provide X-Idempotency-Key header.' });
    }
    if (!uid) {
      return res.status(401).json({ success: false, error: 'UNAUTHORIZED', detail: 'Authentication required.' });
    }

    const docRef = db.collection('idempotency').doc(`${uid}:${key}`);
    const sessionId = req.body?.sessionId;

    // Single read to decide replay vs reserve
    const snap = await docRef.get();
    if (snap.exists) {
      const d = snap.data();
      if (d.state === 'pending') {
        return res.status(409).json({ success: false, error: 'IDEMPOTENT_IN_PROGRESS', detail: 'Request in progress.' });
      }
      if (d.state === 'done') {
        const status = d.status || 200;
        const shortId = d.shortId ?? null;
        const sid = d.sessionId || sessionId;
        let session = null;
        if (sid) {
          try {
            session = await getSession(uid, sid);
          } catch (err) {
            console.error('[idempotency][finalize] getSession on replay:', err);
          }
        }
        if (session == null) {
          return res.status(404).json({ success: false, error: 'SESSION_NOT_FOUND', detail: 'Session no longer available for replay.' });
        }
        return res.status(status).json({ success: true, data: session, shortId });
      }
    }

    // Create pending + reserve credits in one transaction
    try {
      await db.runTransaction(async (tx) => {
        const docSnap = await tx.get(docRef);
        if (docSnap.exists) {
          const d = docSnap.data();
          if (d.state === 'pending') throw Object.assign(new Error('IN_PROGRESS'), { _idemp: 'PENDING' });
          if (d.state === 'done') throw Object.assign(new Error('DONE'), { _idemp: d });
        }
        const userRef = db.collection('users').doc(uid);
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists) {
          const err = new Error('User not found');
          err.code = 'USER_NOT_FOUND';
          err.status = 402;
          throw err;
        }
        const credits = userSnap.data()?.credits ?? 0;
        if (credits < creditCost) {
          const err = new Error('Insufficient credits');
          err.code = 'INSUFFICIENT_CREDITS';
          err.status = 402;
          throw err;
        }
        tx.set(docRef, {
          state: 'pending',
          reservedCredits: creditCost,
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000),
        });
        tx.update(userRef, {
          credits: admin.firestore.FieldValue.increment(-creditCost),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });
    } catch (e) {
      if (e._idemp === 'PENDING') {
        return res.status(409).json({ success: false, error: 'IDEMPOTENT_IN_PROGRESS', detail: 'Request in progress.' });
      }
      if (e._idemp) {
        const status = e._idemp.status || 200;
        const shortId = e._idemp.shortId ?? null;
        const sid = e._idemp.sessionId || sessionId;
        if (!sid) {
          return res.status(404).json({ success: false, error: 'SESSION_NOT_FOUND', detail: 'Session id missing for replay.' });
        }
        let session = null;
        try {
          session = await getSession(uid, sid);
        } catch (err) {
          console.error('[idempotency][finalize] getSession on replay (race):', err);
        }
        if (session == null) {
          return res.status(404).json({ success: false, error: 'SESSION_NOT_FOUND', detail: 'Session no longer available for replay.' });
        }
        return res.status(status).json({ success: true, data: session, shortId });
      }
      if (e?.status === 402 || e?.code === 'INSUFFICIENT_CREDITS' || e?.code === 'USER_NOT_FOUND') {
        return res.status(402).json({
          success: false,
          error: e?.code || 'INSUFFICIENT_CREDITS',
          detail: e?.message || 'Insufficient credits for render.',
        });
      }
      return next(e);
    }

    res._idempotencyReserved = true;
    res._idempotencyDocRef = docRef;
    res._idempotencySessionId = sessionId;
    res._idempotencyCreditCost = creditCost;

    const origJson = res.json.bind(res);
    res.json = async function (body) {
      const status = res.statusCode || 200;
      if (status < 500 && res._idempotencyDocRef) {
        const shortId = body?.shortId ?? null;
        const sid = res._idempotencySessionId || body?.data?.id;
        try {
          await res._idempotencyDocRef.set(
            {
              state: 'done',
              status,
              shortId,
              sessionId: sid,
              finishedAt: new Date(),
            },
            { merge: true }
          );
        } catch (err) {
          console.error('[idempotency][finalize] Failed to write done state:', err);
        }
      }
      return origJson(body);
    };

    res.on('finish', async () => {
      if (!res._idempotencyReserved || res.statusCode < 500) return;
      try {
        const { refundCredits } = await import('../services/credit.service.js');
        await refundCredits(uid, res._idempotencyCreditCost);
        await docRef.delete();
        console.log('[idempotency][finalize] Refunded credits after failure, key=', key);
      } catch (err) {
        console.error('[idempotency][finalize] Refund/delete on failure:', err);
      }
    });

    next();
  };
}

export default function idempotencyFirestore({ ttlMinutes = 60 } = {}) {
  return async function middleware(req, res, next) {
    const key = req.get('X-Idempotency-Key');
    const uid = req.user?.uid || 'anon';
    if (!key) return res.status(400).json({ success: false, error: 'MISSING_IDEMPOTENCY_KEY', detail: 'Provide X-Idempotency-Key header.' });

    const docRef = db.collection('idempotency').doc(`${uid}:${key}`);

    // Create "pending" if missing atomically
    try {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(docRef);
        if (snap.exists) {
          const d = snap.data();
          if (d.state === 'pending') throw Object.assign(new Error('IN_PROGRESS'), { _idemp: 'PENDING' });
          if (d.state === 'done')   throw Object.assign(new Error('DONE'),     { _idemp: d });
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
      if (e._idemp === 'PENDING') return res.status(409).json({ success: false, error: 'IDEMPOTENT_IN_PROGRESS', detail: 'Request in progress.' });
      if (e._idemp) return res.status(e._idemp.status || 200).json(e._idemp.body || { success: true });
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
        try { await docRef.delete(); } catch {}
      }
    });

    next();
  };
}