// src/controllers/checkout.controller.js
import { stripe } from "../config/stripe.js";
import { CREDIT_PRICE_MAP } from "../services/credit.service.js";

/** Normalize FRONTEND_URL with no trailing slash, prefer env, fall back to request origin */
function getFrontendBase(req) {
  const envBase = (process.env.FRONTEND_URL || "https://vaiform.com").replace(/\/+$/, "");
  const origin = (req.headers.origin || "").replace(/\/+$/, "");
  const base = envBase || origin || "https://vaiform.com";
  console.info(`[checkout] front-end base = ${base} (origin=${origin || "n/a"} env=${envBase})`);
  return base;
}

function clampInt(n, { min = 0, max = 1e9 } = {}) {
  const v = Number.parseInt(n, 10);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

/**
 * One-time Checkout (line_items price is a one-time price).
 * Secured by requireAuth: req.user.{uid,email}
 * Body: { priceId: string, quantity?: number, credits?: number }
 */
export async function createCheckoutSession(req, res) {
  try {
    const { priceId, quantity = 1, credits = 0 } = req.body || {};
    if (!priceId || !CREDIT_PRICE_MAP[priceId]) {
      return res.status(400).json({ success: false, error: "Unknown or disallowed priceId" });
    }

    const qty = clampInt(quantity, { min: 1, max: 10 });
    const creditHint = clampInt(credits, { min: 0, max: 1e9 });
    const FRONTEND = getFrontendBase(req);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: qty }],

      // include session id for a tiny “receipt reference” on /success
      success_url: `${FRONTEND}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${FRONTEND}/buy-credits.html?canceled=1`,

      // Identity for the webhook → instant crediting
      customer_email: req.user.email,
      client_reference_id: req.user.uid,
      metadata: {
        uid: req.user.uid,
        email: req.user.email,
        priceId,
        quantity: String(qty),
        credits: String(creditHint),   // analytics hint only
        kind: "onetime",
      },

      // DO NOT set payment_method_collection here (only for recurring)
    });

    console.info(
      `[checkout] one-time price=${priceId} qty=${qty} uid=${req.user.uid} email=${req.user.email} → success=${FRONTEND}/success`
    );
    return res.json({ url: session.url });
  } catch (err) {
    console.error("createCheckoutSession error:", err);
    return res.status(500).json({ success: false, error: "Checkout failed" });
  }
}

/**
 * Subscription Checkout (recurring price).
 * Secured by requireAuth: req.user.{uid,email}
 * Body: { priceId: string, credits?: number }
 */
export async function createSubscriptionSession(req, res) {
  try {
    const { priceId, credits = 0 } = req.body || {};
    if (!priceId || !CREDIT_PRICE_MAP[priceId]) {
      return res.status(400).json({ success: false, error: "Unknown or disallowed priceId" });
    }

    const creditHint = clampInt(credits, { min: 0, max: 1e9 });
    const FRONTEND = getFrontendBase(req);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],

      success_url: `${FRONTEND}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${FRONTEND}/buy-credits.html?canceled=1`,

      customer_email: req.user.email,
      client_reference_id: req.user.uid,
      metadata: {
        uid: req.user.uid,
        email: req.user.email,
        priceId,
        credits: String(creditHint), // analytics hint only
        kind: "subscription",
      },

      // For subscriptions: ensure a PM is collected/saved
      payment_method_collection: "always",

      // Stamp the subscription too; handy for later webhooks
      subscription_data: {
        metadata: {
          uid: req.user.uid,
          email: req.user.email,
          priceId,
          credits: String(creditHint),
          kind: "subscription",
        },
      },
    });

    console.info(
      `[checkout] subscription price=${priceId} uid=${req.user.uid} email=${req.user.email} → success=${FRONTEND}/success`
    );
    return res.json({ url: session.url });
  } catch (err) {
    console.error("createSubscriptionSession error:", err);
    return res.status(500).json({ success: false, error: "Subscription checkout failed" });
  }
}

/**
 * Plans & Pricing Checkout (Creator/Pro plans).
 * Secured by requireAuth: req.user.{uid,email}
 * Body: { plan: 'creator'|'pro', billing: 'monthly'|'onetime', uid: string, email: string }
 */
export async function startPlanCheckout(req, res) {
  try {
    const { plan, billing, uid, email } = req.body;
    
    // Validate inputs
    if (!['creator', 'pro'].includes(plan)) {
      return res.status(400).json({ ok: false, reason: "INVALID_PLAN", detail: "Plan must be 'creator' or 'pro'" });
    }
    if (!['monthly', 'onetime'].includes(billing)) {
      return res.status(400).json({ ok: false, reason: "INVALID_BILLING", detail: "Billing must be 'monthly' or 'onetime'" });
    }
    if (!uid || !email) {
      return res.status(400).json({ ok: false, reason: "MISSING_USER_DATA", detail: "uid and email are required" });
    }

    // Map plan + billing to Stripe price ID
    const PRICE_MAP = {
      "creator:monthly": process.env.STRIPE_PRICE_CREATOR_SUB,
      "creator:onetime": process.env.STRIPE_PRICE_CREATOR_PASS,
      "pro:monthly": process.env.STRIPE_PRICE_PRO_SUB,
      "pro:onetime": process.env.STRIPE_PRICE_PRO_PASS,
    };

    const priceId = PRICE_MAP[`${plan}:${billing}`];
    if (!priceId) {
      return res.status(400).json({ ok: false, reason: "UNKNOWN_PRICE", detail: `No price configured for ${plan}:${billing}` });
    }

    const mode = billing === "monthly" ? "subscription" : "payment";
    const FRONTEND = getFrontendBase(req);

            console.log(`[checkout/start] Creating session with metadata:`, { uid, email, plan, billing, priceId, mode });
            
            const session = await stripe.checkout.sessions.create({
              mode,
              line_items: [{ price: priceId, quantity: 1 }],
              customer_email: email,
              success_url: `${FRONTEND}/success?plan=${plan}`,
              cancel_url: `${FRONTEND}/pricing`,
              metadata: { uid, email, plan, billing },
      ...(mode === "subscription" && {
        payment_method_collection: "always",
        subscription_data: {
          metadata: { uid, email, plan, billing },
        },
      }),
    });

    console.info(`[checkout/start] ${plan} ${billing} uid=${uid} email=${email} → ${session.url}`);
    return res.json({ url: session.url });
  } catch (e) {
    console.error("[checkout/start] error", e);
    return res.status(500).json({ ok: false, reason: "CHECKOUT_FAILED", detail: e?.message || "Checkout failed" });
  }
}

/**
 * Billing Portal (Manage subscription / payment methods / invoices).
 * No body needed.
 */
export async function createBillingPortalSession(req, res) {
  try {
    const FRONTEND = getFrontendBase(req);

    // Find/create Stripe Customer for this email
    let customerId = null;
    try {
      // Search is fast & accurate when enabled
      const found = await stripe.customers.search({ query: `email:'${req.user.email}'`, limit: 1 });
      customerId = found?.data?.[0]?.id || null;
    } catch {
      // Fallback to list for setups without search access
      if (!customerId) {
        const list = await stripe.customers.list({ email: req.user.email, limit: 1 });
        customerId = list?.data?.[0]?.id || null;
      }
    }

    if (!customerId) {
      const c = await stripe.customers.create({ email: req.user.email, metadata: { uid: req.user.uid } });
      customerId = c.id;
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${FRONTEND}/buy-credits.html`,
    });

    console.info(`[billing] portal for uid=${req.user.uid} email=${req.user.email} → ${portal.url}`);
    return res.json({ url: portal.url });
  } catch (err) {
    console.error("createBillingPortalSession error:", err);
    return res.status(500).json({ success: false, error: "Billing portal failed" });
  }
}