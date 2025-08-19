import admin from "../config/firebase.js";
import { enhancePrompt } from "../services/enhance.service.js";
import { ensureUserDoc } from "../services/credit.service.js";
import { ENHANCE_COST } from "../config/pricing.js";

export async function enhanceImageController(req, res) {
  try {
    const { prompt, strength = 0.5 } = req.body || {};
    const { email } = req.user || {};

    const { ref: userRef, data: userData } = await ensureUserDoc(email);
    const currentCredits = userData.credits || 0;
    if (currentCredits < ENHANCE_COST) {
      return res.status(400).json({ success: false, error: "INSUFFICIENT_CREDITS" });
    }

    const enhancedPrompt = await enhancePrompt(prompt, strength);
    await userRef.update({ credits: admin.firestore.FieldValue.increment(-ENHANCE_COST) });

    return res.status(200).json({ enhancedPrompt });
  } catch (err) {
    return res.status(500).json({ success: false, error: "ENHANCE_FAILED" });
  }
}