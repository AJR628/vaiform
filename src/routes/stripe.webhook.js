import express from 'express';
import admin from '../config/firebase.js';
import { stripe, STRIPE_WEBHOOK_SECRET } from '../config/stripe.js';
import { getCreditsForPlan, getCreditsForStripePrice } from '../services/credit.service.js';
import { ok, fail } from '../http/respond.js';

const router = express.Router();

const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const RENEWAL_BILLING_REASONS = new Set(['subscription_cycle']);

function webhookError(code, detail, status = 500) {
  const err = new Error(detail);
  err.code = code;
  err.status = status;
  return err;
}

function metaValue(metadata, key) {
  const value = metadata?.[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : null;
}

function toPositiveInt(value, fallback = 1) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function inferPurchaseType(metadata, fallbackPriceId = null) {
  const purchaseType = metaValue(metadata, 'purchaseType');
  if (purchaseType === 'plan' || purchaseType === 'credit_pack') return purchaseType;
  if (metaValue(metadata, 'plan')) return 'plan';
  if (metaValue(metadata, 'priceId') || fallbackPriceId) return 'credit_pack';
  return null;
}

async function resolveUidByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  try {
    const record = await admin.auth().getUserByEmail(normalized);
    return record?.uid || null;
  } catch {
    return null;
  }
}

async function resolveCustomerEmail(customerId) {
  if (!stripe || typeof customerId !== 'string' || !customerId) return null;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (customer && !customer.deleted) return customer.email || null;
  } catch (err) {
    console.warn('[webhook] customer email lookup failed:', err?.message || err);
  }
  return null;
}

async function resolveUid({ uidHints = [], emailHints = [], customerId = null }) {
  for (const uidHint of uidHints) {
    if (typeof uidHint === 'string' && uidHint.trim()) return uidHint.trim();
  }

  for (const emailHint of emailHints) {
    const resolvedUid = await resolveUidByEmail(emailHint);
    if (resolvedUid) return resolvedUid;
  }

  const customerEmail = await resolveCustomerEmail(customerId);
  if (customerEmail) {
    const resolvedUid = await resolveUidByEmail(customerEmail);
    if (resolvedUid) return resolvedUid;
  }

  throw webhookError('WEBHOOK_IDENTITY_MISSING', 'Unable to resolve user identity for webhook');
}

function buildGrantContextFromSession(session) {
  const metadata = session.metadata || {};
  const purchaseType = inferPurchaseType(metadata);

  if (!purchaseType) {
    throw webhookError(
      'WEBHOOK_CONTEXT_MISSING',
      'Missing purchase context for checkout.session.completed'
    );
  }

  if (purchaseType === 'plan') {
    const plan = metaValue(metadata, 'plan');
    const billing =
      metaValue(metadata, 'billing') || (session.mode === 'subscription' ? 'monthly' : 'onetime');

    if (!plan) {
      throw webhookError('WEBHOOK_PLAN_MISSING', 'Missing plan metadata for checkout session');
    }

    const creditsToAdd = getCreditsForPlan(plan);
    if (creditsToAdd <= 0) {
      throw webhookError('UNKNOWN_PLAN', `Unknown plan "${plan}" for checkout session`);
    }

    return {
      purchaseType,
      plan,
      billing,
      creditsToAdd,
      email: normalizeEmail(
        metaValue(metadata, 'email') || session.customer_email || session.customer_details?.email
      ),
      marker: {
        purchaseType,
        plan,
        billing,
        creditsGranted: creditsToAdd,
        stripeObjectId: session.id,
        source: 'checkout.session.completed',
      },
    };
  }

  const priceId = metaValue(metadata, 'priceId');
  const quantity = toPositiveInt(metaValue(metadata, 'quantity'), 1);
  const creditsPerUnit = getCreditsForStripePrice(priceId);

  if (!priceId) {
    throw webhookError('WEBHOOK_PRICE_MISSING', 'Missing priceId metadata for checkout session');
  }

  if (creditsPerUnit <= 0) {
    throw webhookError('UNKNOWN_PRICE_ID', `Unknown priceId "${priceId}" for checkout session`);
  }

  return {
    purchaseType,
    priceId,
    quantity,
    billing: session.mode === 'subscription' ? 'monthly' : 'onetime',
    creditsToAdd: creditsPerUnit * quantity,
    email: normalizeEmail(
      metaValue(metadata, 'email') || session.customer_email || session.customer_details?.email
    ),
    marker: {
      purchaseType,
      priceId,
      quantity,
      billing: session.mode === 'subscription' ? 'monthly' : 'onetime',
      creditsGranted: creditsPerUnit * quantity,
      stripeObjectId: session.id,
      source: 'checkout.session.completed',
    },
  };
}

function buildGrantContextFromSubscription(subscription, invoice = null) {
  const metadata = subscription?.metadata || {};
  const fallbackPriceId =
    subscription?.items?.data?.[0]?.price?.id || invoice?.lines?.data?.[0]?.price?.id || null;
  const purchaseType = inferPurchaseType(metadata, fallbackPriceId);

  if (!purchaseType) {
    throw webhookError(
      'WEBHOOK_CONTEXT_MISSING',
      'Missing purchase context for subscription renewal'
    );
  }

  if (purchaseType === 'plan') {
    const plan = metaValue(metadata, 'plan');
    const billing = metaValue(metadata, 'billing') || 'monthly';

    if (!plan) {
      throw webhookError('WEBHOOK_PLAN_MISSING', 'Missing plan metadata for subscription renewal');
    }

    const creditsToAdd = getCreditsForPlan(plan);
    if (creditsToAdd <= 0) {
      throw webhookError('UNKNOWN_PLAN', `Unknown plan "${plan}" for subscription renewal`);
    }

    return {
      purchaseType,
      plan,
      billing,
      creditsToAdd,
      email: normalizeEmail(
        metaValue(metadata, 'email') || invoice?.customer_email || invoice?.customer_details?.email
      ),
      marker: {
        purchaseType,
        plan,
        billing,
        creditsGranted: creditsToAdd,
        stripeObjectId: subscription.id,
        source: 'invoice.payment_succeeded',
      },
    };
  }

  const priceId = metaValue(metadata, 'priceId') || fallbackPriceId;
  const quantity = toPositiveInt(
    invoice?.lines?.data?.[0]?.quantity || subscription?.items?.data?.[0]?.quantity || 1,
    1
  );
  const creditsPerUnit = getCreditsForStripePrice(priceId);

  if (!priceId) {
    throw webhookError('WEBHOOK_PRICE_MISSING', 'Missing priceId for subscription renewal');
  }

  if (creditsPerUnit <= 0) {
    throw webhookError('UNKNOWN_PRICE_ID', `Unknown priceId "${priceId}" for subscription renewal`);
  }

  return {
    purchaseType,
    priceId,
    quantity,
    billing: 'monthly',
    creditsToAdd: creditsPerUnit * quantity,
    email: normalizeEmail(
      metaValue(metadata, 'email') || invoice?.customer_email || invoice?.customer_details?.email
    ),
    marker: {
      purchaseType,
      priceId,
      quantity,
      billing: 'monthly',
      creditsGranted: creditsPerUnit * quantity,
      stripeObjectId: subscription.id,
      source: 'invoice.payment_succeeded',
    },
  };
}

function buildPlanCancellationContext(subscription) {
  const metadata = subscription?.metadata || {};
  const purchaseType = inferPurchaseType(metadata);

  if (purchaseType !== 'plan') {
    return null;
  }

  const plan = metaValue(metadata, 'plan');
  const billing = metaValue(metadata, 'billing') || 'monthly';

  if (!plan) {
    throw webhookError(
      'WEBHOOK_PLAN_MISSING',
      'Missing plan metadata for customer.subscription.deleted'
    );
  }

  return {
    purchaseType,
    plan,
    billing,
    email: normalizeEmail(metaValue(metadata, 'email')),
    marker: {
      purchaseType,
      plan,
      billing,
      stripeObjectId: subscription.id,
      source: 'customer.subscription.deleted',
      action: 'subscription_deleted',
    },
  };
}

function buildGrantUserPatch(currentUser, context) {
  const timestampNow = admin.firestore.Timestamp.now();
  const serverNow = admin.firestore.FieldValue.serverTimestamp();
  const patch = {
    uid: context.uid,
    credits: admin.firestore.FieldValue.increment(context.creditsToAdd),
    lastPaymentAt: serverNow,
    updatedAt: serverNow,
  };

  if (!currentUser?.createdAt) {
    patch.createdAt = serverNow;
  }

  if (context.email) {
    patch.email = context.email;
  }

  if (context.purchaseType === 'plan') {
    patch.plan = context.plan;
    patch.isMember = true;
    patch.subscriptionStatus = context.billing === 'monthly' ? 'active' : null;
    patch.membership = {
      kind: context.billing === 'onetime' ? 'onetime' : 'subscription',
      billing: context.billing,
      startedAt: currentUser?.membership?.startedAt || timestampNow,
      expiresAt:
        context.billing === 'onetime'
          ? admin.firestore.Timestamp.fromDate(new Date(Date.now() + ONE_MONTH_MS))
          : null,
    };
  }

  return patch;
}

function buildCancellationUserPatch(currentUser, context) {
  const serverNow = admin.firestore.FieldValue.serverTimestamp();
  const membership = currentUser?.membership || {};
  const patch = {
    uid: context.uid,
    isMember: false,
    subscriptionStatus: 'canceled',
    updatedAt: serverNow,
    membership: {
      ...membership,
      kind: 'subscription',
      billing: context.billing,
      endedAt: admin.firestore.Timestamp.now(),
    },
  };

  if (!currentUser?.createdAt) {
    patch.createdAt = serverNow;
  }

  if (context.email) {
    patch.email = context.email;
  }

  return patch;
}

async function applyWebhookTransaction({
  uid,
  eventId,
  eventType,
  markerData,
  buildUserPatch = null,
}) {
  const db = admin.firestore();
  const userRef = db.collection('users').doc(uid);
  const eventRef = userRef.collection('stripe_webhook_events').doc(eventId);
  let duplicate = false;

  await db.runTransaction(async (tx) => {
    const eventSnap = await tx.get(eventRef);
    if (eventSnap.exists) {
      duplicate = true;
      return;
    }

    const userSnap = await tx.get(userRef);
    const currentUser = userSnap.exists ? userSnap.data() || {} : {};

    if (buildUserPatch) {
      tx.set(userRef, buildUserPatch(currentUser), { merge: true });
    }

    tx.set(eventRef, {
      eventId,
      eventType,
      uid,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...markerData,
    });
  });

  return { duplicate };
}

async function handleCheckoutCompleted(event) {
  const session = event.data.object;
  const context = buildGrantContextFromSession(session);
  context.uid = await resolveUid({
    uidHints: [metaValue(session.metadata, 'uid'), session.client_reference_id],
    emailHints: [
      metaValue(session.metadata, 'email'),
      session.customer_email,
      session.customer_details?.email,
    ],
    customerId: session.customer,
  });

  const result = await applyWebhookTransaction({
    uid: context.uid,
    eventId: event.id,
    eventType: event.type,
    markerData: context.marker,
    buildUserPatch: (currentUser) => buildGrantUserPatch(currentUser, context),
  });

  return result.duplicate ? { duplicate: true } : { processed: true };
}

async function handleInvoicePaymentSucceeded(event) {
  const invoice = event.data.object;
  const billingReason = invoice?.billing_reason || null;

  if (!RENEWAL_BILLING_REASONS.has(billingReason)) {
    return { ignored: true, reason: `billing_reason:${billingReason || 'unknown'}` };
  }

  const subscriptionId =
    typeof invoice.subscription === 'string'
      ? invoice.subscription
      : invoice.subscription?.id || null;

  if (!subscriptionId) {
    throw webhookError(
      'WEBHOOK_SUBSCRIPTION_MISSING',
      'Missing subscription ID for renewal invoice'
    );
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const context = buildGrantContextFromSubscription(subscription, invoice);
  context.uid = await resolveUid({
    uidHints: [metaValue(subscription.metadata, 'uid')],
    emailHints: [
      metaValue(subscription.metadata, 'email'),
      invoice.customer_email,
      invoice.customer_details?.email,
    ],
    customerId: invoice.customer,
  });

  const result = await applyWebhookTransaction({
    uid: context.uid,
    eventId: event.id,
    eventType: event.type,
    markerData: context.marker,
    buildUserPatch: (currentUser) => buildGrantUserPatch(currentUser, context),
  });

  return result.duplicate ? { duplicate: true } : { processed: true };
}

async function handleSubscriptionDeleted(event) {
  const subscription = event.data.object;
  const context = buildPlanCancellationContext(subscription);

  if (!context) {
    return { ignored: true, reason: 'non_plan_subscription' };
  }

  context.uid = await resolveUid({
    uidHints: [metaValue(subscription.metadata, 'uid')],
    emailHints: [metaValue(subscription.metadata, 'email')],
    customerId: subscription.customer,
  });

  const result = await applyWebhookTransaction({
    uid: context.uid,
    eventId: event.id,
    eventType: event.type,
    markerData: context.marker,
    buildUserPatch: (currentUser) => buildCancellationUserPatch(currentUser, context),
  });

  return result.duplicate ? { duplicate: true } : { processed: true };
}

// POST /stripe/webhook must use raw body
router.post('/', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  console.log('[webhook] hit', new Date().toISOString());

  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    console.warn('[webhook] Stripe not configured');
    return fail(req, res, 500, 'WEBHOOK_NOT_CONFIGURED', 'Stripe webhook is not configured');
  }

  let event;
  try {
    const sig = req.headers['stripe-signature'];
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    console.log('[webhook] type:', event.type);
  } catch (err) {
    console.error('[webhook] signature verification failed:', err?.message || err);
    return fail(
      req,
      res,
      400,
      'WEBHOOK_SIGNATURE_INVALID',
      err?.message || 'Webhook signature verification failed'
    );
  }

  try {
    let result = { ignored: false, duplicate: false };

    switch (event.type) {
      case 'checkout.session.completed':
        result = await handleCheckoutCompleted(event);
        break;
      case 'invoice.payment_succeeded':
        result = await handleInvoicePaymentSucceeded(event);
        break;
      case 'customer.subscription.deleted':
        result = await handleSubscriptionDeleted(event);
        break;
      default:
        console.log('[webhook] intentionally ignoring event type:', event.type);
        result = { ignored: true, reason: 'unhandled_event_type' };
        break;
    }

    return ok(req, res, { received: true, ...result });
  } catch (err) {
    console.error('[webhook] handler error', err);
    return fail(
      req,
      res,
      err?.status || 500,
      err?.code || 'WEBHOOK_ERROR',
      err?.message || 'Webhook processing failed'
    );
  }
});

router.get('/', (req, res) => {
  return ok(req, res, { alive: true });
});

export default router;
