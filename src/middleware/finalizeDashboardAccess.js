import { fail } from '../http/respond.js';

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isFinalizeDashboardEnabled() {
  return process.env.FINALIZE_DASHBOARD_ENABLED === '1';
}

export function getFinalizeDashboardAllowedEmails() {
  const raw = process.env.FINALIZE_DASHBOARD_ALLOWED_EMAILS || '';
  return new Set(
    raw
      .split(',')
      .map((entry) => normalizeEmail(entry))
      .filter(Boolean)
  );
}

export function requireFinalizeDashboardDataEnabled(req, res, next) {
  if (!isFinalizeDashboardEnabled()) {
    return fail(req, res, 404, 'NOT_FOUND', 'Not found');
  }
  return next();
}

export function requireFinalizeDashboardFounder(req, res, next) {
  const email = normalizeEmail(req.user?.email);
  const emailVerified = req.user?.emailVerified === true;
  const allowedEmails = getFinalizeDashboardAllowedEmails();

  if (!email || !emailVerified || !allowedEmails.has(email)) {
    return fail(
      req,
      res,
      403,
      'FORBIDDEN',
      'You are not authorized to access the finalize dashboard.'
    );
  }

  req.finalizeDashboardUser = {
    email,
    uid: req.user?.uid || null,
  };
  return next();
}
