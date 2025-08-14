// src/controllers/enhance.controller.js
import admin from 'firebase-admin';
import { enhancePrompt } from '../services/enhance.service.js';
import { ensureUserDoc } from '../services/credit.service.js';
import { ENHANCE_COST } from '../config/pricing.js';

export async function enhanceImage(req, res) {
  const { prompt, strength = 0.5 } = req.body;

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Invalid or missing prompt' });
  }
  if (typeof strength !== 'number' || strength < 0 || strength > 1) {
    return res.status(400).json({ error: 'Invalid strength value' });
  }

  try {
    const enhancedPrompt = await enhancePrompt(prompt, strength);
    const { ref: userRef, data: userData } = await ensureUserDoc(req.user.email);
    const currentCredits = userData.credits ?? 0;
    if (currentCredits < ENHANCE_COST) {
      return res.status(400).json({ error: 'Insufficient credits' });
    }

    await userRef.update({
      credits: admin.firestore.FieldValue.increment(-ENHANCE_COST),
    });

    return res.json({ enhancedPrompt });
  } catch (err) {
    console.error('❌ EnhanceImage error:', err);
    return res.status(500).json({ error: 'Failed to enhance image' });
  }
}
