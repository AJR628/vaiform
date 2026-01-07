# Vaiform Launch Readiness - Comprehensive Stoplight Map

**Date**: December 2024  
**Scope**: Full-stack audit synthesizing Firestore/Storage, Routes, and Render Pipeline audits  
**Goal**: Identify launch-blocking risks and minimum guardrails required for production readiness

---

## Executive Summary

This report synthesizes findings from three comprehensive audits:
1. **Firestore & Storage Access Patterns** (FIRESTORE_STORAGE_AUDIT_REPORT.md)
2. **Route Security & API Patterns** (ROUTE_TRUTH_TABLE.md)
3. **Render Pipeline Architecture** (RENDER_PIPELINE_AUDIT.md)

**Critical Findings**:
- **⛔ 9 P0 Launch Risks** requiring immediate fixes
- **⚠️ 12 P1 Guardrails** needed before scale
- **✅ 15 Safe Patterns** already in place

**Stoplight Breakdown**:
- ⛔ Launch Risk: 9 items (security, data loss, cost, outage risks)
- ⚠️ Needs Guardrails: 12 items (clear fixes exist, not structural)
- ✅ Safe: 15 items (properly protected, validated, limited)

---

## Stoplight Classification Map

### 🔴 P0 - ⛔ Launch Risk (Fix Before Launch)

#### 1. Public Routes Without Authentication (DoS & Cost Amplification)

**Area**: Route Security  
**Stoplight**: ⛔ **Launch Risk**  
**Evidence**:
- `src/routes/caption.preview.routes.js:65` - `POST /api/caption/preview` - No `requireAuth` middleware
- `src/routes/caption.render.routes.js:8` - `POST /api/caption/render` - No `requireAuth` middleware  
- `src/routes/tts.routes.js:5` - `POST /api/tts/preview` - No `requireAuth` middleware

**Failure Mode**:
- Unauthenticated users can spam canvas rendering (CPU-intensive, no timeout)
- Unauthenticated users can exhaust TTS API quotas (external API calls)
- Large payloads (10mb) accepted without rate limiting → DoS via memory exhaustion
- No request limits → cost amplification attacks

**Minimal Guardrail**:
```javascript
// src/routes/caption.preview.routes.js:65
router.post("/caption/preview", requireAuth, express.json(), async (req, res) => {
  // ... existing handler ...
});

// src/routes/caption.render.routes.js:8
router.post("/caption/render", requireAuth, express.json(), async (req, res) => {
  // ... existing handler ...
});

// src/routes/tts.routes.js:5
r.post("/preview", requireAuth, ttsPreview);
```

**DoD**:
- [ ] Add `requireAuth` middleware to all three routes
- [ ] Test unauthenticated requests return 401
- [ ] Verify authenticated requests still work
- [ ] Add rate limiting middleware (P1) to prevent abuse by authenticated users

---

#### 2. Temp File Leakage (Disk Exhaustion)

**Area**: Render Pipeline  
**Stoplight**: ⛔ **Launch Risk**  
**Evidence**:
- `src/services/story.service.js:761` - Creates `tmpDir` via `fs.mkdtempSync()` but **never cleans up** (no finally block at line 1042)
- `src/services/studio.service.js:1851` - `renderAllFormats()` creates `tmpRoot` but **no cleanup** in caller
- `src/utils/ffmpeg.timeline.js:136` - Creates `tmpDir` but returns without cleanup, caller doesn't clean
- `src/services/shorts.service.js:644-645` - Cleanup only in success/outer catch, missing from intermediate failures

**Failure Mode**:
- Failed renders leave temp directories in `/tmp` → disk fills up over days
- Server restart doesn't clean `/tmp` → disk full → all renders fail with "ENOSPC: no space left on device"
- No monitoring → silent failures until disk is 100% full
- After ~100 failed renders, disk exhausted

**Minimal Guardrail**:
```javascript
// src/services/story.service.js:743-1042
export async function renderStory({ uid, sessionId }) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaiform-story-render-'));
  try {
    // ... existing render logic ...
  } finally {
    // Cleanup temp directory
    try {
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch (cleanupErr) {
      console.warn('[story.service] Cleanup failed:', cleanupErr.message);
    }
  }
}

// src/services/studio.service.js:348-541
export async function finalizeStudioMulti({ ... }) {
  let tmpRoot = null;
  try {
    // ... existing logic ...
    tmpRoot = await renderAllFormats({ ... });
    // ... upload logic ...
  } finally {
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      try {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.warn('[studio.service] Cleanup failed:', cleanupErr.message);
      }
    }
  }
}
```

**DoD**:
- [ ] Add finally blocks to `renderStory()` with tmpDir cleanup
- [ ] Add finally block to `finalizeStudioMulti()` with tmpRoot cleanup
- [ ] Add cleanup to `fetchClipsToTmp()` caller in story.service.js:659
- [ ] Test failed render cleans up temp files
- [ ] Test successful render cleans up temp files
- [ ] Monitor disk usage in staging after 50+ renders

---

#### 3. Unbounded Firestore Queries (Cost Blowup)

**Area**: Firestore Access  
**Stoplight**: ⛔ **Launch Risk**  
**Evidence**:
- `src/controllers/shorts.controller.js:406-408` - Fallback query loads ALL shorts for user without `.limit()`:
```javascript
const snapshot = await db.collection('shorts')
  .where('ownerId', '==', ownerUid)
  .get();  // ⚠️ NO LIMIT
```

**Failure Mode**:
- When index missing (code 9 error), fallback path loads all user documents (could be 1000+)
- O(n) reads where n = total shorts per user → cost blowup
- In-memory sort of all documents → performance degradation
- Unbounded growth with user activity

**Minimal Guardrail**:
```javascript
// src/controllers/shorts.controller.js:406
const snapshot = await db.collection('shorts')
  .where('ownerId', '==', ownerUid)
  .limit(1000)  // ADD THIS - hard cap for fallback
  .get();
```

**DoD**:
- [ ] Add `.limit(1000)` to fallback query
- [ ] Verify primary path still uses `.limit(24)` with index
- [ ] Deploy Firestore index: `ownerId ASC, createdAt DESC`
- [ ] Test fallback path with 1000+ user shorts (should cap at 1000)
- [ ] Monitor fallback usage (should be 0 after index deployed)

---

#### 4. Unbounded Storage File Enumeration (Cost & Memory)

**Area**: Storage Access  
**Stoplight**: ⛔ **Launch Risk**  
**Evidence**:
- `src/services/studio.service.js:546` - `getFiles()` without `maxResults`:
```javascript
const [files] = await bucket.getFiles({ prefix: `artifacts/${uid}/`, autoPaginate: true });
```
- `src/services/studio.service.js:567` - Same issue
- `src/services/studio.service.js:699` - Same issue  
- `src/services/studio.service.js:742` - Same issue

**Failure Mode**:
- Could enumerate thousands of files per user → cost blowup
- Loads all file metadata into memory → OOM risk
- Slow enumeration for users with many artifacts → timeouts
- Storage API charges per operation

**Minimal Guardrail**:
```javascript
// src/services/studio.service.js:546, 567, 699, 742
const [files] = await bucket.getFiles({ 
  prefix: `artifacts/${uid}/`, 
  autoPaginate: true,
  maxResults: 1000  // ADD THIS - hard cap
});
```

**DoD**:
- [ ] Add `maxResults: 1000` to all 4 `getFiles()` calls
- [ ] Test with user having 2000+ files (should cap at 1000)
- [ ] Verify cleanup operations still work correctly
- [ ] Monitor Storage operation counts (should decrease)

---

#### 5. Story Sessions Unbounded Growth (Storage Cost)

**Area**: Storage Access  
**Stoplight**: ⛔ **Launch Risk**  
**Evidence**:
- `src/utils/json.store.js` - Story sessions stored as single JSON files in Storage (`drafts/{uid}/{sessionId}/story.json`)
- No size limits enforced before save
- No cleanup job for expired sessions (`expiresAt` checked in-memory only)
- `session.shots[].candidates[]` arrays grow unbounded with clip searches

**Failure Mode**:
- Session objects accumulate `shots[]`, `candidates[]`, `renderedSegments[]` → JSON files can grow to MB+
- No cleanup or TTL enforcement → storage bloat
- Large JSON downloads slow session loads → timeout risk
- Per-user session count unbounded (only TTL-based expiration checked in memory)

**Minimal Guardrail**:
```javascript
// src/utils/json.store.js - Before save:
const json = JSON.stringify(session);
const sizeBytes = Buffer.byteLength(json, 'utf8');
const MAX_SESSION_SIZE = 500 * 1024; // 500KB
if (sizeBytes > MAX_SESSION_SIZE) {
  throw new Error(`SESSION_TOO_LARGE: ${sizeBytes} bytes exceeds ${MAX_SESSION_SIZE}`);
}
```

**DoD**:
- [ ] Enforce max session size (500KB) before save
- [ ] Implement background cleanup job for expired sessions (check `expiresAt` field)
- [ ] Set Storage lifecycle policy: delete `drafts/` files older than TTL_HOURS
- [ ] Test large session (100+ shots) fails with clear error
- [ ] Test cleanup job removes expired sessions
- [ ] Monitor Storage size per user

---

#### 6. No Concurrency Limits on Renders (OOM & CPU Exhaustion)

**Area**: Render Pipeline  
**Stoplight**: ⛔ **Launch Risk**  
**Evidence**:
- `src/services/studio.service.js:348-541` - `finalizeStudioMulti()` - No concurrency guards
- `src/services/story.service.js:743-1042` - `renderStory()` - No concurrency guards
- `src/routes/studio.routes.js:157-211` - No semaphore/queue system
- `src/routes/story.routes.js:483-525` - No semaphore/queue system

**Failure Mode**:
- 10 users trigger renders simultaneously → 10 FFmpeg processes + downloads → server OOM
- Disk I/O saturation from concurrent temp file writes
- Network bandwidth exhaustion from concurrent video downloads (200MB each)
- No queue → renders compete for CPU/memory → cascade failures

**Minimal Guardrail**:
```javascript
// src/routes/studio.routes.js - Add at top of file:
let activeRenders = 0;
const MAX_CONCURRENT_RENDERS = 3;

// In finalize route (line 157):
if (activeRenders >= MAX_CONCURRENT_RENDERS) {
  return res.status(503).json({ success: false, error: 'SERVER_BUSY', retryAfter: 30 });
}
activeRenders++;
try {
  await finalizeStudioMulti({ ... });
} finally {
  activeRenders--;
}

// Similar pattern for src/routes/story.routes.js:483
```

**DoD**:
- [ ] Add concurrency limit (3 concurrent renders) to studio finalize route
- [ ] Add concurrency limit (3 concurrent renders) to story finalize route
- [ ] Return 503 with `retryAfter` when limit exceeded
- [ ] Test 5 simultaneous render requests (3 should process, 2 should get 503)
- [ ] Monitor active renders metric

---

#### 7. External API Calls Without Timeouts (Hanging Requests)

**Area**: External API Reliability  
**Stoplight**: ⛔ **Launch Risk**  
**Evidence**:
- `src/utils/video.fetch.js:21` - `fetch()` calls have no timeout (can hang indefinitely)
- `src/services/tts.service.js:102` - Retry logic exists but no per-request timeout
- `src/utils/storage.js:13` - Firebase Storage uploads have no timeout
- `src/utils/image.fetch.js:12` - `fetch()` calls have no timeout

**Failure Mode**:
- Video download hangs → HTTP request blocks indefinitely → server thread stuck
- Firebase upload hangs on slow connections → request blocked indefinitely  
- TTS API call hangs → render pipeline stalls → user waits forever
- Multiple hanging requests → server unresponsive

**Minimal Guardrail**:
```javascript
// src/utils/video.fetch.js:21
export async function fetchVideoToTmp(url, maxBytes = MAX_BYTES) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    // ... existing logic ...
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new Error('VIDEO_DOWNLOAD_TIMEOUT');
    }
    throw err;
  }
}

// Similar pattern for image.fetch.js, storage.js uploads
```

**DoD**:
- [ ] Add AbortController with 60s timeout to `fetchVideoToTmp()`
- [ ] Add AbortController with 30s timeout to image.fetch.js
- [ ] Add timeout to Firebase Storage uploads (60s)
- [ ] Add timeout wrapper to TTS service calls (30s)
- [ ] Test timeout triggers correctly (mock slow network)
- [ ] Test successful requests still work

---

#### 8. Credit Leakage on Render Failure (User Loss)

**Area**: Payment & Credits  
**Stoplight**: ⛔ **Launch Risk**  
**Evidence**:
- `src/routes/studio.routes.js:188-195` - Credits spent **after** render succeeds, but if upload fails after render → credits already spent
- `src/routes/story.routes.js:502-509` - Same pattern
- `src/services/shorts.service.js:665-672` - Credits spent after render, but no refund on failure

**Failure Mode**:
- Upload fails after render succeeds → credits already spent (no refund)
- Firestore write fails after upload → credits spent but video not linked to user
- Thumbnail extraction fails → credits still spent (non-critical failure)
- Users lose credits for failed renders → support burden + trust loss

**Minimal Guardrail**:
```javascript
// src/routes/studio.routes.js:188-195
let creditsSpent = false;
try {
  // ... render logic ...
  await spendCredits(ownerUid, RENDER_CREDIT_COST);
  creditsSpent = true;
  // ... upload logic ...
} catch (err) {
  if (creditsSpent) {
    try {
      await refundCredits(ownerUid, RENDER_CREDIT_COST);
    } catch (refundErr) {
      console.error('[studio] Refund failed:', refundErr);
    }
  }
  throw err;
}

// Similar pattern for story.routes.js and shorts.service.js
```

**DoD**:
- [ ] Wrap credit spending in try/catch with refund on failure
- [ ] Track whether credits were spent before refund
- [ ] Add refund logic to all render paths (studio, story, shorts)
- [ ] Test failed render refunds credits
- [ ] Test successful render doesn't refund
- [ ] Test refund failure is logged but doesn't block error response

---

#### 9. All Renders Block HTTP Requests (Scalability & Timeout Risk)

**Area**: Render Pipeline Architecture  
**Stoplight**: ⛔ **Launch Risk**  
**Evidence**:
- `src/routes/studio.routes.js:168` - `await finalizeStudioMulti({ ... })` - **blocks HTTP response**
- `src/routes/story.routes.js:497` - `await finalizeStory({ ... })` - **blocks HTTP response**
- `server.js:33` - Server timeout 600s (10 minutes)
- No job queue system (no BullMQ, pg-boss, or custom queue)

**Failure Mode**:
- Long-running renders (30s-5min) block HTTP connections
- Client must wait for entire pipeline (downloads → TTS → FFmpeg → uploads)
- HTTP timeout at 10min → client timeout → server continues rendering invisibly
- No job state → can't resume or track progress
- Multiple concurrent renders → event loop exhaustion

**Note**: This is a structural issue. For launch, we can add concurrency limits (P0 #6) and increase timeouts, but full fix requires background job queue (P2).

**Minimal Guardrail** (for launch):
- Already addressed via P0 #6 (concurrency limits)
- Increase server timeout to 15 minutes for story renders
- Add progress polling endpoint (P1)

**DoD**:
- [ ] Increase server timeout to 15 minutes (server.js:33)
- [ ] Add progress endpoint for long-running renders (P1)
- [ ] Document current blocking behavior
- [ ] Plan background job queue migration (P2)

---

### 🟡 P1 - ⚠️ Needs Guardrails (Fix Soon)

#### 10. Missing Storage Rule for `drafts/` Path

**Area**: Security Rules  
**Stoplight**: ⚠️ **Needs Guardrails**  
**Evidence**:
- `storage.rules` - `drafts/{uid}/{sessionId}/story.json` not explicitly covered
- Falls through to default deny (safe) but lacks explicit rule

**Failure Mode**:
- Low risk (server-only via Admin SDK, default deny safe)
- Missing explicit rule reduces clarity

**Minimal Guardrail**:
```javascript
// storage.rules - Add:
match /drafts/{uid}/{sessionId}/{fileName} {
  allow read, write: if false; // Server-only via Admin SDK
}
```

**DoD**:
- [ ] Add explicit rule for `drafts/` path
- [ ] Deploy rules: `firebase deploy --only storage`
- [ ] Test client SDK cannot access `drafts/` paths
- [ ] Verify server Admin SDK still works

---

#### 11. Monthly Generations Query Without Limit

**Area**: Firestore Access  
**Stoplight**: ⚠️ **Needs Guardrails**  
**Evidence**:
- `src/controllers/limits.controller.js:22-24` - Queries monthly generations without explicit limit:
```javascript
const monthlyGens = await generationsRef
  .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(monthStart))
  .get();  // ⚠️ Uses .size, but still loads all docs
```

**Failure Mode**:
- O(n) reads where n = monthly generations (free: 10, pro: 250)
- Bounded by plan limits, but no hard cap
- Uses `.size` which doesn't load full documents, but still counts all matching docs

**Minimal Guardrail**:
```javascript
// src/controllers/limits.controller.js:22
const monthlyGens = await generationsRef
  .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(monthStart))
  .limit(500)  // ADD THIS - safety cap
  .get();
```

**DoD**:
- [ ] Add `.limit(500)` to monthly generations query
- [ ] Test with 300+ monthly generations (should cap at 500)
- [ ] Verify query still works correctly

---

#### 12. Stripe Webhook Events No Cleanup

**Area**: Firestore Access  
**Stoplight**: ⚠️ **Needs Guardrails**  
**Evidence**:
- `src/routes/stripe.webhook.js:85` - Webhook events stored per user with no cleanup:
```javascript
const eventRef = userRef.collection("stripe_webhook_events").doc(eventId);
await eventRef.set({ ... });  // ⚠️ Never deleted
```

**Failure Mode**:
- O(n) subcollection docs where n = lifetime webhook events per user
- Grows indefinitely (1 doc per webhook event)
- Used only for idempotency (prevents duplicate processing)

**Minimal Guardrail**:
```javascript
// src/routes/stripe.webhook.js:85 - Add TTL field:
const expiresAt = admin.firestore.Timestamp.fromDate(
  new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) // 90 days
);
await eventRef.set({ ..., expiresAt });
```

**DoD**:
- [ ] Add `expiresAt` field to webhook events (90 days)
- [ ] Configure Firestore TTL policy to auto-delete after 90 days
- [ ] Deploy TTL policy: `firebase deploy --only firestore:indexes`
- [ ] Test events older than 90 days are deleted
- [ ] Verify idempotency still works for recent events

---

#### 13. Missing Explicit Index for Monthly Generations Query

**Area**: Firestore Indexes  
**Stoplight**: ⚠️ **Needs Guardrails**  
**Evidence**:
- `src/controllers/limits.controller.js:22` - Query uses `createdAt >=` filter
- `firestore.indexes.json` - No explicit index defined for generations subcollection

**Failure Mode**:
- Firestore may auto-create single-field index, but not explicit
- Risk of missing index causing fallback query pattern
- Lower query performance without explicit index

**Minimal Guardrail**:
```json
// firestore.indexes.json - Add:
{
  "collectionGroup": "generations",
  "fields": [
    { "fieldPath": "createdAt", "order": "ASCENDING" }
  ]
}
```

**DoD**:
- [ ] Add explicit index definition to firestore.indexes.json
- [ ] Deploy indexes: `firebase deploy --only firestore:indexes`
- [ ] Verify index status in Firebase Console
- [ ] Test query performance with large monthly generation counts

---

#### 14. No Rate Limiting on Public/Auth Routes

**Area**: Route Security  
**Stoplight**: ⚠️ **Needs Guardrails**  
**Evidence**:
- `ROUTE_TRUTH_TABLE.md` - No global rate limiting middleware found
- Only daily cap on script generation (`enforceScriptDailyCap(300)`)
- No rate limits on expensive routes (caption preview, TTS preview, render routes)

**Failure Mode**:
- Authenticated users can spam expensive operations (renders, TTS, caption preview)
- DoS via rapid-fire requests to CPU-intensive endpoints
- Cost amplification by authenticated users

**Minimal Guardrail**:
```javascript
// Add express-rate-limit middleware
import rateLimit from 'express-rate-limit';

const renderRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 requests per minute
  message: 'Too many render requests, please try again later'
});

// Apply to render routes:
app.use('/api/studio/finalize', renderRateLimit);
app.use('/api/story/finalize', renderRateLimit);
```

**DoD**:
- [ ] Add rate limiting middleware (express-rate-limit)
- [ ] Apply rate limits to expensive routes (renders, TTS, caption preview)
- [ ] Test rate limit triggers correctly
- [ ] Test normal usage doesn't hit limits
- [ ] Configure appropriate limits per route

---

#### 15. Canvas Rendering No Timeout

**Area**: Route Security  
**Stoplight**: ⚠️ **Needs Guardrails**  
**Evidence**:
- `src/routes/caption.preview.routes.js:65` - Canvas rendering (no timeout found)
- Relies on server timeout of 10min

**Failure Mode**:
- CPU-intensive canvas operations can hang or take very long
- No explicit timeout → request blocked until server timeout
- DoS risk even with auth (malicious payloads)

**Minimal Guardrail**:
```javascript
// src/routes/caption.preview.routes.js - Add timeout wrapper:
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout
try {
  // ... canvas rendering ...
} finally {
  clearTimeout(timeoutId);
}
```

**DoD**:
- [ ] Add 30s timeout to canvas rendering operations
- [ ] Test timeout triggers correctly
- [ ] Test successful renders still work
- [ ] Handle timeout errors gracefully

---

#### 16. Partial Uploads Not Rolled Back

**Area**: Render Pipeline  
**Stoplight**: ⚠️ **Needs Guardrails**  
**Evidence**:
- `src/services/studio.service.js:456-460` - Uploads formats sequentially, no rollback if one fails
- If `9x16` upload succeeds but `1x1` fails → credits spent, partial result

**Failure Mode**:
- Partial uploads consume storage → costs accumulate
- Orphaned files not linked to user → storage bloat
- User sees partial result (only some formats available)

**Minimal Guardrail**:
```javascript
// src/services/studio.service.js:456 - Upload with rollback:
const uploadedFiles = [];
try {
  if (want9x16 && rr.files["9x16"]) {
    const url = await up(...);
    uploadedFiles.push({ format: '9x16', url });
  }
  if (want1x1 && rr.files["1x1"]) {
    const url = await up(...);
    uploadedFiles.push({ format: '1x1', url });
  }
} catch (err) {
  // Rollback: delete uploaded files
  for (const file of uploadedFiles) {
    try {
      await bucket.file(pathFromUrl(file.url)).delete();
    } catch (deleteErr) {
      console.warn('[studio] Rollback delete failed:', deleteErr);
    }
  }
  throw err;
}
```

**DoD**:
- [ ] Track uploaded files in array
- [ ] Delete partial uploads on failure
- [ ] Test partial upload failure cleans up
- [ ] Test successful upload doesn't delete files

---

#### 17. No Retry Logic for Network Operations

**Area**: External API Reliability  
**Stoplight**: ⚠️ **Needs Guardrails**  
**Evidence**:
- `src/utils/video.fetch.js` - No retry logic for video downloads
- `src/utils/image.fetch.js` - No retry logic for image downloads
- `src/utils/storage.js` - No retry logic for Storage uploads
- Exception: `src/services/tts.service.js:102` - Has retry logic with backoff

**Failure Mode**:
- Transient network failures cause permanent render failures
- No resilience to temporary network issues
- User must retry manually

**Minimal Guardrail**:
```javascript
// src/utils/video.fetch.js - Add retry wrapper:
async function fetchWithRetry(url, maxRetries = 2) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fetchVideoToTmp(url);
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000 * (i + 1))); // exponential backoff
    }
  }
}
```

**DoD**:
- [ ] Add retry logic (2 retries) to video downloads
- [ ] Add retry logic to image downloads
- [ ] Add retry logic to Storage uploads
- [ ] Test retry triggers on network failure
- [ ] Test successful requests don't retry unnecessarily

---

#### 18. FFmpeg Timeout Too Short for Multi-Segment Stories

**Area**: Render Pipeline  
**Stoplight**: ⚠️ **Needs Guardrails**  
**Evidence**:
- `src/utils/ffmpeg.js:80` - Default 300s (5 minutes) timeout
- `src/services/story.service.js:766-944` - Renders 8 segments sequentially
- 8 segments × 5s each = 40s render per segment, plus concatenation = 60s+
- Total can exceed 5min easily

**Failure Mode**:
- Multi-segment story renders timeout prematurely
- User sees failure even though render would complete
- Credits spent, partial renders left on disk

**Minimal Guardrail**:
```javascript
// src/services/story.service.js - Increase timeout for segment renders:
const SEGMENT_TIMEOUT = 600000; // 10 minutes for segments
await runFFmpeg({ ..., timeout: SEGMENT_TIMEOUT });
```

**DoD**:
- [ ] Increase FFmpeg timeout to 10 minutes for story segment renders
- [ ] Test 8-segment story completes successfully
- [ ] Test timeout still triggers for truly hung processes
- [ ] Document timeout rationale

---

#### 19. No RequestId Propagation in Logs

**Area**: Observability  
**Stoplight**: ⚠️ **Needs Guardrails**  
**Evidence**:
- `src/app.js` - Request ID middleware exists (`reqId`)
- `src/services/story.service.js` - Logs don't include requestId
- `src/services/studio.service.js` - Logs don't include requestId
- Inconsistent logging format (mix of console.log, console.error, console.warn)

**Failure Mode**:
- Can't correlate errors across services (no requestId)
- Hard to trace single request across service boundaries
- Difficult to debug production issues

**Minimal Guardrail**:
```javascript
// Pass requestId through service functions:
export async function renderStory({ uid, sessionId, requestId }) {
  console.log(`[${requestId}] [story.service] Starting render for session ${sessionId}`);
  // ... existing logic ...
}

// In routes, pass requestId:
await renderStory({ uid, sessionId, requestId: req.id });
```

**DoD**:
- [ ] Add requestId parameter to service functions
- [ ] Include requestId in all log statements
- [ ] Test logs show requestId consistently
- [ ] Verify requestId traces across service boundaries

---

#### 20. Missing Explicit Deny Rule for Idempotency Collection

**Area**: Security Rules  
**Stoplight**: ⚠️ **Needs Guardrails**  
**Evidence**:
- `firestore.rules` - `idempotency/{uid:key}` collection has no rules defined
- Server-only via Admin SDK, default deny safe, but lacks explicit rule

**Failure Mode**:
- Low risk (server-only, default deny safe)
- Missing explicit rule reduces clarity

**Minimal Guardrail**:
```javascript
// firestore.rules - Add:
match /idempotency/{doc} {
  allow read, write: if false; // Server-only via Admin SDK
}
```

**DoD**:
- [ ] Add explicit deny rule for idempotency collection
- [ ] Deploy rules: `firebase deploy --only firestore:rules`
- [ ] Test client SDK cannot access idempotency collection
- [ ] Verify server Admin SDK still works

---

#### 21. No Memory/CPU Limits on FFmpeg Processes

**Area**: Render Pipeline  
**Stoplight**: ⚠️ **Needs Guardrails**  
**Evidence**:
- `src/utils/ffmpeg.js` - Spawns FFmpeg processes without resource limits
- No memory limits, no CPU throttling

**Failure Mode**:
- FFmpeg processes can consume GBs of memory
- Multiple concurrent renders → OOM risk
- No process priority/niceness

**Note**: This is mitigated by P0 #6 (concurrency limits), but explicit limits provide additional safety.

**Minimal Guardrail** (Low Priority):
- Consider ulimit or process resource limits (OS-level)
- Monitor memory usage in production
- Document expected memory usage per render

**DoD**:
- [ ] Monitor FFmpeg memory usage in staging
- [ ] Document expected memory per render type
- [ ] Set up memory alerts
- [ ] Consider OS-level resource limits (ulimit)

---

### ✅ Safe Patterns (Already Properly Protected)

#### 22. Firestore Security Rules - User Access Control

**Area**: Security Rules  
**Stoplight**: ✅ **Safe**  
**Evidence**:
- `firestore.rules` - `users/{uid}` uses `isSelf(uid)` helper ✅
- `firestore.rules` - `shorts/{id}` uses `resource.data.ownerId == request.auth.uid` ✅
- Server fields (`plan`, `credits`, `membership`, `isMember`) blocked from client writes ✅
- Default deny for unmatched paths ✅

**Status**: Properly secured, no changes needed

---

#### 23. Storage Security Rules - Artifacts Access Control

**Area**: Security Rules  
**Stoplight**: ✅ **Safe**  
**Evidence**:
- `storage.rules` - `artifacts/{uid}/{jobId}/{fileName}` uses `isSelf(uid)` ✅
- Write blocked (server-only via Admin SDK) ✅
- Sharing uses download tokens (bypass rules, stored in metadata) ✅
- Default deny for all other paths ✅

**Status**: Properly secured, no changes needed

---

#### 24. Auth Middleware on Protected Routes

**Area**: Route Security  
**Stoplight**: ✅ **Safe**  
**Evidence**:
- `ROUTE_TRUTH_TABLE.md` - 60+ routes use `requireAuth` middleware ✅
- Render routes (`/api/studio/finalize`, `/api/story/finalize`) protected ✅
- Credit/spending routes protected ✅
- User data routes protected ✅

**Status**: Properly secured, except P0 #1 (public routes)

---

#### 25. Input Validation with Zod Schemas

**Area**: Route Security  
**Stoplight**: ✅ **Safe**  
**Evidence**:
- `ROUTE_TRUTH_TABLE.md` - 50+ routes use Zod validation ✅
- Story routes enforce max 8 beats, 850 chars total ✅
- Render routes validate required fields ✅
- Type safety and schema validation in place ✅

**Status**: Properly validated, no changes needed

---

#### 26. Credit Checking Before Render

**Area**: Payment & Credits  
**Stoplight**: ✅ **Safe**  
**Evidence**:
- `src/routes/studio.routes.js` - Uses `enforceCreditsForRender()` middleware ✅
- `src/routes/story.routes.js` - Uses `enforceCreditsForRender()` middleware ✅
- Credits checked before render starts ✅
- Atomic transactions for credit spending ✅

**Status**: Properly implemented, except P0 #8 (refunds on failure)

---

#### 27. File Size Limits on Downloads

**Area**: Render Pipeline  
**Stoplight**: ✅ **Safe**  
**Evidence**:
- `src/utils/video.fetch.js:7` - `MAX_BYTES = 200MB` (env configurable) ✅
- `src/utils/image.fetch.js:6` - `MAX_BYTES = 8MB` ✅
- Checked during download ✅

**Status**: Properly limited, no changes needed

---

#### 28. FFmpeg Timeouts Present

**Area**: Render Pipeline  
**Stoplight**: ✅ **Safe**  
**Evidence**:
- `src/utils/ffmpeg.js:80` - Default 300s (5 minutes) timeout ✅
- `src/utils/ffmpeg.timeline.js:98` - 300s timeout for concatenation ✅
- Kills process with `SIGKILL` on timeout ✅

**Status**: Properly implemented, except P1 #18 (may be too short for stories)

---

#### 29. TTS Retry Logic with Backoff

**Area**: External API Reliability  
**Stoplight**: ✅ **Safe**  
**Evidence**:
- `src/services/tts.service.js:51` - `MAX_TRIES = 3` (env configurable) ✅
- `src/services/tts.service.js:52` - Exponential backoff ✅
- `src/services/tts.service.js:54` - `COOLDOWN_MS = 60000` (1min) after 429 ✅

**Status**: Properly implemented, except P0 #7 (needs timeout)

---

#### 30. Job ID Generation and Tracking

**Area**: Observability  
**Stoplight**: ✅ **Safe**  
**Evidence**:
- `src/services/studio.service.js:403` - Generates `jobId = render-{timestamp}-{random}` ✅
- `src/services/story.service.js:970` - Generates `jobId = story-{timestamp}` ✅
- Stored in Firestore, returned to client ✅

**Status**: Properly implemented, except P1 #19 (needs requestId correlation)

---

#### 31. Firestore Index for Shorts Query

**Area**: Firestore Indexes  
**Stoplight**: ✅ **Safe**  
**Evidence**:
- `firestore.indexes.json` - Index defined: `ownerId ASC, createdAt DESC` ✅
- Primary query path uses index with `.limit(24)` ✅

**Status**: Properly indexed, except P0 #3 (fallback needs limit)

---

#### 32. Idempotency Key Support

**Area**: Route Security  
**Stoplight**: ✅ **Safe**  
**Evidence**:
- `src/routes/generate.routes.js:11` - Uses `idempotency()` middleware ✅
- `X-Idempotency-Key` header tracked in Firestore ✅
- Prevents duplicate processing ✅

**Status**: Properly implemented, no changes needed

---

#### 33. Server Timeout Configuration

**Area**: Render Pipeline  
**Stoplight**: ✅ **Safe**  
**Evidence**:
- `server.js:33` - `server.timeout = 600000` (10 minutes) ✅
- `server.js:34` - `keepAliveTimeout = 65000` (65 seconds) ✅
- `server.js:35` - `headersTimeout = 66000` (66 seconds) ✅

**Status**: Properly configured, may need increase for stories (see P0 #9)

---

#### 34. Story Beat Limits Enforced

**Area**: Render Pipeline  
**Stoplight**: ✅ **Safe**  
**Evidence**:
- `src/services/story.service.js:29` - `MAX_BEATS = 8` ✅
- `src/services/story.service.js:30` - `MAX_BEAT_CHARS = 160` per beat ✅
- `src/services/story.service.js:31` - `MAX_TOTAL_CHARS = 850` total ✅
- Enforced in validation ✅

**Status**: Properly limited, no changes needed

---

#### 35. Temp Directory Isolation

**Area**: Render Pipeline  
**Stoplight**: ✅ **Safe**  
**Evidence**:
- Uses `os.tmpdir()` via `fs.mkdtempSync()` for isolated directories ✅
- Pattern: `vaiform-{jobId}-`, `vaiform-story-render-`, `vaiform-timeline-` ✅

**Status**: Properly isolated, except P0 #2 (needs cleanup)

---

#### 36. CDN Proxy Timeout

**Area**: External API Reliability  
**Stoplight**: ✅ **Safe**  
**Evidence**:
- `src/routes/cdn.routes.js:10` - 10s timeout via AbortController ✅
- Origin check (Firebase Storage only) ✅

**Status**: Properly implemented, no changes needed

---

## P0 Guardrails Before Launch Checklist

### Critical Security Fixes

- [ ] **P0 #1**: Add `requireAuth` middleware to `/api/caption/preview`, `/api/caption/render`, `/api/tts/preview`
- [ ] **P0 #1**: Test unauthenticated requests return 401
- [ ] **P0 #1**: Verify authenticated requests still work

### Critical Data Integrity Fixes

- [ ] **P0 #2**: Add finally blocks to `renderStory()` with tmpDir cleanup
- [ ] **P0 #2**: Add finally block to `finalizeStudioMulti()` with tmpRoot cleanup
- [ ] **P0 #2**: Add cleanup to `fetchClipsToTmp()` caller
- [ ] **P0 #2**: Test failed render cleans up temp files
- [ ] **P0 #2**: Monitor disk usage in staging after 50+ renders

### Critical Cost Control Fixes

- [ ] **P0 #3**: Add `.limit(1000)` to `getMyShorts` fallback query
- [ ] **P0 #3**: Deploy Firestore index: `ownerId ASC, createdAt DESC`
- [ ] **P0 #3**: Test fallback path with 1000+ user shorts
- [ ] **P0 #4**: Add `maxResults: 1000` to all 4 `getFiles()` calls
- [ ] **P0 #4**: Test with user having 2000+ files
- [ ] **P0 #5**: Enforce max session size (500KB) before save
- [ ] **P0 #5**: Implement background cleanup job for expired sessions
- [ ] **P0 #5**: Set Storage lifecycle policy for `drafts/` path

### Critical Reliability Fixes

- [ ] **P0 #6**: Add concurrency limit (3) to studio finalize route
- [ ] **P0 #6**: Add concurrency limit (3) to story finalize route
- [ ] **P0 #6**: Test 5 simultaneous render requests (3 process, 2 get 503)
- [ ] **P0 #7**: Add AbortController with 60s timeout to `fetchVideoToTmp()`
- [ ] **P0 #7**: Add timeout to image.fetch.js (30s)
- [ ] **P0 #7**: Add timeout to Firebase Storage uploads (60s)
- [ ] **P0 #7**: Add timeout wrapper to TTS service calls (30s)
- [ ] **P0 #8**: Wrap credit spending in try/catch with refund on failure
- [ ] **P0 #8**: Add refund logic to all render paths
- [ ] **P0 #8**: Test failed render refunds credits

### Critical Architecture Notes

- [ ] **P0 #9**: Increase server timeout to 15 minutes (document limitation)
- [ ] **P0 #9**: Document current blocking behavior
- [ ] **P0 #9**: Plan background job queue migration (P2)

---

## P1 Guardrails After Launch (Fix Soon)

### Security & Rules

- [ ] **P1 #10**: Add explicit Storage rule for `drafts/` path
- [ ] **P1 #20**: Add explicit deny rule for idempotency collection
- [ ] **P1 #14**: Add rate limiting middleware to expensive routes

### Query & Storage Optimizations

- [ ] **P1 #11**: Add `.limit(500)` to monthly generations query
- [ ] **P1 #12**: Add TTL field to webhook events (90 days)
- [ ] **P1 #13**: Add explicit index for monthly generations query

### Reliability & Observability

- [ ] **P1 #15**: Add 30s timeout to canvas rendering operations
- [ ] **P1 #16**: Track uploaded files and rollback on failure
- [ ] **P1 #17**: Add retry logic (2 retries) to network operations
- [ ] **P1 #18**: Increase FFmpeg timeout to 10 minutes for story segments
- [ ] **P1 #19**: Add requestId propagation to all service functions

### Resource Management

- [ ] **P1 #21**: Monitor FFmpeg memory usage and set up alerts

---

## Recommended Follow-Up Audits

### High Priority

1. **Deployment & CI/CD Audit**
   - Manual deploy steps vs automated pipelines
   - Environment variable management (secrets rotation)
   - Database migration procedures
   - Rollback procedures

2. **Monitoring & Alerting Audit**
   - What metrics are tracked? (CPU, memory, disk, request latency, error rates)
   - What alerts exist? (P0 errors, disk full, memory high, cost spikes)
   - Log aggregation and search capabilities
   - Error tracking (Sentry, etc.)

3. **Cost Monitoring Audit**
   - Firebase/Firestore usage quotas and alerts
   - External API usage tracking (OpenAI, ElevenLabs, Pexels, Stripe)
   - Storage size per user limits
   - Cost per render/job tracking

### Medium Priority

4. **Load Testing Plan**
   - Test concurrent render limits (3 simultaneous)
   - Test disk cleanup under load
   - Test Firestore query performance at scale
   - Test rate limiting behavior

5. **Disaster Recovery Audit**
   - Backup procedures for Firestore/Storage
   - Recovery time objectives (RTO)
   - Recovery point objectives (RPO)
   - Data loss scenarios

6. **Background Job Queue Migration Plan**
   - Evaluate queue systems (BullMQ, pg-boss, Cloud Tasks)
   - Design job state schema
   - Plan migration from blocking HTTP to async jobs
   - Progress polling endpoint design

---

## Summary Statistics

### Stoplight Breakdown

- **⛔ Launch Risk**: 9 items (must fix before launch)
- **⚠️ Needs Guardrails**: 12 items (fix soon after launch)
- **✅ Safe**: 15 items (properly protected)

### Risk Categories

- **Security**: 3 P0 risks, 3 P1 guardrails
- **Cost**: 3 P0 risks, 3 P1 guardrails
- **Reliability**: 3 P0 risks, 6 P1 guardrails
- **Observability**: 0 P0 risks, 1 P1 guardrail

### Estimated Fix Effort

- **P0 Fixes**: ~2-3 days of focused work
  - Most are straightforward (add middleware, add limits, add finally blocks)
  - P0 #9 (background jobs) is structural but can be mitigated for launch
  
- **P1 Fixes**: ~1-2 weeks of incremental work
  - Can be done post-launch with monitoring
  - Rate limiting and observability improvements can be added gradually

---

## Conclusion

**Launch Readiness**: **⛔ NOT READY** - 9 P0 risks must be addressed before launch

**Critical Path**:
1. Fix P0 security issues (public routes) - **1 day**
2. Fix P0 data integrity (temp file cleanup) - **1 day**
3. Fix P0 cost controls (query limits, storage limits) - **0.5 days**
4. Fix P0 reliability (concurrency, timeouts, refunds) - **1 day**
5. Testing and verification - **0.5 days**

**Total Estimated Time**: 4 days of focused work to address all P0 risks

**Recommendation**: Address all P0 items before launch. P1 items can be addressed incrementally post-launch with proper monitoring in place.

---

**End of Report**





