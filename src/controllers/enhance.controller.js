// src/controllers/enhance.controller.js
import admin from "../config/firebase.js"; // ✅ use the initialized Admin instance
import { enhancePrompt } from "../services/enhance.service.js";
import { ensureUserDoc, debitCreditsTx } from "../services/credit.service.js";
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
  // [AI_IMAGES] Kill-switch - image prompt enhancement disabled for v1
  return res.status(410).json({
    success: false,
    error: 'FEATURE_DISABLED',
    detail: 'Image prompt enhancement is not available in this version of Vaiform.'
  });
  
  // [AI_IMAGES] Legacy implementation (disabled for v1)
  /* eslint-disable no-unreachable */
  try {
    const { prompt, strength = 0.6 } = req.body || {};
    const { uid, email } = req.user || {};

    // Ensure user doc exists and migrate if needed
    await ensureUserDoc(uid, email);

    // Deduct 1 credit from UID doc
    await debitCreditsTx(uid, 1);

    // ---- Enhance the prompt ----
    const enhancedPrompt = await enhancePrompt(prompt, strength);

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
