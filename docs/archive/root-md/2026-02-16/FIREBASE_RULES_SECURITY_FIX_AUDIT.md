# Firebase Rules Security Fix - Implementation Audit

**Date**: 2025-01-XX  
**Status**: ✅ All fixes implemented

---

## 1. Changes Summary (Unified Diff)

### Fix 1: `firestore.rules` - Restrict `usersByEmail` to Get-Only

```diff
  // Legacy email-keyed docs (temporary, read-only)
  match /usersByEmail/{emailId} {
-    allow read: if emailMatches(emailId);
+    allow get: if emailMatches(emailId);
+    allow list: if false;
    allow write: if false;
  }
```

**Impact**: Prevents users from listing all documents in `usersByEmail` collection. Only direct document access (`get`) is allowed.

### Fix 2: `storage.rules` - Remove Unused `userUploads` Block

```diff
-  // Optional: legacy user uploads (if still in use)
-  match /userUploads/{userEmail}/{fileName} {
-    allow read, write: if request.auth != null
-      && request.auth.token.email != null
-      && request.auth.token.email.replace('.', '_') == userEmail;
-  }
-
  // Deny everything else by default
```

**Impact**: Removes unused legacy path that allowed list access. All uploads use `artifacts/{uid}/...` paths.

### Fix 3: `firestore.rules` - Add Explicit Deny-All Fallback

```diff
      allow delete: if isSignedIn() &&
                    resource.data.ownerId == request.auth.uid;
    }
+
+    // Explicit deny-all fallback
+    match /{allPaths=**} {
+      allow read, write: if false;
+    }
  }
}
```

**Impact**: Adds explicit security fallback. Firestore defaults to deny, but explicit rule is a best practice.

---

## 2. Final File Contents

### `firestore.rules` (Complete)

```rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn()     { return request.auth != null; }
    function isSelf(uid)      { return isSignedIn() && request.auth.uid == uid; }
    function emailMatches(id) { return isSignedIn() && request.auth.token.email == id; }

    // Canonical users by UID
    match /users/{uid} {
      allow read: if isSignedIn() && request.auth.uid == uid;
      allow create: if isSignedIn() && request.auth.uid == uid
        && !(("plan" in request.resource.data) || ("credits" in request.resource.data) || ("membership" in request.resource.data) || ("isMember" in request.resource.data));
      allow update: if isSignedIn() && request.auth.uid == uid
        && !request.resource.data
              .diff(resource.data)
              .changedKeys()
              .hasAny(["plan","credits","membership","isMember"]);

      match /generations/{genId} {
        allow read, write: if isSelf(uid);
      }

      match /transactions/{txId} {
        allow read: if isSelf(uid);
        allow create, update, delete: if false; // server-only via Admin SDK
      }
    }

    // Legacy email-keyed docs (temporary, read-only)
    match /usersByEmail/{emailId} {
      allow get: if emailMatches(emailId);
      allow list: if false;
      allow write: if false;
    }

    // Private server-only collections
    match /pending_credits_by_email/{emailDoc} {
      allow read, write: if false;
    }

    // --- Shorts library (owner-locked) ---
    match /shorts/{id} {
      // Create: must create for themselves
      allow create: if isSignedIn() &&
                    request.resource.data.ownerId == request.auth.uid;

      // Read: only owner can view
      allow read: if isSignedIn() &&
                  resource.data.ownerId == request.auth.uid;

      // Update: only owner AND cannot change ownerId/createdAt
      allow update: if isSignedIn() &&
                    resource.data.ownerId == request.auth.uid &&
                    request.resource.data.ownerId == resource.data.ownerId &&
                    (!('createdAt' in resource.data) ||
                      request.resource.data.createdAt == resource.data.createdAt);

      // Delete: only owner can delete
      allow delete: if isSignedIn() &&
                    resource.data.ownerId == request.auth.uid;
    }

    // Explicit deny-all fallback
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

### `storage.rules` (Complete)

```rules
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {

    function isSignedIn() { return request.auth != null; }
    function isSelf(uid)  { return isSignedIn() && request.auth.uid == uid; }

    // Artifacts uploaded by the server (Admin SDK bypasses rules).
    // Files live under: artifacts/{uid}/{jobId}/(short.mp4|cover.jpg|meta.json|...)
    match /artifacts/{uid}/{jobId}/{fileName} {
      // Owner-only SDK access (e.g. my shorts library, in-app playback).
      // Sharing uses Firebase "download tokens" which bypass rules and are
      // stored in the file's metadata.
      allow read: if isSelf(uid);

      // Block client writes; only server should write artifacts.
      allow write: if false;
    }

    // Deny everything else by default
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

---

## 3. Firebase Deployment Path

### Current Setup Analysis

**Findings:**
- ✅ `firestore.rules` exists at repo root
- ✅ `storage.rules` exists at repo root
- ❌ No `firebase.json` found
- ❌ No `.firebaserc` found
- ❌ No Firebase CLI scripts in `package.json`
- ✅ Project ID identified: `vaiform` (from `.github/workflows/health.yml`)

**Conclusion**: You're likely using **Firebase Console** for manual deployment, or need to set up Firebase CLI.

### Option A: Firebase Console (Manual Deployment)

**Steps:**
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select project: **vaiform**
3. **Firestore Rules:**
   - Navigate to: Firestore Database → Rules tab
   - Copy contents of `firestore.rules`
   - Paste into editor
   - Click **Publish**
4. **Storage Rules:**
   - Navigate to: Storage → Rules tab
   - Copy contents of `storage.rules`
   - Paste into editor
   - Click **Publish**

**File Locations**: Rules files are at repo root (correct location for both Console and CLI).

### Option B: Firebase CLI (Recommended for Future)

**Initial Setup (one-time):**
```bash
# Install Firebase CLI globally (if not installed)
npm install -g firebase-tools

# Login to Firebase
firebase login

# Initialize Firebase in repo (creates firebase.json and .firebaserc)
firebase init

# When prompted:
# - Select: Firestore, Storage
# - Use existing project: vaiform
# - Firestore rules file: firestore.rules (already exists)
# - Storage rules file: storage.rules (already exists)
```

**Deployment Commands:**
```bash
# Deploy both rules
firebase deploy --only firestore:rules,storage

# Or deploy individually
firebase deploy --only firestore:rules
firebase deploy --only storage
```

**File Structure (after init):**
```
vaiform-1/
├── firebase.json          # Created by firebase init
├── .firebaserc            # Created by firebase init
├── firestore.rules        # ✅ Already exists
└── storage.rules          # ✅ Already exists
```

**Expected `firebase.json` (after init):**
```json
{
  "firestore": {
    "rules": "firestore.rules"
  },
  "storage": {
    "rules": "storage.rules"
  }
}
```

---

## 4. Post-Deploy Verification Checklist

### Test 1: Firestore `usersByEmail` List Access (Should DENY)

**Method**: Firebase Console → Firestore → Rules Playground

**Test Case:**
- **Collection**: `usersByEmail`
- **Operation**: `list`
- **Authenticated**: Yes (any user)
- **Expected**: ❌ **DENY**

**Manual Test (if using client SDK):**
```javascript
// In browser console (authenticated user)
const db = firebase.firestore();
const snapshot = await db.collection('usersByEmail').get();
// Expected: Permission denied error
```

### Test 2: Firestore `usersByEmail` Get Access (Should ALLOW for matching email)

**Method**: Rules Playground

**Test Case:**
- **Document**: `usersByEmail/{emailId}` where `emailId` matches `request.auth.token.email`
- **Operation**: `get`
- **Authenticated**: Yes (user with matching email)
- **Expected**: ✅ **ALLOW**

**Test Case (non-matching email):**
- **Document**: `usersByEmail/{emailId}` where `emailId` does NOT match `request.auth.token.email`
- **Operation**: `get`
- **Authenticated**: Yes (different user)
- **Expected**: ❌ **DENY**

### Test 3: Storage `userUploads` Path (Should DENY - Path Removed)

**Method**: Rules Playground or client SDK

**Test Case:**
- **Path**: `userUploads/{userEmail}/test.jpg`
- **Operation**: `read` or `write`
- **Authenticated**: Yes (any user)
- **Expected**: ❌ **DENY** (falls through to `match /{allPaths=**}` deny-all)

**Manual Test:**
```javascript
// In browser console (authenticated user)
const storage = firebase.storage();
const ref = storage.ref('userUploads/test@example_com/test.jpg');
await ref.getDownloadURL();
// Expected: Permission denied error
```

### Test 4: Firestore Deny-All Fallback (Should DENY Unknown Paths)

**Method**: Rules Playground

**Test Case:**
- **Collection**: `unknownCollection/{id}`
- **Operation**: `read` or `write`
- **Authenticated**: Yes (any user)
- **Expected**: ❌ **DENY** (matches `/{allPaths=**}` fallback)

**Test Case:**
- **Collection**: `test/{id}`
- **Operation**: `read` or `write`
- **Authenticated**: Yes (any user)
- **Expected**: ❌ **DENY**

---

## 5. Verification Commands (CLI Testing)

If you set up Firebase CLI, you can also test rules locally:

```bash
# Test Firestore rules
firebase emulators:start --only firestore

# Test Storage rules
firebase emulators:start --only storage

# Test both
firebase emulators:start --only firestore,storage
```

Then use Rules Playground at: `http://localhost:4000` (Firestore) or test via SDK.

---

## Summary

✅ **Fix 1**: `usersByEmail` now get-only (no list access)  
✅ **Fix 2**: `userUploads` block removed (unused path)  
✅ **Fix 3**: Explicit deny-all fallback added to Firestore  

**Next Steps:**
1. Deploy rules via Firebase Console or CLI
2. Run verification checklist (4 tests above)
3. Monitor for any permission errors in production logs

**Files Modified:**
- `firestore.rules` (2 changes: Fix 1 + Fix 3)
- `storage.rules` (1 change: Fix 2)
