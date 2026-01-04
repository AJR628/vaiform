import admin from "../config/firebase.js";

export async function getUsageLimits(req, res) {
  try {
    const uid = req.user?.uid;
    if (!uid) {
      return res.status(401).json({ ok: false, reason: "UNAUTHENTICATED" });
    }

    const userRef = admin.firestore().doc(`users/${uid}`);
    const userSnap = await userRef.get();
    const userData = userSnap.data() || {};
    
    const isPro = (userData.credits || 0) > 100 || userData.subscriptionStatus === 'active';
    const plan = isPro ? 'pro' : 'free';

    // Get current month's usage from generations collection
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const generationsRef = userRef.collection('generations');
    const monthlyGens = await generationsRef
      .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(monthStart))
      .limit(500)  // Safety cap (2x pro plan limit of 250)
      .get();

    const monthlyCount = monthlyGens.size;

    // Define limits based on plan
    const limits = {
      free: {
        monthlyGenerations: 10,
        monthlyQuotes: 20,
        maxAssetsPerRequest: 2,
        features: ['basic_quotes', 'stock_assets']
      },
      pro: {
        monthlyGenerations: 250,
        monthlyQuotes: 500,
        maxAssetsPerRequest: 16,
        features: ['basic_quotes', 'stock_assets', 'ai_images', 'quote_remix', 'unlimited_assets']
      }
    };

    const planLimits = limits[plan];
    const usage = {
      monthlyGenerations: monthlyCount,
      monthlyQuotes: Math.floor(monthlyCount * 1.5), // Estimate
      remainingGenerations: Math.max(0, planLimits.monthlyGenerations - monthlyCount),
      remainingQuotes: Math.max(0, planLimits.monthlyQuotes - Math.floor(monthlyCount * 1.5))
    };

    return res.json({ 
      ok: true, 
      data: { 
        plan,
        isPro,
        usage,
        limits: planLimits,
        resetDate: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString()
      } 
    });
  } catch (e) {
    return res.status(500).json({ ok: false, reason: "SERVER_ERROR", detail: e?.message || "usage limits fetch failed" });
  }
}
