# Deep Beta Hardening Audit

**Audit date:** 2026-03-02  
**Mode:** Plan-first, no edits. Evidence-based, file:line citations.

---

## Status Update (2026-03-05 implementation)

- P0-1 is reduced on the active caller-backed link path. `/api/story/start` stores link input, and `POST /api/story/generate` is the route that now triggers the guarded outbound fetch through `generateStory(...) -> generateStoryFromInput(...) -> extractContentFromUrl(...)` (`src/routes/story.routes.js:118-170`, `src/services/story.service.js:125-155`, `src/services/story.llm.service.js:158-168`, `src/utils/outbound.fetch.js:148-267`, `src/utils/link.extract.js:21-107`).
- P0-2 is reduced on the active clip fetch surfaces. `fetchVideoToTmp(...)` now uses the same shared outbound policy for HEAD and GET, HEAD remains timed best-effort, and the helper is shared by manual finalize plus provider-backed render/timeline flows (`src/utils/video.fetch.js:21-95`, `src/services/story.service.js:1528`, `src/services/story.service.js:1752`, `src/utils/ffmpeg.timeline.js:298`).
- P0-3 remains intentionally deferred because `tmp.js` still has no active caller-backed `http://` or `https://` path in repo truth (`src/utils/tmp.js:30-31`, `src/utils/ffmpeg.js:440`, `src/utils/ffmpeg.video.js:1129`).
- The original findings below remain the 2026-03-02 audit snapshot; use this status note plus `docs/BETA_HARDENING_PLAN.md` for current implementation state.

---

## 1) Active Surface Map (Code Truth)

### A) Backend route/middleware topology

**Entrypoint:** `server.js` → `import app from './src/app.js'` (server.js:8)

**Ordered mount list** (from `src/app.js`):

| Order | Mount                                   | Method(s) | Debug-gated?        | Notes                                                |
| ----- | --------------------------------------- | --------- | ------------------- | ---------------------------------------------------- |
| 1     | `reqId`                                 | all       | No                  | req.id assignment (app.js:45)                        |
| 2     | `helmet`                                | all       | No                  | CSP disabled (app.js:37-42)                          |
| 3     | `cors(corsOptions)`                     | all       | No                  | ALLOWED_ORIGINS + isReplitPreview (app.js:61-107)    |
| 4     | `app.options('*', cors)`                | OPTIONS   | No                  | (app.js:110)                                         |
| 5     | `/stripe/webhook`                       | POST, GET | No                  | Raw body, before JSON parser (app.js:116)            |
| 6     | JSON 200kb for `/api/caption/preview`   | POST      | No                  | Conditional (app.js:122-127)                         |
| 7     | `express.json({ limit: '10mb' })`       | all       | No                  | Global (app.js:130)                                  |
| 8     | `express.urlencoded({ limit: '10mb' })` | all       | No                  | (app.js:131)                                         |
| 9     | Diag body log                           | all       | Yes (VAIFORM_DEBUG) | (app.js:135-142)                                     |
| 10    | Trailing-slash normalizer               | GET       | No                  | Skips /diag, /health, /api, /stripe (app.js:145-160) |
| 11    | `GET /health`                           | GET       | No                  | (app.js:164-167)                                     |
| 12    | `HEAD /health`                          | HEAD      | No                  | (app.js:168-170)                                     |
| 13    | `GET /api/health`                       | GET       | No                  | (app.js:171-174)                                     |
| 14    | `HEAD /api/health`                      | HEAD      | No                  | (app.js:175-177)                                     |
| 15    | `POST /diag/echo`                       | POST      | Yes (VAIFORM_DEBUG) | (app.js:179-189)                                     |
| 16    | `/assets` static                        | GET       | No                  | (app.js:194-204)                                     |
| 17    | `/assets/fonts` CORS                    | GET       | No                  | (app.js:206-210)                                     |
| 18    | `/diag`                                 | \*        | Yes (VAIFORM_DEBUG) | (app.js:215)                                         |
| 19    | `/api/whoami`                           | GET       | No                  | (app.js:216)                                         |
| 20    | `/api/credits`                          | GET       | No                  | (app.js:217)                                         |
| 21    | `/api` diag headers                     | \*        | Yes (VAIFORM_DEBUG) | (app.js:219-221)                                     |
| 22    | `/api/checkout`                         | POST      | No                  | (app.js:225)                                         |
| 23    | `/api/shorts`                           | GET       | No                  | (app.js:230)                                         |
| 24    | `/api/assets`                           | POST      | No                  | (app.js:234)                                         |
| 25    | `/api/limits`                           | GET       | No                  | (app.js:238)                                         |
| 26    | `/api/story`                            | \*        | No                  | (app.js:242)                                         |
| 27    | `/api` caption preview                  | POST      | No                  | (app.js:248)                                         |
| 28    | `/api/user`                             | \*        | No                  | (app.js:253)                                         |
| 29    | `/api/users`                            | POST      | No                  | (app.js:258)                                         |
| 30    | `.woff2` MIME fix                       | all       | No                  | (app.js:267-274)                                     |
| 31    | `errorHandler`                          | all       | No                  | (app.js:289)                                         |

### B) Per-route endpoint table

| Route                        | Method(s) | Auth? | Rate limited? | Body limit | Timeout      | Idempotent?       | Credits         | Concurrency | Notes                            |
| ---------------------------- | --------- | ----- | ------------- | ---------- | ------------ | ----------------- | --------------- | ----------- | -------------------------------- |
| `/health`                    | GET, HEAD | No    | No            | -          | 15min server | -                 | -               | -           | app.js:164-177                   |
| `/api/health`                | GET, HEAD | No    | No            | -          | 15min        | -                 | -               | -           | app.js:171-177                   |
| `/stripe/webhook`            | GET, POST | No    | No            | 1mb raw    | 15min        | Event idempotency | -               | -           | stripe.webhook.js:14-72          |
| `/diag/echo`                 | POST      | No    | No            | 10mb       | 15min        | -                 | -               | -           | Debug only                       |
| `/diag/*`                    | \*        | No    | No            | -          | -            | -                 | -               | -           | Debug only                       |
| `/api/whoami`                | GET       | Yes   | No            | -          | 15min        | -                 | -               | -           | whoami.routes.js:11              |
| `/api/credits`               | GET       | Yes   | No            | -          | 15min        | -                 | -               | -           | credits.routes.js:11             |
| `/api/checkout/start`        | POST      | Yes   | No            | 10mb       | 15min        | -                 | -               | -           | checkout.routes.js:16            |
| `/api/checkout/session`      | POST      | Yes   | No            | 10mb       | 15min        | -                 | -               | -           | checkout.routes.js:20            |
| `/api/checkout/subscription` | POST      | Yes   | No            | 10mb       | 15min        | -                 | -               | -           | checkout.routes.js:23            |
| `/api/checkout/portal`       | POST      | Yes   | No            | 10mb       | 15min        | -                 | -               | -           | checkout.routes.js:31            |
| `/api/shorts/mine`           | GET       | Yes   | No            | -          | 15min        | -                 | -               | -           | shorts.routes.js:8               |
| `/api/shorts/:jobId`         | GET       | Yes   | No            | -          | 15min        | -                 | -               | -           | shorts.routes.js:9               |
| `/api/assets/options`        | POST      | Yes   | No            | 10mb       | 15min        | -                 | -               | -           | assets.routes.js:9               |
| `/api/limits/usage`          | GET       | Yes   | No            | -          | 15min        | -                 | -               | -           | limits.routes.js:7               |
| `/api/story/*`               | \*        | Yes   | Varies        | 10mb       | 15min        | finalize only     | render/finalize | 3 slots     | story.routes.js                  |
| `/api/caption/preview`       | POST      | Yes   | 20/min        | 200kb      | 15min        | -                 | -               | -           | caption.preview.routes.js:91-113 |
| `/api/user/*`                | \*        | Yes   | No            | -          | 15min        | -                 | -               | -           | user.routes.js                   |
| `/api/users/ensure`          | POST      | Yes   | No            | 10mb       | 15min        | -                 | -               | -           | users.routes.js:15               |

**Story sub-routes detail:**

| Sub-route                                           | Rate limit                 | Credits                 | Concurrency    | Idempotency       |
| --------------------------------------------------- | -------------------------- | ----------------------- | -------------- | ----------------- |
| `/start`                                            | No                         | No                      | No             | No                |
| `/generate`                                         | enforceScriptDailyCap(300) | No                      | No             | No                |
| `/plan`                                             | enforceScriptDailyCap(300) | No                      | No             | No                |
| `/search`, `/search-shot`                           | No                         | No                      | No             | No                |
| `/update-shot`, `/update-video-cuts`                | No                         | No                      | No             | No                |
| `/insert-beat`, `/delete-beat`, `/update-beat-text` | No                         | No                      | No             | No                |
| `/timeline`, `/captions`                            | No                         | No                      | No             | No                |
| `/render`                                           | No                         | enforceCreditsForRender | withRenderSlot | No                |
| `/finalize`                                         | No                         | idempotency reserve     | withRenderSlot | X-Idempotency-Key |

### C) Frontend ingress + API bridge

- **netlify.toml:** `/api/*` → proxy to backend (lines 22-26); `/stripe/webhook` → proxy (lines 28-31). Backend URL hardcoded to Replit.
- **web/public/api.mjs:** `API_ROOT = '/api'`, `BACKEND = window.location.origin` (line 13). Same-origin `/api/*` via Netlify proxy. No root aliases.
- **Removed AI image surfaces:** docs/ACTIVE_SURFACES.md lists `/api/assets/ai-images`, `/api/generate`, `/api/job/:jobId` as removed. No entry pages link to them per SSOT.

---

## 2) Threat/Risk Findings (ranked P0/P1/P2)

### P0 — Must fix before beta

#### P0-1: SSRF via link extraction (user-provided URL)

- **Impact:** Attacker can probe internal networks (127.0.0.1, 169.254.169.254, RFC1918), cloud metadata, or abuse as open proxy.
- **Exploit path:** POST `/api/story/start` with `{ input: "http://169.254.169.254/latest/meta-data/", inputType: "link" }` → `extractContentFromUrl` fetches URL.
- **Evidence:** `src/utils/link.extract.js:47` — `fetch(url, { redirect: 'follow', ... })` with user `url`. No https-only, no private-IP block, no redirect cap, no max bytes. Timeout 20s via `withAbortTimeout` (line 44-53).
- **Fix shape:** Add URL validator (https-only, block private IPs after DNS), cap redirects, enforce max response size.

#### P0-2: SSRF via user-provided clip URLs (create-manual-session)

- **Impact:** Same as P0-1; attacker provides arbitrary `selectedClip.url` in beats.
- **Exploit path:** POST `/api/story/create-manual-session` with `beats: [{ text: "...", selectedClip: { id: "x", url: "https://169.254.169.254/" } }]` → `fetchVideoToTmp(shot.selectedClip.url)` in story.service.js.
- **Evidence:** `src/routes/story.routes.js:558-563` — schema allows `selectedClip.url`; `src/services/story.service.js:1752` — `fetchVideoToTmp(shot.selectedClip.url)`. `video.fetch.js:12` enforces `https:` only but has no private-IP block, no redirect validation.
- **Fix shape:** Add private-IP / metadata-URL block to `fetchVideoToTmp` (or central safe-fetch helper). Optionally allowlist Pexels/Pixabay domains for manual-session clips.

#### P0-3: tmp.js httpToTmp — http allowed, no timeout, no size limit

- **Impact:** If any caller passes http/https URL to `fetchToTmp`, server can fetch arbitrary URLs with no protections.
- **Evidence:** `src/utils/tmp.js:79-110` — `httpToTmp` uses `http.get`/`https.get`, allows `http://`, no timeout, no Content-Length cap, pipes to file unbounded.
- **Callers:** `ffmpeg.video.js:1129`, `ffmpeg.js:440` pass `dataUrl` (data:). `fetchToTmp` also handles `http://` and `https://` (tmp.js:30-31). No current caller passes http/https, but API is dangerous.
- **Fix shape:** Deprecate httpToTmp for external URLs or replace with safe-fetch helper. Enforce https-only, timeout, max bytes.

#### P0-4: Stripe webhook returns 200 on credits/plan update failure

- **Impact:** Stripe stops retrying; user pays but never receives credits.
- **Evidence:** `src/routes/stripe.webhook.js:41-48` — `grantCreditsAndUpdatePlan` errors are caught, logged, and not rethrown; handler still returns `ok(req, res, { received: true })` (line 67). Idempotency check (lines 93-99) runs before transaction, but processed marker is written only after successful transaction (lines 138-147). If transaction fails after idempotency check, we return 200 without persisting.
- **Fix shape:** Return 500 (or `fail`) when `grantCreditsAndUpdatePlan` throws, so Stripe retries. Only return 200 after processed marker is persisted.

### P1 — Strongly recommended

#### P1-1: Long-running renders block HTTP (DoS/reliability)

- **Impact:** 15-minute server timeout; render blocks connection. With 3 concurrent slots, 3 slow renders can exhaust capacity; no per-IP/per-UID admission.
- **Evidence:** `server.js:36` — `server.timeout = 900000`; `story.routes.js:506-508` — `finalizeStory` runs inside `withRenderSlot`; `render.semaphore.js:2` — `MAX_CONCURRENT_RENDERS = 3`.
- **Fix shape (beta-minimum):** Keep semaphore; add strict per-UID rate limit on finalize/render (e.g. 2/min). Document job-queue as P2.

#### P1-2: Missing rate limits on expensive story endpoints

- **Impact:** Abuse of generate/plan/search/finalize without per-IP or per-UID limits beyond script daily cap.
- **Evidence:** `story.routes.js` — only `/generate` and `/plan` have `enforceScriptDailyCap(300)`. No rate limit on `/search`, `/search-shot`, `/finalize`, `/render`, `/create-manual-session`.
- **Fix shape:** Add express-rate-limit (per-UID or per-IP) on `/finalize`, `/render`, `/generate`, `/plan`, `/search`, `/create-manual-session`.

#### P1-3: Auth token revocation not checked

- **Impact:** Revoked tokens (e.g. user signed out, password change) remain valid until expiry.
- **Evidence:** `src/middleware/requireAuth.js:13` — `admin.auth().verifyIdToken(idToken)` without second arg; Firebase default `checkRevoked: false`.
- **Fix shape:** Use `verifyIdToken(idToken, true)` for billing/finalize (or all auth) if overhead acceptable.

#### P1-4: req.session used without session middleware

- **Impact:** `req.session` is undefined; code creates `req.session = {}` ad-hoc. Session data is not persisted across requests; "seen" IDs reset every request.
- **Evidence:** `src/controllers/assets.controller.js:30-31,85` — `req.session = req.session || {}`, `req.session[sessKey] = ...`. No `express-session` in app.js (grep: no `express.session` or `session(`).
- **Fix shape:** Remove session usage or add express-session. For beta, in-memory per-UID de-dup keyed by `req.user?.uid` is simpler.

#### P1-5: CORS relies on NODE_ENV for Replit preview

- **Impact:** If `NODE_ENV` is mis-set in prod, Replit preview origins could be allowed in production.
- **Evidence:** `src/app.js:71` — `const isDev = process.env.NODE_ENV !== 'production'`; `isReplitPreview` returns false when `!isDev` (line 73).
- **Fix shape:** Add explicit `ALLOW_DEV_ORIGINS=1` (or similar) instead of relying solely on NODE_ENV.

### P2 — Nice-to-have

#### P2-1: Global body limit 10mb is high for most routes

- **Evidence:** `app.js:130` — `express.json({ limit: '10mb' })` global. Caption preview uses 200kb (line 121).
- **Fix shape:** Reduce global to 1mb; add route-specific 10mb only for story/create-manual-session if needed.

#### P2-2: Job queue for renders (P2 per server.js comment)

- **Evidence:** `server.js:34-35` — comment: "Full solution requires background job queue (P2)."
- **Fix shape:** 202 + poll pattern or background worker.

#### P2-3: Response envelope — finalize includes shortId at top level

- **Evidence:** `story.routes.js:35-39` — `finalizeSuccess` returns `{ success, data, shortId, requestId }`. API_CONTRACT.md expects `success`, `data`, `requestId`.
- **Fix shape:** Move `shortId` into `data` or document as allowed extension.

---

## 3) Hardening Plan (Phased, minimal diffs)

### Phase 3A — Outbound fetch / SSRF hardening

**Files:** `src/utils/link.extract.js`, `src/utils/video.fetch.js`, `src/utils/image.fetch.js`, `src/utils/tmp.js`, new `src/utils/safe-fetch.js` (optional)

**Approach:**

1. Create `safeFetch(url, opts)` or extend `withAbortTimeout` usage: https-only, block private IPs (127.0.0.0/8, 169.254.0.0/16, 10.0.0.0/8, 172.16.0.0/12, ::1, fc00::/7), redirect cap (e.g. 5), max bytes, timeouts.
2. In `link.extract.js`: validate URL before fetch; use safeFetch.
3. In `video.fetch.js` / `image.fetch.js`: add private-IP block (DNS resolution + URL host check).
4. In `tmp.js`: either remove httpToTmp path for external URLs or route through safeFetch; add timeout and max bytes.

**Acceptance:** Unit tests reject 127.0.0.1, 169.254.169.254, http://; allow https://pexels.com.

### Phase 3B — Rate limiting + admission control

**Files:** `src/app.js`, `src/routes/story.routes.js`, new `src/middleware/rateLimit.story.js` (optional)

**Approach:**

1. Add global baseline limiter (e.g. 300 req/15min per IP) in app.js before API routes.
2. Add strict per-route limiters: `/api/story/finalize` (2/min per UID), `/api/story/render` (2/min), `/api/story/generate` (10/min), `/api/story/plan` (10/min), `/api/story/create-manual-session` (5/min).
3. Use `keyGenerator: req => req.user?.uid || req.ip` for authenticated routes.

**Acceptance:** 429 on excess requests; Retry-After header present.

### Phase 3C — Stripe webhook reliability

**Files:** `src/routes/stripe.webhook.js`

**Approach:**

1. In `checkout.session.completed` handler: if `grantCreditsAndUpdatePlan` throws, return `fail(req, res, 500, 'WEBHOOK_ERROR', ...)` (or `res.status(500).send(...)`) instead of swallowing.
2. Ensure processed marker is written before returning 200. Current flow writes after transaction (lines 138-147); if transaction throws, we never write. Move idempotency skip before try, and only return 200 after successful write.
3. Document: 500 = retryable, 200 = processed.

**Acceptance:** Simulated Firestore failure → 500; Stripe retries.

### Phase 3D — Auth revocation scope

**Files:** `src/middleware/requireAuth.js`, optionally `src/middleware/planGuards.js`

**Approach:**

1. Add `verifyIdToken(idToken, true)` for requireAuth (or create `requireAuthStrict` for checkout/finalize).
2. If latency is a concern, scope to checkout + finalize only.

**Acceptance:** Revoked token → 401.

### Phase 3E — Body limits + parse surface

**Files:** `src/app.js`, `src/routes/story.routes.js`

**Approach:**

1. Reduce global `express.json` limit to 1mb.
2. Add route-specific `express.json({ limit: '10mb' })` for `/api/story/create-manual-session` and any other large-body routes.

**Acceptance:** Small-body routes reject >1mb; create-manual-session accepts up to 10mb.

### Phase 3F — Session cleanup

**Files:** `src/controllers/assets.controller.js`

**Approach:**

1. Replace `req.session` with in-memory Map keyed by `req.user?.uid` (or remove de-dup if not critical for beta).
2. Remove `req.session` usage.

**Acceptance:** No `req.session` references; assets options still work.

---

## 4) Patch Inventory (files likely to change)

| P0/P1 Item             | Files                                                                   |
| ---------------------- | ----------------------------------------------------------------------- |
| P0-1 SSRF link.extract | `src/utils/link.extract.js`, `src/utils/safe-fetch.js` (new)            |
| P0-2 SSRF clip URLs    | `src/utils/video.fetch.js`, `src/utils/image.fetch.js`                  |
| P0-3 tmp.js httpToTmp  | `src/utils/tmp.js`                                                      |
| P0-4 Stripe webhook    | `src/routes/stripe.webhook.js`                                          |
| P1-1 Render admission  | `src/routes/story.routes.js`, `src/middleware/rateLimit.story.js` (new) |
| P1-2 Rate limits       | `src/app.js`, `src/routes/story.routes.js`                              |
| P1-3 Auth revocation   | `src/middleware/requireAuth.js`                                         |
| P1-4 Session           | `src/controllers/assets.controller.js`                                  |
| P1-5 CORS              | `src/app.js`                                                            |
| P2-1 Body limits       | `src/app.js`, `src/routes/story.routes.js`                              |

---

## 5) Verification Plan (tests + smoke)

### Required commands (must remain green)

```
npm run lint
npm run format:check
npm run check:netlify-redirects
npm run check:root-api-callers
npm run check:hardcoded-backend-origins
node scripts/check-responses.js
```

**Current status (2026-03-02):** All pass. Lint has 20 warnings (no errors).

### Recommended targeted tests

1. **SSRF rejection:** Block 127.0.0.1, 169.254.169.254, 10.x, 172.16.x, http:// in link extract and video fetch.
2. **Redirect hop revalidation:** Max 5 redirects; reject redirect to private IP.
3. **Webhook retry:** Simulate Firestore error → expect 500.
4. **Rate limit:** POST /api/story/finalize exceeding limit → 429.

### Manual smoke (sacred)

- Creative article flow: story → assets → caption → finalize
- My-shorts flow
- Pricing + buy-credits checkout

---

## 6) Notes/Risks + Explicit Assumptions

### Assumptions

- **Single-instance deployment:** In-memory rate limiters and render semaphore are acceptable for beta. Multi-instance would need Redis or similar.
- **Netlify proxy:** Backend URL in netlify.toml is deployment-specific; frontend uses same-origin `/api` correctly.
- **Firebase Auth:** Token verification is sufficient for beta; revocation check adds one extra API call per request.

### Not verified

- **Stripe webhook signature:** Verified via `constructEvent`; not re-audited.
- **Pexels/Pixabay provider fetches:** URLs are from provider APIs, not user input; lower SSRF risk.
- **ElevenLabs/OpenAI fetches:** Fixed URLs; no user-controlled URL.
- **NASA provider:** Fixed API URL pattern.

### Known drift

- **finalizeSuccess** returns `shortId` at top level; API_CONTRACT.md does not list it. Minor; document or move into `data`.
- **ROUTE_TRUTH_TABLE.md** and **docs/ACTIVE_SURFACES.md** match code; no material drift found.

### Grep evidence summary

```
rg -n "app\.use|app\.get|app\.post" src/app.js     → 30 matches
rg -n "fetch\(|http\.get|https\.get" src          → 17 fetch, 1 https.get (tmp.js)
rg -n "req\.session" src                          → assets.controller.js:30,31,85
rg -n "express\.json\(" src                        → app.js:121,130; caption.preview:113
rg -n "rateLimit|express-rate-limit" src          → caption.preview:5,91; pixabay (header read); tts (fn name)
rg -n "verifyIdToken" src                         → requireAuth:13; planGuards:290
rg -n "stripe\.webhook|constructEvent|event\.id|processed" src/routes/stripe.webhook.js
  → constructEvent:26; event.id:41; processed:93,98,143
```

---

_End of audit. No implementation performed._
