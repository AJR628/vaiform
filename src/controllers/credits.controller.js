import admin from "firebase-admin";
import { ensureUserDoc } from "../services/credit.service.js";

// GET /credits/balance?email=...
export const balance = async (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: "Missing email." });
  try {
    const { data } = await ensureUserDoc(email);
    res.json({ success: true, credits: data.credits ?? 0 });
  } catch (err) {
    console.error("❌ balance error:", err.message);
    res.status(500).json({ success: false, error: "Failed to fetch balance." });
  }
};

// POST /credits/grant { email, credits }
export const grant = async (req, res) => {
  const { email, credits } = req.body;
  if (!email || !Number.isFinite(credits)) {
    return res.status(400).json({ error: "Missing email or credits." });
  }
  try {
    const { ref: userRef } = await ensureUserDoc(email);
    await userRef.update({
      credits: admin.firestore.FieldValue.increment(Number(credits)),
    });
    await userRef.collection("transactions").add({
      type: "grant",
      credits: Number(credits),
      amount: 0,
      currency: "usd",
      stripeId: null,
      status: "succeeded",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    res.json({ success: true });
  } catch (err) {
    console.error("❌ grant error:", err.message);
    res.status(500).json({ success: false, error: "Failed to grant credits." });
  }
};