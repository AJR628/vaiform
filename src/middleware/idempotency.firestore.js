import { db } from '../config/firebase.js';

export default function idempotencyFirestore({ ttlMinutes = 60 } = {}) {
  return async function middleware(req, res, next) {
    const key = req.get('X-Idempotency-Key');
    const uid = req.user?.uid || 'anon';
    if (!key) return res.status(400).json({ error: 'MISSING_IDEMPOTENCY_KEY', message: 'Provide X-Idempotency-Key header.' });

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
      if (e._idemp === 'PENDING') return res.status(409).json({ error: 'IDEMPOTENT_IN_PROGRESS', message: 'Request in progress.' });
      if (e._idemp) return res.status(e._idemp.status || 200).json(e._idemp.body || { ok: true });
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