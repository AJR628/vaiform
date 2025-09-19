import express from "express";
import Stripe from "stripe";

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// POST /stripe/webhook must use raw body
router.post("/", express.raw({ type: "application/json" }), async (req, res) => {
  let event;
  try {
    const sig = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[stripe] signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        // TODO: resolve user (uid/email from session.metadata)
        // TODO: set isMember=true, plan from metadata.plan, kind from mode, credit top-up
        break;
      }
      case "invoice.payment_succeeded": {
        // TODO: subscription renewal → top up credits, update nextPaymentAt
        break;
      }
      case "customer.subscription.deleted": {
        // TODO: mark isMember=false, clear plan/kind
        break;
      }
      default:
        break;
    }
    return res.json({ received: true });
  } catch (e) {
    console.error("[stripe] handler error", e);
    return res.status(500).json({ ok: false });
  }
});

router.get("/", (_req, res) => res.json({ status: "ok", endpoint: "/stripe/webhook" }));

export default router;
