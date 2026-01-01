# P0 Launch Readiness - Comprehensive Meta-Plan

**Date**: December 2024  
**Scope**: All P0 Launch Risks from LAUNCH_READINESS_STOPLIGHT_MAP.md  
**Status**: READ-ONLY AUDIT + PLAN (No Implementation)  
**Goal**: Address all 9 P0 risks with incremental, testable, reversible commits

---

## Executive Summary

**Most Critical Risks** (fix first):
1. **Public routes without authentication** (DoS & cost amplification) - Fix in Commit #1
2. **Temp file leakage** (disk exhaustion) - Fix in Commit #2
3. **Unbounded queries** (cost blowup) - Fix in Commit #3-4
4. **No concurrency limits** (OOM/CPU exhaustion) - Fix in Commit #5
5. **External API timeouts** (hanging requests) - Fix in Commit #6
6. **Credit refunds on failure** (user loss) - Fix in Commit #7
7. **Session size limits** (storage cost) - Fix in Commit #8
8. **Blocking HTTP architecture** (mitigated) - Document in Commit #9

**Estimated Total Time**: 4-5 days of focused work  
**Commit Strategy**: 9 small, independent commits (each testable/reversible)  
**Risk Level**: Medium (changes are additive, minimal refactoring)

---

## Confirmation Audit Summary (Pre-Implementation)

**Date**: Pre-implementation confirmation audit  
**Scope**: Risky ambiguities identified in original plan  
**Status**: CONFIRMED - All behaviors verified against actual codebase

### ✅ Confirmed Behaviors

1. **Auth Middleware** (`requireAuth` from `src/middleware/requireAuth.js`):
   - Error shape: `{ success: false, error: "AUTH_REQUIRED", code: "UNAUTHENTICATED", message: "You need to sign in..." }` (401)
   - Used consistently across 16+ routes
   - Verifies Firebase Auth token via `admin.auth().verifyIdToken()`

2. **Storage SDK `getFiles()` with `maxResults` + `autoPaginate`**:
   - `maxResults` limits total results across all pages when `autoPaginate: true`
   - SDK fetches pages automatically but stops when `maxResults` limit reached
   - Safe to add `maxResults: 1000` to existing `autoPaginate: true` calls

3. **Firebase Storage Upload Timeout**:
   - `bucket.upload()` with `resumable: false` doesn't support cancellation
   - `Promise.race()` approach will timeout the request but upload may complete in background (zombie)
   - **Decision**: Accept zombie uploads for P0 (better than blocking requests)
   - Note: `fetch()` with AbortController properly cancels (no zombies)

4. **Credit Refund Idempotency**:
   - `refundCredits()` at `src/services/credit.service.js:214` uses `FieldValue.increment(amount)`
   - `increment()` is idempotent but multiple calls add credits multiple times (not true idempotency)
   - For P0: Single refund call is sufficient (prevent duplicate refunds is P1 improvement)
   - `spendCredits()` at line 227 uses transaction-wrapped increment (atomic)

---

## 1) P0 Inventory Table

| # | Issue | Risk | Impacted Files/Routes | Quick Fix Summary |
|---|-------|------|----------------------|-------------------|
| 1 | Public routes without auth | DoS & cost amplification | `src/routes/caption.preview.routes.js:65`<br>`src/routes/caption.render.routes.js:8`<br>`src/routes/tts.routes.js:5` | Add `requireAuth` middleware to 3 routes |
| 2 | Temp file leakage | Disk exhaustion | `src/services/story.service.js:761-1042`<br>`src/services/studio.service.js:348-541`<br>`src/services/story.service.js:659` | Add finally blocks with cleanup |
| 3 | Unbounded Firestore query | Cost blowup | `src/controllers/shorts.controller.js:406-408` | Add `.limit(1000)` to fallback query |
| 4 | Unbounded Storage enumeration | Cost & memory | `src/services/studio.service.js:546,567,699,742` | Add `maxResults: 1000` to 4 getFiles() calls |
| 5 | Story session unbounded growth | Storage cost | `src/utils/json.store.js:16-27` | Enforce 500KB size limit before save |
| 6 | No render concurrency limits | OOM & CPU exhaustion | `src/routes/studio.routes.js:157`<br>`src/routes/story.routes.js:483` | Add semaphore (max 3 concurrent) |
| 7 | External API calls without timeouts | Hanging requests | `src/utils/video.fetch.js:21`<br>`src/utils/image.fetch.js:12`<br>`src/utils/storage.js:13`<br>`src/services/tts.service.js:102` | Add AbortController timeouts |
| 8 | Credit leakage on render failure | User loss | `src/routes/studio.routes.js:188-195`<br>`src/routes/story.routes.js:502-509` | Wrap credit spending in try/catch with refund |
| 9 | Blocking HTTP render architecture | Scalability & timeout | All render routes | Document + increase timeout to 15min |

---

## 2) Audit Findings (Repo-Specific)

### P0 #1: Public Routes Without Authentication (CONFIRMED MIDDLEWARE)

**Exact Locations**:
- `src/routes/caption.preview.routes.js:65` - `router.post("/caption/preview", express.json(), ...)`
- `src/routes/caption.render.routes.js:8` - `router.post("/caption/render", express.json(), ...)`
- `src/routes/tts.routes.js:5` - `r.post("/preview", ttsPreview)`

**Current Behavior**:
- Routes accept requests without authentication
- Canvas rendering (CPU-intensive, no timeout)
- TTS API calls (external API, retry logic exists but no timeout)
- Large payloads accepted (10mb global limit)

**Call Chain**:
```
POST /api/caption/preview
  → caption.preview.routes.js:65
    → renderCaptionRaster() (canvas rendering)
    
POST /api/caption/render
  → caption.render.routes.js:8
    → renderPreviewImage() (canvas rendering)
    
POST /api/tts/preview
  → tts.routes.js:5
    → tts.controller.js (TTS API calls)
```

**Failure Scenarios**:
1. Unauthenticated user spams `/api/caption/preview` with large payloads → CPU exhaustion
2. Unauthenticated user spams `/api/tts/preview` → TTS API quota exhaustion → cost blowup
3. Botnet DoS attack → server unresponsive

**Minimal Fix**:
- Import `requireAuth` from `src/middleware/requireAuth.js` (default export, used consistently across codebase)
- Add `requireAuth` middleware before route handlers
- Replace route-local `express.json()` with `express.json({ limit: "200kb" })` to enforce payload size cap (more restrictive than global 10mb limit)
- Error shape: `{ success: false, error: "AUTH_REQUIRED", code: "UNAUTHENTICATED", message: "You need to sign in to create shorts." }` (401 status)
- No breaking changes (existing authenticated clients continue to work)

**CONFIRMED**: 
- All other routes use `requireAuth` from `requireAuth.js` (16 routes confirmed)
- Error response format is consistent: `{ success: false, error, code, message }`
- Middleware verifies Firebase Auth token via `admin.auth().verifyIdToken()`

**Compatibility Risks**: None (additive change)

---

### P0 #2: Temp File Leakage

**Exact Locations**:

1. **`src/services/story.service.js:761`**:
   ```javascript
   const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaiform-story-render-'));
   // ... render logic ...
   return session; // Line 1042 - NO CLEANUP
   ```

2. **`src/services/studio.service.js:348-541`**:
   ```javascript
   export async function finalizeStudioMulti({ ... }) {
     // ...
     const rr = await renderAllFormats({ ... }); // Returns { tmpRoot, ... }
     // ... upload logic ...
     return { renderId, ... }; // NO CLEANUP of rr.tmpRoot
   }
   ```

3. **`src/services/story.service.js:659`**:
   ```javascript
   const { clips: fetchedClips, tmpDir } = await fetchClipsToTmp(clipsToFetch);
   // Uses tmpDir but NEVER cleans up
   ```

**Current Behavior**:
- Temp directories created but never deleted on failure paths
- Success paths may clean up (depends on caller), but failure paths leave files
- Server restart doesn't clean `/tmp` → disk fills over days

**Call Chain**:
```
renderStory() → creates tmpDir → renders segments → returns (no cleanup)
finalizeStudioMulti() → renderAllFormats() returns tmpRoot → returns (no cleanup)
timeline() → fetchClipsToTmp() returns tmpDir → caller doesn't clean
```

**Failure Scenarios**:
1. Failed render → tmpDir remains → 100+ failed renders → disk full
2. Server crash mid-render → tmpDir orphaned → disk fills over weeks
3. Disk full → all renders fail with "ENOSPC: no space left on device"

**Minimal Fix**:
- Wrap render logic in try/finally blocks
- Cleanup `tmpDir`/`tmpRoot` in finally blocks
- Use `fs.rmSync(tmpDir, { recursive: true, force: true })` with try/catch (don't throw on cleanup failure)

**Compatibility Risks**: None (cleanup is safe, doesn't affect success paths)

---

### P0 #3: Unbounded Firestore Fallback Query

**Exact Location**: `src/controllers/shorts.controller.js:406-408`

**Current Behavior**:
```javascript
// Fallback path when index missing (code 9)
const snapshot = await db.collection('shorts')
  .where('ownerId', '==', ownerUid)
  .get();  // ⚠️ NO LIMIT - loads ALL shorts for user
```

**Call Chain**:
```
GET /api/shorts/mine
  → shorts.controller.js:getMyShorts()
    → Primary path: .limit(24) with index (SAFE)
    → Fallback path: .get() without limit (UNSAFE)
```

**Failure Scenarios**:
1. Index missing → fallback loads 1000+ documents → O(n) reads → cost blowup
2. User with 5000 shorts → fallback loads all → in-memory sort → OOM risk
3. Firestore read quota exhaustion → service degraded

**Minimal Fix**:
- Add `.limit(1000)` to fallback query (hard cap)
- Log warning when fallback is used (already present)
- Ensure index exists: `ownerId ASC, createdAt DESC` (deploy separately)

**Compatibility Risks**: None (fallback path only, primary path unchanged)

---

### P0 #4: Unbounded Storage Enumeration (CONFIRMED SDK BEHAVIOR)

**Exact Locations**: `src/services/studio.service.js`:
- Line 546: `createRemix()` quota check
- Line 567: Cleanup operation
- Line 699: Cleanup operation
- Line 742: Cleanup operation

**Current Behavior**:
```javascript
const [files] = await bucket.getFiles({ 
  prefix: `artifacts/${uid}/`, 
  autoPaginate: true  // ⚠️ NO MAX_RESULTS
});
```

**Call Chain**:
```
createRemix() → getFiles() → enumerates ALL artifacts
Cleanup operations → getFiles() → enumerates ALL files
```

**Failure Scenarios**:
1. User with 5000 artifacts → getFiles() loads all metadata → memory spike
2. Storage operation costs → O(n) where n = file count → cost blowup
3. Slow enumeration → timeout risk

**Minimal Fix**:
- Add `maxResults: 1000` to all 4 `getFiles()` calls
- Keep `autoPaginate: true` (SDK will still paginate internally, but `maxResults` caps total results)
- Document that cleanup operations may need pagination (future work)

**CONFIRMED**:
- Firebase Admin Storage SDK: `maxResults` limits total results across all pages when `autoPaginate: true`
- Behavior: SDK fetches pages automatically but stops when `maxResults` limit reached
- This prevents unbounded enumeration while maintaining pagination behavior

**Compatibility Risks**: Low (cleanup operations may skip some files, but hard cap prevents cost blowup)

---

### P0 #5: Story Session Unbounded Growth

**Exact Location**: `src/utils/json.store.js:16-27`

**Current Behavior**:
```javascript
export async function saveJSON({ uid, studioId, file = "session.json", data }) {
  const buf = Buffer.from(JSON.stringify(data, null, 2), "utf8");
  await f.save(buf, { ... }); // ⚠️ NO SIZE CHECK
}
```

**Call Chain**:
```
saveStorySession() → saveJSON()
  → JSON.stringify() → Buffer.from() → Storage.save()
  → No size limit enforced
```

**Failure Scenarios**:
1. Session with 100+ shots → `candidates[]` arrays grow → JSON > 10MB → expensive storage
2. Large session loads → slow downloads → timeout risk
3. Storage cost accumulation → unbounded per-user costs

**Minimal Fix**:
- Remove JSON pretty-printing: Change `JSON.stringify(data, null, 2)` to `JSON.stringify(data)` to avoid inflated sizes
- Check size before save: `const sizeBytes = Buffer.byteLength(buf, 'utf8')`
- Enforce limit: `if (sizeBytes > 500 * 1024) throw new Error('SESSION_TOO_LARGE')`
- Return clear error to caller

**Compatibility Risks**: Medium (existing large sessions may fail to save, but prevents future bloat)

**Follow-up Required**:
- Background cleanup job for expired sessions (P1)
- Storage lifecycle policy (P1)

---

### P0 #6: No Render Concurrency Limits

**Exact Locations**:
- `src/routes/studio.routes.js:157` - `finalizeStudio` route
- `src/routes/story.routes.js:483` - `finalizeStory` route

**Current Behavior**:
- No semaphore/queue system
- Multiple users can trigger renders simultaneously
- Each render spawns FFmpeg processes, downloads videos, uses CPU/memory

**Call Chain**:
```
POST /api/studio/finalize
  → studio.routes.js:157
    → finalizeStudioMulti() → renderAllFormats() → FFmpeg processes
    
POST /api/story/finalize
  → story.routes.js:483
    → finalizeStory() → renderStory() → FFmpeg processes
```

**Failure Scenarios**:
1. 10 users trigger renders simultaneously → 10 FFmpeg processes → OOM
2. Disk I/O saturation from concurrent temp file writes
3. Network bandwidth exhaustion from concurrent video downloads (200MB each)

**Minimal Fix**:
- Create simple semaphore module: `src/utils/render.semaphore.js`
- Track active renders: `let activeRenders = 0; const MAX_CONCURRENT_RENDERS = 3;`
- In routes: Check limit before render, increment/decrement in try/finally
- Return 503 with `retryAfter: 30` when limit exceeded

**Compatibility Risks**: Low (legitimate users may see 503 under load, but prevents server crash)

---

### P0 #7: External API Calls Without Timeouts (CONFIRMED BEHAVIORS)

**Exact Locations**:

1. **`src/utils/video.fetch.js:21`**:
   ```javascript
   const res = await fetch(url, { redirect: "follow" }); // ⚠️ NO TIMEOUT
   ```

2. **`src/utils/image.fetch.js:12`**:
   ```javascript
   const res = await fetch(url, { redirect: "follow" }); // ⚠️ NO TIMEOUT
   ```

3. **`src/utils/storage.js:13`**:
   ```javascript
   await bucket.upload(localPath, { ... }); // ⚠️ NO TIMEOUT (Firebase SDK)
   ```

4. **`src/services/tts.service.js:102`**:
   ```javascript
   async function withRetry(fetchFn, ...) {
     res = await fetchFn(); // ⚠️ NO PER-REQUEST TIMEOUT
   }
   ```

**Current Behavior**:
- `fetch()` calls can hang indefinitely on network issues
- Firebase Storage uploads can hang on slow connections
- TTS retry logic exists but no timeout per request

**Call Chain**:
```
renderStory() → fetchVideoToTmp() → fetch() (no timeout)
finalizeStudioMulti() → fetchImageToTmp() → fetch() (no timeout)
renderStory() → uploadPublic() → bucket.upload() (no timeout)
renderStory() → synthVoiceWithTimestamps() → TTS API (no timeout)
```

**Failure Scenarios**:
1. Video download hangs → HTTP request blocks → server thread stuck
2. Firebase upload hangs → render pipeline stalls → user waits forever
3. TTS API call hangs → render pipeline stalls → credits spent but no result

**Minimal Fix**:
- Add AbortController with 60s timeout to `fetchVideoToTmp()` (abort fetch stream on timeout - no zombies)
- Add AbortController with 30s timeout to `fetchImageToTmp()` (abort fetch stream on timeout - no zombies)
- Wrap Firebase `bucket.upload()` in Promise.race() with 60s timeout (zombie uploads possible but acceptable)
  - **CRITICAL**: Do NOT delete `localPath` file until upload promise settles (whether success or timeout)
  - File cleanup must occur AFTER upload promise resolves/rejects to avoid corrupting partial uploads
- Add timeout wrapper to TTS service calls (30s) - wrap existing `withRetry()` function

**CONFIRMED**:
- **fetch() with AbortController**: Aborting fetch cancels the request stream - no zombie downloads
- **Firebase Admin `bucket.upload()`**: With `resumable: false`, SDK doesn't support cancellation
- **Promise.race() approach**: If timeout fires, Promise.race rejects, but upload may continue in background (zombie)
- **Zombie upload risk**: Low impact - upload consumes storage bandwidth but request unblocks (acceptable for P0)
- **Alternative considered**: Resumable uploads support cancellation but add complexity (defer to P1)
- **Decision**: Accept zombie uploads for P0 - better than blocking requests indefinitely

**Compatibility Risks**: Low (timeouts prevent hangs, but may fail legitimate slow connections - acceptable trade-off. Note: zombie uploads possible but better than blocking)

---

### P0 #8: Credit Leakage on Render Failure (CONFIRMED FUNCTION LOCATIONS & IDEMPOTENCY)

**Exact Locations**:

1. **`src/routes/studio.routes.js:188-195`**:
   ```javascript
   if (publicUrl || Object.keys(urls).length > 0) {
     await spendCredits(req.user.uid, RENDER_CREDIT_COST); // After render succeeds
   }
   // ⚠️ If upload fails AFTER this, credits already spent
   ```

2. **`src/routes/story.routes.js:502-509`**:
   ```javascript
   if (session?.finalVideo?.url) {
     await spendCredits(req.user.uid, RENDER_CREDIT_COST); // After render succeeds
   }
   // ⚠️ If Firestore write fails AFTER this, credits already spent
   ```

**Current Behavior**:
- Credits spent AFTER render succeeds (good)
- But if upload/Firestore write fails AFTER spending → no refund
- Users lose credits for failed renders

**Call Chain**:
```
POST /api/studio/finalize
  → finalizeStudioMulti() (render + upload)
  → spendCredits() (after success check)
  → ⚠️ If exception occurs after spendCredits(), no refund

POST /api/story/finalize
  → finalizeStory() → renderStory() (render + upload)
  → spendCredits() (after success check)
  → ⚠️ If exception occurs after spendCredits(), no refund
```

**Failure Scenarios**:
1. Upload succeeds, Firestore write fails → credits spent, video orphaned
2. Partial format upload failure → credits spent, incomplete result
3. Network blip during upload → credits spent, no video URL returned

**Minimal Fix**:
- Track whether credits were spent: `let creditsSpent = false;`
- Wrap credit spending + subsequent operations in try/catch
- On error, if credits were spent, call `refundCredits(uid, amount)` from `src/services/credit.service.js:214`
- Don't throw from refund error handler (log only)

**CONFIRMED**:
- `spendCredits()`: Located at `src/services/credit.service.js:227`, uses Firestore transaction with `FieldValue.increment(-amount)`
- `refundCredits()`: Located at `src/services/credit.service.js:214`, uses `FieldValue.increment(amount)` (NOT transaction-wrapped)
- **Idempotency**: `FieldValue.increment()` is idempotent - multiple calls add credits multiple times
- **Current Usage**: `refundCredits()` is used in generate.controller.js and assets.controller.js with try/catch pattern
- **Note**: For P0, single refund call is sufficient. True idempotency (prevent duplicate refunds) requires idempotency keys (P1 improvement)

**Compatibility Risks**: None (additive change, improves user experience)

---

### P0 #9: Blocking HTTP Render Architecture

**Exact Locations**: All render routes

**Current Behavior**:
- All renders run blocking inside HTTP requests
- Server timeout: 600s (10 minutes)
- No job queue system

**Call Chain**:
```
POST /api/studio/finalize
  → await finalizeStudioMulti() // BLOCKS HTTP REQUEST
  
POST /api/story/finalize
  → await finalizeStory() // BLOCKS HTTP REQUEST
```

**Failure Scenarios**:
1. Long-running renders (5min+) → HTTP timeout → client sees error but render continues
2. Multiple concurrent renders → event loop exhaustion
3. No job state → can't resume or track progress

**Minimal Fix** (Launch Mitigation):
- Increase server timeout to 15 minutes (`server.js:33`)
- Add concurrency limits (P0 #6) to prevent overload
- Document current blocking behavior in code comments
- Plan background job queue migration (P2)

**Compatibility Risks**: Low (timeout increase is safe, documented limitation)

**Note**: Full fix requires background job queue (P2), but launch mitigation is acceptable.

---

## 3) Build Plan (Commit Ladder)

### Commit #1: Add Auth to Public Routes + Route-Local Payload Caps
**Files**: 
- `src/routes/caption.preview.routes.js`
- `src/routes/caption.render.routes.js`
- `src/routes/tts.routes.js`

**Changes**:
- Import `requireAuth` from `src/middleware/requireAuth.js` (default export, matches existing pattern)
- Add `requireAuth` middleware before route handlers
- Replace route-local `express.json()` with `express.json({ limit: "200kb" })` to enforce payload size cap (more restrictive than global 10mb limit)
- Error response: `{ success: false, error: "AUTH_REQUIRED", code: "UNAUTHENTICATED", message: "You need to sign in to create shorts." }` (401 status)

**Test**: Unauthenticated requests return 401 with expected error shape, authenticated requests work, oversized payloads (>200kb) are rejected

---

### Commit #2: Add Temp File Cleanup
**Files**:
- `src/services/story.service.js` (renderStory function)
- `src/services/studio.service.js` (finalizeStudioMulti function)
- `src/services/story.service.js` (timeline function caller)

**Changes**:
- Wrap render logic in try/finally blocks
- Add cleanup in finally: `fs.rmSync(tmpDir, { recursive: true, force: true })`
- Wrap cleanup in try/catch (don't throw on cleanup failure)

**Test**: Failed render cleans up temp files, successful render still works

---

### Commit #3: Add Limit to Firestore Fallback Query
**Files**:
- `src/controllers/shorts.controller.js`

**Changes**:
- Add `.limit(1000)` to fallback query (line 406)

**Test**: Fallback query caps at 1000 documents

---

### Commit #4: Add maxResults to Storage getFiles() Calls
**Files**:
- `src/services/studio.service.js`

**Changes**:
- Add `maxResults: 1000` to all 4 `getFiles()` calls (lines 546, 567, 699, 742)
- Keep `autoPaginate: true` (maxResults caps total results across all pages)

**Test**: getFiles() calls cap at 1000 files (verify SDK respects maxResults with autoPaginate)

---

### Commit #5: Add Render Concurrency Limits
**Files**:
- `src/utils/render.semaphore.js` (NEW)
- `src/routes/studio.routes.js`
- `src/routes/story.routes.js`

**Changes**:
- Create semaphore module with `withRenderSlot(fn)` wrapper
- Apply semaphore to finalize routes
- Return 503 with `retryAfter: 30` when limit exceeded

**Test**: 5 simultaneous renders → 3 process, 2 get 503

---

### Commit #6: Add Timeouts to External API Calls
**Files**:
- `src/utils/video.fetch.js`
- `src/utils/image.fetch.js`
- `src/utils/storage.js`
- `src/services/tts.service.js`

**Changes**:
- Add AbortController with 60s timeout to `fetchVideoToTmp()` (abort fetch on timeout)
- Add AbortController with 30s timeout to `fetchImageToTmp()` (abort fetch on timeout)
- Wrap Firebase `bucket.upload()` in Promise.race() with 60s timeout (zombie uploads possible but acceptable)
  - **CRITICAL**: Do NOT delete `localPath` file until upload promise settles (whether success or timeout)
  - File cleanup must occur AFTER upload promise resolves/rejects to avoid corrupting partial uploads
  - Note: Promise.race() timeout rejects the wrapper promise, but upload may continue in background (zombie upload)
- Add timeout wrapper to TTS service calls (30s) - wrap existing `withRetry()` calls

**Test**: Slow URL → timeout triggers correctly. Note: Firebase uploads may complete in background after timeout (zombie), but request unblocks. Verify localPath file remains intact until upload promise settles.

---

### Commit #7: Add Credit Refunds on Render Failure
**Files**:
- `src/routes/studio.routes.js`
- `src/routes/story.routes.js`

**Changes**:
- Import `refundCredits` from `src/services/credit.service.js`
- Track `creditsSpent` flag (set to true after `spendCredits()` succeeds)
- Wrap credit spending + subsequent operations in try/catch
- On error, if credits spent, call `refundCredits(uid, RENDER_CREDIT_COST)`
- Wrap refund in try/catch (log errors, don't throw - refund failure shouldn't block error response)

**Test**: Failed render after credit spend → refund occurs. Verify credits restored in Firestore.

---

### Commit #8: Add Session Size Limit
**Files**:
- `src/utils/json.store.js`

**Changes**:
- Remove JSON pretty-printing: Change `JSON.stringify(data, null, 2)` to `JSON.stringify(data)` to avoid inflated sizes
- Check size before save: `const sizeBytes = Buffer.byteLength(buf, 'utf8')`
- Enforce limit: `if (sizeBytes > 500 * 1024) throw new Error('SESSION_TOO_LARGE')`

**Test**: Large session save fails with clear error

---

### Commit #9: Document Blocking Architecture + Increase Timeout
**Files**:
- `server.js`
- `src/routes/studio.routes.js` (add comment)
- `src/routes/story.routes.js` (add comment)

**Changes**:
- Increase server timeout to 15 minutes
- Add code comments documenting blocking behavior
- Note: Background job queue migration planned (P2)

**Test**: Long renders complete without timeout

---

## 4) Test Plan

### Smoke Tests (`smoke.sh`)

```bash
#!/bin/bash
set -e

BASE_URL="${BASE_URL:-http://localhost:3000}"
TOKEN="${TOKEN:-your-test-token}"

echo "=== Smoke Tests ==="

# Test 1: Public routes require auth (should return 401)
echo "Test 1: Public routes require auth"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/caption/preview" \
  -H "Content-Type: application/json" \
  -d '{"ssotVersion":3,"mode":"raster","text":"test"}')
if [ "$STATUS" != "401" ]; then
  echo "FAIL: Should return 401, got $STATUS"
  exit 1
fi
curl -s -X POST "$BASE_URL/api/caption/preview" \
  -H "Content-Type: application/json" \
  -d '{"ssotVersion":3,"mode":"raster","text":"test"}' | jq -e '.success == false and .error == "AUTH_REQUIRED" and .code == "UNAUTHENTICATED"' || echo "FAIL: Should return expected error shape"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/caption/render" \
  -H "Content-Type: application/json" \
  -d '{"placement":"custom","yPct":0.5,"text":"test"}')
if [ "$STATUS" != "401" ]; then
  echo "FAIL: Should return 401, got $STATUS"
  exit 1
fi
curl -s -X POST "$BASE_URL/api/caption/render" \
  -H "Content-Type: application/json" \
  -d '{"placement":"custom","yPct":0.5,"text":"test"}' | jq -e '.success == false and .error == "AUTH_REQUIRED" and .code == "UNAUTHENTICATED"' || echo "FAIL: Should return expected error shape"

STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/tts/preview" \
  -H "Content-Type: application/json" \
  -d '{"text":"test"}')
if [ "$STATUS" != "401" ]; then
  echo "FAIL: Should return 401, got $STATUS"
  exit 1
fi
curl -s -X POST "$BASE_URL/api/tts/preview" \
  -H "Content-Type: application/json" \
  -d '{"text":"test"}' | jq -e '.success == false and .error == "AUTH_REQUIRED" and .code == "UNAUTHENTICATED"' || echo "FAIL: Should return expected error shape"

# Test 2: Authenticated requests work
echo "Test 2: Authenticated requests work"
curl -s -X POST "$BASE_URL/api/caption/preview" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ssotVersion":3,"mode":"raster","text":"test","lines":["test"],"rasterW":500,"rasterH":100,"yPx_png":960,"totalTextH":50,"yPxFirstLine":935,"frameW":1080,"frameH":1920,"fontPx":48}' | jq -e '.ok == true' || echo "FAIL: Should return 200 with ok:true"

curl -s -X POST "$BASE_URL/api/caption/render" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"placement":"custom","yPct":0.5,"text":"test","fontPx":48}' | jq -e '.success == true' || echo "FAIL: Should return 200 with success:true"

# Test 3: Concurrency limit (5 simultaneous renders → 3 process, 2 get 503)
echo "Test 3: Concurrency limit"
# Start 5 renders in background
for i in {1..5}; do
  curl -s -X POST "$BASE_URL/api/studio/finalize" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"studioId":"test"}' &
done
wait
# Check logs for 503 responses (2 should get 503)

echo "=== Smoke Tests Complete ==="
```

### Fault Injection Tests

#### Test A: Temp File Cleanup
```bash
# Simulate failed render (inject error mid-way)
# 1. Start render
# 2. Kill process mid-way (SIGTERM)
# 3. Verify temp dir is cleaned up
# 4. Check disk usage doesn't grow
```

#### Test B: Timeout Triggers
```bash
# 1. Mock slow URL (httpbin.org/delay/120)
# 2. Call fetchVideoToTmp(slowUrl)
# 3. Verify timeout triggers after 60s
# 4. Verify error is handled gracefully
```

#### Test C: Credit Refund
```bash
# 1. Start render
# 2. Spend credits (mock)
# 3. Inject error after credit spend (mock upload failure)
# 4. Verify refundCredits() is called
# 5. Verify user credits are restored
```

#### Test D: Session Size Limit
```bash
# 1. Create session with 1000+ shots (mock)
# 2. Try to save session
# 3. Verify SESSION_TOO_LARGE error
# 4. Verify session is not saved
```

#### Test E: Concurrency Limit
```bash
# 1. Start 5 simultaneous renders
# 2. Verify 3 process successfully
# 3. Verify 2 get 503 with retryAfter: 30
# 4. Verify active renders metric is tracked
```

---

## 5) Rollback Plan

### Commit #1: Add Auth to Public Routes
**Rollback**: Remove `requireAuth` middleware from 3 routes  
**Risk**: Low (reverts to original unsafe state)  
**Verification**: Unauthenticated requests work again

### Commit #2: Add Temp File Cleanup
**Rollback**: Remove finally blocks, restore original code  
**Risk**: Low (reverts to original leaky state)  
**Verification**: Temp files accumulate again

### Commit #3: Add Limit to Firestore Fallback Query
**Rollback**: Remove `.limit(1000)` from fallback query  
**Risk**: Low (reverts to original unbounded query)  
**Verification**: Fallback query loads all documents

### Commit #4: Add maxResults to Storage getFiles() Calls
**Rollback**: Remove `maxResults: 1000` from 4 calls  
**Risk**: Low (reverts to original unbounded enumeration)  
**Verification**: getFiles() loads all files

### Commit #5: Add Render Concurrency Limits
**Rollback**: Remove semaphore module, restore original routes  
**Risk**: Low (reverts to original unbounded concurrency)  
**Verification**: Unlimited concurrent renders allowed

### Commit #6: Add Timeouts to External API Calls
**Rollback**: Remove AbortController/timeout wrappers  
**Risk**: Medium (reverts to original hanging requests)  
**Verification**: Fetch calls can hang indefinitely

### Commit #7: Add Credit Refunds on Render Failure
**Rollback**: Remove try/catch with refund logic  
**Risk**: Low (reverts to original credit leakage)  
**Verification**: Credits not refunded on failure

### Commit #8: Add Session Size Limit
**Rollback**: Remove size check from saveJSON()  
**Risk**: Low (reverts to original unbounded growth)  
**Verification**: Large sessions can be saved

### Commit #9: Document Blocking Architecture + Increase Timeout
**Rollback**: Revert server timeout to 10 minutes, remove comments  
**Risk**: Low (reverts to original timeout)  
**Verification**: 10-minute timeout restored

---

## 6) Launch Gate Checklist

### Pre-Commit Checklist (for each commit)
- [ ] Code changes reviewed (self-review sufficient for P0 fixes)
- [ ] Changes are minimal and focused (no refactoring)
- [ ] No breaking changes introduced
- [ ] Error handling is graceful (no uncaught exceptions)

### Post-Commit Checklist (for each commit)
- [ ] Smoke tests pass
- [ ] Targeted fault injection test passes
- [ ] No regressions in existing functionality
- [ ] Logs show expected behavior

### Pre-Launch Checklist (after all commits)
- [ ] All 9 P0 fixes committed and tested
- [ ] Smoke tests pass in staging environment
- [ ] Fault injection tests pass
- [ ] Disk usage monitored (temp cleanup working)
- [ ] Concurrency limits tested under load
- [ ] Credit refunds tested with mock failures
- [ ] Session size limits tested
- [ ] Server timeout increased to 15 minutes
- [ ] Documentation updated (code comments added)
- [ ] Rollback plan documented and tested

### Post-Launch Monitoring
- [ ] Monitor 401 responses on previously public routes (should be normal)
- [ ] Monitor disk usage (should not grow unbounded)
- [ ] Monitor Firestore read costs (fallback usage should be 0 after index deployed)
- [ ] Monitor Storage operation costs (should decrease with maxResults)
- [ ] Monitor 503 responses (concurrency limits working)
- [ ] Monitor timeout errors (should decrease with increased timeout)
- [ ] Monitor credit refunds (should occur on failures)
- [ ] Monitor session save failures (SESSION_TOO_LARGE errors)

---

## 7) Definition of Done (Per P0)

### P0 #1: Public Routes Auth + Payload Caps
- [ ] `requireAuth` added to 3 routes
- [ ] Route-local `express.json({ limit: "200kb" })` replaces global parser for these routes
- [ ] Unauthenticated requests return 401 with expected error shape
- [ ] Authenticated requests work normally
- [ ] Payloads >200kb are rejected (413 status)
- [ ] No breaking changes

### P0 #2: Temp File Cleanup
- [ ] Finally blocks added to renderStory()
- [ ] Finally block added to finalizeStudioMulti()
- [ ] Cleanup added to timeline() caller
- [ ] Failed render cleans up temp files
- [ ] Successful render still works

### P0 #3: Firestore Query Limit
- [ ] `.limit(1000)` added to fallback query
- [ ] Fallback query caps at 1000 documents
- [ ] Primary path unchanged (still uses index)

### P0 #4: Storage Enumeration Limit
- [ ] `maxResults: 1000` added to 4 getFiles() calls
- [ ] getFiles() calls cap at 1000 files
- [ ] Cleanup operations still work

### P0 #5: Session Size Limit
- [ ] JSON.stringify() changed to remove pretty-printing (no null, 2 args)
- [ ] 500KB size limit enforced before save
- [ ] Large session save fails with SESSION_TOO_LARGE error
- [ ] Error message is clear and actionable

### P0 #6: Concurrency Limits
- [ ] Semaphore module created
- [ ] Concurrency limit (3) applied to render routes
- [ ] 503 with retryAfter returned when limit exceeded
- [ ] 5 simultaneous renders → 3 process, 2 get 503

### P0 #7: External API Timeouts
- [ ] 60s timeout added to fetchVideoToTmp()
- [ ] 30s timeout added to fetchImageToTmp()
- [ ] 60s timeout added to Firebase uploads (Promise.race wrapper)
- [ ] localPath file NOT deleted until upload promise settles
- [ ] 30s timeout added to TTS service calls
- [ ] Slow URL → timeout triggers correctly

### P0 #8: Credit Refunds
- [ ] Credit spending tracked with flag
- [ ] Refund logic added to render routes
- [ ] Failed render after credit spend → refund occurs
- [ ] Successful render → no refund

### P0 #9: Blocking Architecture (Mitigation)
- [ ] Server timeout increased to 15 minutes
- [ ] Code comments added documenting blocking behavior
- [ ] Background job queue migration planned (P2)

---

## 8) Risks & Mitigations

### Implementation Risks

1. **Breaking Changes**: All fixes are additive (no removals) → Low risk
2. **Performance Impact**: Timeouts may fail legitimate slow connections → Acceptable trade-off
3. **Concurrency Limits**: Users may see 503 under load → Better than server crash
4. **Session Size Limits**: Existing large sessions may fail → Prevents future bloat

### Operational Risks

1. **Disk Cleanup**: If cleanup fails silently, temp files still accumulate → Monitor disk usage
2. **Credit Refunds**: If refund fails, user still loses credits → Log refund failures, manual review
3. **Timeout Too Short**: Legitimate slow connections may fail → Monitor timeout errors, adjust if needed

### Mitigations

- All changes are incremental and reversible
- Extensive testing before launch
- Post-launch monitoring for all metrics
- Rollback plan for each commit

---

## Conclusion

This meta-plan addresses all 9 P0 launch risks with incremental, testable, reversible commits. Each commit is independently testable and can be rolled back if needed. The plan prioritizes safety and minimal changes over perfect architecture (background job queue is P2).

**Estimated Timeline**: 4-5 days of focused work  
**Risk Level**: Medium (changes are additive, minimal refactoring)  
**Launch Readiness**: Ready after all P0 fixes are committed and tested

---

**End of Meta-Plan**

