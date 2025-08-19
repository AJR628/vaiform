import admin from "firebase-admin";
import { ensureUserDoc } from "../services/credit.service.js";

/**
 * GET /credits
 * Authenticated: requires Firebase ID token via requireAuth
 * Returns { email, credits }
 */
export async function getCredits(req, res) {
  try {
    const { uid, email } = req.user || {};
    if (!email) {
      return res.status(401).json({ success: false, error: "UNAUTHENTICATED", detail: "Missing user email" });
    }

    const { ref, data } = await ensureUserDoc(email, uid);
    let docData = data;
    if (!docData) {
      const snap = await ref.get();
      docData = snap.exists ? snap.data() : {};
    }

    const credits = Number.isFinite(Number(docData?.credits)) ? Number(docData.credits) : 0;
    return res.json({ email, credits });
  } catch (err) {
    console.error("❌ getCredits error:", err);
    return res.status(500).json({ success: false, error: "INTERNAL", detail: "Failed to fetch credits" });
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