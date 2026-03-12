import { fail } from '../http/respond.js';

export async function getCredits(req, res) {
  return fail(
    req,
    res,
    410,
    'CREDITS_REMOVED',
    'Credits have been removed from the active billing model. Use /api/usage.'
  );
}
