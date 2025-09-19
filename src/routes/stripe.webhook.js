// src/routes/stripe.webhook.js
import express from "express";
import Stripe from "stripe";
import admin from "../config/firebase.js";
import { ensureUserDoc } from "../services/credit.service.js";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// POST /stripe/webhook (must use raw body for Stripe signature)
router.post("/", express.raw({ type: "application/json" }), async (req, res) => {
  let event;
  try {
    const sig = req.headers["stripe-signature"];
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      console.error("❌ Missing STRIPE_WEBHOOK_SECRET");
      return res.status(500).send("Webhook misconfigured");
    }
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[stripe] signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[stripe/webhook] Processing event: ${event.type}`);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        console.log(`[stripe/webhook] checkout.session.completed:`, {
          id: session.id,
          metadata: session.metadata
        });

        // Get email and uid from session metadata
        const email = session?.metadata?.email || session?.customer_details?.email;
        const uidHint = session?.metadata?.uid;
        const plan = session?.metadata?.plan;
        const billing = session?.metadata?.billing;

        if (!email && !uidHint) {
          console.warn("No email or uid in session metadata");
          break;
        }

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
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
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
              livemode: !!event.livemode,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          }

          console.log(`✅ Plan activated: ${plan} ${billing} +${bonusCredits} credits → ${email || uidHint}`);
        } else {
          console.log("No plan metadata found in session");
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        console.log(`[stripe/webhook] invoice.payment_succeeded:`, {
          id: invoice.id,
          subscription: invoice.subscription
        });
        
        // TODO: Handle subscription renewals - top up credits and update nextPaymentAt
        // This would be for monthly subscription renewals
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object;
        console.log(`[stripe/webhook] customer.subscription.deleted:`, {
          id: sub.id,
          customer: sub.customer
        });
        
        // TODO: Mark isMember=false, clear plan/kind/nextPaymentAt
        // This would handle subscription cancellations
        break;
      }

      default:
        console.log(`[stripe/webhook] Unhandled event type: ${event.type}`);
        break;
    }

    return res.json({ received: true, eventType: event.type });
  } catch (e) {
    console.error("[stripe/webhook] handler error", e);
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// GET health check (handy for quick ping in browser)
router.get("/", (req, res) => {
  res.json({ 
    status: "ok", 
    endpoint: "/stripe/webhook",
    timestamp: new Date().toISOString()
  });
});

export default router;
