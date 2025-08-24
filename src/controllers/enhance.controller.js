// src/controllers/enhance.controller.js
import admin from "../config/firebase.js";
import { enhancePrompt } from "../services/enhance.service.js";
import { ensureUserDoc, debitCreditsTx } from "../services/credit.service.js";

export async function enhance(req, res) {
  try {
    const { prompt, strength } = req.body || {};
    const { uid, email } = req.user || {};

    if (typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ success: false, error: "Invalid 'prompt' provided." });
    }

    if (strength != null && (typeof strength !== 'number' || strength < 0 || strength > 1)) {
      return res.status(400).json({ success: false, error: "'strength' must be a number between 0 and 1." });
    }

    await ensureUserDoc(uid, email);
    await debitCreditsTx(uid, 1);

    const enhancedPrompt = await enhancePrompt(prompt, strength);

    return res.json({ success: true, enhancedPrompt });
  } catch (err) {
    console.error("Enhance image failed:", err);
    return res.status(500).json({ success: false, error: "Enhancement failed." });
  }
}
