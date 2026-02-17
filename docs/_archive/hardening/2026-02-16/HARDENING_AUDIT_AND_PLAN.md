# Vaiform Backend Hardening Audit and Plan

**Goal:** Harden backend for hundreds → thousands of users: no cost spikes, hung workers, disk blowups, or duplicate renders/charges.

**Rules:** Audit first (read-only); minimal diff; reuse existing utilities; no semantic drift; P0 stability focus.

**P0 must-fix (don’t ship without):**
1. **POST /api/story/render** – unguarded (no slot, credits, idempotency, rate limit). Harden or disable.
2. **Finalize** – TOCTOU + “free render if spend fails” + no idempotency (retries can double-render / double-charge or avoid spend). Reserve → render → confirm/refund + idempotency.
3. **SSRF + unbounded buffering** – user URLs in uploads/register and generate image_url; security + cost + hang risk. Timeout + max bytes + block private IP.
4. **Tmp/disk leaks** – TTS dirs/cache, caption dirs, karaoke .ass; kills long-running instances. Bounded cleanup / purge.

**Extra certainty (proven in §2.5 Audit Proof Pack):**
- **A) Who calls /render?** No client. Only finalize is used (creative.html one-click and article flows). Safe to gate or disable /render.
- **B) Idempotency keys today?** Only `/generate` gets `x-idempotency-key` (api.mjs auto-adds for generate). Finalize callers do **not** send it; frontend must be updated when we add idempotency to finalize.

---

## 1) Heavy Work Endpoints – Full Table

Every endpoint that can trigger FFmpeg/render, large downloads, multi-provider search, or LLM:

| Route path | Handler / service | Auth | withRenderSlot | Credits | Idempotency | Rate limit | Worst-case / risk |
|------------|------------------|------|----------------|---------|-------------|------------|-------------------|
| **POST /api/story/render** | Inline → `renderStory()` [story.routes.js:756] | Yes (r.use(requireAuth)) | **No** | **No** | **No** | **No** | FFmpeg + TTS + downloads; unbounded concurrency, no credit check |
| **POST /api/story/finalize** | `finalizeStory()` [story.routes.js:788] | Yes | Yes | Yes (`enforceCreditsForRender`) | **No** | **No** | Full pipeline; long runtime; retry = duplicate render + possible double charge |
| **POST /api/story/generate** | `generateStory()` → LLM [story.routes.js:92] | Yes | N/A | N/A | No | Yes (`enforceScriptDailyCap(300)`) | LLM; 300/day cap |
| **POST /api/story/plan** | `planShots()` → LLM [story.routes.js:400] | Yes | N/A | N/A | No | Yes (script cap) | LLM |
| **POST /api/story/search** | `searchShots()` → Pexels/Pixabay/NASA [story.routes.js:429] | Yes | N/A | N/A | **No** | **No** | Multi-provider search; no rate limit |
| **POST /api/story/search-shot** | `searchClipsForShot()` [story.routes.js:547] | Yes | N/A | N/A | **No** | **No** | Per-shot clip search; no rate limit |
| **POST /api/story/timeline** | `buildTimeline()` [story.routes.js:607] | Yes | N/A | N/A | No | No | Fetches clips to tmp, FFmpeg concat; has tmp cleanup [story.service.js:703-704] |
| **POST /api/story/captions** | `generateCaptionTimings()` [story.routes.js:625] | Yes | N/A | N/A | No | No | TTS + timings |
| **POST /api/studio/finalize** | `finalizeStudioMulti()` [studio.routes.js:172] | Yes | Yes | Yes | **No** | **No** | renderAllFormats; **unmounted** in app.js |
| **POST /api/shorts/create** | `createShort` → `createShortService()` | Yes | N/A | Yes (on route) | N/A | N/A | **Unmounted** [shorts.routes.js:9] |
| **POST /api/uploads/image** | Inline [uploads.routes.js:42] | Yes | N/A | N/A | No | Yes (10/min) | 8MB file; tmp write then unlink [uploads.routes.js:57,61] |
| **POST /api/uploads/register** | `saveImageFromUrl()` [uploads.routes.js:78, storage.service.js:36] | Yes | N/A | N/A | No | Yes (10/min) | **Fetches user-provided URL** (SSRF); buffers full body; 5min timeout |
| **GET /cdn** | Inline [cdn.routes.js:21] | No | N/A | N/A | No | Yes (300/min) | **Allowlisted** to `firebasestorage.googleapis.com` only; buffers `arrayBuffer()` with 10s timeout |
| **POST /api/tts/preview** | `ttsPreview` [tts.routes.js:24] | Yes | N/A | N/A | No | Yes (5/min) | TTS; 200kb body limit |
| **POST /api/caption/preview** | Inline [caption.preview.routes.js:105] | Yes | N/A | N/A | No | Yes (previewRateLimit) | Caption preview; 200kb |
| **POST /api/caption/render** | Inline [caption.render.routes.js:26] | Yes | N/A | N/A | No | Yes (renderRateLimit) | Caption render |
| **POST /generate** (and /api/generate) | `generate` [generate.routes.js:11] | Yes | N/A | Debit in controller | Yes (idempotency.firestore) | No (per-route) | Image gen; fetches `options.image_url` / `imageUrl` (user URL); idempotency stores **full response body** |

**File:line references (guards):**

- `withRenderSlot`: [src/utils/render.semaphore.js](src/utils/render.semaphore.js) – used in story.routes.js:788, studio.routes.js:165,172.
- `enforceCreditsForRender`: [src/middleware/planGuards.js](src/middleware/planGuards.js):159 – used in story.routes.js:773, studio.routes.js:158.
- Story `/render` has no slot/credits/idempotency/rate limit: [src/routes/story.routes.js](src/routes/story.routes.js):744–769.

---

## 2) New Issues – Investigation Results

### A) Temp files + disk growth

**Locations and cleanup:**

| Location | File:line | Bounded? | Cleanup strategy |
|----------|-----------|----------|------------------|
| **vaiform-story-render-*** | story.service.js:1267, 1812–1813 | Yes (one dir per render) | `finally { fs.rmSync(tmpDir, { recursive: true, force: true }) }` |
| **vaiform-timeline-*** | ffmpeg.timeline.js:237 | Yes | Caller (buildTimeline) cleans tmpDir in story.service.js:703–704 |
| **vaiform-tts-cache** (disk) | tts.service.js:61 `diskDir = join(tmpdir(), "vaiform-tts-cache")` | **No** | **Never purged.** Files written via `toDisk(k, buf)` [tts.service.js:95–99]. No TTL or max-size cleanup. |
| **vaiform-tts-*** (per-request dirs) | tts.service.js:161, 181, 385 `mkdtemp(join(tmpdir(), "vaiform-tts-"))` | Yes (one per request) | **Not cleaned** – dirs created for cached copy [161, 181] and for render output [385]; caller (story render) uses audio path then cleans only `tmpDir` (story-render), not these TTS dirs. **Leak.** |
| **{id}-*** (renderAllFormats)** | ffmpeg.video.js:2062 | Yes | Caller finalizeStudioMulti cleans in studio.service.js:545–546 |
| **{jobId}-*** (shorts)** | shorts.service.js:32 | Yes | Cleaned in finally/catch at 672, 726–728 |
| **vaiform-upload-*** | uploads.routes.js:57 | Yes | Unlink at 61 on success; **on throw before 61, tmp file leaks** |
| **vaiform-caption-*** | captionFile.js:13 | **No** | `writeCaptionFile()` creates `mkdtempSync(..., 'vaiform-caption-')` and returns file path. Callers (ffmpeg.js:248, 488) **never delete the dir**. **Leak.** |
| **vaiform-{uuid}.ass** (root tmp) | karaoke.ass.js:399, 815 | **No** | Files written to `join(tmpdir(), "vaiform-"+uuid+".ass")`. Not under story’s tmpDir; **never cleaned**. **Leak.** |
| **vaiform-txt-*** | ffmpeg.video.js:1029 | Needs trace | Used in export path; caller must clean |
| **os.tmpdir()/shorts/{jobId}** | renderCaptionImage.js:306 | Depends on caller | Used by preview/diag; shorts create (unmounted) would use same jobId tmpRoot – if preview/diag only, may accumulate |

**Summary:** Unbounded: (1) TTS disk cache dir, (2) TTS per-request temp dirs (cached + render), (3) vaiform-caption-* dirs, (4) vaiform-*.ass files. Upload tmp leaks on error path.

---

### B) SSRF / untrusted URL fetch

| Surface | File:line | Source | Risk | Current | Recommended |
|---------|-----------|--------|------|---------|-------------|
| **POST /api/uploads/register** | uploads.routes.js:78, storage.service.js:36–60 | `req.body.imageUrl` | High | Fetch arbitrary https; 5min timeout; **full body buffered** (`arrayBuffer()`) with no max size; no content-type/length check | Allowlist hostnames or block private IPs; max response size (e.g. 10MB); validate content-type image/* |
| **POST /generate (image_url)** | generate.controller.js:172, 643 | `options.image_url` / body | High | `fetch(options.image_url)` / `fetch(imageUrl)`; **no timeout**; `Buffer.from(await resp.arrayBuffer())` – unbounded | withAbortTimeout; max bytes (e.g. 10MB); block private IP/localhost |
| **Link extract** | link.extract.js:45, 115 | User URL + OpenAI API | Medium (first: user URL) | First fetch wrapped with withAbortTimeout(20s); second fetch (LLM) **no timeout** | Add withAbortTimeout to second fetch; consider URL allowlist for first (or block private IP) |
| **CDN GET /cdn?u=** | cdn.routes.js:21–120 | Query `u` | Low | **Strict allowlist**: protocol https, hostname `firebasestorage.googleapis.com`, pathname `/v0/b/`. No private IP needed (already restricted). | Optional: reject if URL resolves to private IP (defense in depth) |
| **Provider results replayed** | story render path | Clips from Firestore (Pexels/Pixabay/NASA URLs) | Low | URLs from our providers; fetched in video.fetch.js / image.fetch with timeout (video 60s, image 30s). No explicit private-IP block | Optional: block private IP in video.fetch/image.fetch for defense in depth |

**Recommendation:** (1) Central helper: `fetchWithSafety(url, { timeoutMs, maxBytes, allowPrivate: false })` that blocks localhost/private IP unless allowlisted. (2) Use in uploads/register, generate.controller, link.extract. (3) Cap buffer size everywhere (stream or abort when over max).

---

### C) Idempotency middleware – Firestore doc size

**Current:** [src/middleware/idempotency.firestore.js](src/middleware/idempotency.firestore.js):39–41 – on `res.json(body)` it stores:

```js
await docRef.set({ state: 'done', status, body, finishedAt: new Date() }, { merge: true });
```

So the **entire response `body`** is stored. For:

- **POST /generate:** body can be large (e.g. image URLs, metadata) – often OK.
- **POST /api/story/finalize** (if we add this middleware): body = `{ success: true, data: session, shortId }`. `session` can be **very large** (full story, shots, clips, sentences, captions, finalVideo, etc.). Firestore document size limit is **1 MiB**. A big session can exceed that and cause `set()` to fail or bloat the collection.

**Recommendation:**

- Do **not** store the full finalize response body in idempotency.
- Store a **minimal payload**: e.g. `{ state: 'done', status: 200, shortId: session?.finalVideo?.jobId ?? null, sessionId }` so retries can return a stable 200 with the same shortId without re-running render.
- Optionally store a **pointer**: `{ state: 'done', status: 200, jobDoc: 'shorts/{jobId}' }` and have client fetch the job doc for full result. Then idempotency doc stays small and safe under 1 MiB.

---

### D) Credits: check → render → spend consistency

**Current flow (e.g. story finalize):**

1. **Check:** `enforceCreditsForRender()` [planGuards.js:159] – reads `users/{uid}.credits`, returns 402 if &lt; 20.
2. **Render:** `withRenderSlot(() => finalizeStory(...))` – runs full pipeline.
3. **Spend:** If `session?.finalVideo?.url`, `spendCredits(uid, 20)` in a Firestore transaction.
4. **Refund:** Only if `res.json()` throws after credits were spent [story.routes.js:814–819].

**Risks:**

- **Free render if spend fails:** If `spendCredits()` throws (e.g. INSUFFICIENT_CREDITS because balance changed), the route logs and does **not** fail the request – so user gets 200 and video URL but no deduction. **Credits can be “free rendered”.**
- **Retry = duplicate render + double charge:** No idempotency. Two identical POSTs → two renders; if balance ≥ 40, both spend 20 → double charge.
- **TOCTOU:** Between check and spend, another request can deduct credits; second request may pass check then fail at spend (user sees 200 + success body but we failed to deduct – same as above).

**Recommended P0 flow (reserve → render → confirm/refund):**

1. **Idempotency:** Require `x-idempotency-key`; store minimal result (shortId/sessionId), not full body.
2. **Reserve:** In a Firestore transaction: deduct 20 from `users/{uid}.credits` and write a reservation record (e.g. `reservations/{idempotencyKey}` or `idempotency/{uid}:{key}` with `reserved: 20`). If balance &lt; 20, abort and return 402.
3. **Render:** Run `withRenderSlot(() => finalizeStory(...))`.
4. **Confirm:** On success – mark reservation as consumed (no second deduction). On failure – **refund:** in a transaction add 20 back to `users/{uid}.credits` and mark reservation as refunded.

This way: one key = one reserve, one render, one confirm or refund; no double charge; no free render (reserve already deducted).

---

### E) Validation gaps on “options” payloads

| Where | File:line | Current | Risk | Recommended |
|-------|-----------|---------|------|-------------|
| **Story finalize** | story.routes.js:791 | `options: req.body.options \|\| {}` passed to `finalizeStory`. No Zod. | finalizeStory does not currently use `options` in code paths (grep options. in story.service.js: no matches). Low today; future fields could drive cost. | Add optional schema e.g. `OptionsSchema = z.object({ ... }).strict().optional()` and pass only parsed data; or document “no options used” and reject non-empty until defined. |
| **Studio finalize** | studio.routes.js:55–62, 161 | `renderSpec: z.any().optional()`, `formats: z.array(...).optional()`. | `renderSpec` is unvalidated; can be huge or contain cost-driving fields (duration, resolution, etc.). | Validate renderSpec: max depth, allowed keys, durationSec/tailPadSec bounds, max size. |
| **Generate** | generate.controller.js:117, 155 | `options = body.options \|\| {}`; used for image_base64, provider-specific. | Free-form; image_url fetched without validation; count/steps already bounded elsewhere. | Validate options: image_url must be string URL if present; max length; optional allowlist for host. |

**Exact fields to validate (sane bounds):**

- **Story finalize options:** If/when used: e.g. `voicePreset`, `captionMode` – enum only; no free-form blobs.
- **Studio renderSpec:** `output.durationSec` (e.g. 1–120), `output.tailPadSec` (e.g. 0–30), `voiceoverDelaySec`, `tailPadSec`; reject unknown top-level keys or cap object size.
- **Generate options:** `image_url` string length and allowed schemes (https only); `image_base64` max length if used.

---

## 2.5) Audit Proof Pack (read-only verification)

**Purpose:** Prove Commit 1 and Commit 2 won’t break anything; confirm call sites and semantics before implementation.

### A) Client call graph: /api/story/render vs /api/story/finalize

**POST /api/story/render**

- **Repo-wide search:** No client calls this endpoint.
  - **Web frontend:** [public/creative.html](public/creative.html) – no occurrence of `/story/render` or `story/render`. All story flows use `/story/finalize` only.
  - **Web (React):** [web/src](web/src) – no story render; studio uses `/api/studio/finalize` ([web/src/lib/api.ts](web/src/lib/api.ts):102).
  - **Scripts:** [scripts/test-caption-parity.mjs](scripts/test-caption-parity.mjs):125 calls `${baseUrl}/api/render` with caption payload – that is **caption** render, not `/api/story/render`. [test-overlay-system.mjs](test-overlay-system.mjs) uses `/api/caption/render`. No script calls `/api/story/render`.
  - **Docs/examples:** Only docs and route definition reference it (ROUTE_TRUTH_TABLE.md, security-notes.md, story.routes.js:743).
- **Conclusion:** **No client depends on POST /api/story/render.** Safe to disable in prod (or gate behind env) once confirmed in your deployment.

**POST /api/story/finalize**

- **Call sites:**

| File | Line | Wrapper | Body | x-idempotency-key? | Retries? |
|------|------|---------|------|--------------------|----------|
| [public/creative.html](public/creative.html) | 6037 | `apiFetch('/story/finalize', { method: 'POST', body: { sessionId } })` | `{ sessionId }` | **No** | No (single fetch) |
| [public/creative.html](public/creative.html) | 9756 | `apiFetch('/story/finalize', { method: 'POST', body: { sessionId, options: { voicePreset } } })` | `{ sessionId, options }` | **No** | No |

- **apiFetch behavior:** [public/api.mjs](public/api.mjs):112–198. Adds `Authorization` for paths starting with `/story/`. **Does not** add `x-idempotency-key` for `/story/finalize` – only for `path.startsWith("/generate")` POST (lines 140–143). No automatic retry; single `fetch()`.
- **Implication for Commit 2:** Clients do **not** send `x-idempotency-key` today. Adding required idempotency to finalize means the **frontend must be updated** to send a key (e.g. `sessionId` + user action id, or `crypto.randomUUID()` per “Finalize” click) or we return 400 until they do. Recommend: add key in [public/creative.html](public/creative.html) at both call sites (e.g. `headers: { 'X-Idempotency-Key': sessionId + '-' + Date.now() }` or a stable key per session+action).

---

### B) Idempotency semantics today

- **Source:** [src/middleware/idempotency.firestore.js](src/middleware/idempotency.firestore.js).
- **Doc key schema:** `idempotency/{uid}:{key}` where `key = req.get('X-Idempotency-Key')`, `uid = req.user?.uid || 'anon'`.
- **States:** `pending` (set in transaction when doc missing); `done` (set on `res.json(body)` when status &lt; 500). If doc exists and state is `pending` → 409 IN_PROGRESS. If state is `done` → return `d.body` with `d.status`.
- **Persistence / TTL:** `expiresAt: new Date(Date.now() + ttlMinutes * 60 * 1000)` is written (default `ttlMinutes = 60`). There is **no background job** that deletes by `expiresAt`; docs remain until overwritten or manually deleted. Collisions: same `uid` + same key → deterministic 409 or cached response.
- **Routes using idempotency:** Only [src/routes/generate.routes.js](src/routes/generate.routes.js):11 – `r.post("/generate", requireAuth, idempotency(), ...)`. No other route uses Firestore idempotency.
- **Response body size risk:** Middleware stores **full `body`** (line 39). For **POST /generate**, response is typically `{ images, ... }` – can be large but usually under 1 MiB. For **POST /api/story/finalize**, if we used the same middleware without change, `body` would be `{ success: true, data: session, shortId }`; `session` can exceed **1 MiB** (full story, shots, clips, sentences, captions). So finalize **must not** use the same “store full body” behavior – use minimal payload (e.g. `{ state, status, shortId, sessionId }`) or store reservation in same doc and return minimal body for idempotent response.

---

### C) /api/story/finalize credit flow (exact behavior)

- **Trace:** [src/routes/story.routes.js](src/routes/story.routes.js):773–824.
  1. **Check:** `enforceCreditsForRender()` runs before handler (line 773). Reads `users/{uid}.credits`; if &lt; 20 returns **402** with `INSUFFICIENT_CREDITS`. No deduction.
  2. **Render:** `withRenderSlot(() => finalizeStory({ uid, sessionId, options }))` (788). Blocks until render completes.
  3. **Spend:** If `session?.finalVideo?.url` (795), calls `spendCredits(req.user.uid, RENDER_CREDIT_COST)` (798). On **success** sets `creditsSpent = true`. On **failure** (catch 800–802): logs error, **does not** set creditsSpent, **does not** return – execution continues to line 806.
  4. **Response:** `return res.json({ success: true, data: session, shortId })` (807–811). So if spend failed, user still gets **200** and full session with video URL – **“free render”**.
  5. **Refund path:** Only if `res.json()` throws (812–821): if `creditsSpent && !res.headersSent`, refund 20 and rethrow.
- **Status codes today:** 400 (invalid body), 402 (insufficient credits), 500 (finalize failed), 503 (SERVER_BUSY). On success always **200** with `{ success: true, data: session, shortId }`.
- **Confirmed:** “Free render if spend fails” is true. Retries cause duplicate render and, if balance allows, double spend (no idempotency).

---

### D) Temp/disk leak proof (creator → callers → leak reason)

| Prefix / location | Creator (file:line) | Callers | Cleanup? | Leak reason |
|-------------------|----------------------|--------|----------|-------------|
| **vaiform-caption-** | [src/utils/captionFile.js](src/utils/captionFile.js):13 `mkdtempSync(..., 'vaiform-caption-')` | [src/utils/ffmpeg.js](src/utils/ffmpeg.js):248, 488 – `writeCaptionFile()` returns **file** path (caption.txt), not dir. FFmpeg uses file; no code ever deletes the parent dir. | **No** | Callers only have file path; dir is never removed. |
| **vaiform-{uuid}.ass** | [src/utils/karaoke.ass.js](src/utils/karaoke.ass.js):399, 815 `join(tmpdir(), "vaiform-"+randomUUID()+".ass")` – file in **tmpdir() root**, not inside any tmpDir. | [src/services/story.service.js](src/services/story.service.js):1328, 1564 (buildKaraokeASSFromTimestamps); [src/services/shorts.service.js](src/services/shorts.service.js):239 (buildKaraokeASS). Story finally cleans only `tmpDir` (vaiform-story-render-*); ASS file is outside that. | **No** | ASS path is not under tmpDir; finally only does rmSync(tmpDir). |
| **vaiform-tts-** (dirs) | [src/services/tts.service.js](src/services/tts.service.js):161, 181, 385 `mkdtemp(join(tmpdir(), "vaiform-tts-"))` | synthVoice returns `audioPath` (file inside dir). Callers: story.service (renderStory), shorts.service – they pass path to FFmpeg then clean their **own** tmpDir (story-render or jobId). They never receive or delete the TTS dir. | **No** | TTS returns path to file; callers don’t have reference to parent dir; only story/shorts tmpDir is cleaned. |
| **vaiform-tts-cache** | [src/services/tts.service.js](src/services/tts.service.js):61 `diskDir = join(tmpdir(), "vaiform-tts-cache")`; toDisk() writes files. | Used only inside tts.service; no purge by mtime or size. | **No** | No TTL or max-size cleanup implemented. |

---

### E) Other heavy endpoints missing guards (mounted only)

- **POST /api/story/render** – no slot, no credits, no idempotency, no rate limit (only mounted “heavy” one missing all).
- **POST /api/story/finalize** – has slot + credits; missing idempotency + rate limit.
- **POST /api/story/search**, **POST /api/story/search-shot** – no rate limit (multi-provider / clip search).

All other heavy endpoints either have rate limit, or are unmounted (studio finalize, shorts create).

---

### Recommended order for Commit 1 and Commit 2

1. **Commit 1:** Safe to **gate** POST /api/story/render: no client calls it. Prefer **env flag** `DISABLE_STORY_RENDER_ROUTE=1` → 405; otherwise add slot + credits (no hardcode “disable in prod” until you’ve confirmed in your own prod traffic).
2. **Commit 2:** Add idempotency + reserve→render→confirm/refund for finalize. **Requires frontend change** to send `x-idempotency-key` from both creative.html finalize call sites; otherwise return 400. Store reservation in the **same** idempotency doc (not a separate collection); store minimal payload for done state so body size stays under 1 MiB.

---

## 3) Updated Build Plan – 3–4 Commits (P0 → P1)

### Commit 1 — Lock down unprotected render entry points (P0)

- **File:** [src/routes/story.routes.js](src/routes/story.routes.js).
- **Change (minimal, no hardcode “disable in prod” until proven):** Gate by **env flag** so unknown clients aren’t broken:
  - If `process.env.DISABLE_STORY_RENDER_ROUTE === '1'` → return **405** with `RENDER_DISABLED`, detail “Use POST /api/story/finalize to render.”
  - **Else** add same guards as finalize: `enforceCreditsForRender()`, `withRenderSlot(() => renderStory(...))`, and (if product intent) spend-after-success/refund-on-fail. No idempotency/rate limit required for this route if it stays dev-only.
- **Rationale:** Audit proved **no client calls POST /api/story/render**. You can set `DISABLE_STORY_RENDER_ROUTE=1` in prod after deploy; if any hidden client appears, leave unset and rely on slot+credits.
- **Confirm:** No other mounted route calls `renderStory` without slot + credits (already confirmed).

**Verification:**  
With `DISABLE_STORY_RENDER_ROUTE=1`: `curl -X POST <host>/api/story/render ...` → 405. Without flag: 200 only with credits + slot (if fallback behavior implemented).

---

### Commit 2 — Idempotency + credit reservation for finalize (P0)

- **Files:** [src/routes/story.routes.js](src/routes/story.routes.js), [src/routes/studio.routes.js](src/routes/studio.routes.js), [src/services/credit.service.js](src/services/credit.service.js), [src/middleware/idempotency.firestore.js](src/middleware/idempotency.firestore.js) (or finalize-specific variant).
- **Changes:**
  1. Add idempotency to POST `/api/story/finalize` (and POST `/api/studio/finalize` when mounted). Require `x-idempotency-key`. **Store reservation in the same idempotency doc** (no separate collection): e.g. in pending doc add `reservedCredits: 20`; on done store minimal `{ state: 'done', status: 200, shortId, sessionId }` (no full session body) so Firestore doc stays under 1 MiB.
  2. Reserve → render → confirm/refund:
     - In transaction when creating idempotency “pending”: deduct 20 from `users/{uid}.credits` and set `reservedCredits: 20` on the **same** idempotency doc. If balance &lt; 20, abort and return 402.
     - Run `withRenderSlot(finalizeStory...)`. On success: update idempotency doc to done with minimal payload; no second deduction. On failure: refund 20 to user and update doc (e.g. delete or mark refunded).
  3. **Frontend:** Add `X-Idempotency-Key` at both finalize call sites in [public/creative.html](public/creative.html) (e.g. 6037, 9756). Key can be `sessionId + '-' + Date.now()` or a stable per-action id so retries are idempotent.

**Verification:**  
Same key twice → second response 409 or 200 with same shortId; one render. Force failure after reserve → credits restored; idempotency doc reflects refund.

---

### Commit 3 — Outbound fetch hardening (P0)

- **Shared helper:** Add one shared helper (e.g. `fetchWithSafety(url, { timeoutMs, maxBytes, allowPrivate: false })`) that: uses AbortController for timeout, blocks localhost/private IP unless allowlisted, and enforces max response size (stream or content-length check). Use it for the worst call sites first.
- **Worst call sites (do first):**
  - [src/services/storage.service.js](src/services/storage.service.js) (uploads/register): user `srcUrl` – timeout + **max bytes** + block private IP.
  - [src/controllers/generate.controller.js](src/controllers/generate.controller.js):172, 643 – user `image_url`/`imageUrl` – same: timeout + max bytes + block private IP.
- **Then:** Apply `withAbortTimeout` (or the same helper) to remaining call sites: [src/utils/link.extract.js](src/utils/link.extract.js):115, [src/services/story.llm.service.js](src/services/story.llm.service.js):298/342/575, [src/services/nasa.videos.provider.js](src/services/nasa.videos.provider.js):46/82, [src/services/pixabay.videos.provider.js](src/services/pixabay.videos.provider.js):40, [src/controllers/voice.controller.js](src/controllers/voice.controller.js):133, [src/services/llmQuotes.service.js](src/services/llmQuotes.service.js):21/89, [src/services/pexels.service.js](src/services/pexels.service.js):6, [src/adapters/replicate.adapter.js](src/adapters/replicate.adapter.js):55/69, [src/adapters/realesrgan.adapter.js](src/adapters/realesrgan.adapter.js):7, [src/utils/video.fetch.js](src/utils/video.fetch.js):16 (HEAD).

**Verification:**  
Slow/hung upstream aborts with timeout. User URL to private IP → rejected. Large response over maxBytes → aborted or capped.

---

### Commit 4 — Rate limits + tmp/disk hygiene (P1)

- **Rate limits:** Add express-rate-limit to:
  - POST `/api/story/search` and POST `/api/story/search-shot` (e.g. per-uid or per-IP, e.g. 60/min).
  - POST `/api/story/finalize` (e.g. 10/min per uid) to cap abuse.
- **TTS disk cache:** Add purge:
  - Either: periodic cleanup (cron or startup) of `vaiform-tts-cache` by mtime (e.g. delete files older than 24h or 7d).
  - Or: bounded size (e.g. max 500 files) and delete oldest when full.
- **TTS temp dirs:** Ensure dirs from `mkdtemp(vaiform-tts-)` are cleaned: either delete after use in tts.service (e.g. after caller reads the file) or return path and document that caller must clean (and clean in story.service after using TTS output).
- **Caption/karaoke leaks:** In [src/utils/captionFile.js](src/utils/captionFile.js) / callers: delete the caption temp dir after FFmpeg use; or switch to a single temp dir per render and put caption file inside it. For [src/utils/karaoke.ass.js](src/utils/karaoke.ass.js): write ASS file inside the story render `tmpDir` (pass tmpDir into buildKaraokeASSFromTimestamps) so existing `finally` cleanup removes it.
- **Upload tmp:** In [src/routes/uploads.routes.js](src/routes/uploads.routes.js): in catch block, try `fs.unlink(tmpPath)` if tmpPath was set.
- **Startup log:** When `VAIFORM_DEBUG=1`, log tmp/cache health: e.g. count (or size) of files in `vaiform-tts-cache`, and optionally total size of `os.tmpdir()` vaiform-* entries.

**Verification:**  
Run multiple renders; confirm no growth of vaiform-caption-*, vaiform-*.ass, or TTS dirs (after fixes). Rate limit: 429 after exceeding cap.

---

## 4) Verification Checklist (per commit)

- **Commit 1:**  
  - Prod: `curl -X POST https://<prod>/api/story/render -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"sessionId":"x"}'` → 405, body `RENDER_DISABLED_IN_PROD` (or equivalent).  
  - Logs: no `[story][render]` success in prod.

- **Commit 2:**  
  - Idempotency: same `x-idempotency-key` twice → second response 409 or 200 with same shortId; only one render in logs.  
  - Reserve/refund: simulate failure after reserve → credits restored; log shows refund.

- **Commit 3:**  
  - Timeout: force slow upstream → request aborts with timeout error; no hang.

- **Commit 4:**  
  - Rate limit: exceed cap → 429.  
  - Tmp: run 5–10 renders; check tmp dir (e.g. `ls /tmp/vaiform-*` or equivalent) – no accumulation of caption/karaoke/TTS dirs.  
  - Debug: `VAIFORM_DEBUG=1` startup logs cache/tmp stats.

---

## 5) Risk Notes (what could break, mitigation)

- **Changing /render to 405 in prod:** Any client that currently calls `/render` in production will break; they must switch to `/finalize`. Mitigation: deploy note; optional feature flag to 405 only when enabled.
- **Idempotency required on finalize:** Clients must send `x-idempotency-key` or get 400. Mitigation: document; frontend sends key (e.g. sessionId + timestamp or uuid per “finalize” action).
- **Reserve-then-render:** If refund fails (e.g. Firestore error), user loses credits. Mitigation: log and alert; optional background job to reconcile reservations.
- **Storing minimal body in idempotency:** Clients that expect full session in 200 response on retry will get minimal body (shortId/sessionId). Mitigation: document; client can GET session or short by id if needed.
- **Rate limits:** Legitimate heavy users may hit 429. Mitigation: use per-uid limits and set high enough (e.g. 10 finalize/min); expose Retry-After.
- **TTS cache purge:** Aggressive purge may increase TTS calls. Mitigation: TTL or max size tuned (e.g. 24h or 500 files).
- **Karaoke/caption cleanup:** Passing tmpDir into karaoke or cleaning caption dir might require signature changes. Mitigation: minimal change (e.g. optional tmpDir param; if provided write there, else current behavior) and ensure callers pass story tmpDir.

---

## Summary

- **Heavy endpoints:** Only POST `/api/story/render` lacks slot, credits, idempotency, and rate limit; `/finalize` and studio finalize have slot + credits but no idempotency/rate limit. Search/search-shot have no rate limit.
- **Temp/disk:** TTS disk cache and per-request TTS dirs, caption dirs, and karaoke ASS files leak; upload tmp can leak on error.
- **SSRF:** uploads/register and generate fetch user URLs with no private-IP block and unbounded buffer; CDN is allowlisted.
- **Idempotency:** Storing full body for finalize risks Firestore 1 MiB limit; store minimal payload.
- **Credits:** Current flow allows free render if spend fails and double charge on retry; reserve → render → confirm/refund with idempotency fixes both.
- **Options:** Story options unused but unvalidated; studio renderSpec is z.any(); generate options include user image_url – validate and bound.

Implement in 4 commits: (1) lock /render, (2) idempotency + reserve/refund for finalize, (3) fetch timeouts + safety, (4) rate limits + tmp/cache hygiene.
