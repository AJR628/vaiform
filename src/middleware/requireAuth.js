// src/middleware/requireAuth.js
import admin from '../config/firebase.js';
import { fail } from '../http/respond.js';

export default async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!m) {
      return fail(req, res, 401, 'AUTH_REQUIRED', 'You need to sign in to create shorts.');
    }
    const idToken = m[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.user = { uid: decoded.uid, email: decoded.email || null };
    next();
  } catch (err) {
    console.error('requireAuth verifyIdToken error:', err?.message || err);
    return fail(req, res, 401, 'AUTH_REQUIRED', 'You need to sign in to create shorts.');
  }
}
