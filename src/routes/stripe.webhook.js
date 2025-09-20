import express from "express";
import Stripe from "stripe";
import admin from "../config/firebase.js";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-06-30.basil",
});

// POST /stripe/webhook must use raw body
router.post("/", express.raw({ type: "application/json" }), async (req, res) => {
  console.log("[webhook] hit", new Date().toISOString());
  
  let event;
  try {
    const sig = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    console.log("[webhook] type:", event.type);
  } catch (err) {
    console.error("[webhook] signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        console.log("[webhook] session metadata:", session.metadata);
        
        if (session.metadata?.uid && session.metadata?.plan) {
          try {
            await grantCreditsAndUpdatePlan(session.metadata);
            console.log(`[webhook] Successfully processed payment for uid=${session.metadata.uid}`);
          } catch (error) {
            console.error(`[webhook] Failed to process payment for uid=${session.metadata.uid}:`, error);
            // Don't throw here - we still want to return success to Stripe to avoid retries
          }
        } else {
          console.error("[webhook] Missing uid or plan in session metadata:", session.metadata);
        }
        break;
      }
      case "invoice.payment_succeeded": {
        // TODO: subscription renewal → top up credits, update nextPaymentAt
        console.log("[webhook] invoice payment succeeded:", event.data.object.id);
        break;
      }
      case "customer.subscription.deleted": {
        // TODO: mark isMember=false, clear plan/kind
        console.log("[webhook] subscription deleted:", event.data.object.id);
        break;
      }
      default:
        console.log("[webhook] unhandled event type:", event.type);
        break;
    }
    return res.json({ received: true });
  } catch (e) {
    console.error("[webhook] handler error", e);
    return res.status(500).json({ ok: false, reason: "WEBHOOK_ERROR", detail: e?.message });
  }
});

async function grantCreditsAndUpdatePlan(metadata) {
  const { uid, plan, billing, email } = metadata;
  
  if (!uid || !plan) {
    console.error("[webhook] Missing uid or plan in metadata:", metadata);
    return;
  }

  const db = admin.firestore();
  const userRef = db.collection("users").doc(uid);
  
  try {
    await db.runTransaction(async (t) => {
      const snap = await t.get(userRef);
      const now = admin.firestore.Timestamp.now();
      const creditsToAdd = plan === "creator" ? 1000 : plan === "pro" ? 2500 : 0;
      const expiresAt = billing === "onetime"
        ? admin.firestore.Timestamp.fromDate(new Date(Date.now() + 30*24*60*60*1000))
        : null;

      t.set(userRef, {
        email: email || admin.firestore.FieldValue.delete(),
        plan,
        isMember: true,
        credits: admin.firestore.FieldValue.increment(creditsToAdd),
        membership: { 
          kind: billing === "onetime" ? "onetime" : "subscription", 
          billing, 
          startedAt: now, 
          expiresAt 
        },
        lastPaymentAt: now,
        updatedAt: now,
      }, { merge: true });
    });
    
    console.log(`[plan] Upgraded uid=${uid} -> ${plan}, credits +${creditsToAdd}`);
  } catch (error) {
    console.error(`[webhook] Failed to update user ${uid}:`, error);
    throw error;
  }
}

router.get("/", (_req, res) => {
  res.status(200).json({ ok: true, msg: "Webhook endpoint (GET) alive" });
});

export default router;
