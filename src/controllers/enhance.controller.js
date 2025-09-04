// src/controllers/enhance.controller.js
import admin from "../config/firebase.js";
import { enhancePrompt } from "../services/enhance.service.js";
import { ensureUserDoc, debitCreditsTx } from "../services/credit.service.js";
import { ENHANCE_COST } from "../config/pricing.js";

export async function enhanceController(req, res) {
  try {
    const { prompt, strength = 0.6 } = req.body || {};
    const { uid, email } = req.user || {};

    await ensureUserDoc(uid, email);
    await debitCreditsTx(uid, 1);

    const enhancedPrompt = await enhancePrompt(prompt, strength);

    return res.status(200).json({ enhancedPrompt });
  } catch (err) {
    console.error("❌ [enhance] failed:", err?.code || err?.name, err?.message || err);
    return res.status(500).json({ error: "ENHANCE_FAILED" });
  }
}