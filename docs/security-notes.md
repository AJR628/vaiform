# Vaiform – Security Notes (v1)

**Purpose:** Capture the current security posture for Vaiform v1 so future changes don't accidentally re-open old attack surfaces.

This document is the **single source of truth** for:

- What data users can see or modify
- Which routes/features are intentionally disabled
- How Firestore and Storage are locked down

**Last updated:** December 2025

---

## 1. Ownership Model

**Identity source:** Firebase Auth (`uid`, `email`).

**Ownership rules:**

- Every user has a canonical doc at:  
  `users/{uid}`

- All user-specific content is either:
  - Nested under `users/{uid}/…` (e.g. `generations`, `transactions`), or
  - In top-level collections with an explicit `ownerId` field (e.g. `shorts/{id}` with `ownerId = uid`).

**Client vs server responsibilities:**

- **Server-owned fields** (plan, credits, membership, etc.) are only written by backend code using the Admin SDK.
- The **browser can never:**
  - Create or edit someone else's docs
  - Change its own `plan`, `credits`, `membership` flags
  - Touch other users' shorts or transactions

---

## 2. Firestore Rules (Current)

```javascript
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {

    // --- helpers ---
    function isSignedIn()     { return request.auth != null; }
    function isSelf(uid)      { return isSignedIn() && request.auth.uid == uid; }
    function emailMatches(id) { return isSignedIn() && request.auth.token.email == id; }

    // --- Canonical users by UID ---
    match /users/{uid} {
      // Read own user doc
      allow read: if isSelf(uid);

      // Client may create their doc, but NOT set server-owned fields
      allow create: if isSelf(uid)
        && !(
          ("plan" in request.resource.data) ||
          ("credits" in request.resource.data) ||
          ("membership" in request.resource.data) ||
          ("isMember" in request.resource.data)
        );

      // Client can update only if they DON'T touch server-owned fields
      allow update: if isSelf(uid)
        && !request.resource.data
              .diff(resource.data)
              .changedKeys()
              .hasAny(["plan","credits","membership","isMember"]);

      // Optional: block client deletes
      allow delete: if false;

      // --- Nested collections ---

      // User's own generations (images/videos/jobs metadata)
      match /generations/{genId} {
        allow read, write: if isSelf(uid);
      }

      // Stripe / credit transaction logs - server only
      match /transactions/{txId} {
        // Client can read their own transaction history
        allow read: if isSelf(uid);

        // Writes are server-only (Admin SDK bypasses rules)
        allow create, update, delete: if false;
      }
    }

    // --- Legacy email-keyed docs (temporary, read-only) ---
    match /usersByEmail/{emailId} {
      // Allow user to read their legacy doc (for migration)
      allow read: if emailMatches(emailId);

      // No client writes
      allow write: if false;
    }

    // --- Private server-only collections ---
    match /pending_credits_by_email/{emailDoc} {
      // No client access at all
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
  }
}
```

### Firestore Security Summary

**User docs:**
- Only the logged-in user can read their `users/{uid}` doc.
- Client can't set or change `plan`, `credits`, `membership`, `isMember`. Those are server-owned.

**Generations:**
- A user can read/write only their own `users/{uid}/generations/*` docs.

**Transactions & pending credits:**
- Client can read their own transactions.
- All credit-granting / Stripe bookkeeping (`transactions`, `pending_credits_by_email`) is server-only.

**Shorts library:**
- `/shorts/{id}` is owner-locked.
- `ownerId` is immutable from the client, so users can't "steal" someone else's short by editing it.

**Default stance:**
- No "public read" collections.
- Everything requires auth, and almost everything is owner-scoped.

---

## 3. Storage Rules (Current)

```javascript
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

    // Optional: legacy user uploads (if still in use)
    match /userUploads/{userEmail}/{fileName} {
      allow read, write: if request.auth != null
        && request.auth.token.email != null
        && request.auth.token.email.replace('.', '_') == userEmail;
    }

    // Deny everything else by default
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

### Storage Security Summary

**In-app access (SDK):**
- Only the owner (`uid`) can list/get their files under `artifacts/{uid}/…`.

**Sharing out to the world:**
- If the app exposes a "Copy link" / "Share" button, it should use a download URL generated by the server (or a secure admin script).
- Those URLs include a long, unguessable token query parameter and are safe to share like "unlisted" videos on YouTube.
- Storage rules still require owner auth for SDK reads; the token is a separate, explicit sharing mechanism.

**Writes:**
- Browser cannot upload or overwrite `artifacts/*`. All renders are written by the backend only.

---

## 4. Active Routes (Core Features)

### Article Explainer Pipeline (`/api/story/*`)
All routes mounted and active:
- `POST /api/story/start` - Create story session
- `POST /api/story/generate` - Generate script
- `POST /api/story/update-script` - Edit script
- `POST /api/story/plan` - Generate visual plan
- `POST /api/story/search` - Search clips for shots
- `POST /api/story/search-shot` - Search/paginate single shot
- `POST /api/story/update-shot` - Swap clip
- `POST /api/story/insert-beat` - Insert sentence
- `POST /api/story/delete-beat` - Delete sentence
- `POST /api/story/update-beat-text` - Edit sentence
- `POST /api/story/timeline` - Build timeline
- `POST /api/story/captions` - Generate caption timings
- `POST /api/story/render` - Render segments
- `POST /api/story/finalize` - Full pipeline (20 credits)
- `GET /api/story/:sessionId` - Get session

**Security:** All require `requireAuth` middleware

### Caption System
- `POST /api/caption/preview` - V3 raster mode (SSOT)
- `POST /api/caption/render` - Final caption render

**Security:** No auth required (public preview endpoint)

### Text-to-Speech
- `POST /api/tts/preview` - Generate TTS preview
- `GET /api/voice/voices` - List voices
- `POST /api/voice/preview` - Preview voice

**Security:** All require `requireAuth`

### Payments & Credits
- `POST /checkout/start` - Start checkout (Creator/Pro)
- `POST /checkout/session` - Legacy credit pack
- `POST /checkout/subscription` - Legacy subscription
- `POST /checkout/portal` - Billing portal
- `POST /stripe/webhook` - Stripe webhook (raw body, no auth)
- `GET /credits` - Get credit balance
- `GET /api/credits` - Alias for credits

**Security:** Checkout routes require `requireAuth`; webhook uses Stripe signature verification

### User Management
- `POST /api/users/ensure` - Create user doc (100 welcome credits)
- `POST /api/user/setup` - Setup user (no-op, legacy)
- `GET /api/user/me` - Get user data

**Security:** All require `requireAuth`

### My Shorts Library
- `GET /api/shorts/mine` - List user's shorts
- `GET /api/shorts/:jobId` - Get short details

**Security:** Both require `requireAuth`; server-side ownerId filtering

### Other Active Routes
- `GET /health` - Health check
- `GET /whoami` - Auth test
- `GET /api/limits` - Rate limit info
- `POST /creative` - Creative routes (if mounted)

---

## 5. Disabled Routes (Mounted but Return 410)

These routes are **mounted** in Express but immediately return `410 FEATURE_DISABLED`:

### AI Image Generation (Kill-Switches)
- `POST /enhance` - Prompt enhancement
  - **File:** `src/controllers/enhance.controller.js`
  - **Response:** `{ success: false, error: "FEATURE_DISABLED" }`
  
- `POST /generate` - Text-to-image generation
  - **File:** `src/controllers/generate.controller.js`
  - **Response:** `{ success: false, error: "FEATURE_DISABLED" }`
  
- `GET /job/:jobId` - Image job polling
  - **File:** `src/controllers/generate.controller.js` → `jobStatus()`
  - **Response:** `{ success: false, error: "FEATURE_DISABLED" }`

### AI Image Routes (Not Mounted, But Controllers Exist)
These controller functions exist but are **NOT mounted** as routes:
- `POST /generate/image-to-image` - Controller exists, returns 410, but route not in `generate.routes.js`
- `POST /generate/upscale` - Controller exists, returns 410, but route not in `generate.routes.js`

**Note:** These cannot be called because routes don't exist, but code is preserved.

### Assets Route (If Mounted Would Return 410)
- `POST /api/assets/ai-images` - AI image generation for assets
  - **File:** `src/routes/assets.routes.js`
  - **Status:** Route exists but router is **unmounted** in `app.js`
  - **If called:** Would return `{ success: false, error: "FEATURE_DISABLED" }`

---

## 6. Unmounted Routes (Commented Out)

These route modules exist but are **commented out** in `src/app.js`:

### Quote-to-Short Studio
- **Router:** `src/routes/studio.routes.js`
- **Routes:** All `/api/studio/*` endpoints
- **Status:** Unmounted (lines 205-209 in `app.js`)
- **Reason:** Non-core feature for v1

### Quote Helpers
- **Router:** `src/routes/quotes.routes.js`
- **Routes:** All `/api/quotes/*` endpoints
- **Status:** Unmounted (lines 210-215 in `app.js`)
- **Reason:** Non-core feature for v1

### Asset Helpers
- **Router:** `src/routes/assets.routes.js`
- **Routes:** `/api/assets/options`, `/api/assets/ai-images`
- **Status:** Unmounted (lines 216-220 in `app.js`)
- **Reason:** Non-core feature for v1

### Legacy Preview
- **Router:** `src/routes/preview.routes.js`
- **Routes:** `/api/preview/caption` (v1/v2 legacy)
- **Status:** Unmounted (lines 235-240 in `app.js`)
- **Reason:** Replaced by `/api/caption/preview` (V3 raster)

---

## 7. Disabled Route Handlers (Code Preserved)

These routes are **commented out** in their route files but handlers exist:

### Shorts Routes
- **File:** `src/routes/shorts.routes.js`
- `POST /api/shorts/create` - Legacy short creation (line 9, commented)
- `DELETE /api/shorts/:jobId` - Delete short (line 16, commented)
- **Reason:** Not used by Article Explainer; only read endpoints (`/mine`, `/:jobId`) are active

---

## 8. Frontend Feature Flags

**File:** `public/js/feature-flags.js`

```javascript
window.VAIFORM_FEATURES = {
  ENABLE_IMAGE_CREATOR: false,
  ENABLE_IMAGE_UPSCALE: false
};
```

**UI Behavior:**
- Image Creator nav link hidden when `ENABLE_IMAGE_CREATOR === false`
- `image-creator.html` shows "not available" message
- Upscale buttons show "feature disabled" toast
- Job polling is no-op when disabled

**Historical Data:** Users can still read `users/{uid}/generations` to view past images, but cannot generate new ones.

---

## 9. Service-Level Kill-Switches

**File:** `src/services/ai.image.provider.js`

```javascript
export async function generateAIImage(...) {
  throw new Error("AI_IMAGES_DISABLED: AI image generation is disabled in this version of Vaiform.");
}
```

**Impact:** Even if routes were enabled, the provider would throw, preventing image generation.

---

## 10. Core Features Guaranteed to Stay On

Per the v1 scope doc, these must remain functional:

### Article Explainer Pipeline
- All `/api/story/*` routes
- `story.service.js`, `story.llm.service.js`

### Karaoke Captions
- `/api/caption/preview` (V3 raster mode)
- `/api/caption/render`

### Text-to-Speech / Voice Preview
- `/api/tts/preview`
- `/api/voice/voices`, `/api/voice/preview`
- `tts.service.js`

### Payments & Credits
- `/checkout/*` routes
- `/stripe/webhook`
- `/credits` (GET endpoint)
- `/api/users/ensure`, `/api/user/me`, `/api/user/setup`
- `credit.service.js` (includes `RENDER_CREDIT_COST = 20` and plan credit mappings)

### My Shorts Library
- `GET /api/shorts/mine`
- `GET /api/shorts/:jobId`

All other features are either non-core or explicitly disabled until after v1.

---

## 11. Manual Security Sanity Checks

Before shipping changes that touch auth/routing, run these quick checks:

### Cross-user read attempt (should fail):
In the browser console, try to manually read another user's `/users/{uid}` or `/shorts/{id}` via SDK or REST.

**Expected:** Permission denied.

### Disabled endpoints:
- `POST /enhance`
- `POST /generate`
- `POST /generate/image-to-image`
- `POST /generate/upscale`
- `GET /job/someId`
- `POST /api/assets/ai-images`

**Expected:** HTTP 410 with `{ success: false, error: "FEATURE_DISABLED", ... }` (or 404 if unmounted).

### Happy-path Article Explainer:
Run full pipeline: start → generate script → plan → search → captions → finalize.

**Confirm:**
- Render succeeds.
- Credits drop by 20.
- Result appears in My Shorts for that user only.

### Storage access:
From the browser SDK, verify you can only list/get `artifacts/{currentUid}/…` and not for another UID.

Verify shared download URLs (if you generate any) work even when logged out, but only expose that one asset.

---

## 12. Route Status Matrix

| Route | Mounted | Status | Auth Required | Notes |
|-------|---------|--------|---------------|-------|
| `/api/story/*` | ✅ | Active | Yes | Core feature |
| `/api/caption/preview` | ✅ | Active | No | Public preview |
| `/api/caption/render` | ✅ | Active | No | Public render |
| `/api/tts/preview` | ✅ | Active | Yes | Core feature |
| `/api/voice/voices` | ✅ | Active | Yes | Core feature |
| `/api/voice/preview` | ✅ | Active | Yes | Core feature |
| `/checkout/*` | ✅ | Active | Yes | Payments |
| `/stripe/webhook` | ✅ | Active | Stripe sig | Webhook |
| `/credits` | ✅ | Active | Yes | Read-only |
| `/api/users/ensure` | ✅ | Active | Yes | User setup |
| `/api/user/me` | ✅ | Active | Yes | User data |
| `/api/shorts/mine` | ✅ | Active | Yes | Read-only |
| `/api/shorts/:jobId` | ✅ | Active | Yes | Read-only |
| `/enhance` | ✅ | Disabled (410) | Yes | AI images |
| `/generate` | ✅ | Disabled (410) | Yes | AI images |
| `/job/:jobId` | ✅ | Disabled (410) | Yes | AI images |
| `/api/studio/*` | ❌ | Unmounted | N/A | Non-core |
| `/api/quotes/*` | ❌ | Unmounted | N/A | Non-core |
| `/api/assets/*` | ❌ | Unmounted | N/A | Non-core |
| `/api/preview/caption` | ❌ | Unmounted | N/A | Legacy |
| `/api/shorts/create` | ❌ | Commented | N/A | Legacy |
| `/api/shorts/:jobId` DELETE | ❌ | Commented | N/A | Optional |
| `/generate/image-to-image` | ❌ | Not mounted | N/A | Controller exists |
| `/generate/upscale` | ❌ | Not mounted | N/A | Controller exists |

---

## 13. Firestore Collections Summary

| Collection | Rules Exist | Client Read | Client Write | Server Access |
|------------|-------------|-------------|--------------|---------------|
| `users/{uid}` | ✅ | Self only | Self (no server fields) | Admin SDK |
| `users/{uid}/generations` | ✅ | Self only | Self only | Admin SDK |
| `users/{uid}/transactions` | ✅ | Self only | Blocked | Admin SDK only |
| `usersByEmail/{emailId}` | ✅ | Email match | Blocked | Admin SDK |
| `pending_credits_by_email` | ✅ | Blocked | Blocked | Admin SDK only |
| `shorts/{id}` | ✅ | Owner only | Owner only | Admin SDK |

---

## 14. Related Documentation

This document should be kept in sync with:

- `firestore.rules` - Firestore security rules
- `storage.rules` - Storage security rules
- `docs/vaiform-v1-scope.md` - Feature scope and route documentation
- `src/app.js` - Route mounting logic

**Update Process:** When any of the above files change, update this document in the same PR.

---

**End of Security Documentation**















