# Commit 3 Audit — Firestore Query Limits

**Date**: December 2024  
**Scope**: Unbounded Firestore queries causing cost blowup risk  
**Status**: Pre-implementation audit + action plan  
**Priority**: P0 (Launch Risk)

---

## Executive Summary

This audit identifies **1 P0 unbounded query** and **1 P1 unbounded query** in the Firestore codebase that could cause cost blowup under specific failure conditions.

### Findings Overview

| Risk Level | Count | Status | Impact |
|------------|-------|--------|--------|
| **P0 (Launch Risk)** | 1 | ⛔ **Must Fix** | Unbounded fallback query loads ALL user shorts (1000+ docs) |
| **P1 (High Priority)** | 1 | ⚠️ **Fix Soon** | Monthly generations query without explicit limit (bounded by plan limits) |
| **Low Risk** | 1 | ✅ **Acceptable** | Migration helper (one-time operation, bounded scope) |

### Safe Patterns Confirmed

- ✅ Primary `getMyShorts` path uses `.limit(24)` with proper index
- ✅ Firestore index exists for `shorts` collection (`ownerId ASC, createdAt DESC`)
- ✅ Single document reads are bounded (1 doc per call)
- ✅ No collection group queries found

---

## Findings (Table)

| # | File | Line | Function | Query Pattern | Risk Level | User-Triggerable | Worst-Case Reads | Reason |
|---|------|------|----------|---------------|------------|------------------|------------------|--------|
| 1 | `src/controllers/shorts.controller.js` | 406-408 | `getMyShorts()` | `.where('ownerId', '==', uid).get()` | ⛔ **P0** | ✅ Yes | **Unbounded** (1000+) | Fallback path when index missing loads ALL user shorts |
| 2 | `src/controllers/limits.controller.js` | 22-24 | `getUsageLimits()` | `.where('createdAt', '>=', monthStart).get()` | ⚠️ **P1** | ✅ Yes | ~250 (pro plan limit) | Monthly generations query without explicit limit |
| 3 | `src/services/credit.service.js` | 10 | `copySubcollection()` | `.collection(name).get()` | ✅ **Low** | ❌ No (migration only) | ~10-50 (one-time migration) | Migration helper, bounded by legacy doc scope |

---

## P0 Item: Unbounded Shorts Fallback Query

### Evidence

**Location**: `src/controllers/shorts.controller.js:354-441`

**Primary Path** (Safe - lines 365-394):
```javascript
let query = db.collection('shorts')
  .where('ownerId', '==', ownerUid)
  .orderBy('createdAt', 'desc')
  .limit(limit);  // ✅ limit = 24 (max 100)

const snapshot = await query.get();
```

**Fallback Path** (Unsafe - lines 406-408):
```javascript
// Fallback path: no orderBy (no index required). We sort in memory.
const snapshot = await db.collection('shorts')
  .where('ownerId', '==', ownerUid)
  .get();  // ⚠️ NO LIMIT - loads ALL shorts for user
```

**Trigger Condition**:
- Firestore error code `9` (FAILED_PRECONDITION) → "requires an index"
- Or error message contains "requires an index"
- Occurs when index `ownerId ASC, createdAt DESC` is missing or not deployed

**Index Status**:
- ✅ Index **defined** in `firestore.indexes.json` (lines 3-10)
- ⚠️ Index may not be **deployed** (requires `firebase deploy --only firestore:indexes`)
- ⚠️ Index may be **building** (takes time for large collections)

### Failure Mode

1. **Index Missing Scenario**:
   - User has 5000 shorts
   - Index not deployed or still building
   - Fallback path loads **all 5000 documents** → 5000 Firestore reads
   - In-memory sort of 5000 docs → CPU/memory spike
   - Cost: **5000 reads × $0.06 per 100K reads = $0.003 per request** (scales linearly)

2. **Cost Amplification**:
   - If 100 users hit fallback → 500K reads → **$0.30 per incident**
   - If index missing for 1 hour → repeated requests → cost blowup
   - No rate limiting on this endpoint → can be spammed

3. **Performance Impact**:
   - In-memory sort of 5000 docs → ~100-500ms CPU time
   - Network transfer of 5000 docs → ~1-5 seconds
   - Memory usage: ~50MB per request (5000 docs × ~10KB each)

### Fix (Minimal Diff)

**File**: `src/controllers/shorts.controller.js`

**Change at line 406-408**:
```javascript
// BEFORE (UNSAFE):
const snapshot = await db.collection('shorts')
  .where('ownerId', '==', ownerUid)
  .get();

// AFTER (SAFE):
const snapshot = await db.collection('shorts')
  .where('ownerId', '==', ownerUid)
  .limit(1000)  // ✅ Hard cap for fallback path
  .get();
```

**Complete Context** (lines 403-435):
```javascript
console.warn("[shorts] Using index fallback for getMyShorts:", err.message);

// Fallback path: no orderBy (no index required). We sort in memory.
const snapshot = await db.collection('shorts')
  .where('ownerId', '==', ownerUid)
  .limit(1000)  // ✅ ADD THIS - hard cap for fallback
  .get();

const all = snapshot.docs.map(doc => ({ 
  id: doc.id, 
  ...doc.data(),
  createdAt: doc.data().createdAt?.toDate?.() || null,
  completedAt: doc.data().completedAt?.toDate?.() || null,
  failedAt: doc.data().failedAt?.toDate?.() || null
}));

// Sort by createdAt in memory
all.sort((a, b) => {
  if (!a.createdAt || !b.createdAt) return 0;
  return b.createdAt.getTime() - a.createdAt.getTime();
});

const items = all.slice(0, limit);  // limit = 24 (from req.query.limit)
const nextCursor = null; // disable pagination until index exists

return res.json({ 
  success: true, 
  data: { 
    items, 
    nextCursor: null,
    hasMore: false,
    note: 'INDEX_FALLBACK'
  } 
});
```

**Rationale for `.limit(1000)`**:
- Hard cap prevents unbounded reads (max 1000 docs per request)
- 1000 docs × ~10KB = ~10MB memory (acceptable)
- 1000 docs sort time: ~10-50ms (acceptable)
- Cost: 1000 reads = $0.0006 per request (acceptable)
- UI only shows 24 items anyway (`.slice(0, limit)`)
- If user has >1000 shorts, they'll see most recent 24 (acceptable degradation)

### DoD (Definition of Done)

- [ ] Add `.limit(1000)` to fallback query at line 408
- [ ] Verify primary path still uses `.limit(24)` with index (no changes)
- [ ] Deploy Firestore index: `firebase deploy --only firestore:indexes`
- [ ] Verify index status in Firebase Console (should show "Enabled")
- [ ] Test fallback path with user having 1000+ shorts (should cap at 1000)
- [ ] Test primary path with index (should use index, return 24 items)
- [ ] Monitor fallback usage in production (should be 0 after index deployed)
- [ ] Add alert when fallback path is hit (index missing warning)

---

## Additional Unbounded Query Findings

### P1: Monthly Generations Query Without Limit

**Location**: `src/controllers/limits.controller.js:22-24`

**Current Code**:
```javascript
const generationsRef = userRef.collection('generations');
const monthlyGens = await generationsRef
  .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(monthStart))
  .get();  // ⚠️ No explicit limit

const monthlyCount = monthlyGens.size;
```

**Risk Assessment**:
- **Bounded by plan limits**: Free (10/month), Pro (250/month)
- **Uses `.size`**: Doesn't load full documents, but still counts all matching docs
- **Worst case**: 250 reads (pro plan limit) → acceptable but not ideal
- **Risk level**: ⚠️ **P1** (not launch-blocking, but should fix)

**Recommended Fix**:
```javascript
const monthlyGens = await generationsRef
  .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(monthStart))
  .limit(500)  // ✅ Safety cap (2x pro plan limit)
  .get();
```

**Rationale**:
- 500 is 2x pro plan limit (250) → safety margin
- Prevents accidental cost if plan limits are bypassed
- Minimal performance impact (still uses `.size`)

**DoD**:
- [ ] Add `.limit(500)` to monthly generations query
- [ ] Test with user having 300+ monthly generations (should cap at 500)
- [ ] Verify query still works correctly (returns correct count)

---

### Low Risk: Migration Helper Query

**Location**: `src/services/credit.service.js:10`

**Current Code**:
```javascript
async function copySubcollection(srcRef, dstRef, name) {
  const snap = await srcRef.collection(name).get();  // ⚠️ No limit
  if (snap.empty) return;
  // ... copy logic ...
}
```

**Risk Assessment**:
- **One-time migration**: Only called during legacy email → UID migration
- **Bounded scope**: Legacy user docs have limited subcollections (~10-50 docs)
- **Not user-triggerable**: Server-side migration only
- **Risk level**: ✅ **Low** (acceptable for migration operations)

**Recommendation**: 
- ✅ **No change needed** for P0 launch
- Consider adding `.limit(1000)` as safety cap if migration runs frequently (P2)

---

## Recommended Actions (Prioritized)

### Immediate (P0 - Before Launch)

1. **Add `.limit(1000)` to shorts fallback query**
   - File: `src/controllers/shorts.controller.js:408`
   - Effort: 1 line change
   - Risk: None (fallback path only)
   - Test: Verify fallback caps at 1000 docs

2. **Deploy Firestore index**
   - Command: `firebase deploy --only firestore:indexes`
   - Verify: Check Firebase Console for index status
   - Goal: Ensure fallback path is never hit in production

3. **Add monitoring/alerting**
   - Log when fallback path is hit: `console.warn("[shorts] Using index fallback...")`
   - Alert if fallback usage > 0 in production
   - Goal: Detect index deployment issues early

### Short-term (P1 - After Launch)

4. **Add `.limit(500)` to monthly generations query**
   - File: `src/controllers/limits.controller.js:24`
   - Effort: 1 line change
   - Risk: None (safety cap)
   - Test: Verify query still works correctly

5. **Add explicit index for generations query**
   - File: `firestore.indexes.json`
   - Add index: `collectionGroup: "generations", field: "createdAt" ASC`
   - Deploy: `firebase deploy --only firestore:indexes`
   - Goal: Improve query performance

---

## Tests & Verification

### Test 1: Fallback Path with Limit

**Goal**: Verify fallback query caps at 1000 documents

**Setup**:
1. Create test user with 1500 shorts (or mock Firestore to return 1500 docs)
2. Temporarily remove/rename index in `firestore.indexes.json` to force fallback
3. Or: Mock Firestore to throw code 9 error

**Test**:
```bash
# Request shorts list (should hit fallback)
curl -X GET "http://localhost:3000/api/shorts/mine?limit=24" \
  -H "Authorization: Bearer $TEST_TOKEN"

# Expected response:
# - items.length = 24 (UI limit)
# - note: "INDEX_FALLBACK"
# - Log shows: "[shorts] Using index fallback..."
```

**Verification**:
- ✅ Response contains 24 items (not 1500)
- ✅ Log shows fallback warning
- ✅ Firestore read count = 1000 (not 1500)
- ✅ Response time < 1 second (not 5+ seconds)

### Test 2: Primary Path with Index

**Goal**: Verify primary path uses index and returns 24 items

**Setup**:
1. Ensure index is deployed: `firebase deploy --only firestore:indexes`
2. Verify index status in Firebase Console (should show "Enabled")

**Test**:
```bash
# Request shorts list (should use index)
curl -X GET "http://localhost:3000/api/shorts/mine?limit=24" \
  -H "Authorization: Bearer $TEST_TOKEN"

# Expected response:
# - items.length = 24
# - nextCursor: ISO timestamp (pagination enabled)
# - hasMore: true/false
# - No "INDEX_FALLBACK" note
```

**Verification**:
- ✅ Response contains 24 items
- ✅ Response includes `nextCursor` (pagination enabled)
- ✅ No fallback warning in logs
- ✅ Firestore read count = 24 (not 1000)
- ✅ Response time < 100ms (fast with index)

### Test 3: Force Fallback Path (Dev Only)

**Goal**: Test fallback path behavior in development

**Method 1: Temporarily modify code**:
```javascript
// In getMyShorts(), force fallback by throwing code 9 error:
try {
  // ... primary path ...
} catch (err) {
  // Force fallback for testing
  const testErr = new Error('Test: requires an index');
  testErr.code = 9;
  throw testErr;
}
```

**Method 2: Mock Firestore**:
```javascript
// In test file, mock Firestore to throw code 9:
const mockFirestore = {
  collection: () => ({
    where: () => ({
      orderBy: () => ({
        limit: () => ({
          get: () => Promise.reject({ code: 9, message: 'requires an index' })
        })
      })
    })
  })
};
```

**Verification**:
- ✅ Fallback path executes
- ✅ Query includes `.limit(1000)`
- ✅ Response contains 24 items (sorted by createdAt desc)
- ✅ Log shows fallback warning

### Test 4: Index Deployment Verification

**Goal**: Verify index is deployed and active

**Steps**:
1. Deploy index: `firebase deploy --only firestore:indexes`
2. Check Firebase Console → Firestore → Indexes
3. Verify index status: `shorts` collection, `ownerId ASC, createdAt DESC` → "Enabled"

**Verification**:
- ✅ Index shows "Enabled" status (not "Building" or "Error")
- ✅ Index creation date is recent
- ✅ No errors in Firebase Console

---

## Rollout Checklist

### Pre-Commit

- [ ] Review code changes (self-review sufficient for 1-line fix)
- [ ] Verify change is minimal (add `.limit(1000)` only)
- [ ] No breaking changes (fallback path only, primary path unchanged)
- [ ] Error handling unchanged (same try/catch structure)

### Post-Commit

- [ ] Run Test 1: Fallback path with limit (verify caps at 1000)
- [ ] Run Test 2: Primary path with index (verify uses index)
- [ ] Run Test 3: Force fallback path (dev only, verify behavior)
- [ ] Run Test 4: Index deployment verification
- [ ] No regressions in existing functionality
- [ ] Logs show expected behavior (fallback warning when triggered)

### Pre-Deployment

- [ ] Deploy Firestore index: `firebase deploy --only firestore:indexes`
- [ ] Verify index status in Firebase Console ("Enabled")
- [ ] Test in staging environment (verify fallback not hit)
- [ ] Monitor fallback usage (should be 0 after index deployed)

### Post-Deployment

- [ ] Monitor Firestore read costs (should decrease with index)
- [ ] Monitor fallback usage (should be 0 in production)
- [ ] Set up alert if fallback path is hit (index missing warning)
- [ ] Verify primary path performance (should be < 100ms)

### Rollback Plan

**If issues occur**:
1. Revert commit (remove `.limit(1000)` from fallback query)
2. Verify primary path still works (should be unaffected)
3. Investigate why fallback was hit (index deployment issue?)
4. Re-deploy index if needed: `firebase deploy --only firestore:indexes`

**Risk**: Low (reverts to original unsafe state, but primary path still safe)

---

## Appendix: Firestore Index Configuration

**File**: `firestore.indexes.json`

**Current Index**:
```json
{
  "indexes": [
    {
      "collectionGroup": "shorts",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "ownerId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

**Deployment Command**:
```bash
firebase deploy --only firestore:indexes
```

**Verification**:
- Firebase Console → Firestore → Indexes
- Look for: `shorts` collection, `ownerId ASC, createdAt DESC`
- Status should be: "Enabled" (not "Building" or "Error")

---

## Appendix: Cost Analysis

### Current Risk (Without Fix)

**Scenario**: User with 5000 shorts, index missing, 100 requests hit fallback

- **Reads per request**: 5000 docs
- **Total reads**: 5000 × 100 = 500,000 reads
- **Cost**: 500,000 reads × $0.06 per 100K = **$0.30 per incident**
- **Time**: ~5 seconds per request (in-memory sort + network)

### After Fix (With `.limit(1000)`)

**Scenario**: Same user, same conditions, 100 requests hit fallback

- **Reads per request**: 1000 docs (capped)
- **Total reads**: 1000 × 100 = 100,000 reads
- **Cost**: 100,000 reads × $0.06 per 100K = **$0.06 per incident** (5x reduction)
- **Time**: ~1 second per request (faster sort + less network)

### After Index Deployment (Ideal)

**Scenario**: Index deployed, fallback never hit

- **Reads per request**: 24 docs (primary path)
- **Total reads**: 24 × 100 = 2,400 reads
- **Cost**: 2,400 reads × $0.06 per 100K = **$0.0014 per incident** (200x reduction)
- **Time**: ~50ms per request (indexed query)

---

**End of Audit Report**


