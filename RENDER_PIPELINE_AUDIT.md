# Render Pipeline Audit Report

**Date**: Generated from codebase analysis  
**Scope**: FFmpeg rendering, downloads, overlays, TTS stitching, uploads, background jobs

---

## Executive Summary

This audit examines the render pipeline architecture, concurrency, resource management, failure handling, and observability. **Critical finding**: All render work runs **blocking inside HTTP requests** with no background job queue, creating severe scalability and reliability risks.

---

## 1) HTTP Blocking vs Background Jobs

### ⛔ **CRITICAL: All renders run blocking in HTTP requests**

**Evidence**:

1. **Studio finalize** (`src/routes/studio.routes.js:157-211`)
   - Route: `POST /api/studio/finalize`
   - Calls `finalizeStudioMulti()` which blocks until render completes
   - Line 168: `await finalizeStudioMulti({ ... })` - **blocks HTTP response**
   - Credits spent **after** render succeeds (line 190), but request blocks entire time

2. **Story render** (`src/routes/story.routes.js:483-504`)
   - Route: `POST /api/story/finalize`
   - Calls `finalizeStory()` → `renderStory()` which blocks
   - Line 497: `await finalizeStory({ ... })` - **blocks HTTP response**
   - Render can take 2-10+ minutes for multi-segment videos

3. **Shorts service** (`src/services/shorts.service.js:28-705`)
   - Called from routes (likely blocking)
   - Entire render pipeline executes synchronously
   - No job queue, no async processing

**Exception (background job)**:
- `src/controllers/generate.controller.js:227` - AI image generation uses `setImmediate()` for background processing
- Returns 202 immediately, processes async
- **This pattern is NOT used for video rendering**

**How it dies**:
- Multiple simultaneous renders exhaust Node.js event loop
- HTTP timeouts (600s server timeout) cause client retries → duplicate renders
- No queue → renders compete for CPU/memory → cascade failures
- Client connection drops → credits already spent but render continues invisibly

---

## 2) Concurrency: Multiple Renders at Once?

### ⛔ **NO concurrency limits**

**Evidence**:
- **No queue system**: No BullMQ, pg-boss, or custom queue
- **No semaphore/limit**: Multiple users can trigger renders simultaneously
- **Sequential per-request only**: Each request processes its render sequentially, but requests are concurrent

**Locations**:
- `src/services/studio.service.js:348-541` - No concurrency guards
- `src/services/story.service.js:743-1042` - Renders segments in loop (sequential per story, but multiple stories concurrent)
- `src/utils/ffmpeg.video.js:1849-1933` - `renderAllFormats()` renders 3 formats sequentially, but multiple calls concurrent

**How it dies**:
- 5 users render simultaneously → 5 FFmpeg processes + downloads → server OOM
- Disk I/O saturation from concurrent temp file writes
- Network bandwidth exhaustion from concurrent video downloads

**Resource competition**:
- FFmpeg spawns subprocesses (no process pool)
- Each render creates temp dirs (`os.tmpdir()`) - no cleanup until completion
- Multiple large video downloads (`MAX_BYTES=200MB`) concurrent → network/timeout issues

---

## 3) Temp Files: Creation and Cleanup

### ✅ **Creation: Proper**
- Uses `os.tmpdir()` via `fs.mkdtempSync()` for isolated directories
- Pattern: `vaiform-{jobId}-`, `vaiform-story-render-`, `vaiform-timeline-`

### ⚠️ **Cleanup: INCOMPLETE**

**Good cleanup**:
1. **Shorts service** (`src/services/shorts.service.js:644-645, 700-701`)
   ```javascript
   try { if (imageTmpPath) fs.unlinkSync(imageTmpPath); } catch {}
   try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
   ```
   - **Problem**: Only in success path AND outer catch
   - **Missing**: Not in all error paths

2. **Story service** (`src/services/story.service.js:761`)
   - Creates `tmpDir` but **NEVER cleans it up**
   - Line 761: `const tmpDir = fs.mkdtempSync(...)` 
   - **No cleanup in finally blocks or error handlers**

3. **FFmpeg timeline** (`src/utils/ffmpeg.timeline.js:136`)
   - Creates `tmpDir` but returns it without cleanup
   - Caller (`story.service.js:659`) doesn't clean up either

4. **Studio service** (`src/services/studio.service.js:407`)
   - `renderAllFormats()` creates `tmpRoot` (line 1851)
   - **No cleanup** - relies on caller or OS temp cleanup

5. **Video/image fetch** (`src/utils/video.fetch.js:28, src/utils/image.fetch.js:19`)
   - Creates individual temp files
   - **No cleanup** - files accumulate until OS cleanup

**How it dies**:
- Failed renders leave temp dirs → disk fills up over days
- Server restart doesn't clean `/tmp` → disk full → all renders fail
- No monitoring of disk usage → silent failures

**Missing finally blocks**:
- `story.service.js:renderStory()` - no cleanup in finally
- `studio.service.js:finalizeStudioMulti()` - no cleanup in finally  
- `shorts.service.js:createShortService()` - cleanup only in success/outer catch, not in intermediate failures

---

## 4) Timeouts

### ✅ **FFmpeg timeouts: Present**

**Location**: `src/utils/ffmpeg.js:71-139`
- Default: 300s (5 minutes)
- Configurable via `opts.timeout`
- Kills process with `SIGKILL` on timeout

**Location**: `src/utils/ffmpeg.timeline.js:96-127`
- Concatenation: 300s (5 minutes)
- Uses `setTimeout()` with `clearTimeout()` cleanup

**Location**: `src/utils/ffmpeg.video.js:1742` (implicit via `runFfmpeg`)
- Video render uses `runFFmpeg()` from `ffmpeg.js` → 300s default

**Problem**: Timeout too short for multi-segment stories
- 8 segments × 5s each = 40s render per segment
- Plus concatenation = 60s+
- Total can exceed 5min easily

### ⛔ **External API timeouts: MISSING**

**No timeouts found for**:
1. **TTS synthesis** (`src/services/tts.service.js`)
   - Calls OpenAI/ElevenLabs APIs
   - No timeout wrapper → can hang indefinitely
   - **Evidence**: `src/services/story.service.js:782` - `await synthVoiceWithTimestamps()` - no timeout

2. **Video downloads** (`src/utils/video.fetch.js:21`)
   - Uses native `fetch()` - no timeout
   - `MAX_BYTES=200MB` - large downloads can timeout at network level
   - **No AbortController timeout**

3. **Image downloads** (`src/utils/image.fetch.js:12`)
   - Uses native `fetch()` - no timeout
   - Same issue

4. **Storage uploads** (`src/utils/storage.service.js`)
   - Firebase Storage uploads - no timeout found
   - Large files (200MB) can hang on slow connections

5. **Pexels API** (stock video/image search)
   - No timeout found in search calls
   - Network hangs → request blocks indefinitely

### ✅ **Server HTTP timeout: Present**

**Location**: `server.js:33`
- `server.timeout = 600000` (10 minutes)
- Applies to all HTTP requests

**Problem**: 
- Renders can exceed 10min → client gets timeout
- Server continues rendering in background
- Credits already spent, user sees error, but render may complete later
- **No idempotency** → retry creates duplicate render

---

## 5) Failure Handling

### ⚠️ **Partial uploads: NO rollback**

**Evidence**:
- `src/services/studio.service.js:456-460` - Uploads formats sequentially
- If upload #2 fails, #1 is already uploaded
- **No cleanup of partial uploads**
- Firebase Storage charges for storage → costs accumulate

**Studio multi-format** (`src/services/studio.service.js:456-460`):
```javascript
if (want9x16 && rr.files["9x16"]) { await up(...); }
if (want1x1 && rr.files["1x1"]) { await up(...); }
// If this fails, 9x16 is already uploaded
```

**Story segments** (`src/services/story.service.js:766-944`):
- Renders segments in loop
- If segment 5 fails, segments 1-4 already rendered
- **No cleanup** - orphaned segments consume disk

### ✅ **Credit refunds: Partial implementation**

**Refunds exist**:
- `src/services/credit.service.js:214-217` - `refundCredits()` function
- Used in AI image generation (`src/controllers/generate.controller.js:267, 319, etc.`)
- Used in assets controller (`src/controllers/assets.controller.js:163, 175, 191`)

**Refunds MISSING for renders**:
- `src/services/shorts.service.js:667` - Credits spent **after** render succeeds
- **If render fails, credits already spent → NO refund**
- **Evidence**: Line 570 `throw err;` - error thrown but credits not refunded

- `src/routes/studio.routes.js:190` - Credits spent **after** `finalizeStudioMulti()` succeeds
- **If render fails before this line, credits already checked but not spent** (middleware check)
- **If render fails after uploads, credits spent but render incomplete → NO refund**

- `src/routes/story.routes.js:504` - Credits spent **after** `finalizeStory()` succeeds
- Same issue

**Credit spending timing**:
- Middleware (`enforceCreditsForRender()`) checks credits **before** render starts
- Credits actually spent **after** render completes
- **Race condition**: If credits spent between check and spend, render can fail after spending

### ⚠️ **Retries: None for renders**

**Evidence**:
- No retry logic in render paths
- FFmpeg failures are final
- Network failures during download → no retry
- Storage upload failures → no retry

**Exception**: `src/utils/ffmpeg.video.js:1747-1767` - Retries FFmpeg once if colorspace filter fails (specific case only)

---

## 6) Resource Caps

### ✅ **File size limits**

**Video downloads** (`src/utils/video.fetch.js:7`):
- `MAX_BYTES = 200MB` (configurable via `VIDEO_MAX_BYTES` env)
- Checked during download (line 36)
- **Problem**: No cumulative limit - can download multiple 200MB files concurrently

**Image downloads** (`src/utils/image.fetch.js:6`):
- `MAX_BYTES = 8MB` (hardcoded)
- Checked during download

### ✅ **Story beats limit**

**Location**: `src/services/story.service.js:29`
- `MAX_BEATS = 8`
- Enforced in validation (line 1054)

### ⛔ **Missing caps**

1. **Memory**: No memory limits
   - FFmpeg processes can consume GBs
   - Multiple concurrent renders → OOM

2. **CPU**: No CPU throttling
   - FFmpeg uses all available cores
   - No process priority/niceness

3. **Disk space**: No monitoring
   - Temp files accumulate
   - No cleanup of failed renders
   - Disk full → all renders fail silently

4. **Max render duration**: No limit
   - Stories can be arbitrarily long (8 beats × duration)
   - FFmpeg timeout (5min) may be too short

5. **Max concurrent renders**: No limit
   - Unlimited concurrent requests
   - Server can be overwhelmed

6. **Max assets per render**: No limit
   - Studio can render 3 formats + poster + audio = 5 outputs
   - Each can be large
   - No cumulative size check

---

## 7) Observability

### ✅ **Request ID: Present**

**Location**: `src/app.js` (request ID middleware)
- Adds `reqId` to requests
- Logged in console output

**Problem**: Not consistently propagated to all log statements

### ✅ **Job ID: Present**

**Evidence**:
- `jobId` generated in services: `render-${Date.now().toString(36)}-${Math.random()...}`
- `story-${Date.now().toString(36)}`
- `shorts-${Date.now().toString(36)}-...`
- Stored in Firestore (`shorts` collection)
- Returned to client

### ⚠️ **Per-phase duration logs: Partial**

**Good logging**:
- `src/utils/ffmpeg.js:707-715` - Logs render duration: `[render.image] done in ${duration}ms`
- `src/services/studio.service.js:353` - Progress callbacks with timestamps
- `src/services/story.service.js:934` - Logs segment completion

**Missing**:
- No structured phase timing (download, TTS, render, upload)
- No aggregate timing per job
- No slow query detection

### ⚠️ **Error shapes: Inconsistent**

**Good error details**:
- `src/services/shorts.service.js:540-547` - Logs detailed error with `stderr`, `filterComplex`, `duration`
- `src/utils/ffmpeg.video.js:1770-1778` - Enhanced error with `filter`, `stderr`, `code`

**Problems**:
- Some errors are plain strings: `throw new Error('RENDER_FAILED')`
- No error codes/categories for monitoring
- Firestore error details truncated (2000 chars max)

**Error logging locations**:
- Console.error() calls throughout
- No centralized error tracking (Sentry, etc.)
- No error aggregation/monitoring

---

## Summary: Launch Risks

### ⛔ **CRITICAL Risks**

1. **All renders block HTTP requests**
   - **Impact**: Server unresponsive under load, timeouts, duplicate renders
   - **Fix**: Move to background job queue (BullMQ, pg-boss)

2. **No concurrency limits**
   - **Impact**: OOM, disk exhaustion, network saturation
   - **Fix**: Add semaphore/queue with max concurrent renders

3. **Temp files not cleaned up on failure**
   - **Impact**: Disk fills over days, silent failures
   - **Fix**: Add finally blocks, cleanup on all error paths

4. **No credit refunds on render failure**
   - **Impact**: Users lose credits for failed renders
   - **Fix**: Refund credits in catch blocks, use transactions

5. **No timeouts on external APIs**
   - **Impact**: Hanging requests, resource exhaustion
   - **Fix**: Add AbortController timeouts to all fetch calls

6. **Partial uploads not rolled back**
   - **Impact**: Storage costs, orphaned files
   - **Fix**: Delete partial uploads on failure, or use transaction-like patterns

### ⚠️ **HIGH Risks**

7. **No memory/CPU limits**
   - **Impact**: Server OOM under load
   - **Fix**: Add resource monitoring, process limits

8. **No retry logic**
   - **Impact**: Transient failures cause permanent failures
   - **Fix**: Add retries with exponential backoff for network operations

9. **HTTP timeout too short for long renders**
   - **Impact**: Clients timeout, server continues rendering invisibly
   - **Fix**: Move to async jobs, or increase timeout + add progress polling

---

## Guardrails Needed (Minimal Diffs)

### Priority 1: Temp file cleanup

**File**: `src/services/story.service.js`
```javascript
// After line 1040, add finally block:
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
```

**File**: `src/services/studio.service.js`
- Add cleanup in `finalizeStudioMulti()` finally block
- Cleanup `tmpRoot` from `renderAllFormats()`

### Priority 2: Credit refunds

**File**: `src/services/shorts.service.js`
```javascript
// Wrap credit spending in try/catch, refund on failure
try {
  // ... render logic ...
  await spendCredits(ownerUid, RENDER_CREDIT_COST);
} catch (err) {
  // If credits were spent but render failed, refund
  try {
    await refundCredits(ownerUid, RENDER_CREDIT_COST);
  } catch (refundErr) {
    console.error('[shorts] Refund failed:', refundErr);
  }
  throw err;
}
```

### Priority 3: External API timeouts

**File**: `src/utils/video.fetch.js`
```javascript
// Add AbortController with 60s timeout
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 60000);
try {
  const res = await fetch(url, { signal: controller.signal, ... });
  clearTimeout(timeoutId);
  // ... rest of logic ...
} catch (err) {
  clearTimeout(timeoutId);
  if (err.name === 'AbortError') throw new Error('VIDEO_DOWNLOAD_TIMEOUT');
  throw err;
}
```

### Priority 4: Concurrency limit (quick fix)

**File**: `src/routes/studio.routes.js` (add at top of file)
```javascript
let activeRenders = 0;
const MAX_CONCURRENT_RENDERS = 3;

// In finalize route:
if (activeRenders >= MAX_CONCURRENT_RENDERS) {
  return res.status(503).json({ success: false, error: 'SERVER_BUSY' });
}
activeRenders++;
try {
  await finalizeStudioMulti({ ... });
} finally {
  activeRenders--;
}
```

---

## What's Already Solid

✅ **FFmpeg timeouts** - Properly implemented with cleanup  
✅ **File size limits** - Enforced during download  
✅ **Job IDs** - Generated and tracked  
✅ **Error details** - Good logging in most places  
✅ **Story beat limits** - Enforced  
✅ **Credit checking** - Atomic transactions  
✅ **Temp dir isolation** - Uses mkdtempSync for isolation  

---

## Recommendations

1. **Immediate (Pre-launch)**:
   - Add temp file cleanup in finally blocks
   - Add credit refunds on render failure
   - Add external API timeouts

2. **Short-term (Post-launch)**:
   - Move renders to background job queue
   - Add concurrency limits
   - Add retry logic for network operations

3. **Medium-term**:
   - Add resource monitoring (memory, disk, CPU)
   - Implement structured logging with correlation IDs
   - Add error tracking (Sentry)

4. **Long-term**:
   - Distributed job queue for horizontal scaling
   - Rate limiting per user
   - Cost monitoring/alerts



