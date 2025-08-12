// src/config/stripe.js
import Stripe from "stripe";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

if (!STRIPE_SECRET_KEY) {
  console.error("❌ Missing STRIPE_SECRET_KEY in environment. Stripe API will not work.");
  throw new Error("Missing Stripe secret key");
}

if (!STRIPE_WEBHOOK_SECRET) {
  console.warn("⚠️ STRIPE_WEBHOOK_SECRET not set. Webhook signature verification will fail.");
}

export const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16", // pin to a stable version
});