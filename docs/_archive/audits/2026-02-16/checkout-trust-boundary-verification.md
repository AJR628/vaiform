# Checkout Trust Boundary Verification

## Overview

This document describes how to verify that `startPlanCheckout` correctly ignores client-supplied `uid`/`email` and uses server-derived values from `req.user`.

## Fix Summary

**Before**: Endpoint accepted `uid` and `email` from `req.body` (client-supplied, untrusted)  
**After**: Endpoint derives `uid` and `email` from `req.user` (server-verified via Firebase token)

## Verification Steps

### Prerequisites

1. Server running with `VAIFORM_DEBUG=1` (enables security warning logs)
2. Valid Firebase ID token for an authenticated user
3. `curl` or similar HTTP client

### Test 1: Request with Spoofed uid/email

**Purpose**: Verify that client-supplied `uid`/`email` are ignored.

**Command**:
```bash
curl -X POST http://localhost:3000/checkout/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ID_TOKEN" \
  -d '{
    "plan": "creator",
    "billing": "onetime",
    "uid": "SPOOFED_UID_12345",
    "email": "spoofed@example.com"
  }'
```

**Expected Behavior**:
- ✅ Request succeeds (200 OK)
- ✅ Server logs show security warning (if `VAIFORM_DEBUG=1`):
  ```
  [checkout/start:security] Client sent uid="SPOOFED_UID_12345" but server using req.user.uid="REAL_UID" (ignored)
  ```
- ✅ Stripe session created with `client_reference_id` = real user's uid (from token)
- ✅ Stripe session `metadata.uid` = real user's uid (not spoofed value)

**How to Verify Stripe Session**:
1. Check server logs for the created session ID
2. In Stripe Dashboard → Checkout Sessions, find the session
3. Verify `client_reference_id` and `metadata.uid` match the authenticated user's uid (not "SPOOFED_UID_12345")

### Test 2: Request without uid/email (Normal Flow)

**Purpose**: Verify that endpoint works when client doesn't send `uid`/`email`.

**Command**:
```bash
curl -X POST http://localhost:3000/checkout/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ID_TOKEN" \
  -d '{
    "plan": "creator",
    "billing": "onetime"
  }'
```

**Expected Behavior**:
- ✅ Request succeeds (200 OK)
- ✅ No security warnings in logs (client didn't send conflicting values)
- ✅ Stripe session created with correct uid/email from `req.user`

### Test 3: Frontend Compatibility

**Purpose**: Verify that existing frontend code (which sends `uid`/`email`) still works.

**Current Frontend Code** (`public/js/pricing.js:115-120`):
```javascript
body: JSON.stringify({
  plan,
  billing,
  uid: user.uid,      // ✅ Still sent (harmless)
  email: user.email   // ✅ Still sent (harmless)
})
```

**Expected Behavior**:
- ✅ Frontend checkout flow works normally
- ✅ Server ignores client-supplied `uid`/`email` (uses `req.user` instead)
- ✅ If `VAIFORM_DEBUG=1`, no warnings appear (values match `req.user`)

## Manual Verification Checklist

- [ ] Test 1: Spoofed uid/email is ignored
- [ ] Test 2: Request without uid/email works
- [ ] Test 3: Frontend checkout flow works
- [ ] Server logs show correct uid in Stripe session creation
- [ ] Stripe Dashboard shows correct `client_reference_id` and `metadata.uid`

## Code Changes Summary

**File**: `src/controllers/checkout.controller.js`

**Changes**:
1. Removed `uid, email` from `req.body` destructuring (line 134)
2. Added server-derived `uid` and `email` from `req.user` (lines 145-146)
3. Removed validation that required `uid`/`email` from body (removed lines 142-144)
4. Added debug logging for security verification (lines 149-158)
5. Added `client_reference_id: uid` to Stripe session (line 182) for consistency
6. Updated JSDoc comment to reflect trust boundary (line 130)

**No Changes Required**:
- Frontend code can continue sending `uid`/`email` (server ignores them)
- No schema validation changes (endpoint doesn't use validation middleware)
- Route protection unchanged (already uses `requireAuth`)

## Security Impact

**Before Fix**: 
- Authenticated user could set `uid` to another user's ID
- Could cause credits to be assigned to wrong user
- Could cause billing to be associated with wrong user

**After Fix**:
- ✅ Server always uses authenticated user's uid/email
- ✅ Client-supplied values are completely ignored
- ✅ Trust boundary enforced: identity derived from verified token only

## Related Files

- `src/controllers/checkout.controller.js` - Fixed endpoint
- `src/routes/checkout.routes.js` - Route definition (no changes)
- `public/js/pricing.js` - Frontend (no changes needed, but can be cleaned up later)
- `web/dist/js/pricing.js` - Built frontend (no changes needed)
