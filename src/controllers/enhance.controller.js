import { enhancePrompt } from '../services/enhance.service.js';
import { db } from '../config/firebase.js';

export const enhanceImage = async (req, res) => {
  const { prompt, strength } = req.body;
  if (typeof prompt !== 'string' || (strength != null && (isNaN(strength) || strength < 0 || strength > 1))) {
    return res.status(400).json({ error: 'Invalid input.' });
  }

  const email = req.user.email;
  const userRef = db.collection('users').doc(email);
  const userSnap = await userRef.get();
  const userData = userSnap.data();

  if ((userData.credits ?? 0) < 1) {
    return res.status(400).json({ error: 'Insufficient credits' });
  }

  await userRef.update({ credits: userData.credits - 1 });

  const enhancedPrompt = await enhancePrompt(prompt, strength);
  res.json({ enhancedPrompt });
};