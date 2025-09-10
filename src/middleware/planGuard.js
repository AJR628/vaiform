import admin from "../config/firebase.js";

/**
 * Middleware to enforce Free vs Pro plan limits
 * For now, we'll use a simple heuristic: Pro = has active subscription
 * In the future, this could be enhanced with explicit plan fields
 */
export function planGuard(requiredPlan = 'free') {
  return async (req, res, next) => {
    try {
      const uid = req.user?.uid;
      if (!uid) {
        return res.status(401).json({ ok: false, reason: "UNAUTHENTICATED" });
      }

      // Check if user has active subscription (Pro indicator)
      const userRef = admin.firestore().doc(`users/${uid}`);
      const userSnap = await userRef.get();
      const userData = userSnap.data() || {};
      
      // Simple heuristic: Pro if they have credits > 100 or subscription metadata
      const isPro = (userData.credits || 0) > 100 || userData.subscriptionStatus === 'active';
      const userPlan = isPro ? 'pro' : 'free';

      // Attach plan info to request
      req.userPlan = userPlan;
      req.isPro = isPro;

      if (requiredPlan === 'pro' && !isPro) {
        return res.status(403).json({ 
          ok: false, 
          reason: "PLAN_UPGRADE_REQUIRED",
          detail: "This feature requires a Pro plan"
        });
      }

      next();
    } catch (error) {
      console.error('Plan guard error:', error);
      return res.status(500).json({ ok: false, reason: "PLAN_CHECK_FAILED" });
    }
  };
}

export default planGuard;
