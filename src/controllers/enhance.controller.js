// src/controllers/enhance.controller.js
import admin from '../config/firebase.js';
import { enhancePrompt } from '../services/enhance.service.js';
import { ensureUserDoc } from '../services/credit.service.js';
import { ENHANCE_COST } from '../config/pricing.js';

export async function enhanceController(req, res) {
  try {
    const { prompt, strength = 0.6 } = req.body || {};
    const { uid, email } = req.user || {};

    const { ref: userRef, data: userData } = await ensureUserDoc(email);
    const currentCredits = userData.credits ?? 0;
    if (currentCredits < ENHANCE_COST) {
      return res.status(400).json({
        success: false,
        error: 'INSUFFICIENT_CREDITS',
        detail: `You need at least ${ENHANCE_COST} credits.`,
      });
    }

    const enhancedPrompt = await enhancePrompt(prompt, strength);

    await userRef.update({
      credits: admin.firestore.FieldValue.increment(-ENHANCE_COST),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastEnhanceAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.status(200).json({
      success: true,
      data: {
        enhancedPrompt,
        cost: ENHANCE_COST,
      },
    });
  } catch (err) {
    console.error('❌ [enhance] failed:', err?.code || err?.name, err?.message || err);
    return res.status(500).json({
      success: false,
      error: 'ENHANCE_FAILED',
      detail: err?.message || 'Enhance failed',
    });
  }
}
