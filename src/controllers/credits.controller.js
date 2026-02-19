import admin from 'firebase-admin';
import { ensureUserDoc } from '../services/credit.service.js';
import { ok, fail } from '../http/respond.js';

export async function getCredits(req, res) {
  try {
    const { uid, email } = req.user || {};
    const { ref, data } = await ensureUserDoc(uid || email, email);

    return ok(req, res, {
      uid: data?.uid || uid,
      email: data?.email || email,
      credits: data?.credits ?? 0,
    });
  } catch (err) {
    return fail(req, res, 500, 'CREDITS_ERROR', err?.message || 'Failed to fetch credits');
  }
}
