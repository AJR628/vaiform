// src/middleware/planGuards.js
import admin from "../config/firebase.js";
import { RENDER_CREDIT_COST } from "../services/credit.service.js";
import { fail } from "../http/respond.js";

/**
 * Require membership (blocks free users from premium features)
 */
export function requireMember(plan = null) {
  return (req, res, next) => {
    const u = req.user;
    if (!u?.isMember) {
      return fail(req, res, 402, "MEMBERSHIP_REQUIRED", "This feature requires a paid plan");
    }
    
    const kind = u.membership?.kind;
    if (kind === "onetime" && u.membership?.expiresAt && Date.now() > u.membership.expiresAt) {
      return fail(req, res, 402, "MEMBERSHIP_EXPIRED", "Your one-month pass has expired");
    }
    
    if (plan && u.plan !== plan) {
      return fail(req, res, 403, "INSUFFICIENT_PLAN", `This feature requires ${plan} plan or higher`);
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
      return fail(req, res, 429, "FREE_LIMIT_REACHED", `Free users can create up to ${limit} shorts per day. Upgrade to create unlimited shorts.`);
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
 * Enforce free lifetime short limit (4 shorts total for free users)
 * Blocks both script generation and final rendering once limit is reached.
 */
export function enforceFreeLifetimeShortLimit(maxFree = 4) {
  return async (req, res, next) => {
    // Fail-safe: require authentication
    const uid = req.user?.uid || req.authUid;
    if (!uid) {
      return fail(req, res, 401, "AUTH_REQUIRED", "You need to sign in to create shorts.");
    }

    // Fetch user document from Firestore
    const userRef = admin.firestore().collection("users").doc(uid);
    const snap = await userRef.get();
    if (!snap.exists) {
      return fail(req, res, 401, "AUTH_REQUIRED", "You need to sign in to create shorts.");
    }

    const doc = snap.data() || {};

    // Determine if user is "Free"
    const isMember = doc.isMember === true;
    const credits = doc.credits || 0;
    const subscriptionStatus = doc.subscriptionStatus;
    const isPaid = isMember || credits > 0 || subscriptionStatus === 'active';

    // If user is NOT free (paid/has credits), skip limit
    if (isPaid) {
      return next();
    }

    // User IS free - check lifetime limit
    const freeShortsUsed = doc.freeShortsUsed || 0;

    if (freeShortsUsed >= maxFree) {
      return fail(req, res, 403, "FREE_LIMIT_REACHED", "You've used your 4 free shorts. Upgrade to keep creating.");
    }

    // User is free and under limit - allow request
    next();
  };
}

/**
 * Block AI quotes for free users (requires membership)
 */
export function blockAIQuotesForFree() {
  return (req, res, next) => {
    if (!req.user?.isMember) {
      return fail(req, res, 402, "AI_QUOTES_MEMBERSHIP_REQUIRED", "AI quote generation requires a Creator or Pro plan");
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
 * Enforce sufficient credits before render
 * Pre-check only - does not spend credits
 * Must be used after requireAuth middleware
 */
export function enforceCreditsForRender(required = RENDER_CREDIT_COST) {
  return async (req, res, next) => {
    // Require authentication
    const uid = req.user?.uid;
    if (!uid) {
      return fail(req, res, 401, "AUTH_REQUIRED", "You need to sign in to create shorts.");
    }

    // Fetch user document from Firestore
    const userRef = admin.firestore().collection("users").doc(uid);
    const snap = await userRef.get();
    
    if (!snap.exists) {
      return fail(req, res, 401, "AUTH_REQUIRED", "You need to sign in to create shorts.");
    }

    const doc = snap.data() || {};
    const credits = doc.credits || 0;

    if (credits < required) {
      return fail(req, res, 402, "INSUFFICIENT_CREDITS", `Insufficient credits. You need ${required} credits to render.`);
    }

    // User has sufficient credits - allow request
    next();
  };
}

/**
 * Enforce daily script generation cap (prevents LLM abuse)
 * Uses Firestore transaction for atomic increment
 * Must be used after requireAuth middleware
 */
export function enforceScriptDailyCap(maxPerDay = 300) {
  return async (req, res, next) => {
    // Require authentication
    const uid = req.user?.uid || req.authUid;
    if (!uid) {
      return fail(req, res, 401, "AUTH_REQUIRED", "You need to sign in to generate scripts.");
    }

    const db = admin.firestore();
    const userRef = db.collection("users").doc(uid);
    const todayKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

    try {
      await db.runTransaction(async (t) => {
        const snap = await t.get(userRef);
        
        if (!snap.exists) {
          const err = new Error("USER_NOT_FOUND_TX");
          throw err;
        }

        const doc = snap.data() || {};
        let scriptDayKey = doc.scriptDayKey || null;
        let scriptCountToday = doc.scriptCountToday || 0;

        // Reset if day changed
        if (scriptDayKey !== todayKey) {
          scriptDayKey = todayKey;
          scriptCountToday = 0;
        }

        // Check limit
        if (scriptCountToday >= maxPerDay) {
          const err = new Error("SCRIPT_LIMIT_REACHED_TX");
          throw err;
        }

        // Increment count atomically
        t.update(userRef, {
          scriptDayKey: todayKey,
          scriptCountToday: scriptCountToday + 1,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });

      // Transaction succeeded - allow request
      next();
    } catch (error) {
      // Handle transaction errors
      if (error?.message === "USER_NOT_FOUND_TX") {
        return fail(req, res, 404, "USER_NOT_FOUND", "User account not found.");
      }

      if (error?.message === "SCRIPT_LIMIT_REACHED_TX") {
        return fail(req, res, 429, "SCRIPT_LIMIT_REACHED", "Daily script generation limit reached. Try again tomorrow.");
      }

      // Other errors
      console.error("[planGuards] Script cap check failed:", error);
      return fail(req, res, 500, "SCRIPT_LIMIT_ERROR", "Something went wrong while checking script limits.");
    }
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
