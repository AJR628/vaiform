import admin from "firebase-admin";
import { db } from "../config/firebase.js";

// Pricing: 1→20, 2→40, else→70 (4)
export function computeCost(numImages = 1) {
  const n = Number(numImages) || 1;
  if (n === 1) return 20;
  if (n === 2) return 40;
  return 70;
}

export async function ensureUserDoc(email) {
  const userRef = db.collection("users").doc(email);
  const snap = await userRef.get();
  if (!snap.exists) {
    await userRef.set({
      credits: 50,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { ref: userRef, data: { credits: 50 } };
  }
  return { ref: userRef, data: snap.data() };
}

// Map Stripe Price IDs → credits (use your Replit secrets)
export const CREDIT_PRICE_MAP = {
  [process.env.STRIPE_PRICE_500]: 500,
  [process.env.STRIPE_PRICE_2000]: 2000,
  [process.env.STRIPE_PRICE_5000]: 5000,
  [process.env.STRIPE_SUB_PRICE_500]: 500,
  [process.env.STRIPE_SUB_PRICE_2000]: 2000,
  [process.env.STRIPE_SUB_PRICE_5000]: 5000,
};