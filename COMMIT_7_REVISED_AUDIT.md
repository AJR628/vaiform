# Commit #7 Revised Audit: spendCredits() Call Site Analysis

**Date**: January 2025  
**Scope**: All `spendCredits()` call sites across codebase  
**Goal**: Determine which call sites need refund logic vs which are safe (spend is last operation)

---

## Executive Summary

**Total Call Sites**: 3 locations  
**Safe (spend is last)**: 1 location (`src/services/shorts.service.js:667`)  
**Needs Refund Logic**: 2 locations (`src/routes/story.routes.js:508`, `src/routes/studio.routes.js:194`)

**Revised Recommendation**: 
- ✅ **SAFE**: `shorts.service.js` - spendCredits is last operation (no refund needed)
- ❌ **NEEDS FIX**: `story.routes.js` - response construction after spend (low risk but technically fallible)
- ❌ **NEEDS FIX**: `studio.routes.js` - response construction after spend (low risk but technically fallible)

**Best Fix**: Move `spendCredits()` to true end (after `return res.json(...)`) OR add refund logic. Moving to end is cleaner but requires restructuring. Adding refund is safer for P0 (minimal diff).

---

## Call Site #1: `src/routes/story.routes.js:508`

**Location**: `src/routes/story.routes.js:505-520`

**Code Context**:
```javascript
// Spend credits only if render succeeded
if (session?.finalVideo?.url) {
  try {
    await spendCredits(req.user.uid, RENDER_CREDIT_COST);  // Line 508
  } catch (err) {
    console.error("[story][finalize] Failed to spend credits:", err);
    // Don't fail the request - credits were already checked by middleware
  }
}

const shortId = session?.finalVideo?.jobId || null;  // Line 515
return res.json({   // Line 516
  success: true, 
  data: session,
  shortId: shortId
});
```

**Analysis**:
- ✅ Spend happens AFTER render succeeds (`session?.finalVideo?.url` check)
- ⚠️ **Fallible work AFTER spend**: Response construction (`res.json(...)`)
  - Risk level: **LOW** (response construction rarely fails, but technically fallible)
  - If `res.json()` throws (e.g., circular reference, serialization error), credits already spent
- Current error handling: Outer try/catch at line 521, but spend happens BEFORE catch

**Verdict**: ❌ **NEEDS REFUND LOGIC** (or move spend to true end)

**Failure Scenario**:
1. `spendCredits()` succeeds
2. `res.json()` throws (serialization error, circular reference, etc.)
3. Outer catch block executes, but credits already spent (no refund)

---

## Call Site #2: `src/routes/studio.routes.js:194`

**Location**: `src/routes/studio.routes.js:190-201`

**Code Context**:
```javascript
// Spend credits only if render succeeded (multi-format path)
// Note: old path (finalizeStudio) spends credits in createShortService
if (publicUrl || Object.keys(urls).length > 0) {
  try {
    await spendCredits(req.user.uid, RENDER_CREDIT_COST);  // Line 194
  } catch (err) {
    console.error("[studio][finalize] Failed to spend credits:", err);
    // Don't fail the request - credits were already checked by middleware
  }
}

return res.json({ success: true, url: publicUrl, durationSec: renderSpec?.output?.durationSec || undefined, urls, shortId: out?.shortId, thumbUrl: out?.thumbUrl });  // Line 201
```

**Analysis**:
- ✅ Spend happens AFTER render succeeds (`publicUrl || Object.keys(urls).length > 0` check)
- ⚠️ **Fallible work AFTER spend**: Response construction (`res.json(...)`)
  - Risk level: **LOW** (response construction rarely fails, but technically fallible)
  - If `res.json()` throws (e.g., circular reference, serialization error), credits already spent
- Current error handling: Outer try/catch at line 202, but spend happens BEFORE catch

**Verdict**: ❌ **NEEDS REFUND LOGIC** (or move spend to true end)

**Failure Scenario**:
1. `spendCredits()` succeeds
2. `res.json()` throws (serialization error, circular reference, etc.)
3. Outer catch block executes, but credits already spent (no refund)

---

## Call Site #3: `src/services/shorts.service.js:667`

**Location**: `src/services/shorts.service.js:664-677`

**Code Context**:
```javascript
// Update Firestore document with success (or audio error)
try {
  await shortsRef.update({
    status: audioOk ? 'ready' : (voiceover ? 'error_audio' : 'ready'),
    videoUrl: publicUrl,
    coverImageUrl: coverUrl,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
    audioOk: !!audioOk,
    usedQuote: {
      text: (usedQuote?.text || '').trim(),
      author: usedQuote?.author ?? null,
      attributed: !!usedQuote?.attributed,
      isParaphrase: !!usedQuote?.isParaphrase
    }
  });
  console.log(`[shorts] Updated Firestore doc to ready: ${jobId}`);
  
  // Spend credits only if render succeeded
  if (publicUrl) {
    try {
      await spendCredits(ownerUid, RENDER_CREDIT_COST);  // Line 667
    } catch (err) {
      console.error("[shorts] Failed to spend credits:", err);
      // Don't fail the request - credits were already checked by middleware
    }
  }
} catch (error) {  // Line 673
  console.warn(`[shorts] Failed to update Firestore doc: ${error.message}`);
}

return {  // Line 677
  jobId,
  videoUrl: publicUrl,
  coverImageUrl: coverUrl,
  durationSec,
  usedTemplate: template,
  usedQuote,
  credits,
};
```

**Analysis**:
- ✅ Spend happens AFTER Firestore update succeeds (inside try block)
- ✅ **NO fallible work AFTER spend**: Spend is last operation in try block
  - After spend: Only `}` (end of try block), then catch block, then return statement
  - Return statement is not fallible (just object literal)
- ✅ Spend is protected by try/catch (line 648-675)
  - If Firestore update fails, catch block executes (line 673), spend never happens
  - If spend fails, inner catch logs error but doesn't throw (line 669)
- ✅ **Spend is LAST operation in success path** - no refund needed

**Verdict**: ✅ **SAFE - NO REFUND NEEDED** (spend is last operation)

**Used By**: 
- `finalizeStudio()` (single-format path) - Line 323 in `studio.service.js`
- Called from `src/routes/studio.routes.js:165` (old path, back-compat)

**Note**: This is the "old path" mentioned in comment at line 191 of `studio.routes.js` ("Note: old path (finalizeStudio) spends credits in createShortService").

---

## Summary Table

| Call Site | File:Line | Fallible Work After? | Refund Needed? | Risk Level | Verdict |
|-----------|-----------|---------------------|----------------|------------|---------|
| Story finalize | `src/routes/story.routes.js:508` | ✅ Yes (`res.json()` construction) | ❌ **YES** | LOW | ❌ Needs fix |
| Studio finalize (multi) | `src/routes/studio.routes.js:194` | ✅ Yes (`res.json()` construction) | ❌ **YES** | LOW | ❌ Needs fix |
| Studio finalize (single) | `src/services/shorts.service.js:667` | ❌ No (spend is last) | ✅ **NO** | NONE | ✅ Safe |

---

## Revised Fix Plan (Minimal Diff)

### Option A: Add Refund Logic (Recommended for P0)

**Files**: `src/routes/story.routes.js`, `src/routes/studio.routes.js`

**Pattern**: Wrap credit spending + return in try/catch, add refund on error

**File**: `src/routes/story.routes.js`

**Current** (lines 505-520):
```javascript
// Spend credits only if render succeeded
if (session?.finalVideo?.url) {
  try {
    await spendCredits(req.user.uid, RENDER_CREDIT_COST);
  } catch (err) {
    console.error("[story][finalize] Failed to spend credits:", err);
    // Don't fail the request - credits were already checked by middleware
  }
}

const shortId = session?.finalVideo?.jobId || null;
return res.json({ 
  success: true, 
  data: session,
  shortId: shortId
});
```

**Fix**:
```javascript
// Spend credits only if render succeeded
let creditsSpent = false;
if (session?.finalVideo?.url) {
  try {
    await spendCredits(req.user.uid, RENDER_CREDIT_COST);
    creditsSpent = true;
  } catch (err) {
    console.error("[story][finalize] Failed to spend credits:", err);
    // Don't fail the request - credits were already checked by middleware
  }
}

try {
  const shortId = session?.finalVideo?.jobId || null;
  return res.json({ 
    success: true, 
    data: session,
    shortId: shortId
  });
} catch (returnErr) {
  // Refund credits if spent before return failed
  if (creditsSpent) {
    try {
      await refundCredits(req.user.uid, RENDER_CREDIT_COST);
    } catch (refundErr) {
      console.error("[story][finalize] Refund failed:", refundErr);
    }
  }
  throw returnErr; // Re-throw to outer catch
}
```

**File**: `src/routes/studio.routes.js`

**Similar pattern** - Add `creditsSpent` flag, wrap return in try/catch with refund logic.

**Also add import**: `import { refundCredits } from "../services/credit.service.js";` to both files

**Lines Modified**: ~15 lines per file (30 total)

---

### Option B: Move spendCredits to True End (Cleaner, but larger diff)

**Pattern**: Move `spendCredits()` call to AFTER `return res.json(...)`

**Issue**: Cannot move `spendCredits()` after `return` statement (JavaScript limitation)

**Alternative**: Wrap response construction in helper function, call spendCredits after response is sent:

```javascript
// Helper function
async function sendResponseAndSpendCredits(res, data, uid) {
  res.json(data);
  // Spend credits after response is sent (fire-and-forget)
  try {
    await spendCredits(uid, RENDER_CREDIT_COST);
  } catch (err) {
    console.error("[route] Failed to spend credits after response:", err);
  }
}

// Usage
if (session?.finalVideo?.url) {
  await sendResponseAndSpendCredits(res, { success: true, data: session, shortId }, req.user.uid);
  return; // Exit early
}
```

**Issues**:
- Requires helper function (larger diff)
- Response sent before credits spent (user sees success even if spend fails)
- Not recommended for P0 (larger change, different behavior)

**Verdict**: Option A (refund logic) is better for P0.

---

## Idempotency Considerations

**Current `refundCredits()` implementation** (`src/services/credit.service.js:214-217`):
```javascript
export async function refundCredits(uid, amount) {
  await db.collection('users').doc(uid)
    .update({ credits: admin.firestore.FieldValue.increment(amount) });
}
```

**Idempotency Analysis**:
- ✅ Uses `FieldValue.increment()` (idempotent operation)
- ⚠️ **NOT true idempotency**: Multiple calls add credits multiple times
- ⚠️ **No idempotency key**: Cannot prevent duplicate refunds if refund logic is called multiple times

**P0 Mitigation**:
- Single refund call per error path (refund only called once in catch block)
- Refund wrapped in try/catch (refund failure doesn't mask original error)
- Log refund failures for manual review

**P1 Improvement** (future):
- Add idempotency key to refund calls
- Track refund transactions in Firestore
- Prevent duplicate refunds via idempotency check

**P0 Decision**: Single refund call is sufficient (refund logic only called once per error path).

---

## Revised Commit #7 Status

**Original Assessment**: ❌ **NOT IMPLEMENTED** (all 3 call sites need refund)

**Revised Assessment**: ⚠️ **PARTIALLY SAFE** (1/3 safe, 2/3 need refund)

**Changes Needed**:
- ✅ **NO CHANGE NEEDED**: `src/services/shorts.service.js:667` (spend is last, safe)
- ❌ **NEEDS REFUND**: `src/routes/story.routes.js:508` (response construction after spend)
- ❌ **NEEDS REFUND**: `src/routes/studio.routes.js:194` (response construction after spend)

**Revised Priority**: 🟡 **MEDIUM** (risk is LOW - response construction rarely fails, but technically fallible)

**Recommendation**: Still implement refund logic for the 2 route handlers (story and studio finalize) to cover edge cases where response construction fails. The shorts.service.js call site is safe and needs no changes.

---

## Final Verdict

**Commit #7 Status**: ⚠️ **PARTIALLY IMPLEMENTED** (1/3 safe, 2/3 need refund logic)

**Required Fixes**:
1. Add refund logic to `src/routes/story.routes.js:508` (wrap return in try/catch with refund)
2. Add refund logic to `src/routes/studio.routes.js:194` (wrap return in try/catch with refund)
3. Add `refundCredits` import to both route files

**Estimated LOC**: ~30 lines (15 per file)

**Risk if Not Fixed**: LOW (response construction rarely fails, but edge cases could cause credit loss)

**Recommendation**: Implement refund logic for P0 completeness (edge case coverage), but risk is lower than originally assessed.

---

**End of Revised Audit**

