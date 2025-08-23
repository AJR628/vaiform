import admin from "firebase-admin";
import { ensureUserDoc } from "../services/credit.service.js";

export async function getCredits(req, res) {
  try {
    const { uid, email } = req.user || {};
    const { ref, data } = await ensureUserDoc(uid || email, email);

    return res.json({
      success: true,
      uid: data?.uid || uid,
      email: data?.email || email,
      credits: data?.credits ?? 0,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      code: "CREDITS_ERROR",
      message: err.message,
    });
  }
}

/**
 * GET /credits/balance?email=...
 * (Legacy helper) – unauth path for quick checks
 */
export async function balance(req, res) {
  const email = req.query.email;
  if (!email) return res.status(400).json({ success: false, error: "Missing email." });
  try {
    const { data } = await ensureUserDoc(email);
    return res.json({ success: true, credits: data?.credits ?? 0 });
  } catch (err) {
    console.error("❌ balance error:", err?.message || err);
    return res.status(500).json({ success: false, error: "Failed to fetch balance." });
  }
}

/**
 * POST /credits/grant { email, credits }
 * Admin/test helper to add credits
 */
export async function grant(req, res) {
  const { email, credits } = req.body || {};
  const n = Number(credits);
  if (!email || !Number.isFinite(n)) {
    return res.status(400).json({ success: false, error: "Missing email or credits (number)." });
  }

  try {
    const { ref: userRef } = await ensureUserDoc(email);
    await userRef.update({
      credits: admin.firestore.FieldValue.increment(n),
    });
    await userRef.collection("transactions").add({
      type: "grant",
      credits: n,
      amount: 0,
      currency: "usd",
      stripeId: null,
      status: "succeeded",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return res.json({ success: true });
  } catch (err) {
    console.error("❌ grant error:", err?.message || err);
    return res.status(500).json({ success: false, error: "Failed to grant credits." });
  }
}