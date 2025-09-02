// src/controllers/enhance.controller.js
import { enhancePrompt } from '../services/enhance.service.js';
import { debitCreditsTx } from '../services/credit.service.js';

export async function enhanceController(req, res) {
  const { prompt, strength = 0.6 } = req.body || {};
  const { uid } = req.user || {};

  try {
    await debitCreditsTx(uid, 1);

    const enhancedPrompt = await enhancePrompt(prompt, strength);

    return res.status(200).json({ enhancedPrompt });
  } catch (err) {
    console.error('Enhance failed:', err);
    return res.status(500).json({ success: false, error: 'ENHANCE_FAILED' });
  }
}
