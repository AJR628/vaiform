// src/controllers/webhook.controller.js
import admin from "firebase-admin";
import { stripe } from "../config/stripe.js";
import { ensureUserDoc, CREDIT_PRICE_MAP } from "../services/credit.service.js";

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const MAX_EVENT_AGE_SEC = 5 * 60; // replay guard (seconds)

// ---- env helpers ------------------------------------------------------------
function pickNumberEnv(...keys) {
  for (const k of keys) {
    const raw = process.env[k];
    if (raw && raw.trim() !== "") {
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n)) return n;
      console.warn(`[env] ${k} is not a valid integer: "${raw}"`);
    }
  }
  return 0;
}

// Prefer prod default, then dev default, and keep the old misspelling for safety.
const DEFAULT_CREDITS = pickNumberEnv(
  "STRIPE_DEFAULT_CREDITS",
  "STRIPE_DEV_DEFAULT_CREDITS",
  "STRIPE_DEV_DEFUALT_CREDITS"
);

console.log(
  `[env] DEFAULT_CREDITS resolved to ${DEFAULT_CREDITS} | PRICE_MAP entries: ${
    Object.keys(CREDIT_PRICE_MAP || {}).length
  }`
);

// ---- idempotency: event ledger ---------------------------------------------
async function markEventProcessing(event) {
  const ref = admin.firestore().collection("stripe_webhook_events").doc(event.id);
  await ref.create({
    type: event.type,
    livemode: !!event.livemode,
    created: event.created,
    status: "received",
    receivedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return ref;
}

// ---- credit resolution ------------------------------------------------------
function perUnitCreditsFromPrice({ price, livemode }) {
  const id = price?.id || null;

  // 1) Explicit map (from CREDIT_PRICE_MAP service/env)
  if (id && typeof CREDIT_PRICE_MAP?.[id] === "number" && CREDIT_PRICE_MAP[id] > 0) {
    return { perUnit: CREDIT_PRICE_MAP[id], source: "map", mapHit: true };
  }

  // 2) Price metadata override
  const meta = Number(price?.metadata?.credits || 0);
  if (Number.isFinite(meta) && meta > 0) {
    return { perUnit: Math.floor(meta), source: "metadata", mapHit: false };
  }

  // 3) Fallback default (dev/test only)
  if (!livemode && DEFAULT_CREDITS > 0) {
    return { perUnit: DEFAULT_CREDITS, source: "default", mapHit: false };
  }

  // 4) Unknown
  return { perUnit: 0, source: "unknown", mapHit: false };
}

// Pretty logging per line item
function logLine({ label, priceId, qty, perUnit, source, mapHit }) {
  console.log(
    `[webhook] ${label} price=${priceId || "unknown"} qty=${qty} → +${
      perUnit * qty
    } credits (perUnit=${perUnit}, source=${source}, mapHit=${mapHit})`
  );
}

// ---- UID resolver (hint via metadata/client_reference_id, else Auth lookup) -
async function resolveUidHint({ email = null, session = null, invoice = null }) {
  let uid =
    session?.metadata?.uid ||
    session?.client_reference_id ||
    invoice?.metadata?.uid ||
    null;

  if (!uid && email) {
    try {
      const rec = await admin.auth().getUserByEmail(email);
      uid = rec?.uid || null;
    } catch {
      // user may not exist in Auth yet; that's OK
    }
  }
  return uid;
}

// ---- main handler -----------------------------------------------------------
export async function stripeWebhook(req, res) {
  if (!WEBHOOK_SECRET) {
    console.error("❌ Missing STRIPE_WEBHOOK_SECRET; cannot verify Stripe signatures.");
    return res.status(500).json({ success: false, error: 'Webhook misconfigured' });
  }

  const sig = req.headers["stripe-signature"];
  if (!sig) return res.status(400).json({ success: false, error: 'Missing stripe-signature header' });

  let event;
  try {
    // NOTE: bodyParser.raw({ type: 'application/json' }) must be used on this route.
    event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
  } catch (e) {
    console.error("⚠️ Webhook signature verification failed:", e?.message || e);
    return res.status(400).json({ success: false, error: 'WEBHOOK_ERROR', detail: e.message });
  }

  // replay guard
  const nowSec = Math.floor(Date.now() / 1000);
  if (typeof event.created === "number" && nowSec - event.created > MAX_EVENT_AGE_SEC) {
    console.warn(`⏰ Dropping stale event ${event.id} (${event.type}); age ${nowSec - event.created}s`);
    return res.status(200).json({ success: true, received: true, stale: true });
  }

  // idempotency
  let eventRef = null;
  try {
    eventRef = await markEventProcessing(event);
  } catch {
    console.log(`🔁 Duplicate delivery for event ${event.id}; skipping.`);
    return res.status(200).json({ success: true, received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const livemode = !!event.livemode;

        // Prefer explicit metadata email; fall back to customer_details
        const email =
          session?.metadata?.email ||
          session?.customer_details?.email ||
          session?.customer_email ||
          null;

        // Resolve a UID hint from session or by Auth lookup
        const uidHint = await resolveUidHint({ email, session });

        if (!email && !uidHint) {
          console.warn("ℹ️ checkout.session.completed without resolvable email or uid; no credit awarded.");
          await eventRef.update({ status: "processed", note: "missing email+uid (checkout.session.completed)" });
          break;
        }

        // More reliable than deep nested expands on sessions.retrieve
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
          expand: ["data.price"],
        });

        console.log(`[webhook] checkout items=${lineItems?.data?.length || 0}`);

        let totalCredits = 0;
        for (const li of lineItems?.data || []) {
          const price = li.price || null;
          const qty = li.quantity || 1;
          const { perUnit, source, mapHit } = perUnitCreditsFromPrice({ price, livemode });

          logLine({ label: "checkout", priceId: price?.id, qty, perUnit, source, mapHit });
          totalCredits += perUnit * qty;
        }

        // Check if this is a plan subscription (has plan metadata)
        const plan = session?.metadata?.plan;
        const billing = session?.metadata?.billing;
        
        console.log(`[webhook] checkout.session.completed metadata:`, {
          plan,
          billing,
          email,
          uidHint,
          allMetadata: session?.metadata
        });
        
        if (plan && billing) {
          // Handle plan subscription - update user membership status
          const { ref: userRef } = await ensureUserDoc(email, uidHint);
          
          // Calculate bonus credits based on plan
          const bonusCredits = plan === 'creator' ? 1500 : plan === 'pro' ? 3500 : 0;
          
          const membershipData = {
            plan,
            isMember: true,
            membership: {
              kind: billing,
              plan,
              ...(billing === 'onetime' && {
                expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).getTime() // 30 days from now
              })
            },
            credits: admin.firestore.FieldValue.increment(bonusCredits),
          };
          
          await userRef.update(membershipData);
          
          // Record transaction for bonus credits
          if (bonusCredits > 0) {
            await userRef.collection("transactions").add({
              type: "plan_bonus",
              uid: uidHint || null,
              email: email || null,
              credits: bonusCredits,
              plan,
              billing,
              amount: session.amount_total ?? null,
              currency: session.currency ?? "usd",
              stripeId: session.payment_intent || session.id,
              status: "succeeded",
              livemode,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          }
          
          console.log(`✅ Plan activated: ${plan} ${billing} +${bonusCredits} credits → ${email || uidHint}`);
          await eventRef.update({ status: "processed", email: email || null, uid: uidHint || null, plan, billing, bonusCredits });
        } else if (totalCredits > 0) {
          // Handle legacy credit pack purchases
          const { ref: userRef } = await ensureUserDoc(email, uidHint);
          await userRef.update({
            credits: admin.firestore.FieldValue.increment(totalCredits),
          });
          await userRef.collection("transactions").add({
            type: "purchase",
            uid: uidHint || null,
            email: email || null,
            credits: totalCredits,
            amount: session.amount_total ?? null,
            currency: session.currency ?? "usd",
            stripeId: session.payment_intent || session.id,
            status: "succeeded",
            livemode,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log(`✅ +${totalCredits} credits → ${email || uidHint}`);

          await eventRef.update({ status: "processed", email: email || null, uid: uidHint || null, totalCredits });
        } else {
          console.warn("ℹ️ No credits added for checkout.session.completed (totalCredits=0)");
          await eventRef.update({ status: "processed", email: email || null, uid: uidHint || null, totalCredits: 0 });
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object;
        const livemode = !!event.livemode;

        // ✅ Prevent double-credit when a new subscription is created via Checkout
        if (invoice?.billing_reason === "subscription_create") {
          console.log("🧾 Skipping invoice.paid for subscription_create (credited at checkout).");
          await eventRef.update({ status: "processed", note: "skipped subscription_create" });
          break;
        }

        // Resolve email
        let email = invoice?.customer_email || null;
        if (!email) {
          const customer =
            typeof invoice.customer === "string"
              ? await stripe.customers.retrieve(invoice.customer)
              : invoice.customer;
          email = customer?.email || customer?.metadata?.email || null;
        }

        // Resolve UID hint (metadata or Auth lookup)
        const uidHint = await resolveUidHint({ email, invoice });

        if (!email && !uidHint) {
          console.warn("ℹ️ invoice.paid without resolvable email or uid; no credit awarded.");
          await eventRef.update({ status: "processed", note: "missing email+uid (invoice.paid)" });
          break;
        }

        // Fetch full invoice with expanded line item prices (covers subs & one-offs)
        const fullInvoice = await stripe.invoices.retrieve(invoice.id, {
          expand: ["lines.data.price"],
        });

        let totalCredits = 0;
        for (const ln of fullInvoice?.lines?.data || []) {
          const price = ln.price || null;
          const qty = ln.quantity || 1;
          const { perUnit, source, mapHit } = perUnitCreditsFromPrice({ price, livemode });

          logLine({ label: "invoice", priceId: price?.id, qty, perUnit, source, mapHit });
          totalCredits += perUnit * qty;
        }

        if (totalCredits > 0) {
          const { ref: userRef } = await ensureUserDoc(email, uidHint);
          await userRef.update({
            credits: admin.firestore.FieldValue.increment(totalCredits),
          });
          await userRef.collection("transactions").add({
            type: "purchase",
            uid: uidHint || null,
            email: email || null,
            credits: totalCredits,
            amount: invoice.amount_paid ?? null,
            currency: invoice.currency ?? "usd",
            stripeId: invoice.id,
            status: "succeeded",
            livemode,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log(`🔁 Subscription/Invoice: +${totalCredits} credits → ${email || uidHint}`);

          await eventRef.update({ status: "processed", email: email || null, uid: uidHint || null, totalCredits });
        } else {
          console.warn("ℹ️ No credits added for invoice.paid (totalCredits=0)");
          await eventRef.update({ status: "processed", email: email || null, uid: uidHint || null, totalCredits: 0 });
        }
        break;
      }

      default:
        // no-op; still mark processed for visibility
        await eventRef.update({ status: "processed", note: `ignored ${event.type}` });
        break;
    }

    return res.json({ received: true });
  } catch (err) {
    console.error("🔥 Webhook handler error:", err);
    if (eventRef) {
      await eventRef.update({
        status: "error",
        error: String(err?.message || err),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    return res.status(500).json({ success: false, error: 'WEBHOOK_HANDLER_ERROR' });
  }
}
