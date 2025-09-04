import { enhancePrompt } from "../services/enhance.service.js";
import { debitCreditsTx } from "../services/credit.service.js";

export async function enhanceImageController(req, res) {
  try {
    const { prompt, strength = 0.5 } = req.body;
    if (typeof prompt !== 'string' || (strength !== undefined && (typeof strength !== 'number' || strength < 0 || strength > 1))) {
      return res.status(400).json({ success: false, error: "Invalid input" });
    }
    await debitCreditsTx(req.user?.uid, 1);
    const enhancedPrompt = await enhancePrompt(prompt, strength);
    return res.json({ success: true, enhancedPrompt });
  } catch (err) {
    console.error("Enhance image error:", err);
    return res.status(500).json({ success: false, error: "Enhancement failed" });
  }
}