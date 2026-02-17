# Commit 3: Firestore Query Limits Guardrails — Implementation Report

**Date**: December 2024  
**Status**: ✅ Implemented  
**Goal**: Add minimal guardrails to prevent unbounded Firestore queries and Storage enumeration

---

## What Changed

1. **Firestore fallback query**: Added `.limit(1000)` to `getMyShorts()` fallback path + logging for PRIMARY/FALLBACK paths
2. **Monthly generations query**: Added `.limit(500)` to `getUsageLimits()` monthly generations query
3. **Storage enumeration**: Added `maxResults: 1000` to 4 `getFiles()` calls in `studio.service.js` (3 internal + 1 user-facing with truncation detection)

---

## Files Modified

1. `src/controllers/shorts.controller.js` - Firestore fallback query limit + logging
2. `src/controllers/limits.controller.js` - Monthly generations query limit
3. `src/services/studio.service.js` - Storage enumeration caps (4 call sites)
4. `src/routes/studio.routes.js` - Backward-compatible response shape for `listStudios()`

---

## Code Changes

### 1. Firestore Fallback Query Limit

**File**: `src/controllers/shorts.controller.js`

**Change 1**: Added logging to PRIMARY path (after line 376)
```javascript
console.log(`[shorts] PRIMARY path used for uid=${ownerUid}, loaded ${snapshot.docs.length} docs, limit=${limit}`);
```

**Change 2**: Added `.limit(1000)` to fallback query + logging (line 408)
```javascript
const snapshot = await db.collection('shorts')
  .where('ownerId', '==', ownerUid)
  .limit(1000)  // Hard cap for fallback path
  .get();

// ... existing sorting/slicing logic ...

console.log(`[shorts] FALLBACK path used for uid=${ownerUid}, loaded ${snapshot.docs.length} docs, returning ${items.length}, limit=${limit}`);
```

**Impact**: Prevents unbounded reads when index is missing. Fallback path now caps at 1000 docs (UI still shows 24 items).

---

### 2. Monthly Generations Query Limit

**File**: `src/controllers/limits.controller.js`

**Change**: Added `.limit(500)` to monthly generations query (line 24)
```javascript
const monthlyGens = await generationsRef
  .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(monthStart))
  .limit(500)  // Safety cap (2x pro plan limit of 250)
  .get();
```

**Impact**: Prevents unbounded reads for monthly usage count. Cap is 2x pro plan limit (250), so edge case of >500 generations is unlikely.

---

### 3. Storage Enumeration Caps

**File**: `src/services/studio.service.js`

**Change 1**: `createRemix()` - Line 557
```javascript
const [files] = await bucket.getFiles({ 
  prefix: `artifacts/${uid}/`, 
  autoPaginate: true, 
  maxResults: 1000 
});
```

**Change 2**: `listRemixes()` - Line 578
```javascript
const [files] = await bucket.getFiles({ 
  prefix: `artifacts/${uid}/`, 
  autoPaginate: true, 
  maxResults: 1000 
});
```

**Change 3**: `listStudios()` - Line 710 (with truncation detection)
```javascript
const [files, nextQuery] = await bucket.getFiles({ 
  prefix: `drafts/${uid}/`, 
  autoPaginate: false,
  maxResults: 1000
});

// ... existing filtering/sorting logic ...

// Detect truncation: if nextQuery exists, list was capped
const truncated = !!(nextQuery && nextQuery.pageToken);
const note = truncated ? 'List may be incomplete. Showing first 1000 studios.' : null;

return { sessions, truncated, note };
```

**Change 4**: `initStudioSweeper()` - Line 753
```javascript
const [files] = await bucket.getFiles({ 
  prefix: `drafts/`, 
  autoPaginate: true, 
  maxResults: 1000 
});
```

**Impact**: Prevents unbounded Storage enumeration. `listStudios()` now surfaces truncation to UI (no silent data loss).

---

### 4. Backward-Compatible Response Shape

**File**: `src/routes/studio.routes.js`

**Change**: Updated route handler to maintain backward compatibility (line 305)
```javascript
r.get("/", async (req, res) => {
  try {
    const result = await listStudios({ uid: req.user.uid });
    // Backward compatibility: if result is array (old format), wrap it
    // New format: { sessions, truncated, note }
    if (Array.isArray(result)) {
      return res.json({ success: true, data: result });
    }
    // New format: maintain backward compatibility by keeping data as array
    return res.json({ 
      success: true, 
      data: result.sessions,  // Frontend expects resp.data to be array
      truncated: result.truncated,
      note: result.note
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: "STUDIO_LIST_FAILED" });
  }
});
```

**Response Shape**:
- **Before**: `{ success: true, data: sessionsArray }`
- **After**: `{ success: true, data: sessionsArray, truncated: boolean, note: string | null }`

**Backward Compatibility**: ✅ Maintained - `resp.data` is still the array, new fields are optional siblings.

---

## Notable Logs Added

1. **PRIMARY path logging** (`getMyShorts()`):
   ```
   [shorts] PRIMARY path used for uid=<uid>, loaded <count> docs, limit=<limit>
   ```

2. **FALLBACK path logging** (`getMyShorts()`):
   ```
   [shorts] FALLBACK path used for uid=<uid>, loaded <count> docs, returning <items>, limit=<limit>
   ```

**Purpose**: Monitor fallback usage in production. Should trend to zero after index is deployed.

---

## Verification Steps

### 1. Firestore Primary Path

```bash
# Test with index deployed
curl -X GET "http://localhost:3000/api/shorts/mine?limit=24" \
  -H "Authorization: Bearer $TOKEN"

# Expected:
# - Response: { success: true, data: { items: [...], nextCursor: "...", hasMore: true/false } }
# - Log: "[shorts] PRIMARY path used for uid=..., loaded 24 docs, limit=24"
# - Firestore reads: 24 (not 1000+)
```

### 2. Firestore Fallback Path

```bash
# Force fallback (temporarily remove index or mock code 9 error)
# Or wait for index to be missing

curl -X GET "http://localhost:3000/api/shorts/mine?limit=24" \
  -H "Authorization: Bearer $TOKEN"

# Expected:
# - Response: { success: true, data: { items: [...], nextCursor: null, hasMore: false, note: "INDEX_FALLBACK" } }
# - Log: "[shorts] FALLBACK path used for uid=..., loaded 1000 docs, returning 24, limit=24"
# - Firestore reads: 1000 (capped, not unbounded)
```

### 3. Monthly Generations Query

```bash
curl -X GET "http://localhost:3000/api/limits/usage" \
  -H "Authorization: Bearer $TOKEN"

# Expected:
# - Response: { ok: true, data: { plan, usage: { monthlyGenerations: <count>, ... }, ... } }
# - If user has >500 generations, count is capped at 500
# - Firestore reads: <= 500 (capped)
```

### 4. Storage Enumeration - listStudios()

```bash
curl -X GET "http://localhost:3000/api/studio" \
  -H "Authorization: Bearer $TOKEN"

# Expected (normal case):
# - Response: { success: true, data: [...], truncated: false, note: null }
# - Frontend can access resp.data as array (backward compatible)

# Expected (if user has >1000 studios):
# - Response: { success: true, data: [...], truncated: true, note: "List may be incomplete. Showing first 1000 studios." }
# - Frontend can still access resp.data as array
# - Frontend can check resp.truncated to show warning
```

### 5. Storage Enumeration - Other Calls

```bash
# Test remix creation (quota check)
curl -X POST "http://localhost:3000/api/studio/remix" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"parentRenderId": "...", "renderSpec": {...}}'

# Expected: Works normally, quota enforcement still works
# Storage enumeration capped at 1000 files
```

---

## Response Shape Compatibility

### ✅ Confirmed Backward Compatible

**`GET /api/studio`**:
- **Before**: `{ success: true, data: sessionsArray }`
- **After**: `{ success: true, data: sessionsArray, truncated: boolean, note: string | null }`
- **Frontend access**: `resp.data` still works (array)
- **New fields**: Optional siblings (`truncated`, `note`)

**`GET /api/shorts/mine`**:
- **No changes** to response shape
- Only added logging (no breaking changes)

**`GET /api/limits/usage`**:
- **No changes** to response shape
- Only added query limit (no breaking changes)

---

## Post-Deployment Monitoring

### Logs to Watch

1. **Firestore fallback usage**:
   - Search for: `"[shorts] FALLBACK path used"`
   - **Target**: Should trend to **zero** after index is deployed
   - **Action**: If >0, investigate index deployment status

2. **Storage truncation**:
   - Search for: `truncated: true` in `listStudios()` responses
   - **Target**: Should be rare (users with >1000 studios)
   - **Action**: If frequent, consider implementing pagination (P1)

3. **Monthly generations cap**:
   - Monitor if any users hit 500 cap (unlikely)
   - **Action**: If cap is hit, consider count aggregation query (P1)

---

## Summary

**Status**: ✅ **All changes implemented**

**Files Changed**: 4 files, 8 code changes

**Breaking Changes**: None (all changes maintain backward compatibility)

**Risk Level**: Low (additive safety caps only)

**Next Steps**:
1. Deploy Firestore index: `firebase deploy --only firestore:indexes`
2. Monitor fallback usage (should trend to zero)
3. Monitor Storage truncation (should be rare)

---

**End of Implementation Report**

