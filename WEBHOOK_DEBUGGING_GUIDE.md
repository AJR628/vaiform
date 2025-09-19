# Stripe Webhook Debugging Guide

## 🔍 Problem Identified

**Issue**: Stripe webhooks are not reaching the backend server after successful payments.

**Evidence**:
- ✅ Checkout session created successfully with correct metadata
- ❌ No webhook events in server logs after payment completion
- ❌ User plan not updated in Firebase
- ❌ Credits not applied

## 🛠️ Debugging Steps Applied

### 1. **Added Webhook Request Logging**
**File**: `src/controllers/webhook.controller.js`
```javascript
console.log(`[webhook] Received webhook request: ${req.method} ${req.url}`);
console.log(`[webhook] Headers:`, req.headers);
console.log(`[webhook] Body length:`, req.body?.length || 0);
```

### 2. **Added Webhook Test Endpoint**
**File**: `src/routes/webhook.routes.js`
```javascript
// GET /webhook - Test endpoint to verify webhook URL is accessible
router.get('/', (req, res) => {
  console.log(`[webhook] GET request received - webhook URL is accessible`);
  res.json({ 
    status: 'ok', 
    message: 'Webhook endpoint is accessible',
    timestamp: new Date().toISOString(),
    method: 'GET'
  });
});
```

## 🧪 Testing Instructions

### **Step 1: Test Webhook URL Accessibility**
1. Open browser and go to: `https://vaiform.com/webhook`
2. Should see JSON response: `{"status":"ok","message":"Webhook endpoint is accessible"}`
3. Check Replit console for: `[webhook] GET request received - webhook URL is accessible`

### **Step 2: Check Stripe Dashboard Webhook Configuration**
1. Go to [Stripe Dashboard](https://dashboard.stripe.com/webhooks)
2. Check if webhook endpoint is configured:
   - **URL**: `https://vaiform.com/webhook`
   - **Events**: `checkout.session.completed`, `invoice.paid`
   - **Status**: Should be "Active"

### **Step 3: Test Webhook with Stripe CLI (Optional)**
```bash
# Install Stripe CLI
stripe login

# Listen for webhooks locally
stripe listen --forward-to https://vaiform.com/webhook

# Trigger test event
stripe trigger checkout.session.completed
```

## 🔧 Common Webhook Issues & Solutions

### **Issue 1: Webhook URL Not Configured**
**Symptom**: No webhook events in server logs
**Solution**: 
1. Go to Stripe Dashboard → Webhooks
2. Click "Add endpoint"
3. URL: `https://vaiform.com/webhook`
4. Select events: `checkout.session.completed`, `invoice.paid`
5. Save and copy the webhook secret

### **Issue 2: Missing Webhook Secret**
**Symptom**: `❌ Missing STRIPE_WEBHOOK_SECRET` in logs
**Solution**:
1. Copy webhook secret from Stripe Dashboard
2. Add to Replit Secrets: `STRIPE_WEBHOOK_SECRET=whsec_...`

### **Issue 3: Webhook URL Not Accessible**
**Symptom**: Stripe shows webhook delivery failures
**Solution**:
1. Verify `https://vaiform.com/webhook` returns JSON response
2. Check if server is running and accessible
3. Verify no firewall blocking webhook requests

### **Issue 4: Wrong Webhook Events**
**Symptom**: Webhooks received but wrong events
**Solution**:
1. Ensure `checkout.session.completed` is selected
2. Add `invoice.paid` for subscription renewals
3. Remove unnecessary events

## 🎯 Expected Webhook Flow

### **After Payment Completion:**
1. **Stripe sends webhook** → `https://vaiform.com/webhook`
2. **Server logs**: `[webhook] Received webhook request: POST /webhook`
3. **Server logs**: `[webhook] checkout.session.completed metadata: { plan: 'creator', billing: 'onetime', ... }`
4. **Firebase updated**: User plan and credits applied
5. **Success page**: Shows activated plan

### **Debug Logs to Look For:**
```
[webhook] Received webhook request: POST /webhook
[webhook] Headers: { 'stripe-signature': '...', 'content-type': 'application/json' }
[webhook] Body length: 1234
[webhook] checkout.session.completed metadata: { plan: 'creator', billing: 'onetime', email: 'ajrheaa0628@gmail.com', uidHint: 'HuVSlb50iJOSpB2bbtrPBKtEtWT2', allMetadata: { uid: '...', email: '...', plan: 'creator', billing: 'onetime' } }
✅ Plan activated: creator onetime +1500 credits → ajrheaa0628@gmail.com
```

## 🚨 Immediate Action Required

### **Check Stripe Dashboard:**
1. Go to [Stripe Dashboard](https://dashboard.stripe.com/webhooks)
2. Look for webhook endpoint: `https://vaiform.com/webhook`
3. If missing, create it with these events:
   - `checkout.session.completed`
   - `invoice.paid`

### **Test Webhook URL:**
1. Visit: `https://vaiform.com/webhook`
2. Should see JSON response (not 404 error)
3. Check Replit console for GET request log

### **Verify Environment Variables:**
1. Check Replit Secrets for `STRIPE_WEBHOOK_SECRET`
2. Should start with `whsec_`

## 📁 Files Modified

- `src/controllers/webhook.controller.js` - Added webhook request logging
- `src/routes/webhook.routes.js` - Added GET test endpoint

## 🔄 Next Steps

1. **Test webhook URL accessibility** (Step 1 above)
2. **Check Stripe Dashboard webhook configuration** (Step 2 above)
3. **Make another test purchase** to see webhook logs
4. **If still failing, use Stripe CLI** for local testing

The webhook is the critical missing piece - once it's properly configured and reaching your server, the plan activation and credit assignment will work automatically.
