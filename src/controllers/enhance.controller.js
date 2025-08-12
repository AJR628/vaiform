import { enhancePrompt } from '../services/enhance.service.js';
import admin from 'firebase-admin';
import { ensureUserDoc } from '../services/credit.service.js';

export async function enhanceImage(req, res) {
  const { prompt, strength = 0.5 } = req.body;
  if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'Invalid or missing prompt' });
  if (typeof strength !== 'number' || strength < 0 || strength > 1) return res.status(400).json({ error: 'Invalid strength' });

  try {
    const enhancedPrompt = await enhancePrompt(prompt, strength);
    const { ref: userRef, data: userData } = await ensureUserDoc(req.user.email);

    if ((userData.credits ?? 0) < 1) {
      return res.status(400).json({ error: 'Insufficient credits' });
    }

    await userRef.update({ credits: admin.firestore.FieldValue.increment(-1) });

    res.json({ enhancedPrompt });
  } catch (err) {
    console.error('❌ EnhanceImage error:', err.message);
    res.status(500).json({ error: 'Failed to enhance image' });
  }
}