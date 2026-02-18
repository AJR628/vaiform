import admin from 'firebase-admin';
import { ok, fail } from '../http/respond.js';

// GET /credits handler:
// - Verifies Firebase ID token from Authorization: Bearer <token>
// - Reads Firestore doc users/{uid}.credits (0 if missing)
// - Responds with canonical API envelopes
export async function getCreditsHandler(req, res) {
  try {
    const authz = req.headers['authorization'] || '';
    const m = authz.match(/^Bearer\s+(.+)$/i);
    if (!m) return fail(req, res, 401, 'NO_AUTH', 'Missing Bearer token');

    const idToken = m[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;
    const email = decoded.email || null;

    const db = admin.firestore();
    const userRef = db.collection('users').doc(uid);
    const snap = await userRef.get();
    const credits = snap.exists ? (snap.get('credits') ?? 0) : 0;

    return ok(req, res, { uid, email, credits });
  } catch (err) {
    const code = err?.code || err?.message || 'credits-error';
    const http = code === 'auth/argument-error' ? 401 : 500;
    return fail(req, res, http, code, 'Failed to fetch credits');
  }
}
