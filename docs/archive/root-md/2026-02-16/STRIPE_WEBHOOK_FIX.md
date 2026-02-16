# Stripe Webhook Fix - 404 → 200

## ✅ **Problem Identified & Fixed**

**Root Cause**: Webhook was mounted AFTER `express.json()`, causing Stripe signature verification to fail because the raw body was already parsed as JSON.

## 🔧 **Changes Applied**

### **1. Created New Stripe Webhook Route**
**File**: `src/routes/stripe.webhook.js`
- ✅ Uses `express.raw({ type: "application/json" })` for proper Stripe signature verification
- ✅ Implements `checkout.session.completed` handler with existing billing logic
- ✅ Includes proper error handling and logging
- ✅ Added GET endpoint for health checks

### **2. Fixed Mount Order in app.js**
**Before** (BROKEN):
```javascript
app.use(express.json({ limit: "10mb" }));  // Line 69 - Parses body to JSON
// ... other middleware ...
app.post("/webhook", express.raw({ type: "application/json" }), webhookRoutes); // Line 84 - TOO LATE!
```

**After** (FIXED):
```javascript
// ---------- Stripe webhook FIRST (before JSON parser) ----------
import stripeWebhookRoutes from "./routes/stripe.webhook.js";
app.use("/stripe/webhook", stripeWebhookRoutes);  // Line 69-70 - BEFORE JSON parser

// ---------- Parsers AFTER webhook ----------
app.use(express.json({ limit: "10mb" }));  // Line 73 - After webhook
```

### **3. Updated Endpoint Path**
- **Old**: `/webhook`
- **New**: `/stripe/webhook`

### **4. Reused Existing Billing Logic**
The new webhook handler reuses your existing:
- `ensureUserDoc()` from credit service
- Plan metadata processing
- Firebase membership updates
- Credit bonus calculations (Creator: +1500, Pro: +3500)

## 🎯 **Next Steps Required**

### **1. Update Stripe Dashboard**
Change your webhook endpoint from:
```
https://vaiform.com/webhook
```
**To**:
```
https://vaiform.com/stripe/webhook
```

### **2. Test the New Endpoint**
1. **Health Check**: Visit `https://vaiform.com/stripe/webhook`
   - Should return: `{"status":"ok","endpoint":"/stripe/webhook","timestamp":"..."}`

2. **Test Webhook**: In Stripe Dashboard → Webhooks → Send test event
   - Event: `checkout.session.completed`
   - Should return 200 OK in Stripe dashboard
   - Should see logs in Replit console

### **3. Make Test Purchase**
After updating the Stripe dashboard endpoint:
1. Make another Creator plan purchase
2. Check Replit console for webhook logs:
   ```
   [stripe/webhook] Processing event: checkout.session.completed
   [stripe/webhook] checkout.session.completed: { id: 'cs_...', metadata: { plan: 'creator', billing: 'onetime' } }
   ✅ Plan activated: creator onetime +1500 credits → ajrheaa0628@gmail.com
   ```
3. Verify Firebase user document updated with `plan: 'creator'`, `isMember: true`, `credits: 1500`

## 🔍 **Technical Details**

### **Why This Fix Works**
1. **Raw Body First**: Webhook gets raw body before JSON parsing corrupts it
2. **Proper Signature Verification**: Stripe can verify the signature against raw body
3. **Correct Mount Order**: Webhook middleware runs before any body parsing
4. **Dedicated Endpoint**: `/stripe/webhook` is clearly separated from other routes

### **Event Handling**
The webhook now properly handles:
- ✅ `checkout.session.completed` - Plan activation + bonus credits
- 🔄 `invoice.payment_succeeded` - Subscription renewals (TODO)
- 🔄 `customer.subscription.deleted` - Cancellation handling (TODO)

## 📁 **Files Modified**

- ✅ `src/routes/stripe.webhook.js` - **NEW** webhook route
- ✅ `src/app.js` - Fixed mount order and removed old webhook
- 🔄 `src/routes/webhook.routes.js` - **Can be deleted** (replaced)

## 🧪 **Expected Results**

After updating Stripe dashboard endpoint:

1. **Webhook Health Check**: `GET https://vaiform.com/stripe/webhook` → 200 OK
2. **Test Event**: Stripe Dashboard test → 200 OK + server logs
3. **Real Purchase**: User gets Creator plan + 1500 credits automatically
4. **Firebase Updated**: User document shows `plan: 'creator'`, `isMember: true`

**This should completely fix your payment processing issue!** 🎉

The webhook will now properly receive Stripe events, verify signatures, and update user plans/credits in Firebase automatically.
