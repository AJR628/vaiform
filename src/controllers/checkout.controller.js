import { stripe } from '../config/stripe.js'
import { getMonthlyPlanConfig, getMonthlyPlanPriceId } from '../config/commerce.js'
import { ok, fail } from '../http/respond.js'
import { failInternalServerError } from '../http/internal-error.js'

function getFrontendBase(req) {
  const envBase = (process.env.FRONTEND_URL || 'https://vaiform.com').replace(/\/+$/, '')
  const origin = (req.headers.origin || '').replace(/\/+$/, '')
  const base = envBase || origin || 'https://vaiform.com'
  console.info(`[checkout] front-end base = ${base} (origin=${origin || 'n/a'} env=${envBase})`)
  return base
}

function normalizedEmail(email) {
  return typeof email === 'string' && email.trim().length > 0 ? email.trim() : null
}

export async function startPlanCheckout(req, res) {
  try {
    const plan = typeof req.body?.plan === 'string' ? req.body.plan.trim() : ''
    const config = getMonthlyPlanConfig(plan)
    if (!config) {
      return fail(req, res, 400, 'INVALID_PLAN', "Plan must be 'creator' or 'pro'")
    }

    const priceId = getMonthlyPlanPriceId(plan)
    if (!priceId) {
      return fail(
        req,
        res,
        500,
        'CHECKOUT_NOT_CONFIGURED',
        `Stripe price is not configured for the ${plan} monthly plan.`
      )
    }

    const uid = req.user.uid
    const email = normalizedEmail(req.user.email)
    const frontend = getFrontendBase(req)

    const metadata = {
      uid,
      email: email || '',
      purchaseType: 'plan',
      plan,
      billingCadence: 'monthly',
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: email,
      client_reference_id: uid,
      success_url: `${frontend}/success.html?plan=${encodeURIComponent(plan)}`,
      cancel_url: `${frontend}/pricing.html?canceled=1`,
      metadata,
      payment_method_collection: 'always',
      subscription_data: {
        metadata,
      },
    })

    console.info(`[checkout/start] ${plan} monthly uid=${uid} -> ${session.url}`)
    return ok(req, res, { url: session.url })
  } catch (error) {
    console.error('[checkout/start] error', error)
    return failInternalServerError(req, res, 'CHECKOUT_FAILED', 'Checkout failed')
  }
}

export async function createBillingPortalSession(req, res) {
  try {
    const frontend = getFrontendBase(req)
    const email = normalizedEmail(req.user.email)

    if (!email) {
      return fail(req, res, 400, 'BILLING_PORTAL_UNAVAILABLE', 'A verified account email is required.')
    }

    let customerId = null
    try {
      const found = await stripe.customers.search({ query: `email:'${email}'`, limit: 1 })
      customerId = found?.data?.[0]?.id || null
    } catch {
      if (!customerId) {
        const list = await stripe.customers.list({ email, limit: 1 })
        customerId = list?.data?.[0]?.id || null
      }
    }

    if (!customerId) {
      const customer = await stripe.customers.create({
        email,
        metadata: { uid: req.user.uid },
      })
      customerId = customer.id
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${frontend}/pricing.html`,
    })

    console.info(`[billing] portal for uid=${req.user.uid} email=${email} -> ${portal.url}`)
    return ok(req, res, { url: portal.url })
  } catch (error) {
    console.error('createBillingPortalSession error:', error)
    return failInternalServerError(req, res, 'BILLING_PORTAL_FAILED', 'Billing portal failed')
  }
}
