// src/controllers/enhance.controller.js
import admin from "../config/firebase.js"; // ✅ use the initialized Admin instance
import { enhancePrompt } from "../services/enhance.service.js";
import { ensureUserDoc } from "../services/credit.service.js";
import { ENHANCE_COST } from "../config/pricing.js";

/**
 * POST /enhance
 * Body: { prompt: string, strength?: number in [0,1] }
 * Requires: Authorization: Bearer <ID_TOKEN>, X-Idempotency-Key
 * Deducts ENHANCE_COST credits, returns { success:true, enhancedPrompt }
 *
 * Note: Input is validated by EnhanceSchema in the route (validate middleware),
 * so this controller assumes valid types/ranges.
 */
export async function enhanceController(req, res) {
  try {
    const { prompt, strength = 0.6 } = req.body || {};
    const { uid, email } = req.user || {};

    // ---- Ensure user doc & check credits first (avoid work if insufficient) ----
    const { ref: userRef, data: userData } = await ensureUserDoc(email);
    const currentCredits = userData.credits ?? 0;
    if (currentCredits < ENHANCE_COST) {
      return res.status(400).json({
        success: false,
        error: "INSUFFICIENT_CREDITS",
        detail: `You need at least ${ENHANCE_COST} credits.`,
      });
    }

    // ---- Enhance the prompt ----
    const enhancedPrompt = await enhancePrompt(prompt, strength);

    // ---- Deduct credits atomically ----
    await userRef.update({
      credits: admin.firestore.FieldValue.increment(-ENHANCE_COST),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastEnhanceAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // ---- Respond (FireStore idempotency will cache this non-5xx) ----
    return res.status(200).json({
  success: true,
  data: {
    enhancedPrompt,
    cost: ENHANCE_COST,
  },
});
  } catch (err) {
    console.error("❌ [enhance] failed:", err?.code || err?.name, err?.message || err);
    return res.status(500).json({
      success: false,
      error: "ENHANCE_FAILED",
      detail: err?.message || "Enhance failed",
    });
  }
}
