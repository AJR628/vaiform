// src/controllers/enhance.controller.js
import admin from "firebase-admin";
import { enhancePrompt } from "../services/enhance.service.js";
import { ensureUserDoc } from "../services/credit.service.js";
import { ENHANCE_COST } from "../config/pricing.js";

/**
 * POST /enhance-image
 * Body: { prompt: string, strength?: number (0..1) }
 * Deducts ENHANCE_COST credits, returns { enhancedPrompt }
 */
export async function enhanceImage(req, res) {
  const { prompt, strength = 0.5 } = req.body;

  // ---- Validation ----
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "Invalid or missing prompt" });
  }
  if (typeof strength !== "number" || strength < 0 || strength > 1) {
    return res.status(400).json({ error: "Invalid strength value" });
  }

  try {
    // ---- Enhance the prompt ----
    const enhancedPrompt = await enhancePrompt(prompt, strength);

    // ---- Ensure user exists in DB ----
    const { ref: userRef, data: userData } = await ensureUserDoc(req.user.email);

    // ---- Credit check ----
    const currentCredits = userData.credits ?? 0;
    if (currentCredits < ENHANCE_COST) {
      return res.status(400).json({ error: "Insufficient credits" });
    }

    // ---- Deduct credits ----
    await userRef.update({
      credits: admin.firestore.FieldValue.increment(-ENHANCE_COST)
    });

    // ---- Respond ----
    return res.json({ enhancedPrompt });
  } catch (err) {
    console.error("❌ EnhanceImage error:", err);
    return res.status(500).json({ error: "Failed to enhance image" });
  }
}