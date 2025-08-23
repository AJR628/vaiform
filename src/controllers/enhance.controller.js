import admin from '../config/firebase.js';
import { enhancePrompt } from '../services/enhance.service.js';
import { ensureUserDoc } from '../services/credit.service.js';
import { ENHANCE_COST } from '../config/pricing.js';

export async function enhanceController(req, res) {
  try {
    const { prompt, strength = 0.5 } = req.body || {};
    const { email } = req.user || {};
    
    if (typeof prompt !== 'string') {
      return res.status(400).json({ success: false, error: 'Invalid prompt.' });
    }
    if (strength < 0 || strength > 1) {
      return res.status(400).json({ success: false, error: 'Strength must be between 0 and 1.' });
    }

    const { ref: userRef, data: userData } = await ensureUserDoc(email);
    const currentCredits = userData.credits ?? 0;
    if (currentCredits < ENHANCE_COST) {
      return res.status(400).json({
        success: false,
        error: 'INSUFFICIENT_CREDITS',
        detail: `You need at least ${ENHANCE_COST} credits.`
      });
    }

    const enhancedPrompt = await enhancePrompt(prompt, strength);

    await userRef.update({
      credits: admin.firestore.FieldValue.increment(-ENHANCE_COST),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).json({ success: true, enhancedPrompt });
  } catch (err) {
    console.error('[enhance-image] failed:', err);
    return res.status(500).json({ success: false, error: 'ENHANCE_FAILED', detail: err.message });
  }
}