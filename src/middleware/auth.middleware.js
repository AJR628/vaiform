// Auth & authorization helpers for Express (ESM)
import admin from 'firebase-admin';

// Only init if not already initialized elsewhere
if (!admin.apps.length) {
  admin.initializeApp(); // relies on env / default creds already set in your app
}

function getBearer(req) {
  const h = req.headers?.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  return h.slice(7).trim();
}

export async function requireAuth(req, res, next) {
  try {
    const token = getBearer(req);
    if (!token) {
      return res.status(401).json({
        error: 'UNAUTHENTICATED',
        message: 'Missing Authorization: Bearer <token>',
      });
    }
    const d = await admin.auth().verifyIdToken(token);
    req.user = {
      uid: d.uid,
      email: d.email || null,
      email_verified: !!d.email_verified,
    };
    return next();
  } catch {
    return res.status(401).json({
      error: 'UNAUTHENTICATED',
      message: 'Invalid or expired token',
    });
  }
}

// Optional: attach user if token present, otherwise continue anonymous
export async function optionalAuth(req, _res, next) {
  try {
    const token = getBearer(req);
    if (token) {
      const d = await admin.auth().verifyIdToken(token);
      req.user = {
        uid: d.uid,
        email: d.email || null,
        email_verified: !!d.email_verified,
      };
    }
  } catch {
    /* ignore */
  }
  return next();
}

// Gate paid actions until email is verified (flip on/off per route)
export function requireVerifiedEmail(req, res, next) {
  if (!req.user?.email_verified) {
    return res.status(403).json({ error: 'EMAIL_NOT_VERIFIED' });
  }
  return next();
}

// Ensure a claimed user field matches the authed user (hardens multi-tenant ops).
// Also normalizes so downstream uses the server-trusted uid.
export function assertUserScoped(field = 'uid', location = 'body') {
  return (req, res, next) => {
    const claimed = (req[location] || {})[field];
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'UNAUTHENTICATED' });
    }
    if (claimed && claimed !== req.user.uid) {
      return res.status(403).json({ error: 'FORBIDDEN', message: 'User mismatch' });
    }
    if (location === 'body') req.body.uid = req.user.uid;
    if (location === 'params') req.params[field] = req.user.uid;
    return next();
  };
}
