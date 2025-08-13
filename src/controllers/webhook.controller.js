// src/controllers/webhook.controller.js
import admin from 'firebase-admin';
import { stripe } from '../config/stripe.js';
import { ensureUserDoc, CREDIT_PRICE_MAP } from '../services/credit.service.js';

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
// Reject events older than this (seconds) to reduce replay risk
const MAX_EVENT_AGE_SEC = 5 * 60;

// Creates a doc with event.id; if it already exists, we treat as processed (idempotency)
async function markEventProcessing(event) {
  const ref = admin.firestore().collection('stripe_webhook_events').doc(event.id);
  // .create() fails if doc exists
  await ref.create({
    type: event.type,
    livemode: !!event.livemode,
    created: event.created,
    receivedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return ref;
}

export async function stripeWebhook(req, res) {
  if (!WEBHOOK_SECRET) {
    console.error('❌ Missing STRIPE_WEBHOOK_SECRET; cannot verify Stripe signatures.');
    return res.status(500).send('Webhook misconfigured');
  }

  // bodyParser.raw puts a Buffer in req.body; constructEvent requires that Buffer
  const sig = req.headers['stripe-signature'];
  if (!sig) return res.status(400).send('Missing stripe-signature header');

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
  } catch (_e) {
    console.error('⚠️ Webhook signature verification failed:', _e.message);
    return res.status(400).send(`Webhook Error: ${_e.message}`);
  }

  // Basic replay guard (Stripe also signs with a timestamp; we add a soft time window)
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof event.created === 'number' && nowSec - event.created > MAX_EVENT_AGE_SEC) {
    console.warn(`⏰ Dropping stale event ${event.id} (${event.type}); age ${nowSec - event.created}s`);
    return res.status(200).json({ received: true, stale: true });
  }

  // Idempotency: ensure we only process each event.id once
  try {
    await markEventProcessing(event);
  } catch (_e) {
    // Firestore .create() throws if already exists
    console.log(`🔁 Duplicate delivery for event ${event.id}; skipping.`);
    return res.status(200).json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;

        const email = session.metadata?.email || session.customer_details?.email || null;
        if (!email) break;

        // Expand line items to read Price IDs
        const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
          expand: ['line_items.data.price'],
        });

        const items = fullSession?.line_items?.data || [];
        let totalCredits = 0;

        for (const li of items) {
          const priceId = li.price?.id;
          const qty = li.quantity || 1;
          const perUnit = priceId ? CREDIT_PRICE_MAP[priceId] || 0 : 0;
          if (!perUnit) {
            console.warn('⚠️ Unknown price in checkout.session:', priceId);
          }
          totalCredits += perUnit * qty;
        }

        if (totalCredits > 0) {
          const { ref: userRef } = await ensureUserDoc(email);
          await userRef.update({
            credits: admin.firestore.FieldValue.increment(totalCredits),
          });
          await userRef.collection('transactions').add({
            type: 'purchase',
            credits: totalCredits,
            amount: session.amount_total ?? null,
            currency: session.currency ?? 'usd',
            stripeId: session.payment_intent || session.id,
            status: 'succeeded',
            livemode: !!event.livemode,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log(`✅ +${totalCredits} credits → ${email}`);
        }
        break;
      }

      case 'invoice.paid': {
        // Subscription renewal crediting
        const invoice = event.data.object;

        // Find email
        let email = invoice.customer_email || null;
        if (!email) {
          const customer =
            typeof invoice.customer === 'string'
              ? await stripe.customers.retrieve(invoice.customer)
              : invoice.customer;
          email = customer?.email || customer?.metadata?.email || null;
        }
        if (!email) break;

        // Expand subscription to read Price IDs
        const sub = await stripe.subscriptions.retrieve(invoice.subscription, {
          expand: ['items.data.price'],
        });

        let totalCredits = 0;
        for (const it of sub.items.data) {
          const priceId = it.price?.id;
          const qty = it.quantity || 1;
          const perUnit = priceId ? CREDIT_PRICE_MAP[priceId] || 0 : 0;
          if (!perUnit) {
            console.warn('⚠️ Unknown price in invoice.paid:', priceId);
          }
          totalCredits += perUnit * qty;
        }

        if (totalCredits > 0) {
          const { ref: userRef } = await ensureUserDoc(email);
          await userRef.update({
            credits: admin.firestore.FieldValue.increment(totalCredits),
          });
          await userRef.collection('transactions').add({
            type: 'purchase',
            credits: totalCredits,
            amount: invoice.amount_paid ?? null,
            currency: invoice.currency ?? 'usd',
            stripeId: invoice.id,
            status: 'succeeded',
            livemode: !!event.livemode,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log(`🔁 Subscription: +${totalCredits} credits → ${email}`);
        }
        break;
      }

      default:
        // No-op for other event types
        break;
    }

    // Always 2xx so Stripe stops retrying (idempotency covers duplicates)
    return res.json({ received: true });
  } catch (err) {
    console.error('🔥 Webhook handler error:', err);
    // Still return 200 to prevent retries if your logic is idempotent; otherwise 500.
    return res.status(500).send('Webhook handler error.');
  }
}