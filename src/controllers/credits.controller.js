import { ensureProvisionedMobileUser } from '../services/credit.service.js';
import { ok, fail } from '../http/respond.js';

export async function getCredits(req, res) {
  try {
    const { uid, email } = req.user || {};
    const { data } = await ensureProvisionedMobileUser(uid, email);

    return ok(req, res, {
      uid: data?.uid || uid,
      email: data?.email || email,
      credits: data?.credits ?? 0,
    });
  } catch (err) {
    return fail(req, res, 500, 'CREDITS_ERROR', err?.message || 'Failed to fetch credits');
  }
}
