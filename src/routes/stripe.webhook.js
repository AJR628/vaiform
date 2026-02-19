import express from 'express';
import Stripe from 'stripe';
import admin from '../config/firebase.js';
import { PLAN_CREDITS_MAP, getCreditsForPlan } from '../services/credit.service.js';
import { ok, fail } from '../http/respond.js';

const router = express.Router();
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-06-30.basil',
    })
  : null;

// POST /stripe/webhook must use raw body
router.post('/', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  console.log('[webhook] hit', new Date().toISOString());

  if (!stripe) {
    console.warn('[webhook] Stripe not configured, ignoring webhook');
    return res.status(200).send('OK');
  }

  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    console.log('[webhook] type:', event.type);
  } catch (err) {
    console.error('[webhook] signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        console.log('[webhook] session metadata:', session.metadata);

        if (session.metadata?.uid && session.metadata?.plan) {
          try {
            await grantCreditsAndUpdatePlan(session.metadata, event.id, event.type);
            console.log(`[webhook] Successfully processed payment for uid=${session.metadata.uid}`);
          } catch (error) {
            console.error(
              `[webhook] Failed to process payment for uid=${session.metadata.uid}:`,
              error
            );
            // Don't throw here - we still want to return success to Stripe to avoid retries
          }
        } else {
          console.error('[webhook] Missing uid or plan in session metadata:', session.metadata);
        }
        break;
      }
      case 'invoice.payment_succeeded': {
        // TODO: subscription renewal → top up credits, update nextPaymentAt
        console.log('[webhook] invoice payment succeeded:', event.data.object.id);
        break;
      }
      case 'customer.subscription.deleted': {
        // TODO: mark isMember=false, clear plan/kind
        console.log('[webhook] subscription deleted:', event.data.object.id);
        break;
      }
      default:
        console.log('[webhook] unhandled event type:', event.type);
        break;
    }
    return ok(req, res, { received: true });
  } catch (e) {
    console.error('[webhook] handler error', e);
    return fail(req, res, 500, 'WEBHOOK_ERROR', e?.message || 'WEBHOOK_ERROR');
  }
});

async function grantCreditsAndUpdatePlan(metadata, eventId, eventType) {
  const { uid, plan, billing, email } = metadata;

  if (!uid || !plan) {
    console.error('[webhook] Missing uid or plan in metadata:', metadata);
    return;
  }

  if (!eventId || !eventType) {
    console.error('[webhook] Missing eventId or eventType for idempotency check');
    return;
  }

  const db = admin.firestore();
  const userRef = db.collection('users').doc(uid);
  const eventRef = userRef.collection('stripe_webhook_events').doc(eventId);

  // Check idempotency: if this event was already processed, skip
  const eventSnap = await eventRef.get();
  if (eventSnap.exists) {
    const eventData = eventSnap.data();
    console.log(
      `[webhook] Event ${eventId} already processed at ${eventData.processedAt?.toDate()}, skipping`
    );
    return;
  }

  // Calculate credits using PLAN_CREDITS_MAP
  const creditsToAdd = getCreditsForPlan(plan);

  if (creditsToAdd === 0) {
    console.warn(`[webhook] Unknown plan "${plan}", no credits granted`);
  }

  try {
    await db.runTransaction(async (t) => {
      const snap = await t.get(userRef);
      const now = admin.firestore.Timestamp.now();
      const expiresAt =
        billing === 'onetime'
          ? admin.firestore.Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
          : null;

      t.set(
        userRef,
        {
          email: email || admin.firestore.FieldValue.delete(),
          plan,
          isMember: true,
          credits: admin.firestore.FieldValue.increment(creditsToAdd),
          membership: {
            kind: billing === 'onetime' ? 'onetime' : 'subscription',
            billing,
            startedAt: now,
            expiresAt,
          },
          lastPaymentAt: now,
          updatedAt: now,
        },
        { merge: true }
      );
    });

    // Record successful event processing (outside transaction for simplicity)
    await eventRef.set({
      eventId,
      eventType,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      uid,
      plan,
      creditsGranted: creditsToAdd,
      billing,
    });

    console.log(
      `[plan] Upgraded uid=${uid} -> ${plan}, credits +${creditsToAdd} (event: ${eventId})`
    );
  } catch (error) {
    console.error(`[webhook] Failed to update user ${uid}:`, error);
    throw error;
  }
}

router.get('/', (req, res) => {
  return ok(req, res, { alive: true });
});

export default router;
