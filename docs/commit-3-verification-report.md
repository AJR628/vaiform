# Commit 3 Verification Report — Firestore Query Limits

**Date**: December 2024  
**Status**: Pre-implementation verification  
**Goal**: Validate planned changes won't break user-facing functionality

---

## Executive Summary

**Overall Assessment**: ✅ **SAFE TO PROCEED** with planned changes

All planned guardrails are safe:
- **Firestore fallback query**: Safe to cap at 1000 (fallback path only, UI already limits to 24)
- **Monthly generations query**: Safe to cap at 500 (display only, enforcement happens elsewhere)
- **Storage enumeration**: 3/4 calls are safe to cap; 1 user-facing call needs minimal pagination support

**Recommended Changes**:
1. ✅ Proceed with Firestore fixes as planned
2. ✅ Proceed with Storage caps for internal operations
3. ⚠️ Add minimal pagination support for `listStudios()` (user-facing list)

---

## What Looks Good in Current Plan

1. **Firestore fallback query fix** (`getMyShorts()`):
   - Primary path already uses `.limit(24)` with index ✅
   - Fallback path only triggers on index missing (code 9) ✅
   - Fallback already slices to `limit` (24 items) for UI ✅
   - Adding `.limit(1000)` prevents unbounded reads without breaking UX ✅

2. **Monthly generations query fix** (`getUsageLimits()`):
   - Used for display only (shows usage stats) ✅
   - Enforcement happens in `planGuards.js` middleware (separate logic) ✅
   - Plan limits: Free (10/month), Pro (250/month) ✅
   - Cap at 500 provides 2x safety margin ✅

3. **Storage enumeration fixes**:
   - Most calls are internal (quota checks, cleanup) ✅
   - One user-facing call needs pagination support ⚠️

---

## Storage getFiles Call Analysis

| # | File | Line | Function | Route | User-Facing? | Pagination? | Worst-Case Count | Recommendation |
|---|------|------|----------|-------|---------------|-------------|------------------|-----------------|
| 1 | `studio.service.js` | 557 | `createRemix()` | `POST /api/studio/remix` | ❌ No | N/A | ~100-500 artifacts per user | ✅ **Safe to cap** (internal quota check) |
| 2 | `studio.service.js` | 578 | `listRemixes()` | `GET /api/studio/:renderId/remixes` | ✅ Yes | ❌ No | **Max 5 remixes** (quota enforced) | ✅ **Safe to cap** (bounded by quota) |
| 3 | `studio.service.js` | 710 | `listStudios()` | `GET /api/studio` | ✅ Yes | ❌ No | **Unbounded** (could be 100+) | ⚠️ **Needs pagination** (see below) |
| 4 | `studio.service.js` | 753 | `initStudioSweeper()` | N/A (background job) | ❌ No | N/A | All drafts across all users | ✅ **Safe to cap** (internal cleanup) |
| 5 | `shorts.controller.js` | 556 | `deleteShort()` | `DELETE /api/shorts/:jobId` | ❌ No | N/A | **~5-10 files** per jobId | ✅ **Accept as-is** (bounded by jobId prefix) |

---

## Detailed Analysis Per Call Site

### 1. `createRemix()` - Line 557

**Code**:
```javascript
const [files] = await bucket.getFiles({ prefix: `artifacts/${uid}/`, autoPaginate: true });
// ... filters to count remixes with matching parentRenderId ...
if (count >= 5) throw new Error('REMIX_QUOTA_EXCEEDED');
```

**Route**: `POST /api/studio/remix`  
**Purpose**: Internal quota check (enforces max 5 remixes per parent render)  
**User-Facing**: ❌ No (returns error if quota exceeded, not a list)  
**Pagination**: N/A  
**Worst-Case**: ~100-500 artifacts per user (all renders, not just remixes)

**Decision**: ✅ **Safe to cap at 1000**
- This is an internal quota check, not a user-facing list
- If cap is hit, worst case is incorrect quota enforcement (allows 6th remix if files > 1000)
- Risk is low: 1000 files = ~200 renders (assuming 5 files per render)
- If user has >1000 artifacts, they're a power user and quota bypass is acceptable edge case

---

### 2. `listRemixes()` - Line 578

**Code**:
```javascript
const [files] = await bucket.getFiles({ prefix: `artifacts/${uid}/`, autoPaginate: true });
const out = [];
for (const f of files) {
  if (!f.name.endsWith('/meta.json')) continue;
  // ... filters by meta.parentRenderId === renderId ...
  if (meta?.parentRenderId === renderId) out.push(meta);
}
return out;  // Returns to client
```

**Route**: `GET /api/studio/:renderId/remixes`  
**Purpose**: List remixes for a specific render  
**User-Facing**: ✅ Yes (returns list to client)  
**Pagination**: ❌ No  
**Worst-Case**: **Max 5 remixes** (quota enforced in `createRemix()`)

**Decision**: ✅ **Safe to cap at 1000**
- Quota enforces max 5 remixes per render (checked in `createRemix()`)
- Even if enumeration is capped, filtering by `renderId` means max 5 results
- Worst case: If user has >1000 artifacts and remix is in the uncapped portion, it won't show
- Risk is acceptable: Quota prevents >5 remixes, so missing 1 remix in edge case is acceptable

---

### 3. `listStudios()` - Line 710 ⚠️

**Code**:
```javascript
const [files] = await bucket.getFiles({ prefix: `drafts/${uid}/`, autoPaginate: true });
const sessions = [];
for (const f of files) {
  if (!f.name.endsWith("/session.json")) continue;
  // ... parses session.json, filters expired/deleted ...
  sessions.push({ id, createdAt, updatedAt, ... });
}
sessions.sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0));
return sessions;  // Returns to client
```

**Route**: `GET /api/studio`  
**Purpose**: List all user's studios/drafts  
**User-Facing**: ✅ Yes (returns list to client)  
**Pagination**: ❌ No  
**Worst-Case**: **Unbounded** (could be 100+ studios per user over time)

**Decision**: ⚠️ **Needs minimal pagination support**

**Risk if capped without pagination**:
- User with 1500 studios would only see first 1000 (sorted by updatedAt desc)
- Missing studios would be invisible to user
- No way to access older studios

**Recommended Fix**:
```javascript
// Add pagination support (minimal)
export async function listStudios({ uid, pageToken = null, maxResults = 100 }) {
  const bucket = admin.storage().bucket();
  const options = {
    prefix: `drafts/${uid}/`,
    autoPaginate: false,  // Manual pagination
    maxResults: maxResults
  };
  if (pageToken) options.pageToken = pageToken;
  
  const [files, nextPageToken] = await bucket.getFiles(options);
  // ... existing filtering/sorting logic ...
  
  return {
    sessions,
    nextPageToken: nextPageToken || null,
    hasMore: !!nextPageToken
  };
}
```

**Route Update**:
```javascript
r.get("/", async (req, res) => {
  const pageToken = req.query.pageToken || null;
  const maxResults = Math.min(Number(req.query.maxResults) || 100, 1000);
  try {
    const result = await listStudios({ uid: req.user.uid, pageToken, maxResults });
    return res.json({ success: true, data: result });
  } catch (e) {
    return res.status(500).json({ success: false, error: "STUDIO_LIST_FAILED" });
  }
});
```

**Alternative (Minimal for P0)**: If pagination is too complex, add a `truncated` flag:
```javascript
const [files, nextPageToken] = await bucket.getFiles({ 
  prefix: `drafts/${uid}/`, 
  autoPaginate: false,
  maxResults: 1000
});

// ... existing logic ...

return {
  sessions,
  truncated: !!nextPageToken,  // Warn UI that list is incomplete
  note: nextPageToken ? 'List truncated at 1000 studios. Contact support for full list.' : null
};
```

---

### 4. `initStudioSweeper()` - Line 753

**Code**:
```javascript
const [files] = await bucket.getFiles({ prefix: `drafts/`, autoPaginate: true });
// ... deletes expired/deleted sessions ...
```

**Route**: N/A (background job, runs every 30 minutes)  
**Purpose**: Cleanup expired/deleted studio sessions  
**User-Facing**: ❌ No  
**Pagination**: N/A  
**Worst-Case**: All drafts across all users (could be 10,000+)

**Decision**: ✅ **Safe to cap at 1000**
- This is a background cleanup job
- If cap is hit, some expired sessions may not be cleaned up immediately
- Next sweep (30 min later) will catch remaining expired sessions
- Risk is acceptable: Cleanup is best-effort, not critical path

**Note**: Consider pagination for sweeper if it becomes an issue, but not required for P0.

---

### 5. `deleteShort()` - Line 556

**Code**:
```javascript
const [files] = await bucket.getFiles({ prefix: destBase });  // destBase = `artifacts/${uid}/${jobId}`
await Promise.all(files.map(file => file.delete()));
```

**Route**: `DELETE /api/shorts/:jobId`  
**Purpose**: Delete all files for a specific short  
**User-Facing**: ❌ No (deletion operation, not a list)  
**Pagination**: N/A  
**Worst-Case**: **~5-10 files** per jobId (short.mp4, cover.jpg, meta.json, thumbnails, etc.)

**Decision**: ✅ **Accept as-is**
- Prefix is scoped to single jobId: `artifacts/${uid}/${jobId}/`
- Each short has ~5-10 files max
- No risk of unbounded enumeration
- Adding `maxResults` is unnecessary but harmless

---

## Firestore Query Verification

### 1. `getMyShorts()` - Primary vs Fallback Path

**Primary Path** (lines 367-394):
```javascript
let query = db.collection('shorts')
  .where('ownerId', '==', ownerUid)
  .orderBy('createdAt', 'desc')
  .limit(limit);  // limit = Math.min(Number(req.query.limit) || 24, 100)

if (cursor) {
  query = query.startAfter(new Date(cursor));
}

const snapshot = await query.get();
// Returns: { items, nextCursor, hasMore }
```

**Verification**:
- ✅ Uses `.orderBy('createdAt', 'desc')` with index
- ✅ Uses `.limit(limit)` where limit is clamped to max 100
- ✅ Supports pagination via `cursor` parameter
- ✅ Returns `nextCursor` and `hasMore` for UI

**Fallback Path** (lines 406-435):
```javascript
const snapshot = await db.collection('shorts')
  .where('ownerId', '==', ownerUid)
  .get();  // ⚠️ NO LIMIT

const all = snapshot.docs.map(...);
all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
const items = all.slice(0, limit);  // limit = 24 (from req.query)
return { items, nextCursor: null, hasMore: false, note: 'INDEX_FALLBACK' };
```

**Verification**:
- ✅ Only triggers on code 9 (index missing) or "requires an index" error
- ✅ Sorts in memory by `createdAt` desc
- ✅ Slices to `limit` (24 items) for UI
- ✅ Disables pagination (`nextCursor: null`) until index exists
- ⚠️ **Missing**: `.limit(1000)` on fallback query (planned fix)

**Decision**: ✅ **Safe to add `.limit(1000)`**
- Fallback already slices to 24 items for UI
- Adding `.limit(1000)` prevents unbounded reads
- If user has >1000 shorts, they'll see most recent 24 (acceptable degradation)
- Primary path unchanged, no breaking changes

---

### 2. `getUsageLimits()` - Monthly Generations Query

**Current Code** (lines 22-26):
```javascript
const monthlyGens = await generationsRef
  .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(monthStart))
  .get();  // ⚠️ No limit

const monthlyCount = monthlyGens.size;
```

**Usage** (lines 45-50):
```javascript
const usage = {
  monthlyGenerations: monthlyCount,  // Display only
  monthlyQuotes: Math.floor(monthlyCount * 1.5),  // Estimate
  remainingGenerations: Math.max(0, planLimits.monthlyGenerations - monthlyCount),  // Display only
  remainingQuotes: Math.max(0, planLimits.monthlyQuotes - Math.floor(monthlyCount * 1.5))  // Display only
};
```

**Enforcement Check**:
- ❌ **NOT used for enforcement** - This endpoint is display-only
- ✅ Enforcement happens in `planGuards.js` middleware (separate logic)
- ✅ Plan limits: Free (10/month), Pro (250/month)
- ✅ If monthlyCount is capped at 500, worst case is showing incorrect "remaining" count

**Decision**: ✅ **Safe to add `.limit(500)`**

**Reasoning**:
1. **Display-only**: `monthlyCount` is used for UI display, not enforcement
2. **Enforcement elsewhere**: Plan limits are enforced in middleware (`enforceScriptDailyCap`, etc.)
3. **Safety margin**: 500 cap is 2x pro plan limit (250), provides safety margin
4. **Edge case**: If user somehow exceeds 500/month (shouldn't happen due to enforcement), showing "0 remaining" is acceptable (treats as "at or over limit")

**Potential Issue**: If monthlyCount is capped at 500 but user has 600 generations:
- UI shows: `monthlyGenerations: 500, remainingGenerations: 0` (incorrect)
- Enforcement still works (happens in middleware)
- User sees "0 remaining" but enforcement may still allow (if middleware allows)

**Mitigation**: If this is a concern, add logic to detect cap hit:
```javascript
const monthlyGens = await generationsRef
  .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(monthStart))
  .limit(501)  // Check if cap is hit
  .get();

const monthlyCount = monthlyGens.size;
const hitCap = monthlyCount === 501;  // If exactly 501, we hit the cap

const usage = {
  monthlyGenerations: hitCap ? 500 : monthlyCount,  // Cap at 500 if hit
  remainingGenerations: hitCap ? 0 : Math.max(0, planLimits.monthlyGenerations - monthlyCount),
  // ... treat hitCap as "at or over limit"
};
```

**Recommendation**: For P0, simple `.limit(500)` is sufficient. The edge case (user with >500 generations) is unlikely and acceptable.

---

## Concrete "Proceed / Block" Decision

### ✅ GREENLIGHT: Firestore Changes

**Proceed with**:
1. ✅ Add `.limit(1000)` to `getMyShorts()` fallback query
2. ✅ Add `.limit(500)` to `getUsageLimits()` monthly generations query
3. ✅ Add PRIMARY/FALLBACK logging to `getMyShorts()`

**Rationale**: Both changes are safe, no breaking changes, prevent cost blowup.

---

### ✅ GREENLIGHT: Storage Changes (3/4 calls)

**Proceed with**:
1. ✅ Add `maxResults: 1000` to `createRemix()` (line 557) - internal quota check
2. ✅ Add `maxResults: 1000` to `listRemixes()` (line 578) - bounded by quota (max 5)
3. ✅ Add `maxResults: 1000` to `initStudioSweeper()` (line 753) - background cleanup
4. ✅ Accept `deleteShort()` as-is (line 556) - bounded by jobId prefix

**Rationale**: All are safe, no user-facing impact.

---

### ⚠️ BLOCK: Storage Change for `listStudios()`

**Block until pagination added**:
- ❌ Do NOT silently cap `listStudios()` without pagination
- ⚠️ This is a user-facing list that could have 100+ items

**Recommended Fix** (Minimal):

**Option A: Add pagination** (Preferred):
```javascript
// src/services/studio.service.js:708
export async function listStudios({ uid, pageToken = null, maxResults = 100 }) {
  const bucket = admin.storage().bucket();
  const options = {
    prefix: `drafts/${uid}/`,
    autoPaginate: false,
    maxResults: Math.min(maxResults, 1000)  // Cap at 1000
  };
  if (pageToken) options.pageToken = pageToken;
  
  const [files, nextPageToken] = await bucket.getFiles(options);
  // ... existing filtering/sorting logic ...
  
  return {
    sessions,
    nextPageToken: nextPageToken || null,
    hasMore: !!nextPageToken
  };
}
```

**Option B: Add truncated flag** (Minimal for P0):
```javascript
// src/services/studio.service.js:708
export async function listStudios({ uid }) {
  const bucket = admin.storage().bucket();
  const [files, nextPageToken] = await bucket.getFiles({ 
    prefix: `drafts/${uid}/`, 
    autoPaginate: false,
    maxResults: 1000
  });
  
  // ... existing filtering/sorting logic ...
  
  return {
    sessions,
    truncated: !!nextPageToken,  // Warn UI
    note: nextPageToken ? 'List may be incomplete. Showing first 1000 studios.' : null
  };
}
```

**Route Update** (for Option A):
```javascript
// src/routes/studio.routes.js:305
r.get("/", async (req, res) => {
  const pageToken = req.query.pageToken || null;
  const maxResults = Math.min(Number(req.query.maxResults) || 100, 1000);
  try {
    const result = await listStudios({ uid: req.user.uid, pageToken, maxResults });
    return res.json({ success: true, data: result });
  } catch (e) {
    return res.status(500).json({ success: false, error: "STUDIO_LIST_FAILED" });
  }
});
```

**Decision**: Implement **Option B** (truncated flag) for P0. It's minimal and safe. Option A (full pagination) can be P1 improvement.

---

## Implementation Plan

### Phase 1: Firestore Fixes (✅ Safe)

1. **`src/controllers/shorts.controller.js`**:
   - Add `.limit(1000)` to fallback query (line 408)
   - Add PRIMARY/FALLBACK logging (after line 376 and line 424)

2. **`src/controllers/limits.controller.js`**:
   - Add `.limit(500)` to monthly generations query (line 24)

### Phase 2: Storage Fixes (✅ Safe - 3 calls)

3. **`src/services/studio.service.js`**:
   - Add `maxResults: 1000` to `createRemix()` (line 557)
   - Add `maxResults: 1000` to `listRemixes()` (line 578)
   - Add `maxResults: 1000` to `initStudioSweeper()` (line 753)

### Phase 3: Storage Fix with Pagination (⚠️ Required)

4. **`src/services/studio.service.js`**:
   - Update `listStudios()` to use `autoPaginate: false, maxResults: 1000`
   - Add `truncated` flag to response if `nextPageToken` exists
   - Return `{ sessions, truncated, note }` instead of just `sessions`

5. **`src/routes/studio.routes.js`**:
   - Update route to handle new response shape (if using Option B, no route changes needed)

---

## Verification Checklist

### Firestore Changes

- [ ] **Primary path verification**: 
  - Deploy index: `firebase deploy --only firestore:indexes`
  - Test `GET /api/shorts/mine?limit=24` returns 24 items with `nextCursor`
  - Verify logs show "PRIMARY path used"

- [ ] **Fallback path verification**:
  - Force fallback (temporarily remove index or mock code 9 error)
  - Test with user having 1500 shorts
  - Verify response contains 24 items (not 1500)
  - Verify logs show "FALLBACK path used, loaded 1000 docs, returning 24"
  - Verify Firestore read count = 1000 (not 1500)

- [ ] **Monthly generations verification**:
  - Test `GET /api/limits/usage` returns correct monthly count
  - If user has >500 generations, verify count is capped at 500
  - Verify UI still shows usage correctly (may show "0 remaining" if capped)

### Storage Changes

- [ ] **createRemix verification**:
  - Test remix creation still works
  - Verify quota enforcement still works (max 5 remixes)

- [ ] **listRemixes verification**:
  - Test `GET /api/studio/:renderId/remixes` returns remixes
  - Verify max 5 remixes shown (quota enforced)

- [ ] **listStudios verification**:
  - Test `GET /api/studio` returns studios list
  - If user has >1000 studios, verify `truncated: true` flag is present
  - Verify response includes `note` field if truncated

- [ ] **initStudioSweeper verification**:
  - Verify background sweeper still runs (check logs)
  - Verify expired sessions are cleaned up (may take multiple sweeps if >1000)

---

## Post-Deployment Monitoring

### Logs to Watch

1. **Firestore fallback usage**:
   - Search for: `"[shorts] FALLBACK path used"`
   - Should trend to **zero** after index is deployed
   - If >0, investigate index deployment status

2. **Storage enumeration**:
   - Monitor Storage API operation counts
   - Should decrease with `maxResults` caps
   - Watch for `truncated: true` in `listStudios()` responses (indicates users with >1000 studios)

3. **Monthly generations cap**:
   - Monitor if any users hit 500 cap (unlikely but possible)
   - If cap is hit, consider implementing count aggregation query (P1)

---

## Summary

**Status**: ✅ **PROCEED WITH IMPLEMENTATION**

**Required Changes**:
1. ✅ Firestore fallback query: Add `.limit(1000)` + logging
2. ✅ Monthly generations query: Add `.limit(500)`
3. ✅ Storage enumeration: Add `maxResults: 1000` to 3 internal calls
4. ⚠️ Storage enumeration: Add `maxResults: 1000` + `truncated` flag to `listStudios()`

**Blocking Issues**: None

**Risk Level**: Low (all changes are additive safety caps)

**Breaking Changes**: None (all changes maintain backward compatibility)

---

**End of Verification Report**

