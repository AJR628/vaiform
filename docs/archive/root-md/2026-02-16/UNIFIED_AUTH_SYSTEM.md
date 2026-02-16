# Unified Auth System + Firebase Web Config Fix

## Overview
Implemented a unified authentication system where all auth flows go through the pricing modal, with correct Firebase Web SDK configuration and automatic free plan initialization for all new users.

## Key Changes Made

### 1. Shared Firebase Client (`public/js/firebaseClient.js`)
- **Created**: Single Firebase client module used by all pages
- **Fixed**: `storageBucket: "vaiform.appspot.com"` for proper browser compatibility
- **Added**: `ensureUserDoc()` function for automatic free plan setup

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyBg9bqtZoTkC3vfEXk0vzLJAlTibXfjySY",
  authDomain: "vaiform.firebaseapp.com",
  projectId: "vaiform",
  storageBucket: "vaiform.appspot.com",   // ✅ Correct for browser
  messagingSenderId: "798543382244",
  appId: "1:798543382244:web:a826ce7ed8bebbe0b9cef1",
  measurementId: "G-971DTZ5PEN"
};
```

### 2. Pricing Auth Handlers (`public/js/pricingAuthHandlers.js`)
- **Created**: Centralized auth functions for pricing modal
- **Functions**: `uiSignIn()`, `uiSignUp()`, `uiGoogle()`, `routeAfterAuth()`
- **Features**: Automatic user doc creation + smart routing after auth

### 3. Updated Files to Use Shared Client

**`public/frontend.js`:**
- ✅ Imports from shared Firebase client
- ✅ Login button now redirects to `/pricing?auth=open`
- ✅ Removed duplicate `ensureUserDoc` function
- ✅ Auth state listener calls shared `ensureUserDoc`

**`public/js/pricing.js`:**
- ✅ Imports from shared Firebase client and auth handlers
- ✅ Auto-opens auth modal when `?auth=open` in URL
- ✅ Updated checkout to use proper ID token
- ✅ All auth flows route correctly after signup/login

**`public/js/success.js`:**
- ✅ Imports from shared Firebase client
- ✅ Calls `ensureUserDoc` in auth state listener

### 4. Enhanced Pricing Modal (`public/pricing.html`)
- **Added**: Google sign-in button
- **Added**: Email/password form with proper styling
- **Added**: Auto-open functionality via URL parameter
- **Structure**: Clean modal with both auth options

### 5. Smart Routing After Auth
```javascript
export async function routeAfterAuth(user) {
  const snap = await getDoc(doc(db, "users", user.uid));
  const userData = snap.data() || {};
  
  if (userData.isMember) {
    window.location.href = "/creative";  // Paid users → Creative Studio
  } else {
    window.location.href = "/pricing";   // Free users → Stay on pricing
  }
}
```

## User Flow

### New User Signup:
1. User clicks "Sign In" anywhere → Redirects to `/pricing?auth=open`
2. Auth modal auto-opens on pricing page
3. User signs up with email/password or Google
4. `ensureUserDoc()` creates Firestore doc with `plan: "free"`
5. User routed back to pricing page (since not paid)

### Existing User Login:
1. User clicks "Sign In" → Redirects to `/pricing?auth=open`
2. Auth modal opens, user signs in
3. `ensureUserDoc()` ensures doc exists (merge safe)
4. User routed based on plan: paid → `/creative`, free → `/pricing`

### Paid User Experience:
1. User clicks plan buttons on pricing page
2. Checkout uses proper ID token for auth
3. Webhook updates user doc with `isMember: true`, `plan`, bonus credits
4. Success page shows plan activation

## Free Plan Enforcement

Every new user gets:
```javascript
{
  email: user.email,
  plan: "free",
  isMember: false,
  credits: 0,
  shortDayKey: "YYYY-MM-DD",
  shortCountToday: 0,
  membership: { kind: null, expiresAt: null, nextPaymentAt: null }
}
```

This ensures:
- ✅ 4 shorts/day limit enforced
- ✅ AI quotes blocked for free users
- ✅ Watermarks forced for free exports
- ✅ Proper plan gating throughout the app

## Files Modified

### New Files:
- `public/js/firebaseClient.js` - Shared Firebase client
- `public/js/pricingAuthHandlers.js` - Centralized auth functions

### Updated Files:
- `public/frontend.js` - Uses shared client, redirects to pricing
- `public/js/pricing.js` - Unified auth modal with auto-open
- `public/js/success.js` - Uses shared client
- `public/pricing.html` - Enhanced auth modal UI

### Unchanged:
- Backend Firebase Admin SDK (still uses custom bucket if desired)
- Server-side plan guards and webhook logic
- Existing credit pack functionality

## Benefits

1. **Single Auth Flow**: All authentication goes through pricing modal
2. **Correct Firebase Config**: Browser uploads work with `vaiform.appspot.com`
3. **Automatic Free Setup**: Every user gets proper plan status
4. **Smart Routing**: Paid users go to creative, free users stay on pricing
5. **Consistent Experience**: Same auth flow from any page
6. **Proper Security**: ID tokens used for all authenticated requests

## Testing Checklist

- [ ] Home page "Sign In" → Opens pricing modal
- [ ] Pricing modal auto-opens with `?auth=open`
- [ ] Email/password signup creates user with `plan: "free"`
- [ ] Google sign-in creates user with `plan: "free"`
- [ ] Free users stay on pricing after auth
- [ ] Paid users go to creative after auth
- [ ] Checkout works with proper ID token
- [ ] Free plan limits enforced (4 shorts/day, no AI quotes, watermarks)
- [ ] Paid plan activation works via webhook

## URL Patterns

- `/pricing` - Pricing page
- `/pricing?auth=open` - Pricing page with auto-opened auth modal
- `/creative` - Creative Studio (for paid users)
- `/success?plan=creator` - Success page after plan purchase

## Commit Message
```
feat(auth): unify login via pricing modal, correct Firebase Web config, init Free plan
```
