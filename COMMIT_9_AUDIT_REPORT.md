# Commit #9 Audit Report: Server Timeout Configuration & Blocking Routes

**Date**: Pre-implementation audit  
**Scope**: Verify server timeout wiring and identify blocking render routes  
**Goal**: Confirm safety of increasing server.timeout from 10min to 15min

---

## A) Server Creation + Timeout Wiring

### A1. Server Creation

**File**: `server.js:26-30`

```javascript
let server;
function start() {
  server = app.listen(PORT, HOST, () => {
    console.log(`🚀 Vaiform backend running on http://${HOST}:${PORT}`);
  });
```

**Analysis**:
- `app.listen()` is called on line 28
- Returns an `http.Server` instance (Node.js standard behavior)
- Stored in module-level variable `server` (line 26)
- **Entry point**: `server.js:51` calls `start()`
- **No other server entrypoints found** (grep confirmed: only `app.listen` in server.js)

### A2. Timeout Assignment

**File**: `server.js:32-35`

```javascript
  // Set server timeouts to handle long-running image generation requests
  server.timeout = 600000; // 10 minutes
  server.keepAliveTimeout = 65000; // 65 seconds
  server.headersTimeout = 66000; // 66 seconds
```

**Current Values**:
- `server.timeout = 600000` (10 minutes / 600 seconds)
- `server.keepAliveTimeout = 65000` (65 seconds)
- `server.headersTimeout = 66000` (66 seconds)
- `server.requestTimeout`: **NOT SET** (not present in code)

**Critical Verification**:
- ✅ Timeout assignment (line 33) applies to the **SAME** `server` instance from `app.listen()` (line 28)
- ✅ Assignment occurs **AFTER** `app.listen()` but **BEFORE** any requests are handled
- ✅ `server` variable is module-scoped, so timeout applies to the actual listening server

**Console Log Confirmation**:
- Line 37: `console.log(\`⏱️  Server timeouts configured: timeout=${server.timeout}ms, keepAlive=${server.keepAliveTimeout}ms, headers=${server.headersTimeout}ms\`);`
- Confirms timeout values are logged at boot time

---

## B) Blocking Route Confirmation

### B1. POST /api/studio/finalize

**File**: `src/routes/studio.routes.js:158-179`

**Route Handler**:
```javascript
r.post("/finalize", ensureStudio(true), enforceCreditsForRender(), async (req, res) => {
  // ... validation ...
  try {
    // ... back-compat path ...
    // New path: multi-format → run and emit events via bus, return JSON fallback
    const out = await withRenderSlot(() => finalizeStudioMulti({
      uid: req.user.uid,
      studioId,
      renderSpec: renderSpec || {},
      formats: formats || ["9x16","1x1","16x9"],
      wantImage,
      wantAudio,
      voiceover,
      wantAttribution,
      onProgress: (e) => sendEvent(studioId, e.event || 'progress', e),
    }));
    // ... response handling ...
  }
});
```

**Blocking Call**: `await withRenderSlot(() => finalizeStudioMulti({...}))` at **line 169**

**What `withRenderSlot` Does** (`src/utils/render.semaphore.js:9-22`):
```javascript
export async function withRenderSlot(fn) {
  if (activeRenders >= MAX_CONCURRENT_RENDERS) {
    const err = new Error("SERVER_BUSY");
    err.code = "SERVER_BUSY";
    throw err;
  }
  activeRenders++;
  try {
    return await fn();  // ← BLOCKS HERE: awaits the function execution
  } finally {
    activeRenders--;
  }
}
```

**Analysis**:
- `withRenderSlot` is a **concurrency limiter**, NOT a background job queue
- It **awaits** the function execution (line 18), making it **synchronous/blocking**
- The HTTP request handler blocks until `finalizeStudioMulti()` completes
- `finalizeStudioMulti` runs full render pipeline (downloads, TTS, FFmpeg, uploads) before returning

**Confirmation**: Route handler awaits the result before sending response (line 198: `return res.json({ success: true, ... })`)

### B2. POST /api/story/finalize

**File**: `src/routes/story.routes.js:484-500`

**Route Handler**:
```javascript
r.post("/finalize", enforceCreditsForRender(), async (req, res) => {
  try {
    // ... validation ...
    const { sessionId } = parsed.data;
    const session = await withRenderSlot(() => finalizeStory({
      uid: req.user.uid,
      sessionId,
      options: req.body.options || {}
    }));
    // ... response handling ...
  }
});
```

**Blocking Call**: `await withRenderSlot(() => finalizeStory({...}))` at **line 496**

**Analysis**:
- Same pattern as studio finalize
- `withRenderSlot` awaits `finalizeStory()` execution (blocking)
- `finalizeStory` runs full pipeline (generation, planning, rendering, uploads) before returning
- HTTP request blocks until completion

**Confirmation**: Route handler awaits the result before sending response (line 513: `return res.json({ success: true, ... })`)

---

## C) Other Timeout Constraints (Exhaustive Search)

### C1. Express/Connect Timeout Middleware

**Grep Results**: `express-timeout`, `connect-timeout`, `timeout.*middleware`, `timeout.*handler`

**Result**: **NO MATCHES FOUND**

**Conclusion**: No Express timeout middleware in use

### C2. Request/Response Timeout Utilities

**Grep Results**: `requestTimeout`, `res.setTimeout`, `req.setTimeout`

**Result**: **NO MATCHES FOUND** (in route files or app.js)

**Conclusion**: No per-request timeout utilities

### C3. AbortController in Render Routes

**Grep Results**: `AbortController` in `src/routes/studio.routes.js` and `src/routes/story.routes.js`

**Result**: **NO MATCHES FOUND**

**Conclusion**: No AbortController timeouts in finalize routes

**Note**: `src/routes/cdn.routes.js:19-20` has AbortController with 10s timeout, but this is for GET `/cdn` proxy route only (not render routes)

### C4. Reverse Proxy Timeout Configuration

**Files Checked**:
- `netlify.toml` - Contains proxy redirects (lines 21-38) but **NO timeout settings**
- No `nginx.conf` found
- No Cloudflare config files found

**Analysis**:
- `netlify.toml` proxies `/api/*` to backend (line 22-25), but Netlify function timeouts are configured in Netlify dashboard, not in-repo
- **In-repo**: No reverse proxy timeout configuration found

**Risk Assessment**:
- Netlify function timeout (if applicable) may override server timeout
- This is **outside repo scope** (deployment configuration)
- For Commit #9, we assume backend runs directly (not via Netlify Functions)

### C5. Other Server Timeout Properties

**Grep Results**: `headersTimeout`, `keepAliveTimeout`, `requestTimeout`

**Results**:
- `server.js:34-35`: `keepAliveTimeout` and `headersTimeout` set (already documented)
- **No `requestTimeout` property found** (this is not a standard Node.js http.Server property)

**Conclusion**: All server timeout properties are already documented in section A2

### C6. Summary: Other Timeout Constraints

**NO OTHER IN-REPO REQUEST TIMEOUTS FOUND**

**Findings**:
- ✅ No Express timeout middleware
- ✅ No per-request timeout utilities
- ✅ No AbortController timeouts in render routes
- ✅ No reverse proxy timeout config in-repo (netlify.toml has proxies but no timeout settings)
- ⚠️  Netlify function timeout (if backend runs via Netlify) is outside repo scope

---

## D) Existing Documentation/Comments

### D1. Server Timeout Comment

**File**: `server.js:32`

```javascript
// Set server timeouts to handle long-running image generation requests
```

**Analysis**:
- Generic comment about "long-running image generation requests"
- Does NOT mention blocking architecture
- Does NOT mention render routes
- Does NOT mention scalability limitations

### D2. Blocking Architecture Comments in Routes

**Search Results**: 
- `src/routes/studio.routes.js`: No comments about blocking architecture
- `src/routes/story.routes.js`: No comments about blocking architecture

**Conclusion**: **NO EXISTING COMMENTS** about blocking architecture in route files

### D3. Documentation in Audit/Plan Files

**Found in**:
- `LAUNCH_READINESS_STOPLIGHT_MAP.md:386-413` - Documents blocking architecture as P0 risk
- `P0_LAUNCH_READINESS_META_PLAN.md:454-486` - Documents blocking architecture
- `RENDER_PIPELINE_AUDIT.md:14-46` - Documents blocking architecture

**Analysis**: Documentation exists in markdown files, but **NOT in code comments**

---

## E) Recommendation

### E1. Safety Assessment

**Is it safe to proceed with minimal diffs for Commit #9?**

✅ **YES - SAFE TO PROCEED**

**Rationale**:
1. ✅ Server timeout is correctly wired to the actual listening server instance
2. ✅ No other in-repo timeouts that would override/undermine server.timeout
3. ✅ Blocking routes are clearly identified (studio/story finalize)
4. ✅ No existing code comments to duplicate (we can add new ones)
5. ✅ Timeout increase is backward compatible (only extends allowed duration)
6. ⚠️  Netlify function timeout (if applicable) is outside repo scope but unlikely to affect direct backend deployments

### E2. Minimal Diff Plan

**Changes Required**:

1. **`server.js:32-33`**:
   - Update comment to document blocking architecture
   - Change `server.timeout` from `600000` to `900000` (15 minutes)
   - Keep `keepAliveTimeout` and `headersTimeout` unchanged (independent semantics)

2. **`src/routes/studio.routes.js`** (before line 169):
   - Add comment documenting that `withRenderSlot(() => finalizeStudioMulti(...))` blocks HTTP request

3. **`src/routes/story.routes.js`** (before line 496):
   - Add comment documenting that `withRenderSlot(() => finalizeStory(...))` blocks HTTP request

**No other changes needed**:
- No middleware changes
- No route logic changes
- No new dependencies
- No breaking changes

---

## F) Verification Checklist

After implementation, verify:

- [ ] `grep -n "server.timeout" server.js` shows `900000`
- [ ] Server boots successfully
- [ ] Console log shows `timeout=900000ms` (line 37)
- [ ] Comments added in route files
- [ ] No syntax errors or linting issues

---

## G) Risk Summary

| Risk | Status | Mitigation |
|------|--------|------------|
| Timeout not applied to listening server | ✅ Safe | Verified: same `server` instance |
| Other timeouts override server.timeout | ✅ Safe | No other in-repo timeouts found |
| Breaking changes | ✅ Safe | Only increases timeout (backward compatible) |
| Netlify function timeout (external) | ⚠️  Outside scope | Deployment config, not in-repo |

---

**End of Audit Report**

