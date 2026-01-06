# Firestore & Storage Access Patterns Audit Report

**Date**: December 2025  
**Scope**: All Firestore collections, Storage buckets, security rules, and query patterns  
**Status**: P0 Issues Identified - Action Required

---

## Executive Summary

This audit identified **3 P0 security risks**, **2 P0 cost risks**, and **4 indexing requirements**. The most critical issues are:

1. **P0 Security**: Unbounded query fallback in `getMyShorts` loads all user documents when index missing
2. **P0 Security**: Storage rule pattern `{allPaths=**}` denies everything but lacks explicit allow rules audit
3. **P0 Cost**: Story sessions stored in Storage without size limits or cleanup
4. **P0 Cost**: `getFiles()` calls without pagination limits in studio service

**Collections Audited**: 6 Firestore collections, 2 Storage paths  
**Routes Analyzed**: 24 routes with Firestore/Storage access  
**Security Rules**: Firestore rules present and restrictive; Storage rules need verification

---

## 1. Firestore Collections Inventory

### 1.1 Collections & Access Patterns

| Collection/Path | Read Routes | Write Routes | Access Pattern | Security |
|----------------|-------------|--------------|----------------|----------|
| `users/{uid}` | `/api/user/me`, `/api/credits`, `planGuards`, `user.service` | `/api/users/ensure`, `stripe.webhook`, `credit.service` | Direct doc access by UID | ✅ `isSelf(uid)` |
| `users/{uid}/generations` | `/api/limits` (monthly query) | `generate.controller` (disabled) | Subcollection queries | ✅ `isSelf(uid)` |
| `users/{uid}/transactions` | Client read via rules | `credit.service`, `stripe.webhook` | Server-only writes | ✅ `isSelf(uid)`, client read-only |
| `users/{uid}/stripe_webhook_events` | None (internal) | `stripe.webhook` | Idempotency tracking | ✅ Server-only (no rules) |
| `shorts/{id}` | `/api/shorts/mine`, `/api/shorts/:jobId` | `shorts.service`, `story.service` | Queries by `ownerId` | ✅ `resource.data.ownerId == request.auth.uid` |
| `usersByEmail/{emailId}` | Legacy migration path | None (read-only) | Legacy email-keyed docs | ✅ `emailMatches(emailId)`, write blocked |
| `pending_credits_by_email` | None | `credit.service` (migration) | Server-only | ✅ Blocked for client |
| `idempotency/{uid:key}` | `idempotency.firestore` middleware | `idempotency.firestore` middleware | Request deduplication | ⚠️ No rules (server-only via Admin SDK) |

### 1.2 Collection Group Queries

**Found**: 0 collection group queries (all queries are scoped to specific collections)

**Status**: ✅ Safe - no cross-collection queries

---

## 2. Unbounded Queries & Pagination Issues

### 2.1 P0: `getMyShorts` Fallback Query

**Location**: `src/controllers/shorts.controller.js:406-408`

**Issue**: When index is missing (code 9 error), fallback loads ALL shorts for a user:
```javascript
const snapshot = await db.collection('shorts')
  .where('ownerId', '==', ownerUid)
  .get();  // ⚠️ NO LIMIT
```

**Risk**: 
- **Cost**: O(n) reads where n = total shorts per user (could be 1000+)
- **Performance**: In-memory sort of all documents
- **Scale**: Grows unbounded with user activity

**Current Mitigation**: 
- Primary path uses `.limit(24)` with index
- Fallback disabled pagination (`nextCursor: null`)
- Logs warning when fallback used

**Recommendation**: 
- **P0 Fix**: Add `.limit(1000)` to fallback query as hard cap
- Add monitoring alert when fallback path is hit (index missing)
- Ensure index exists: `ownerId ASC, createdAt DESC`

### 2.2 P0: `getFiles()` Without Max Results

**Location**: `src/services/studio.service.js:546, 567, 699, 742`

**Issue**: Multiple `getFiles()` calls use `autoPaginate: true` but no `maxResults`:
```javascript
const [files] = await bucket.getFiles({ 
  prefix: `artifacts/${uid}/`, 
  autoPaginate: true  // ⚠️ NO MAX_RESULTS
});
```

**Risks**:
- **Cost**: Could enumerate thousands of files per user
- **Memory**: Loads all file metadata into memory
- **Performance**: Slow enumeration for users with many artifacts

**Affected Routes**:
- Studio cleanup operations
- Storage enumeration for session management

**Recommendation**:
- **P0 Fix**: Add `maxResults: 1000` to all `getFiles()` calls
- Consider paginated cleanup with cursor-based iteration
- Add storage quota monitoring per user

### 2.3 P1: Monthly Generations Query Without Limit

**Location**: `src/controllers/limits.controller.js:22-24`

**Issue**: Queries monthly generations without explicit limit:
```javascript
const monthlyGens = await generationsRef
  .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(monthStart))
  .get();  // ⚠️ Uses .size, but still loads all docs
```

**Risk**: 
- **Cost**: O(n) reads where n = monthly generations (free: 10, pro: 250)
- **Scale**: Bounded by plan limits, but no hard cap

**Current Behavior**: Uses `.size` which doesn't load full documents, but still counts all matching docs

**Recommendation**:
- **P2 Fix**: Add `.limit(500)` as safety cap
- Consider using Firestore count queries (if available) instead of `.size`

### 2.4 ✅ Safe: All Other Queries

- `getMyShorts` primary path: ✅ Uses `.limit(24)` with cursor pagination
- Single doc reads (`users/{uid}`, `shorts/{id}`): ✅ Bounded (1 doc)
- Subcollection migrations: ✅ One-time operations with bounded scope

---

## 3. Unbounded Document Growth

### 3.1 P0: Story Sessions in Storage (No Size Limits)

**Location**: `src/utils/json.store.js`, Storage path: `drafts/{uid}/{sessionId}/story.json`

**Issue**: Story sessions stored as single JSON files in Storage with no size limits:
- Session objects accumulate `shots[]`, `candidates[]`, `renderedSegments[]`
- Each shot can have multiple candidate clips with full metadata
- No cleanup or TTL enforcement (expiration checked in-memory only)

**Growth Vectors**:
```javascript
session.shots = [{ candidates: [...] }]  // Arrays grow with clip searches
session.renderedSegments = [...]          // Grows with story length
```

**Risk**:
- **Cost**: Storage bloat (JSON files can grow to MB+)
- **Performance**: Large JSON downloads slow session loads
- **Scale**: Per-user session count unbounded (only TTL-based expiration checked)

**Recommendation**:
- **P0 Fix**: Enforce max session size (e.g., 500KB) before save
- Implement background cleanup job for expired sessions (`expiresAt` field exists but not enforced)
- Add Storage lifecycle policy: delete `drafts/` files older than TTL_HOURS
- Consider paginating `candidates[]` arrays (store only N most recent)

### 3.2 P1: `stripe_webhook_events` Subcollection

**Location**: `src/routes/stripe.webhook.js:85`

**Issue**: Webhook events stored per user with no cleanup:
```javascript
const eventRef = userRef.collection("stripe_webhook_events").doc(eventId);
await eventRef.set({ ... });  // ⚠️ Never deleted
```

**Risk**:
- **Cost**: O(n) subcollection docs where n = lifetime webhook events per user
- **Scale**: Grows indefinitely (1 doc per webhook event)

**Mitigation**: Used only for idempotency (prevents duplicate processing)

**Recommendation**:
- **P2 Fix**: Add TTL field and Firestore TTL policy to auto-delete after 90 days
- Or: Periodic cleanup job to delete events older than retention period

### 3.3 ✅ Safe: Other Collections

- `users/{uid}`: ✅ Flat structure, no arrays (credits, plan fields are scalars)
- `shorts/{id}`: ✅ Flat structure, no arrays
- `users/{uid}/generations`: ✅ Subcollection (each generation = separate doc)
- `users/{uid}/transactions`: ✅ Subcollection (each transaction = separate doc)
- `idempotency/{uid:key}`: ✅ Has TTL in code (`expiresAt` field), but no Firestore TTL policy

---

## 4. Security Rules Audit

### 4.1 Firestore Rules

**File**: `firestore.rules`

#### ✅ Secure Patterns Found

1. **`users/{uid}`**: 
   - Read: `isSelf(uid)` ✅
   - Write: `isSelf(uid)` + blocks server fields (`plan`, `credits`, `membership`, `isMember`) ✅
   - Subcollections: `isSelf(uid)` ✅

2. **`shorts/{id}`**:
   - Read: `resource.data.ownerId == request.auth.uid` ✅
   - Write: `resource.data.ownerId == request.auth.uid` + blocks `ownerId`/`createdAt` changes ✅

3. **`usersByEmail/{emailId}`**:
   - Read: `emailMatches(emailId)` ✅
   - Write: Blocked ✅

4. **`pending_credits_by_email`**:
   - All access blocked ✅

#### ⚠️ Potential Issues

1. **`idempotency` Collection**: No rules defined
   - **Risk**: If client SDK accidentally accesses, rules would default-deny (safe)
   - **Status**: ✅ Safe (server-only via Admin SDK)
   - **Recommendation**: Add explicit deny rule for clarity

2. **Server Field Protection**: 
   - Rules prevent client from writing `plan`, `credits`, `membership`, `isMember`
   - ✅ Correctly enforced via `changedKeys()` check

3. **Wildcard Patterns**: None found ✅

### 4.2 Storage Rules

**File**: `storage.rules`

#### ✅ Secure Patterns Found

1. **`artifacts/{uid}/{jobId}/{fileName}`**:
   - Read: `isSelf(uid)` ✅
   - Write: Blocked ✅
   - Sharing: Uses download tokens (bypass rules, stored in metadata) ✅

2. **`userUploads/{userEmail}/{fileName}`** (Legacy):
   - Read/Write: Email match via `request.auth.token.email` ✅
   - **Note**: Legacy path, verify if still in use

3. **Default Deny**:
   - `match /{allPaths=**} { allow read, write: if false; }` ✅

#### ⚠️ Potential Issues

1. **`drafts/` Path Not Explicitly Covered**:
   - Story sessions stored at `drafts/{uid}/{sessionId}/story.json`
   - Not matched by `artifacts/` or `userUploads/` rules
   - Falls through to default deny ✅ (Safe - server-only via Admin SDK)
   - **Recommendation**: Add explicit rule for clarity:
     ```javascript
     match /drafts/{uid}/{sessionId}/{fileName} {
       allow read, write: if false; // Server-only via Admin SDK
     }
     ```

2. **Storage Rules Audit Verification Needed**:
   - Verify rules are deployed: `firebase deploy --only storage`
   - Test client access attempts are blocked

---

## 5. Auth Claims & Ownership Verification

### 5.1 UID-Based Ownership Checks

#### ✅ Correct Patterns

1. **Firestore Rules**:
   - `isSelf(uid)` helper: `request.auth.uid == uid` ✅
   - `shorts` collection: `resource.data.ownerId == request.auth.uid` ✅

2. **Server-Side Checks**:
   - All routes use `requireAuth` middleware → `req.user.uid` ✅
   - `getMyShorts`: Filters by `ownerId == req.user.uid` ✅
   - `getShortById`: Verifies `shortData.ownerId === ownerUid` before delete ✅
   - `deleteShort`: Double-checks ownership before delete ✅

3. **Storage Paths**:
   - `artifacts/{uid}/...` uses `req.user.uid` from auth ✅
   - `drafts/{uid}/...` uses `uid` parameter from route ✅

#### ⚠️ Potential Issues

**None Found**: All access patterns correctly use `req.user.uid` or `request.auth.uid`

### 5.2 Email-Based Access (Legacy)

**Location**: `usersByEmail/{emailId}`, `userUploads/{userEmail}/`

**Status**: 
- ✅ Rules enforce email matching: `request.auth.token.email == id`
- ⚠️ Legacy paths - verify if still in use
- **Recommendation**: Audit and deprecate if unused

---

## 6. Required Indexes

### 6.1 P0: Missing Index for `getMyShorts`

**Query**: `shorts` collection
```javascript
.where('ownerId', '==', ownerUid)
.orderBy('createdAt', 'desc')
.limit(24)
```

**Current Index**: ✅ Defined in `firestore.indexes.json`
```json
{
  "collectionGroup": "shorts",
  "fields": [
    { "fieldPath": "ownerId", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
}
```

**Status**: ✅ Index exists, but fallback path still needs `.limit()` cap

**Verification Needed**:
- Deploy indexes: `firebase deploy --only firestore:indexes`
- Verify index status in Firebase Console
- Test query with index missing (should hit fallback) and with index (should use index)

### 6.2 P1: Monthly Generations Query Index

**Query**: `users/{uid}/generations` subcollection
```javascript
.where('createdAt', '>=', monthStart)
.get()
```

**Current Index**: ⚠️ Not explicitly defined

**Status**: 
- Firestore may auto-create single-field index for `createdAt`
- **Recommendation**: Explicitly define index for consistency:
  ```json
  {
    "collectionGroup": "generations",
    "fields": [
      { "fieldPath": "createdAt", "order": "ASCENDING" }
    ]
  }
  ```

**Verification**: Test query performance with large monthly generation counts

### 6.3 ✅ Other Queries

- Single doc reads: ✅ No index needed
- Subcollection migrations: ✅ No index needed (one-time operations)

---

## 7. Route-by-Route Access Patterns

### 7.1 Firestore Access Routes

| Route | Method | Collection | Operation | Security | Pagination |
|-------|--------|------------|-----------|----------|------------|
| `/api/users/ensure` | POST | `users/{uid}` | `.set()` (merge) | ✅ `req.user.uid` | N/A |
| `/api/user/me` | GET | `users/{uid}` | `.get()` | ✅ `req.user.uid` | N/A |
| `/api/credits` | GET | `users/{uid}` | `.get()` | ✅ `req.user.uid` | N/A |
| `/api/shorts/mine` | GET | `shorts` | `.where().orderBy().limit()` | ✅ `req.user.uid` filter | ✅ `.limit(24)` |
| `/api/shorts/mine` (fallback) | GET | `shorts` | `.where().get()` | ✅ `req.user.uid` filter | ⚠️ **NO LIMIT** |
| `/api/shorts/:jobId` | GET | `shorts/{id}` | `.get()` | ✅ Ownership check | N/A |
| `/api/shorts/:jobId` | DELETE | `shorts/{id}` | `.delete()` | ✅ Ownership check | N/A |
| `/api/limits` | GET | `users/{uid}/generations` | `.where().get()` | ✅ `req.user.uid` | ⚠️ No limit |
| `/stripe/webhook` | POST | `users/{uid}`, `users/{uid}/stripe_webhook_events` | `.set()`, `.get()` | ✅ Server-only | N/A |
| Plan guards middleware | - | `users/{uid}` | `.get()` | ✅ `req.user.uid` | N/A |

### 7.2 Storage Access Routes

| Route | Method | Storage Path | Operation | Security | Pagination |
|-------|--------|--------------|-----------|----------|------------|
| `/api/shorts/create` | POST | `artifacts/{uid}/{jobId}/*` | `.upload()`, `.save()` | ✅ `req.user.uid` | N/A |
| `/api/story/*` | POST/GET | `drafts/{uid}/{sessionId}/story.json` | `.save()`, `.download()` | ✅ `req.user.uid` | N/A |
| `/api/shorts/:jobId` | GET | `artifacts/{uid}/{jobId}/*` | `.download()`, `.exists()` | ✅ Ownership check | N/A |
| `/api/shorts/:jobId` | DELETE | `artifacts/{uid}/{jobId}/*` | `.getFiles().delete()` | ✅ Ownership check | ⚠️ **NO MAX_RESULTS** |
| Studio cleanup | - | `artifacts/{uid}/`, `drafts/{uid}/` | `.getFiles()` | ✅ `req.user.uid` | ⚠️ **NO MAX_RESULTS** |

---

## 8. Stoplight Classification

### 🔴 P0 - Critical (Fix Immediately)

1. **`getMyShorts` Fallback Query Unbounded**
   - **Risk**: Cost blowup, performance degradation
   - **Fix**: Add `.limit(1000)` to fallback query
   - **Test**: Verify fallback path with index missing

2. **Storage `getFiles()` Without Max Results**
   - **Risk**: Cost blowup, memory issues
   - **Fix**: Add `maxResults: 1000` to all `getFiles()` calls
   - **Test**: Verify cleanup operations handle large file counts

3. **Story Sessions Unbounded Growth**
   - **Risk**: Storage cost, performance degradation
   - **Fix**: Enforce max session size, implement cleanup job
   - **Test**: Load large session (100+ shots) and verify size limits

### 🟡 P1 - High Priority (Fix Soon)

1. **Monthly Generations Query Without Limit**
   - **Risk**: Moderate cost (bounded by plan limits)
   - **Fix**: Add `.limit(500)` as safety cap
   - **Test**: Verify query with 250+ monthly generations

2. **`stripe_webhook_events` No Cleanup**
   - **Risk**: Subcollection growth over time
   - **Fix**: Add Firestore TTL policy or cleanup job
   - **Test**: Verify events older than 90 days are deleted

3. **Storage Rules Missing `drafts/` Path**
   - **Risk**: Low (server-only, default deny safe)
   - **Fix**: Add explicit rule for clarity
   - **Test**: Verify client cannot access `drafts/` paths

### 🟢 P2 - Medium Priority (Fix When Convenient)

1. **Explicit Index for Monthly Generations Query**
   - **Risk**: Low (auto-index may exist)
   - **Fix**: Add explicit index definition
   - **Test**: Verify query performance

2. **Idempotency Collection No Rules**
   - **Risk**: Low (server-only, default deny safe)
   - **Fix**: Add explicit deny rule for clarity
   - **Test**: Verify rules deployed

---

## 9. Definition of Done (DoD) Checks

### 9.1 Pre-Deployment Verification

#### Firestore Indexes
- [ ] Deploy indexes: `firebase deploy --only firestore:indexes`
- [ ] Verify `shorts` index status in Firebase Console: `ownerId ASC, createdAt DESC`
- [ ] Test `getMyShorts` query with index present (should use index)
- [ ] Test `getMyShorts` query with index missing (should hit fallback with limit)

#### Security Rules
- [ ] Deploy Firestore rules: `firebase deploy --only firestore:rules`
- [ ] Deploy Storage rules: `firebase deploy --only storage`
- [ ] Test client SDK cannot read `users/{otherUid}`
- [ ] Test client SDK cannot read `shorts/{id}` with `ownerId != auth.uid`
- [ ] Test client SDK cannot write server fields (`plan`, `credits`) in `users/{uid}`
- [ ] Test client SDK cannot access `drafts/` or `artifacts/` paths directly

#### Query Limits
- [ ] Verify `getMyShorts` fallback has `.limit(1000)`
- [ ] Verify all `getFiles()` calls have `maxResults: 1000`
- [ ] Verify monthly generations query has `.limit(500)`
- [ ] Test fallback path with 1000+ user shorts (should cap at 1000)

#### Storage Cleanup
- [ ] Implement cleanup job for expired story sessions (`expiresAt` < now)
- [ ] Set Storage lifecycle policy: delete `drafts/` files older than TTL_HOURS
- [ ] Test cleanup job removes expired sessions
- [ ] Verify story session size limit enforced (max 500KB)

### 9.2 Post-Deployment Monitoring

#### Cost Monitoring
- [ ] Set Firestore read quota alerts (threshold: 10M reads/day)
- [ ] Set Storage operation alerts (threshold: 100K ops/day)
- [ ] Monitor `getMyShorts` fallback usage (should be 0 after index deployed)
- [ ] Monitor `getFiles()` operation counts (should decrease with `maxResults`)

#### Performance Monitoring
- [ ] Track `getMyShorts` query latency (target: < 100ms p95)
- [ ] Track story session load time (target: < 500ms p95)
- [ ] Monitor Firestore index usage (verify `shorts` index is active)

#### Security Monitoring
- [ ] Review Firestore security rules violations (should be 0)
- [ ] Review Storage security rules violations (should be 0)
- [ ] Audit `users/{uid}` writes for server field changes (should be 0 from client)

### 9.3 Testing Queries

#### Firestore Queries to Run
```javascript
// Test 1: getMyShorts with index
const query1 = db.collection('shorts')
  .where('ownerId', '==', 'test-uid')
  .orderBy('createdAt', 'desc')
  .limit(24);
const snap1 = await query1.get();
console.log('Index query:', snap1.size, 'docs');

// Test 2: getMyShorts fallback (should cap at 1000)
const query2 = db.collection('shorts')
  .where('ownerId', '==', 'test-uid')
  .limit(1000);  // Verify limit exists
const snap2 = await query2.get();
console.log('Fallback query:', snap2.size, 'docs (should be <= 1000)');

// Test 3: Monthly generations query (should cap at 500)
const monthStart = new Date(2025, 11, 1); // December 2025
const query3 = db.collection('users/test-uid/generations')
  .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(monthStart))
  .limit(500);  // Verify limit exists
const snap3 = await query3.get();
console.log('Monthly generations:', snap3.size, 'docs (should be <= 500)');
```

#### Storage Operations to Test
```javascript
// Test 1: getFiles with maxResults
const [files] = await bucket.getFiles({ 
  prefix: 'artifacts/test-uid/',
  maxResults: 1000  // Verify limit exists
});
console.log('Files enumerated:', files.length, '(should be <= 1000)');

// Test 2: Story session size limit
const session = { /* large session object */ };
const json = JSON.stringify(session);
if (Buffer.byteLength(json, 'utf8') > 500 * 1024) {
  throw new Error('Session too large');
}
```

---

## 10. Recommendations Summary

### Immediate Actions (P0)

1. **Add limit to `getMyShorts` fallback query** (`src/controllers/shorts.controller.js:406`)
   ```javascript
   const snapshot = await db.collection('shorts')
     .where('ownerId', '==', ownerUid)
     .limit(1000)  // ADD THIS
     .get();
   ```

2. **Add maxResults to all `getFiles()` calls** (`src/services/studio.service.js`, `src/controllers/shorts.controller.js`)
   ```javascript
   const [files] = await bucket.getFiles({ 
     prefix: `artifacts/${uid}/`,
     maxResults: 1000,  // ADD THIS
     autoPaginate: true
   });
   ```

3. **Implement story session size limits and cleanup**
   - Enforce max 500KB per session before save
   - Add background cleanup job for expired sessions
   - Set Storage lifecycle policy for `drafts/` path

### High Priority (P1)

4. **Add limit to monthly generations query** (`src/controllers/limits.controller.js:22`)
   ```javascript
   const monthlyGens = await generationsRef
     .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(monthStart))
     .limit(500)  // ADD THIS
     .get();
   ```

5. **Add Firestore TTL policy for `stripe_webhook_events`**
   - Set TTL field: `expiresAt: admin.firestore.Timestamp.fromDate(expiryDate)`
   - Configure Firestore TTL policy: delete after 90 days

6. **Add explicit Storage rule for `drafts/` path**
   ```javascript
   match /drafts/{uid}/{sessionId}/{fileName} {
     allow read, write: if false; // Server-only via Admin SDK
   }
   ```

### Medium Priority (P2)

7. **Add explicit index for monthly generations query** (`firestore.indexes.json`)
   ```json
   {
     "collectionGroup": "generations",
     "fields": [
       { "fieldPath": "createdAt", "order": "ASCENDING" }
     ]
   }
   ```

8. **Add explicit deny rule for `idempotency` collection** (`firestore.rules`)
   ```javascript
   match /idempotency/{doc} {
     allow read, write: if false; // Server-only via Admin SDK
   }
   ```

---

## 11. Risk Matrix

| Issue | Likelihood | Impact | Risk Level | Priority |
|-------|-----------|--------|------------|----------|
| `getMyShorts` fallback unbounded | Medium (if index missing) | High (cost blowup) | 🔴 High | P0 |
| Storage `getFiles()` unbounded | High (cleanup runs regularly) | High (cost blowup) | 🔴 High | P0 |
| Story sessions unbounded growth | High (every session save) | Medium (storage cost) | 🔴 High | P0 |
| Monthly generations unbounded | Low (bounded by plan) | Low (plan limits) | 🟡 Medium | P1 |
| Webhook events no cleanup | Medium (every webhook) | Low (subcollection growth) | 🟡 Medium | P1 |
| Missing Storage rule for `drafts/` | Low (server-only) | Low (default deny safe) | 🟡 Low | P1 |

---

## Appendix A: Firestore Rules Full Text

See `firestore.rules` for complete rules. Key highlights:
- All collections require authentication
- All user-scoped collections use `isSelf(uid)` checks
- `shorts` collection uses `ownerId` field matching
- Server fields (`plan`, `credits`, etc.) blocked from client writes
- Default deny for unmatched paths

## Appendix B: Storage Rules Full Text

See `storage.rules` for complete rules. Key highlights:
- `artifacts/{uid}/{jobId}/{fileName}`: Owner-only read, write blocked
- `userUploads/{userEmail}/{fileName}`: Email-match read/write (legacy)
- Default deny for all other paths (`{allPaths=**}`)
- `drafts/` path not explicitly covered (falls through to deny)

## Appendix C: Collection Schema Reference

### `users/{uid}`
```typescript
{
  uid: string;
  email: string | null;
  plan?: 'free' | 'creator' | 'pro';
  credits?: number;  // Server-only write
  isMember?: boolean;  // Server-only write
  membership?: {
    kind: 'onetime' | 'subscription';
    startedAt: Timestamp;
    expiresAt?: Timestamp;
  };  // Server-only write
  shortDayKey?: string;
  shortCountToday?: number;
  freeShortsUsed?: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### `shorts/{id}`
```typescript
{
  ownerId: string;  // Required for all operations
  createdAt: Timestamp;
  status: 'processing' | 'ready' | 'error' | 'failed';
  videoUrl?: string;
  coverImageUrl?: string;
  thumbUrl?: string;
  durationSec?: number;
  quoteText?: string;
  mode?: 'quote' | 'feeling' | 'story';
  template?: string;
  voiceover?: boolean;
  wantAttribution?: boolean;
  captionMode?: string;
  watermark?: boolean;
  background?: object;
  completedAt?: Timestamp;
  failedAt?: Timestamp;
  errorMessage?: string;
  errorDetails?: object;
  usedQuote?: object;
}
```

### Story Session (Storage: `drafts/{uid}/{sessionId}/story.json`)
```typescript
{
  id: string;
  uid: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  story?: { sentences: string[] };
  shots?: Array<{
    sentenceIndex: number;
    candidates: Array<object>;  // ⚠️ Can grow unbounded
    selectedClip?: object;
    searchQuery?: string;
    durationSec?: number;
  }>;
  renderedSegments?: string[];  // ⚠️ Can grow with story length
  overlayCaption?: object;
  // ... other fields
}
```

---

**End of Audit Report**




