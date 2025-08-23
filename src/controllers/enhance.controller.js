// src/controllers/enhance.controller.js
import { enhancePrompt } from "../services/enhance.service.js";
import { debitCreditsTx, ensureUserDoc } from "../services/credit.service.js";
import { ENHANCE_COST } from "../config/pricing.js";

export async function enhanceController(req, res) {
  try {
    const { prompt, strength } = req.body;
    const { email } = req.user;

    // Ensure user doc exists
    const { ref } = await ensureUserDoc(email);

    // Deduct credits
    await debitCreditsTx(ref.id, ENHANCE_COST);

    // Enhance prompt
    const enhancedPrompt = await enhancePrompt(prompt, strength);

    res.json({ success: true, enhancedPrompt });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}
