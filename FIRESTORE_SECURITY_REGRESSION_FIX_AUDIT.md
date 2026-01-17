# Firestore Security Regression Fixes - Implementation Audit

**Date**: 2025-01-XX  
**Status**: ✅ All regression fixes implemented

---

## A. Unified Diff of `firestore.rules`

```diff
  rules_version = '2';
  service cloud.firestore {
    match /databases/{database}/documents {

      function isSignedIn()     { return request.auth != null; }
      function isSelf(uid)      { return isSignedIn() && request.auth.uid == uid; }
-     function emailMatches(id) { return isSignedIn() && request.auth.token.email == id; }
+     function emailMatches(id) {
+       return isSignedIn() && request.auth.token.email != null && request.auth.token.email == id;
+     }

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
-         allow read, write: if isSelf(uid);
+         allow read: if isSelf(uid);
+         allow create, update, delete: if false; // server-only via Admin SDK
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
-       // Create: must create for themselves
-       allow create: if isSignedIn() &&
-                     request.resource.data.ownerId == request.auth.uid;
-
-       // Read: only owner can view
+       // Read: only owner can view
        allow read: if isSignedIn() &&
                    resource.data.ownerId == request.auth.uid;
-       // Update: only owner AND cannot change ownerId/createdAt
-       allow update: if isSignedIn() &&
-                     resource.data.ownerId == request.auth.uid &&
-                     request.resource.data.ownerId == resource.data.ownerId &&
-                     (!('createdAt' in resource.data) ||
-                       request.resource.data.createdAt == resource.data.createdAt);
-
-       // Delete: only owner can delete
-       allow delete: if isSignedIn() &&
-                     resource.data.ownerId == request.auth.uid;
+       // Write: server-only via Admin SDK
+       allow create, update, delete: if false;
      }

      // Explicit deny-all fallback
      match /{allPaths=**} {
        allow read, write: if false;
      }
    }
  }
```

---

## B. Deny-All Fallback Confirmation

**Location**: `firestore.rules:54-57`

```rules
    // Explicit deny-all fallback
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

✅ **Confirmed**: Deny-all fallback `match /{allPaths=**}` is at the very end, just before closing braces. This ensures any unmatched paths are explicitly denied.

---

## C. usersByEmail Get-Only Confirmation

**Location**: `firestore.rules:33-38`

```rules
    // Legacy email-keyed docs (temporary, read-only)
    match /usersByEmail/{emailId} {
      allow get: if emailMatches(emailId);
      allow list: if false;
      allow write: if false;
    }
```

✅ **Confirmed**: `usersByEmail` is get-only:
- `allow get: if emailMatches(emailId);` - Allows direct document access only
- `allow list: if false;` - Explicitly blocks listing
- `allow write: if false;` - Blocks all writes

---

## D. Legacy Shorts Docs Without `ownerId` - Risk Assessment

### Investigation Results

**All shorts creation paths explicitly set `ownerId`:**

1. **`shorts.service.js:43`** - `shortsRef.set({ ownerId: ownerUid, ... })`
2. **`story.service.js:1102`** - `shortsRef.set({ ownerId: uid, ... })`
3. **`studio.service.js:515`** - `shortsRef.set({ ownerId: uid, ... })`

**All queries filter by `ownerId`:**
- `shorts.controller.js:368` - `.where('ownerId', '==', ownerUid)`
- `shorts.controller.js:409` - `.where('ownerId', '==', ownerUid)`
- `shorts.controller.js:549` - Ownership check: `if (shortData.ownerId !== ownerUid)`

### Potential Issue

**Current read rule** (`firestore.rules:48-49`):
```rules
allow read: if isSignedIn() &&
            resource.data.ownerId == request.auth.uid;
```

**Risk**: If any legacy shorts documents exist without `ownerId` field:
- `resource.data.ownerId` would be `undefined`
- `undefined == request.auth.uid` evaluates to `false`
- **Result**: Legacy docs would be **inaccessible via client read rules**

### Mitigation

✅ **Low Risk**: All current code paths set `ownerId`. However, if legacy docs exist:

1. **Server-side access unaffected**: Admin SDK bypasses rules, so backend can still read/update legacy docs
2. **Client access would be blocked**: This is actually **desirable** from a security perspective (defense in depth)
3. **Migration path**: If legacy docs need client access, migration script should add `ownerId` field:
   ```javascript
   // One-time migration script (run via Admin SDK)
   const snapshot = await db.collection('shorts').where('ownerId', '==', null).get();
   // Migrate based on other fields (createdAt, email, etc.)
   ```

### Recommendation

**Current rule is correct**. Legacy docs without `ownerId` should be inaccessible via client rules. If migration is needed, it should:
1. Add `ownerId` field via Admin SDK
2. Or delete orphaned docs if ownership cannot be determined

**No rule change needed** - the security posture is correct (deny by default for incomplete docs).

---

## E. Final File Contents

### Complete `firestore.rules`

```rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn()     { return request.auth != null; }
    function isSelf(uid)      { return isSignedIn() && request.auth.uid == uid; }
    function emailMatches(id) {
      return isSignedIn() && request.auth.token.email != null && request.auth.token.email == id;
    }

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
        allow read: if isSelf(uid);
        allow create, update, delete: if false; // server-only via Admin SDK
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
      // Read: only owner can view
      allow read: if isSignedIn() &&
                  resource.data.ownerId == request.auth.uid;
      // Write: server-only via Admin SDK
      allow create, update, delete: if false;
    }

    // Explicit deny-all fallback
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

---

## F. Verification Steps (Rules Playground)

### Test 1: DENY Create `users/{uid}/generations/{genId}`

**Rules Playground Setup:**
- **Location**: `users/testUid123/generations/testGenId`
- **Operation**: `create`
- **Authenticated**: Yes (`auth.uid = "testUid123"`)
- **Expected**: ❌ **DENY**

**Why**: Client writes blocked; only server (Admin SDK) can create.

---

### Test 2: ALLOW Get `users/{uid}/generations/{genId}`

**Rules Playground Setup:**
- **Location**: `users/testUid123/generations/testGenId`
- **Operation**: `get`
- **Authenticated**: Yes (`auth.uid = "testUid123"`)
- **Expected**: ✅ **ALLOW**

**Why**: `isSelf(uid)` allows read for own documents.

---

### Test 3: DENY Create `shorts/{id}`

**Rules Playground Setup:**
- **Location**: `shorts/testShortId`
- **Operation**: `create`
- **Authenticated**: Yes (`auth.uid = "testUid123"`)
- **Resource Data**: `{ ownerId: "testUid123", ... }`
- **Expected**: ❌ **DENY**

**Why**: Client writes blocked; only server (Admin SDK) can create.

---

### Test 4: ALLOW Get `shorts/{id}` (Own Document)

**Rules Playground Setup:**
- **Location**: `shorts/testShortId`
- **Operation**: `get`
- **Authenticated**: Yes (`auth.uid = "testUid123"`)
- **Resource Data**: `{ ownerId: "testUid123", ... }`
- **Expected**: ✅ **ALLOW**

**Why**: `resource.data.ownerId == request.auth.uid` allows read for own documents.

---

### Test 5: DENY Get `shorts/{id}` (Other User's Document)

**Rules Playground Setup:**
- **Location**: `shorts/testShortId`
- **Operation**: `get`
- **Authenticated**: Yes (`auth.uid = "testUid123"`)
- **Resource Data**: `{ ownerId: "otherUid456", ... }`
- **Expected**: ❌ **DENY**

**Why**: `resource.data.ownerId != request.auth.uid` blocks access to other users' documents.

---

## Summary

✅ **Fix 1**: `generations` now read-only (client), server-only writes  
✅ **Fix 2**: `shorts` now read-only (client), server-only writes  
✅ **Fix 3**: `emailMatches` now has null-guard  

✅ **Verification:**
- Deny-all fallback confirmed at end
- `usersByEmail` confirmed get-only + list:false
- Legacy shorts without `ownerId` assessed (low risk, no rule change needed)

**Security Posture**: Matches `transactions` pattern - client read-only, server (Admin SDK) writes. All writes use `admin.firestore()`, so client write permissions were unnecessary and created security risk.

**Files Modified**: `firestore.rules` (3 changes)
