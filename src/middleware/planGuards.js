// src/middleware/planGuards.js
import admin from "../config/firebase.js";

/**
 * Require membership (blocks free users from premium features)
 */
export function requireMember(plan = null) {
  return (req, res, next) => {
    const u = req.user;
    if (!u?.isMember) {
      return res.status(402).json({ ok: false, reason: "MEMBERSHIP_REQUIRED", detail: "This feature requires a paid plan" });
    }
    
    const kind = u.membership?.kind;
    if (kind === "onetime" && u.membership?.expiresAt && Date.now() > u.membership.expiresAt) {
      return res.status(402).json({ ok: false, reason: "MEMBERSHIP_EXPIRED", detail: "Your one-month pass has expired" });
    }
    
    if (plan && u.plan !== plan) {
      return res.status(403).json({ ok: false, reason: "INSUFFICIENT_PLAN", detail: `This feature requires ${plan} plan or higher` });
    }
    
    next();
  };
}

/**
 * Enforce free daily short limit (4 shorts per day for free users)
 */
export function enforceFreeDailyShortLimit(limit = 4) {
  return async (req, res, next) => {
    const u = req.user;
    if (u?.isMember) return next(); // Skip limit for paid users

    const userRef = admin.firestore().collection("users").doc(u.uid);
    const snap = await userRef.get();
    const doc = snap.data() || {};
    const now = Date.now();

    const dayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const currentDayKey = doc.shortDayKey;
    let count = doc.shortCountToday || 0;

    if (currentDayKey !== dayKey) {
      count = 0;
      await userRef.set({ shortDayKey: dayKey, shortCountToday: 0 }, { merge: true });
    }

    if (count >= limit) {
      return res.status(429).json({ 
        ok: false, 
        reason: "FREE_LIMIT_REACHED", 
        detail: `Free users can create up to ${limit} shorts per day. Upgrade to create unlimited shorts.`,
        limit 
      });
    }

    req.incrementShortCount = async () => {
      await userRef.set({ 
        shortDayKey: dayKey, 
        shortCountToday: count + 1, 
        lastShortAt: now 
      }, { merge: true });
    };
    next();
  };
}

/**
 * Block AI quotes for free users (requires membership)
 */
export function blockAIQuotesForFree() {
  return (req, res, next) => {
    if (!req.user?.isMember) {
      return res.status(402).json({ 
        ok: false, 
        reason: "AI_QUOTES_MEMBERSHIP_REQUIRED", 
        detail: "AI quote generation requires a Creator or Pro plan" 
      });
    }
    next();
  };
}

/**
 * Force watermark for free users
 */
export function enforceWatermarkFlag() {
  return (req, res, next) => {
    if (!req.user?.isMember) {
      req.body.forceWatermark = true;
    }
    next();
  };
}

/**
 * Optional auth middleware that attaches user data if token present
 */
export async function requireAuthOptional(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const m = authHeader.match(/^Bearer\s+(.+)$/i);
    if (m) {
      const idToken = m[1];
      const decoded = await admin.auth().verifyIdToken(idToken);
      req.user = {
        uid: decoded.uid,
        email: decoded.email || null,
        email_verified: !!decoded.email_verified,
      };
    }
  } catch {
    // Ignore auth errors for optional auth
  }
  return next();
}
