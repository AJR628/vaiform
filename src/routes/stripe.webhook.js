import express from 'express'
import admin from '../config/firebase.js'
import { stripe, STRIPE_WEBHOOK_SECRET } from '../config/stripe.js'
import { getMonthlyPlanConfig, getPlanForMonthlyPriceId } from '../config/commerce.js'
import { buildCanonicalUsageState } from '../services/usage.service.js'
import { ok, fail } from '../http/respond.js'

const router = express.Router()
const RENEWAL_BILLING_REASONS = new Set(['subscription_cycle'])

function webhookError(code, detail, status = 500) {
  const err = new Error(detail)
  err.code = code
  err.status = status
  return err
}

function metaValue(metadata, key) {
  const value = metadata?.[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : null
}

function toTimestampFromUnixSec(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw webhookError('WEBHOOK_PERIOD_MISSING', 'Missing Stripe billing period timestamps')
  }
  return admin.firestore.Timestamp.fromMillis(Math.floor(numeric * 1000))
}

function timestampMillis(value) {
  if (!value) return null
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function timestampsEqual(a, b) {
  const aMs = timestampMillis(a)
  const bMs = timestampMillis(b)
  return Number.isFinite(aMs) && Number.isFinite(bMs) && aMs === bMs
}

function firstSubscriptionPriceId(subscription, invoice = null) {
  return (
    subscription?.items?.data?.[0]?.price?.id ||
    invoice?.lines?.data?.[0]?.price?.id ||
    null
  )
}

function resolvePlanForSubscription(subscription, invoice = null) {
  const metadata = subscription?.metadata || {}
  const metadataPlan = metaValue(metadata, 'plan')
  const priceId = firstSubscriptionPriceId(subscription, invoice)
  const pricePlan = getPlanForMonthlyPriceId(priceId)

  if (metadataPlan && !getMonthlyPlanConfig(metadataPlan)) {
    throw webhookError('UNKNOWN_PLAN', `Unknown plan "${metadataPlan}" for Stripe subscription`)
  }

  if (metadataPlan && pricePlan && metadataPlan !== pricePlan) {
    throw webhookError(
      'WEBHOOK_PLAN_PRICE_MISMATCH',
      `Stripe metadata plan "${metadataPlan}" did not match price-backed plan "${pricePlan}".`
    )
  }

  const plan = metadataPlan || pricePlan
  if (!plan) {
    throw webhookError('WEBHOOK_PLAN_MISSING', 'Missing plan metadata for Stripe subscription')
  }

  const config = getMonthlyPlanConfig(plan)
  if (!config) {
    throw webhookError('UNKNOWN_PLAN', `Unknown plan "${plan}" for Stripe subscription`)
  }

  return {
    plan,
    config,
    priceId,
  }
}

function buildSubscriptionPeriod(subscription) {
  return {
    periodStartAt: toTimestampFromUnixSec(subscription?.current_period_start),
    periodEndAt: toTimestampFromUnixSec(subscription?.current_period_end),
  }
}

function buildActivePlanContext(subscription, invoice = null, source = 'stripe') {
  const { plan, config, priceId } = resolvePlanForSubscription(subscription, invoice)
  const { periodStartAt, periodEndAt } = buildSubscriptionPeriod(subscription)

  return {
    plan,
    cycleIncludedSec: config.cycleIncludedSec,
    stripePriceId: priceId,
    periodStartAt,
    periodEndAt,
    email: normalizeEmail(
      metaValue(subscription?.metadata, 'email') ||
        invoice?.customer_email ||
        invoice?.customer_details?.email
    ),
    marker: {
      purchaseType: 'plan',
      plan,
      billingCadence: 'monthly',
      cycleIncludedSec: config.cycleIncludedSec,
      stripePriceId: priceId,
      stripeObjectId: subscription.id,
      source,
    },
  }
}

function buildCancellationContext(subscription) {
  const activeContext = buildActivePlanContext(subscription, null, 'customer.subscription.deleted')
  return {
    ...activeContext,
    email: normalizeEmail(metaValue(subscription?.metadata, 'email')),
    marker: {
      ...activeContext.marker,
      action: 'subscription_deleted',
    },
  }
}

async function resolveUidByEmail(email) {
  const normalized = normalizeEmail(email)
  if (!normalized) return null
  try {
    const record = await admin.auth().getUserByEmail(normalized)
    return record?.uid || null
  } catch {
    return null
  }
}

async function resolveCustomerEmail(customerId) {
  if (!stripe || typeof customerId !== 'string' || !customerId) return null
  try {
    const customer = await stripe.customers.retrieve(customerId)
    if (customer && !customer.deleted) return customer.email || null
  } catch (error) {
    console.warn('[webhook] customer email lookup failed:', error?.message || error)
  }
  return null
}

async function resolveUid({ uidHints = [], emailHints = [], customerId = null }) {
  for (const uidHint of uidHints) {
    if (typeof uidHint === 'string' && uidHint.trim()) return uidHint.trim()
  }

  for (const emailHint of emailHints) {
    const resolvedUid = await resolveUidByEmail(emailHint)
    if (resolvedUid) return resolvedUid
  }

  const customerEmail = await resolveCustomerEmail(customerId)
  if (customerEmail) {
    const resolvedUid = await resolveUidByEmail(customerEmail)
    if (resolvedUid) return resolvedUid
  }

  throw webhookError('WEBHOOK_IDENTITY_MISSING', 'Unable to resolve user identity for webhook')
}

function buildCheckoutUserPatch(currentUser, context) {
  const serverNow = admin.firestore.FieldValue.serverTimestamp()
  const current = buildCanonicalUsageState(currentUser)

  return {
    uid: context.uid,
    email: context.email || currentUser?.email || null,
    plan: context.plan,
    lastPaymentAt: serverNow,
    membership: {
      status: 'active',
      kind: 'subscription',
      billingCadence: 'monthly',
      startedAt: currentUser?.membership?.startedAt || context.periodStartAt,
      expiresAt: context.periodEndAt,
      canceledAt: null,
    },
    usage: {
      ...current.usage,
      version: 1,
      billingUnit: 'sec',
      periodStartAt: context.periodStartAt,
      periodEndAt: context.periodEndAt,
      cycleIncludedSec: context.cycleIncludedSec,
      cycleReservedSec: current.usage.cycleReservedSec,
      updatedAt: serverNow,
    },
    updatedAt: serverNow,
    ...(currentUser?.createdAt ? {} : { createdAt: serverNow }),
  }
}

function buildRenewalUserPatch(currentUser, context) {
  const serverNow = admin.firestore.FieldValue.serverTimestamp()
  const current = buildCanonicalUsageState(currentUser)
  const samePeriod =
    timestampsEqual(current.usage.periodStartAt, context.periodStartAt) &&
    timestampsEqual(current.usage.periodEndAt, context.periodEndAt)

  return {
    uid: context.uid,
    email: context.email || currentUser?.email || null,
    plan: context.plan,
    lastPaymentAt: serverNow,
    membership: {
      status: 'active',
      kind: 'subscription',
      billingCadence: 'monthly',
      startedAt: currentUser?.membership?.startedAt || context.periodStartAt,
      expiresAt: context.periodEndAt,
      canceledAt: null,
    },
    usage: {
      ...current.usage,
      version: 1,
      billingUnit: 'sec',
      periodStartAt: context.periodStartAt,
      periodEndAt: context.periodEndAt,
      cycleIncludedSec: context.cycleIncludedSec,
      cycleUsedSec: samePeriod ? current.usage.cycleUsedSec : 0,
      cycleReservedSec: current.usage.cycleReservedSec,
      updatedAt: serverNow,
    },
    updatedAt: serverNow,
    ...(currentUser?.createdAt ? {} : { createdAt: serverNow }),
  }
}

function buildCancellationUserPatch(currentUser, context) {
  const serverNow = admin.firestore.FieldValue.serverTimestamp()
  const current = buildCanonicalUsageState(currentUser)
  const membership = currentUser?.membership || {}

  return {
    uid: context.uid,
    email: context.email || currentUser?.email || null,
    plan: current.plan === 'free' ? context.plan : current.plan,
    membership: {
      ...membership,
      status: 'canceled',
      kind: 'subscription',
      billingCadence: 'monthly',
      startedAt: membership.startedAt || context.periodStartAt,
      expiresAt: context.periodEndAt,
      canceledAt: admin.firestore.Timestamp.now(),
    },
    updatedAt: serverNow,
    ...(currentUser?.createdAt ? {} : { createdAt: serverNow }),
  }
}

async function applyWebhookTransaction({
  uid,
  eventId,
  eventType,
  markerData,
  buildUserPatch = null,
}) {
  const db = admin.firestore()
  const userRef = db.collection('users').doc(uid)
  const eventRef = userRef.collection('stripe_webhook_events').doc(eventId)
  let duplicate = false

  await db.runTransaction(async (tx) => {
    const eventSnap = await tx.get(eventRef)
    if (eventSnap.exists) {
      duplicate = true
      return
    }

    const userSnap = await tx.get(userRef)
    const currentUser = userSnap.exists ? userSnap.data() || {} : {}

    if (buildUserPatch) {
      tx.set(userRef, buildUserPatch(currentUser), { merge: true })
    }

    tx.set(eventRef, {
      eventId,
      eventType,
      uid,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...markerData,
    })
  })

  return { duplicate }
}

async function handleCheckoutCompleted(event) {
  const session = event.data.object
  if (session?.mode !== 'subscription') {
    throw webhookError('WEBHOOK_UNSUPPORTED_MODE', 'Only monthly subscription checkout is supported')
  }

  const subscriptionId =
    typeof session.subscription === 'string' ? session.subscription : session.subscription?.id || null
  if (!subscriptionId) {
    throw webhookError('WEBHOOK_SUBSCRIPTION_MISSING', 'Missing subscription ID for checkout session')
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId)
  const context = buildActivePlanContext(subscription, null, 'checkout.session.completed')
  context.uid = await resolveUid({
    uidHints: [metaValue(session.metadata, 'uid'), metaValue(subscription.metadata, 'uid'), session.client_reference_id],
    emailHints: [
      metaValue(session.metadata, 'email'),
      metaValue(subscription.metadata, 'email'),
      session.customer_email,
      session.customer_details?.email,
    ],
    customerId: session.customer,
  })

  const result = await applyWebhookTransaction({
    uid: context.uid,
    eventId: event.id,
    eventType: event.type,
    markerData: context.marker,
    buildUserPatch: (currentUser) => buildCheckoutUserPatch(currentUser, context),
  })

  return result.duplicate ? { duplicate: true } : { processed: true }
}

async function handleInvoicePaymentSucceeded(event) {
  const invoice = event.data.object
  const billingReason = invoice?.billing_reason || null

  if (!RENEWAL_BILLING_REASONS.has(billingReason)) {
    return { ignored: true, reason: `billing_reason:${billingReason || 'unknown'}` }
  }

  const subscriptionId =
    typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id || null
  if (!subscriptionId) {
    throw webhookError('WEBHOOK_SUBSCRIPTION_MISSING', 'Missing subscription ID for renewal invoice')
  }

  const subscription = await stripe.subscriptions.retrieve(subscriptionId)
  const context = buildActivePlanContext(subscription, invoice, 'invoice.payment_succeeded')
  context.uid = await resolveUid({
    uidHints: [metaValue(subscription.metadata, 'uid')],
    emailHints: [
      metaValue(subscription.metadata, 'email'),
      invoice.customer_email,
      invoice.customer_details?.email,
    ],
    customerId: invoice.customer,
  })

  const result = await applyWebhookTransaction({
    uid: context.uid,
    eventId: event.id,
    eventType: event.type,
    markerData: context.marker,
    buildUserPatch: (currentUser) => buildRenewalUserPatch(currentUser, context),
  })

  return result.duplicate ? { duplicate: true } : { processed: true }
}

async function handleSubscriptionDeleted(event) {
  const subscription = event.data.object
  const context = buildCancellationContext(subscription)
  context.uid = await resolveUid({
    uidHints: [metaValue(subscription.metadata, 'uid')],
    emailHints: [metaValue(subscription.metadata, 'email')],
    customerId: subscription.customer,
  })

  const result = await applyWebhookTransaction({
    uid: context.uid,
    eventId: event.id,
    eventType: event.type,
    markerData: context.marker,
    buildUserPatch: (currentUser) => buildCancellationUserPatch(currentUser, context),
  })

  return result.duplicate ? { duplicate: true } : { processed: true }
}

router.post('/', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  console.log('[webhook] hit', new Date().toISOString())

  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    console.warn('[webhook] Stripe not configured')
    return fail(req, res, 500, 'WEBHOOK_NOT_CONFIGURED', 'Stripe webhook is not configured')
  }

  let event
  try {
    const sig = req.headers['stripe-signature']
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET)
    console.log('[webhook] type:', event.type)
  } catch (error) {
    console.error('[webhook] signature verification failed:', error?.message || error)
    return fail(
      req,
      res,
      400,
      'WEBHOOK_SIGNATURE_INVALID',
      error?.message || 'Webhook signature verification failed'
    )
  }

  try {
    let result = { ignored: false, duplicate: false }

    switch (event.type) {
      case 'checkout.session.completed':
        result = await handleCheckoutCompleted(event)
        break
      case 'invoice.payment_succeeded':
        result = await handleInvoicePaymentSucceeded(event)
        break
      case 'customer.subscription.deleted':
        result = await handleSubscriptionDeleted(event)
        break
      default:
        console.log('[webhook] intentionally ignoring event type:', event.type)
        result = { ignored: true, reason: 'unhandled_event_type' }
        break
    }

    return ok(req, res, { received: true, ...result })
  } catch (error) {
    console.error('[webhook] handler error', error)
    return fail(
      req,
      res,
      error?.status || 500,
      error?.code || 'WEBHOOK_ERROR',
      error?.message || 'Webhook processing failed'
    )
  }
})

router.get('/', (req, res) => {
  return ok(req, res, { alive: true })
})

export default router
