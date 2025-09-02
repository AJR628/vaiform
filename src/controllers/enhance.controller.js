// src/controllers/enhance.controller.js
import { enhancePrompt } from '../services/enhance.service.js';
import { db } from '../config/firebase.js';
import { ENHANCE_COST } from '../config/pricing.js';

export async function enhanceController(req, res) {
  try {
    const { prompt, strength = 0.5 } = req.body || {};
    const { uid, email } = req.user || {};

    const userDoc = db.collection('users').doc(uid);
    const userSnap = await userDoc.get();
    if (!userSnap.exists || userSnap.data().credits < ENHANCE_COST) {
      return res.status(400).json({ success: false, error: 'Insufficient credits' });
    }

    await userDoc.update({
      credits: admin.firestore.FieldValue.increment(-ENHANCE_COST),
    });

    const enhancedPrompt = await enhancePrompt(prompt, strength);
    return res.json({ success: true, enhancedPrompt });
  } catch (error) {
    console.error('Enhance error:', error);
    return res.status(500).json({ success: false, error: 'Enhancement failed.' });
  }
}
