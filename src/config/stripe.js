// src/config/stripe.js
import Stripe from 'stripe';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

let stripe = null;

if (!STRIPE_SECRET_KEY) {
  console.warn('⚠️ Missing STRIPE_SECRET_KEY in environment. Stripe API will not work.');
} else {
  if (!STRIPE_WEBHOOK_SECRET) {
    console.warn('⚠️ STRIPE_WEBHOOK_SECRET not set. Webhook signature verification will fail.');
  }
  
  try {
    stripe = new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: '2023-10-16', // pin to a stable version
    });
    console.log('✅ Stripe initialized successfully');
  } catch (error) {
    console.error('❌ Stripe initialization failed:', error.message);
  }
}

export { stripe };
