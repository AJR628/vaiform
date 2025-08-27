// src/controllers/enhance.controller.js
import admin from "../config/firebase.js";
import { enhancePrompt } from "../services/enhance.service.js";
import { ensureUserDoc } from "../services/credit.service.js";
import { ENHANCE_COST } from "../config/pricing.js";

export async function enhanceController(req, res) {
  try {
    const { prompt, strength = 0.5 } = req.body || {};
    const { email } = req.user || {};

    // Ensure user doc exists
    await ensureUserDoc(email);

    // Deduct credit
    const userRef = admin.firestore().doc(`users/${email}`);
    await userRef.update({
      credits: admin.firestore.FieldValue.increment(-ENHANCE_COST)
    });

    // Enhance prompt
    const enhancedPrompt = await enhancePrompt(prompt, strength);

    // Respond with enhanced prompt
    return res.json({
      success: true,
      enhancedPrompt
    });
  } catch (err) {
    console.error("Enhance error:", err);
    return res.status(500).json({
      success: false,
      error: "Enhancement failed."
    });
  }
}