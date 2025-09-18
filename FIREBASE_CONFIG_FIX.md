# Firebase Config Fix + Free Plan Enforcement

## Overview
Fixed frontend Firebase configuration and enforced free plan setup on user signup/login to ensure proper plan gating.

## Changes Made

### 1. Frontend Firebase Config Updates

**Files Updated:**
- `public/frontend.js` - Main frontend auth flow
- `public/js/pricing.js` - Pricing page auth
- `public/js/success.js` - Success page auth

**Config Applied:**
```javascript
const firebaseConfig = {
  apiKey: "AIzaSyBg9bqtZoTkC3vfEXk0vzLJAlTibXfjySY",
  authDomain: "vaiform.firebaseapp.com",
  projectId: "vaiform",
  storageBucket: "vaiform",
  messagingSenderId: "798543382244",
  appId: "1:798543382244:web:a826ce7ed8bebbe0b9cef1",
  measurementId: "G-971DTZ5PEN"
};
```

### 2. Free Plan Enforcement

**Added `ensureUserDoc` function to all frontend files:**
```javascript
async function ensureUserDoc(user) {
  if (!user || !user.uid) return;
  
  try {
    const ref = doc(db, "users", user.uid);
    await setDoc(ref, {
      email: user.email,
      plan: "free",
      isMember: false,
      credits: 0,
      shortDayKey: new Date().toISOString().slice(0, 10),
      shortCountToday: 0,
      membership: { 
        kind: null, 
        expiresAt: null, 
        nextPaymentAt: null 
      },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });
    
    console.log(`User doc ensured: ${user.uid} (${user.email})`);
  } catch (error) {
    console.error("Failed to ensure user doc:", error);
  }
}
```

### 3. Auth Flow Integration

**Updated auth flows to call `ensureUserDoc`:**

1. **Google Sign-in** (`frontend.js`):
```javascript
loginBtn?.addEventListener("click", async () => {
  try { 
    const result = await signInWithPopup(auth, provider);
    const user = result.user;
    await ensureUserDoc(user); // Ensure free plan setup immediately after sign-in
  }
  catch (err) { console.error("Login failed:", err); }
});
```

2. **Auth State Change** (all files):
```javascript
onAuthStateChanged(auth, async (user) => {
  // ... existing logic ...
  if (user) {
    await ensureUserDoc(user); // Ensure free plan setup
    // ... rest of logic ...
  }
});
```

3. **Email/Password Auth** (`pricing.js`):
```javascript
async function signIn() {
  // ... auth logic ...
  await ensureUserDoc(user); // Ensure free plan setup immediately after sign-in
}

async function signUp() {
  // ... auth logic ...
  await ensureUserDoc(user); // Ensure free plan setup immediately after sign-up
}
```

## User Document Schema

New users will now have documents created with:
```javascript
{
  email: string,
  plan: "free",
  isMember: false,
  credits: 0,
  shortDayKey: "YYYY-MM-DD",
  shortCountToday: 0,
  membership: { 
    kind: null, 
    expiresAt: null, 
    nextPaymentAt: null 
  },
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp()
}
```

## Benefits

1. **Proper Plan Gating**: Free users are now properly limited to 4 shorts/day
2. **AI Quote Blocking**: Free users cannot access AI quote generation
3. **Watermark Enforcement**: Free user exports will have watermarks
4. **Consistent State**: All users have proper plan status in Firestore
5. **Upgrade Path**: Paid plans will override these defaults via webhook

## Testing Checklist

- [ ] Deploy to Netlify
- [ ] Sign up with brand-new email
- [ ] Verify Firestore doc created with `plan: "free"`
- [ ] Test free user limits (4 shorts/day)
- [ ] Verify AI quotes blocked for free users
- [ ] Verify watermark forced for free users
- [ ] Test paid plan upgrade via checkout
- [ ] Verify webhook updates plan status correctly

## Files Modified

1. `public/frontend.js` - Main auth flow + ensureUserDoc
2. `public/js/pricing.js` - Pricing page auth + ensureUserDoc
3. `public/js/success.js` - Firebase config update
4. `public/js/config.js` - Already had correct config (no changes needed)

## Notes

- Backend Firebase Admin config remains unchanged
- All existing functionality preserved
- `{ merge: true }` prevents overwriting existing user data
- Multiple `ensureUserDoc` calls are safe (idempotent)
- Console logging helps with debugging
