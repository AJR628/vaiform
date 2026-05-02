# Vaiform Backend — Production-Readiness Audit (Read-Only)

**Scope:** Backend repo only. No frontend/mobile analysis. No source files modified.
**Method:** Static read of `src/`, `scripts/`, `test/`, `docs/`, `.replit`, `package.json`.
**Runtime topology:** Node 22, Express 4 (CommonJS-style ESM, `"type": "module"`). `.replit` runs `scripts/start-replit-runtime.mjs` which spawns three child processes: `start:api` (server.js), `start:worker:finalize` (story-finalize.worker.js), `start:worker:preview` (story-preview.worker.js). Split runtime confirmed.

---

## A. Executive Summary

Vaiform's backend is a structured Express monolith that has been actively re-architected toward a canonical async finalize pipeline (`/api/story/finalize` + finalize worker), a single `usage.service.js` source of truth for billing, and a contract-driven response envelope (`src/http/respond.js`). The bones are sound: split runtime, idempotency middleware with explicit reservation/replay states, SSRF allow-list (`src/utils/outbound.fetch.js`), webhook signature verification with per-event Firestore idempotency, structured `logger`/`finalize-observability` instrumentation, and a contract test suite.

However, the codebase still carries **significant pre-canonical drift**: parallel "old" code paths coexist with the canonical ones (legacy blocking `/render`, hardcoded plan limits in `limits.controller`, an orphan `idempotencyFirestore` export, an unmounted-but-still-present `health.controller` that writes user docs keyed by email, a `req.session`-dependent dedupe in `assets.controller` with no session middleware mounted, and a one-off `image.fetch` that bypasses the SSRF allow-list). The Stripe webhook is well-scoped per-event but resolves identity via `auth().getUserByEmail` fallbacks — a soft trust boundary. Test coverage is concentrated on finalize/observability and largely absent for billing, planGuards, idempotency edge cases, and SSRF utilities. Five files exceed 1000 lines (`story.service.js` ~5300, `story-finalize.attempts.js` ~2250, `caption.preview.routes.js` ~2000, `story.routes.js` ~1940, `finalize-control.service.js` ~1080), creating concentrated change-risk.

**Net assessment:** Ship-blockers are mostly P1 hygiene/security items (SSRF gap, broken `req.session` usage, dead/unsafe code) plus one P1 contract drift (limits source-of-truth). With the Phase-1 list fixed (≈1–2 weeks of focused work), the service is suitable for paid beta. Phases 2–3 address maintainability, billing trust boundary, and test depth.

---

## B. Risk-Ranked Findings (P0–P3)

> No P0 (immediate-crash / data-loss) findings. Several P1s are tightly scoped and fixable within hours.

### P1 — Pre-launch blockers

| # | Finding | Surface | Fix-effort |
|---|---|---|---|
| P1-1 | **SSRF bypass in image fetcher.** `src/utils/image.fetch.js:10-21` calls raw `fetch(url, { redirect: 'follow' })` without `assertPublicOutboundUrl` / `fetchWithOutboundPolicy`. Validates only `https:` protocol; redirects auto-follow without per-hop IP/DNS-rebind validation. Reachable from any code that downloads selected stock/AI images. | `src/utils/image.fetch.js` | S |
| P1-2 | **Broken in-memory dedupe with no session middleware.** `src/controllers/assets.controller.js:29-31,85` reads/writes `req.session[...]` but `app.js` mounts no session middleware. Each request sees a fresh `{}`, so the per-session Pexels dedupe is a no-op. Same controller reads `req.isPro` (line 20) which is never set anywhere — all users get the free `maxPerPage` cap regardless of plan. | `src/controllers/assets.controller.js` | S |
| P1-3 | **Conflicting plan-limit truth.** `src/controllers/limits.controller.js:33-46` hardcodes `monthlyGenerations: 10/250` and computes a `monthlyCount` from a `generations` subcollection, then returns it under `/api/limits/usage`. Meanwhile `src/services/usage.service.js` is the canonical seconds-based source used by `planGuards.enforceRenderTimeForRender`, `requireMember`, Stripe webhook, etc. Two divergent answers to "how much can the user do?" reach the client. | `src/controllers/limits.controller.js` | M |
| P1-4 | **Dead-but-present unsafe handler keyed by email.** `src/controllers/health.controller.js:84-122` (`testFirestore`, `register`) writes user docs keyed by `email` (`db.collection('users').doc(email)`), violating the canonical `users/{uid}` schema enforced by `user-doc.service`/`user.service`. Module is imported by no route file in `src/routes/` (verified), so it's currently unreachable — but it is still a footgun if ever wired up, and `register` accepts arbitrary `email` from request body without auth. Recommend deletion. | `src/controllers/health.controller.js` | S |
| P1-5 | **Stripe webhook identity resolution via `getUserByEmail` fallback.** `src/routes/stripe.webhook.js:144-183`. After uid hints from `metadata.uid` and `client_reference_id`, falls through to `admin.auth().getUserByEmail(normalize(email))` against (a) checkout/subscription metadata email, (b) Stripe `customer_email`/`customer_details.email`, (c) the email retrieved from `stripe.customers.retrieve`. Stripe customer email is user-supplied at checkout and not necessarily verified-owned. If a Firebase Auth user exists with that email, the paid plan is granted to that uid. Mitigated by always preferring `metadata.uid`; severity depends on whether the checkout flow guarantees `metadata.uid` is set on every Subscription (verify in checkout controller and Stripe Dashboard). | `src/routes/stripe.webhook.js`, `src/controllers/checkout.controller.js` | M |

### P2 — Pre-paid-beta hardening

| # | Finding | Surface | Fix-effort |
|---|---|---|---|
| P2-1 | **Two parallel free-tier counters.** `planGuards.enforceFreeDailyShortLimit` uses `shortDayKey`/`shortCountToday`; `enforceFreeLifetimeShortLimit` uses `freeShortsUsed`. Both are used by different gates without a single accounting story. The lifetime gate also bypasses canonical usage and reads/writes the user doc directly. | `src/middleware/planGuards.js:81-194` | M |
| P2-2 | **Orphan idempotency export still in API.** `src/middleware/idempotency.firestore.js:244` exports a default `idempotencyFirestore({ttlMinutes})` — used by zero callers (only `idempotencyFinalize` is imported, by `story.routes.js:5`). Risk: a future contributor wires the legacy variant and bypasses finalize reservation semantics. | `src/middleware/idempotency.firestore.js` | S |
| P2-3 | **Diag/non-canonical envelopes leak through.** `src/routes/diag.routes.js:22-40,42-58,60-64,66-88,90-140` returns hand-rolled `{ success, ... }` shapes (e.g. `{success:true, size, sample}`, `{success:true, provider, configured, ...}`) instead of the contract envelope `{ success, data, requestId }`. Mounted only when `VAIFORM_DEBUG=1`, but the regex-based `scripts/check-responses.js` cannot detect this drift. | `src/routes/diag.routes.js`, `scripts/check-responses.js` | S |
| P2-4 | **Render legacy path still wired.** `src/routes/story.routes.js:1449-1490` mounts `/api/story/render` behind `ENABLE_STORY_RENDER_ROUTE=1`. Code path includes `renderStory`, `withRenderSlot`, and a separate failure-mapping branch. Carrying it forward duplicates failure semantics and complicates `story.service` (5300 lines). Decommission once finalize is verified end-to-end in production. | `src/routes/story.routes.js`, `src/services/story.service.js` | M |
| P2-5 | **`shorts.controller.getMyShorts` index-fallback masks production cost.** `src/controllers/shorts.controller.js:32-101` catches missing-index error, then issues `where('ownerId','==',uid).limit(1000).get()` and sorts in memory. Per-request 1000-doc reads under load → quota burn. Composite index should be deployed; fallback should warn loudly (it currently `console.warn`s and returns `note:'INDEX_FALLBACK'`). | `src/controllers/shorts.controller.js` | S |
| P2-6 | **Helmet CSP disabled, CORS allow-list contains placeholder.** `src/app.js:40-45` disables CSP; `src/app.js:67-73` includes `'https://vaiform-user-name.netlify.app'` (literal placeholder text). Replit-preview wildcard is correctly dev-only. CSP omission is acceptable for a JSON API but should be re-enabled with `frame-ancestors 'none'` etc.; placeholder origin should be removed. | `src/app.js` | S |
| P2-7 | **`requireAuthOptional` swallows all errors silently.** `src/middleware/planGuards.js:432-449` catches every `verifyIdToken` error with `catch {}`, including expired tokens, network faults, and clock skew — request proceeds as anonymous with no log. Future debugging will be painful. | `src/middleware/planGuards.js` | S |
| P2-8 | **337 `console.log/error/warn` calls vs. structured logger.** Structured `logger`/`emitFinalizeEvent` exists (`src/observability/logger.js`, `finalize-observability.js`) but coverage is partial; routes mix `console.error('[story][...] error:', e)` with structured `logger.error(...)`. Inconsistent log shape complicates Sentry/APM rules. | repo-wide | M |
| P2-9 | **Inline zod schemas duplicate `src/schemas/`.** `story.routes.js` defines `SyncSchema`, `CreateManualSessionSchema`, `ManualSchema` inline (lines 1260-1265, 1734-1735, 1766-1782) while `src/schemas/` exists and is imported elsewhere (`AssetsOptionsSchema`, `startCheckoutSchema`). Drift risk between client contract docs and server enforcement. | `src/routes/story.routes.js`, `src/routes/caption.preview.routes.js` | M |
| P2-10 | **Per-event Stripe idempotency stored under user doc.** `src/routes/stripe.webhook.js:286,303-309`. Storing `stripe_webhook_events/{eventId}` as a subcollection of the resolved user means: (a) if uid resolution flips between events for the same payer, dedupe is bypassed; (b) the audit trail is split across user docs. Recommend a top-level `stripe_webhook_events` collection keyed by event id. | `src/routes/stripe.webhook.js` | M |

### P3 — Maintainability / observability backlog

| # | Finding | Surface |
|---|---|---|
| P3-1 | **Mojibake placeholder.** `src/routes/story.routes.js:1798-1801` checks for `'Add textâ€¦'` (UTF-8 ellipsis double-decoded). Indicates a copy-paste from a Windows-1252 source; works today only because the client also serializes the same mojibake. | `src/routes/story.routes.js` |
| P3-2 | **Mega-files dominate change-risk.** `story.service.js` ~5300L, `story-finalize.attempts.js` ~2250L, `caption.preview.routes.js` ~2000L, `story.routes.js` ~1940L, `finalize-control.service.js` ~1080L. Refactor into smaller modules along stage boundaries (admission / claim / settle / recovery). | `src/services/`, `src/routes/` |
| P3-3 | **Redundant `requireAuth` on `/update-caption-meta`.** `story.routes.js:61` applies router-level `r.use(requireAuth)` and line 544 reapplies `requireAuth` per-route. Harmless but signals stale review. | `src/routes/story.routes.js` |
| P3-4 | **`scripts/check-responses.js` is regex-based.** Cannot detect helper-bypassed envelopes (e.g. raw `res.json({success:true,...})` blocks in `diag.routes.js`, `story.routes.js:1180` 202 reply, `:1331` 202 reply, `:1696` finalize reply). Replace with an AST/grep that flags `res.status(...).json(` outside `respond.js`. | `scripts/check-responses.js` |
| P3-5 | **Limits subcollection vs. canonical usage.** `limits.controller` reads `users/{uid}/generations` collection — no other code in `src/` writes to it (search `generations` collection writes returns no hits), suggesting the count is structurally always 0. Dead query in addition to wrong contract. | `src/controllers/limits.controller.js` |
| P3-6 | **Tests are narrow.** `test/contracts/*` covers ffmpeg/preview/llm/phase4a; `test/observability/*` covers finalize. **Zero direct tests** for: stripe webhook, planGuards, idempotencyFinalize, outbound.fetch SSRF allow-list, image.fetch, link.extract, validate.middleware, error.middleware, respond.js envelope. | `test/` |
| P3-7 | **Trust-proxy hops env-driven without guard.** `src/app.js:37` `app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1))`. `Number(undefined||1)` → 1; but `TRUST_PROXY_HOPS=foo` → `NaN` which Express treats as falsy/disabled, silently degrading rate-limiter accuracy if `express-rate-limit` is wired. | `src/app.js` |
| P3-8 | **Stripe webhook returns 500 on handler errors.** `src/routes/stripe.webhook.js:452-458` returns `failSafeError` (≥500). Stripe will retry. Good for transient errors; for permanent errors (e.g. `WEBHOOK_PLAN_PRICE_MISMATCH`, `UNKNOWN_PLAN`) this causes infinite retry storms. Map known-permanent errors to `200` with logged failure. | `src/routes/stripe.webhook.js` |

---

## C. Evidence Table

| ID | File:Line | Snippet / Evidence |
|---|---|---|
| P1-1 | `src/utils/image.fetch.js:11-21` | `if (u.protocol !== 'https:') throw …; const res = await fetch(url, { redirect: 'follow', … })` — no `assertPublicOutboundUrl`, no manual redirect re-validation. |
| P1-2 | `src/controllers/assets.controller.js:20,30-31,85` | `const isPro = req.isPro \|\| false;` … `req.session = req.session \|\| {}; const seen = new Set(Array.isArray(req.session[sessKey]) ? … : []);` — no session middleware in `src/app.js`. |
| P1-3 | `src/controllers/limits.controller.js:33-46` vs. `src/services/usage.service.js` | Hardcoded `monthlyGenerations: 10/250` and `monthlyCount` from `users/{uid}/generations`; canonical truth is seconds via `buildCanonicalUsageState`/`getAvailableMs`. |
| P1-4 | `src/controllers/health.controller.js:84-122` | `db.collection('users').doc(email)` and `register({email})` from request body without auth. Module not imported by any route (verified via repo grep). |
| P1-5 | `src/routes/stripe.webhook.js:144-152,166-183` | `admin.auth().getUserByEmail(normalize(email))` cascade across metadata + `customer_email` + `stripe.customers.retrieve(customer)` email. Only fails if all hints absent. |
| P2-1 | `src/middleware/planGuards.js:81-138,144-194` | Two distinct counter schemas on the same user doc. |
| P2-2 | `src/middleware/idempotency.firestore.js:244` | `export default function idempotencyFirestore({ttlMinutes=60}={})` — zero callers. |
| P2-3 | `src/routes/diag.routes.js:22-40,42-58,60-64,72-81,119-138` | `res.json({success:true, size, sample})`, etc. |
| P2-4 | `src/routes/story.routes.js:1449-1490` | `if (process.env.ENABLE_STORY_RENDER_ROUTE !== '1') return fail(req,res,405,'RENDER_DISABLED',…)` |
| P2-5 | `src/controllers/shorts.controller.js:64-101` | `if (!needsIndex) throw err; … .where('ownerId','==',ownerUid).limit(1000).get(); … all.sort((a,b)=>…); items = all.slice(0, limit);` |
| P2-6 | `src/app.js:40-45,67-73` | `helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false })`; `'https://vaiform-user-name.netlify.app', // replace with your actual…` |
| P2-7 | `src/middleware/planGuards.js:432-449` | `try { … } catch { /* Ignore auth errors for optional auth */ }` |
| P2-8 | repo-wide | `rg -n 'console\.log' src/ \| wc -l` → 337; structured logger usage is partial. |
| P2-9 | `src/routes/story.routes.js:1260-1265,1734-1735,1766-1782` | `const SyncSchema = z.object({…})`, `const CreateManualSessionSchema = z.object({beats: z.array(…).max(8)})` defined inline. |
| P2-10 | `src/routes/stripe.webhook.js:285-309` | `const userRef = db.collection('users').doc(uid); const eventRef = userRef.collection('stripe_webhook_events').doc(eventId)` |
| P3-1 | `src/routes/story.routes.js:1798-1801` | `trimmed === 'Add textâ€¦' \|\| trimmed.toLowerCase() === 'add textâ€¦'` |
| P3-2 | `wc -l` of: `src/services/story.service.js` 5304, `src/services/story-finalize.attempts.js` 2255, `src/routes/caption.preview.routes.js` 2001, `src/routes/story.routes.js` 1937, `src/services/finalize-control.service.js` 1084 | — |
| P3-3 | `src/routes/story.routes.js:61,544` | `r.use(requireAuth);` then `r.post('/update-caption-meta', requireAuth, async (req, res) => …)` |
| P3-4 | `scripts/check-responses.js` | Regex-only scan; `story.routes.js:1180`, `:1331`, `:1696` use raw `res.status(...).json({ success: true, … })`. |
| P3-5 | `src/controllers/limits.controller.js:24-30` | `userRef.collection('generations').where('createdAt','>=',…)` — collection has no documented writer in `src/`. |
| P3-6 | `test/` listing | `contracts/{ffmpeg-colorspace,ffmpeg-timeline,story-preview,phase4a,story-llm-generation}.test.js`, `observability/{metrics-registry,finalize-observability,finalize-worker-runtime,finalize-diag-route,finalize-admin-dashboard,phase3-paid-beta-safety,sentry-reader,finalize-control.service}.test.js`. No webhook/idempotency/SSRF/planGuards tests. |
| P3-7 | `src/app.js:37` | `app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS \|\| 1))` |
| P3-8 | `src/routes/stripe.webhook.js:452-458` | `return failSafeError(req,res,error,{fallbackError:'WEBHOOK_ERROR',…})` — `failSafeError` returns ≥500 for non-status errors; Stripe retries. |

---

## D. Surface Map (mounted HTTP surface)

Source of truth: `src/app.js`. Order matters (Stripe webhook is mounted **before** the JSON parser, as required).

| Mount | Router file | Auth | Notes |
|---|---|---|---|
| `POST /stripe/webhook` | `src/routes/stripe.webhook.js` | Stripe signature (raw body) | Per-event Firestore idempotency |
| `GET/HEAD /health`, `GET/HEAD /api/health` | inline in `src/app.js:169-182` | none | Returns `{success:true, data:{service,time}}` via `ok()` |
| `POST /diag/echo` | inline (DBG only) | none | DBG=`VAIFORM_DEBUG=1` |
| `*` (admin finalize) | `src/routes/admin.finalize.routes.js` (mounted at root) | dashboard token (see middleware) | Read-only finalize dashboard |
| `/diag/*` | `src/routes/diag.routes.js` | none, DBG-only | Non-canonical envelopes (see P2-3) |
| `/api/whoami` | `src/routes/whoami.routes.js` | requireAuth | `{uid,email}` |
| `/api/usage` | `src/routes/usage.routes.js` → `usage.controller.getUsage` | requireAuth | Canonical usage |
| `/api/checkout/{start,portal}` | `src/routes/checkout.routes.js` | requireAuth | Stripe |
| `/api/shorts/{mine,:jobId}` | `src/routes/shorts.routes.js` | requireAuth | My-Shorts library |
| `/api/assets/options` | `src/routes/assets.routes.js` | requireAuth | Pexels (broken dedupe — P1-2) |
| `/api/limits/usage` | `src/routes/limits.routes.js` | requireAuth | **Drift** — see P1-3 |
| `/api/story/*` | `src/routes/story.routes.js` (router-level requireAuth) | requireAuth | Includes finalize, sync, preview, manual, render(legacy), GET :sessionId |
| `/api/caption/preview` | `src/routes/caption.preview.routes.js` | requireAuth (200kb body limit) | Pre-mounted JSON parser |
| `/api/user/{setup,me}` | `src/routes/user.routes.js` | requireAuth | Legacy ensure path |
| `/api/users/ensure` | `src/routes/users.routes.js` | requireAuth | Canonical ensure path (`ensureUserDocByUid` + `ensureCanonicalUsageState`) |

**Worker surfaces (no HTTP):** `story-finalize.worker.js`, `story-preview.worker.js` — claim/run via Firestore polling; orchestrated by `services/story-finalize.runner.js` (claim/heartbeat/reaper).

---

## E. Dead / Legacy Candidates

| Candidate | Evidence | Recommendation |
|---|---|---|
| `src/controllers/health.controller.js` (`testFirestore`, `register`, `healthz`, `version`, `root`) | No route file imports it; `/health` is defined inline in `src/app.js`. `register` accepts unauth email and writes `users/{email}`. | **Delete file.** Health is already inline. |
| `idempotencyFirestore` default export | `src/middleware/idempotency.firestore.js:244` — zero callers. | Delete the default export; keep only `idempotencyFinalize`. |
| `POST /api/story/render` (legacy blocking) | Gated by `ENABLE_STORY_RENDER_ROUTE`. Off by default. | Remove after a release window with the gate confirmed off in prod. Removes `renderStory` / `withRenderSlot` paths from `story.service`. |
| `users/{uid}/generations` subcollection reads | `limits.controller.js:24-30` — no writers in repo. | Drop the read; replace `/api/limits/usage` with seconds-based summary from `usage.service`. |
| `user.routes.js` (`/api/user/setup`, `/api/user/me`) vs. `users.routes.js` (`/api/users/ensure`) | Two parallel ensure paths (`ensureFreeUser` vs. `ensureUserDocByUid` + `ensureCanonicalUsageState`). | Migrate clients to `/api/users/ensure`; deprecate `user.routes.js` after a release. |
| Mojibake placeholder check | `story.routes.js:1798-1801` | Once the client emits `Add text…` (real ellipsis) or `''`, drop the mojibake string. |
| `helmet.crossOriginEmbedderPolicy: false` | `app.js:43` | Re-enable once verified to not break asset CORS. |
| Hardcoded Netlify preview origin | `app.js:70` | Remove the literal placeholder. |

---

## F. Contract Audit

**Canonical envelope** (`src/http/respond.js`, `docs/API_CONTRACT.md`):
- success: `{ success:true, data, requestId }` at `200`
- failure: `{ success:false, error, detail, requestId, fields? }` at the chosen status

**Conformant pathways:** all `*.controller.js` and most `*.routes.js` use `ok()`/`fail()` / `failInternalServerError()` / `failSafeError()`. The error middleware (`src/middleware/error.middleware.js`) maps Zod and known errors through `fail()`.

**Drift / non-canonical responders detected:**

| File:Line | Drift |
|---|---|
| `src/routes/diag.routes.js:22-40,42-58,60-64,66-88,90-140` | Hand-rolled `res.json({success, …})` shapes; missing `data`/`requestId`. |
| `src/routes/story.routes.js:1180-1188` | Raw `res.status(202).json({ success:true, data, requestId, preview:{…} })` — extra top-level `preview` field outside canonical `data`. |
| `src/routes/story.routes.js:1331-1340` | Same shape for sync 202 (`sync:{state,attemptId,pollSessionId}`). |
| `src/routes/story.routes.js:1696` | Finalize `res.status(reply.status).json(reply.body)` — body is constructed by `buildFinalizeHttpReply` in `story-finalize.attempts.js`; needs verification that it follows the contract for all branches (enqueued / replay-pending / replay-done / replay-failed / overloaded). |
| `src/controllers/health.controller.js` (dead) | `{success, message}`, `{success, skipped, reason}`, `{status, …}` shapes. |

**Detector gap:** `scripts/check-responses.js` is grep-based for `ok:`/`code:`/`issues:`/`message:` keywords. It cannot flag the `{success, …}`-without-`data` drifts above. Replace with an AST scan (Babel/SWC) that whitelists only `respond.js` helpers as JSON responders, or add a contract test that asserts every 2xx has `{success, data, requestId}` keys.

**Contract docs vs. code:**
- `docs/API_CONTRACT.md` and `docs/ROUTE_TRUTH_TABLE.md` accurately describe envelope and routes. The `ENABLE_STORY_RENDER_ROUTE` gate and `idempotencyFinalize` requirement on `/api/story/finalize` are reflected in code.
- Caption preview contract has its own contract test (`scripts/test-caption-preview-contract.mjs`).

---

## G. Finalize Pipeline Audit

**Topology:**
1. Client `POST /api/story/finalize` with `X-Idempotency-Key`.
2. `idempotencyFinalize` (`src/middleware/idempotency.firestore.js`) validates header, auth, sessionId; calls `prepareFinalizeAttempt` (in `story-finalize.attempts.js`) which executes the canonical reservation transaction: creates/queues an attempt doc, reserves render seconds via `usage.service`, returns one of `{enqueued, active_same_key, active_other_key, done_same_key, failed_same_key, overloaded}`. Builds an HTTP reply via `buildFinalizeHttpReply`.
3. Route handler (`story.routes.js:1493-1727`) emits `finalize-observability` events for each branch and returns `reply.status/headers/body`.
4. `start:worker:finalize` child process (`story-finalize.worker.js`) polls/claims via `story-finalize.runner.js` (claim → heartbeat → reaper for crashed claims).
5. On completion the worker writes the canonical `shorts/{shortId}` doc and finalizes attempt state; `GET /api/story/:sessionId` overlays canonical finalize status (`getCanonicalFinalizeStatusForSession`).

**Strengths:**
- Reservation happens **once**, in a transaction, before enqueue. Same-key replay returns prior reservation rather than reserving twice. (`prepareFinalizeAttempt` semantics.)
- Overload gate (`shared overload` → 503 with `Retry-After`) — present in finalize-control.
- Observability is dense: every API admission branch emits `FINALIZE_EVENTS.API_*` with `stage`, `jobState`, `failureReason`, `durationMs`. Worker emits parallel events.
- Crash recovery: `story-finalize.runner` includes a heartbeat-based reaper for orphaned claims.

**Risks / gaps:**
- **F-1 (P2):** `buildFinalizeHttpReply` is the single envelope source for the finalize route — its conformance to `{success, data, requestId}` is not verified by the response-contract scanner (regex-based). Recommend a contract test that exercises all six branches.
- **F-2 (P2):** Over-concentration in two files (`story-finalize.attempts.js` 2255L, `finalize-control.service.js` 1084L). Stage boundaries (admit / claim / settle / recover) can become independent modules.
- **F-3 (P3):** The `/api/story/render` legacy path duplicates failure mapping (`storyFailureFromError`, `withRenderSlot`, `enforceRenderTimeForRender`) used elsewhere. Removing it (P2-4) shrinks `story.service.js` materially.
- **F-4 (P3):** Worker→client recovery relies on the client polling `GET /api/story/:sessionId`. There is no SSE/WebSocket. Acceptable for current product, but document poll cadence to avoid Firestore quota burn.

---

## H. Billing Audit

**Subscriptions only** (`session.mode === 'subscription'`); `WEBHOOK_UNSUPPORTED_MODE` for one-time. Three handled events: `checkout.session.completed`, `invoice.payment_succeeded` (only `billing_reason === 'subscription_cycle'`), `customer.subscription.deleted`.

**Strengths:**
- Signature verification with raw body (`express.raw({type:'application/json', limit:'1mb'})`), mounted before JSON parser.
- Per-event idempotency via Firestore transaction (`stripe_webhook_events/{eventId}`), guarded by transactional `eventSnap.exists` check (`stripe.webhook.js:286-310`).
- Plan/price double-check: `metadata.plan` must match `getPlanForMonthlyPriceId(priceId)` if both present (`stripe.webhook.js:74-79`); `WEBHOOK_PLAN_PRICE_MISMATCH` blocks mismatched events.
- Renewal preserves `cycleUsedSec` only when same period (`samePeriod` check at `:222-245`); resets on new period — correct semantics.
- Canonical usage shape written via `buildCanonicalUsageState` (`usage.service`).

**Risks / gaps:**
- **B-1 (P1-5 / P2-10):** Identity resolution falls back to `getUserByEmail`. If `metadata.uid` is not always set on the Stripe Subscription (it must be on the **subscription**, not just the checkout session, because `invoice.payment_succeeded` and `customer.subscription.deleted` only see the Subscription's metadata), renewals/cancellations resolve via email and risk attaching to the wrong uid if Firebase Auth has a same-email user. Verify `checkout.controller.js` sets `subscription_data.metadata.uid` on every `stripe.checkout.sessions.create`.
- **B-2 (P2-10):** Idempotency keyed under `users/{uid}/stripe_webhook_events/{eventId}`. If event A resolves to uid X and a near-duplicate event A' (same `event.id`) re-resolves to uid Y due to email-lookup race, both insert succeed — duplicate processing. Top-level `stripe_webhook_events/{eventId}` collection avoids this.
- **B-3 (P3-8):** Permanent errors (`UNKNOWN_PLAN`, `WEBHOOK_PLAN_PRICE_MISMATCH`, `WEBHOOK_PLAN_MISSING`) currently return 500, causing Stripe retry storms. Map known-permanent codes to `200 ok` with `failed:true, reason:...` and a structured log.
- **B-4 (P2-8):** Webhook uses `console.log/warn/error` for structured events instead of `logger`/Sentry breadcrumbs. Migrate to structured logger with `eventId`, `eventType`, `uid`, `subscriptionId` fields.
- **B-5 (P3):** No automated test for webhook handlers. Stripe Fixtures + `stripe.webhooks.constructEvent` against canned payloads should cover all six cases (success/duplicate/mismatch/missing-uid/wrong-mode/unhandled-type).

---

## I. Security Audit

### Authentication & Authorization
- `requireAuth` (`src/middleware/requireAuth.js`) verifies Firebase ID token, populates `req.user = {uid, email, email_verified}`. All `/api/*` routes that need auth wire it in (verified by route-by-route read).
- `requireAuthOptional` (`planGuards.js:432-449`) silently swallows errors → P2-7.
- `requireMember` / `enforceFreeDailyShortLimit` / `enforceFreeLifetimeShortLimit` / `enforceRenderTimeForRender` / `enforceScriptDailyCap` correctly key off `req.user.uid` and consult canonical `usage.service`.
- **No role/admin claims** are checked in `requireAuth`. The admin-finalize dashboard relies on a separate token (`finalizeDashboardAccess` middleware — confirmed referenced; needs separate review of token strength and rotation policy).

### Input validation
- Zod schemas in `src/schemas/*` for `quotes`, `checkout`, etc. + `validate.middleware.js` produces canonical `VALIDATION_FAILED` envelopes.
- Inline schemas in `story.routes.js` (P2-9) work but bypass the central schema dir — drift risk.
- `caption.preview.routes.js` uses a 200kb body limit (`json200kb`) — intentional. All other routes use 10mb (`express.json({limit:'10mb'})` at `app.js:135`). 10mb is generous for a JSON API; consider 1mb default with explicit overrides.

### SSRF / Outbound fetches
- `src/utils/outbound.fetch.js` — strong allow-list policy: `https:` only, blocks non-public IPv4 (RFC1918, loopback, link-local, CGNAT, broadcast) and IPv6 (loopback, ULA, link-local, multicast), DNS-rebind defense via verbatim resolved IP, max 5 redirects manually walked with re-validation per hop.
- `src/utils/video.fetch.js` — uses outbound policy + MIME allow-list (`video/mp4` etc.).
- `src/utils/link.extract.js:133` — uses outbound policy for the API URL.
- **`src/utils/image.fetch.js:11-21`** — **bypasses the policy** (P1-1). Validates only `https:`, then `fetch(url, {redirect:'follow'})`. Reachable from any code that downloads selected stock or AI images (e.g. shot selection, manual session). Auto-redirects can land on internal IPs (Firebase metadata server, RFC1918) and exfiltrate response bodies / status codes.

### CORS / Headers
- Strict allow-list with explicit origins; dev-only Replit-preview wildcard. No `*` in prod.
- `helmet` enabled with CSP off (acceptable for JSON API; re-enable with `frame-ancestors 'none'` minimum) — P2-6.
- `trust proxy` env-driven — P3-7.

### Data isolation
- All Firestore writes that matter are keyed by `uid` (verified for `users/{uid}`, `users/{uid}/stories/{sessionId}`, `users/{uid}/finalizeAttempts/...`, `shorts/{shortId}` with `ownerId == uid`).
- `users/{email}` writes exist only in dead `health.controller.js` (P1-4).
- `getMyShorts` correctly filters by `ownerId == ownerUid` (`shorts.controller.js:35`).

### Secrets / config
- Stripe webhook secret read from env with `STRIPE_WEBHOOK_SECRET` guard. Webhook returns `WEBHOOK_NOT_CONFIGURED` if missing.
- `envCheck` runs at boot (`app.js:30`) for presence-only checks; CI bypasses via `NODE_ENV=test`.
- `requireAuthOptional` swallowing errors could mask token-secret rotation issues (P2-7).

### Logging redaction
- `src/observability/logger.js` + `redact.js` exist (per inventory). Spot-check shows webhook errors include raw `error?.message` — should pass through redactor (P2-8).

### Rate limiting
- `express-rate-limit` is in `dependencies` (`package.json`) but **no `app.use(rateLimit(...))`** in `src/app.js`. Per-route gates exist (`enforceFreeDailyShortLimit`, `enforceScriptDailyCap`) but no IP-level abuse protection on `/api/whoami`, `/api/users/ensure`, `/api/checkout/start`, etc. **Recommend** adding a global `rateLimit({windowMs:60_000, max:120, standardHeaders:true})` plus stricter buckets on auth-bootstrap and checkout endpoints.

---

## J. Top-10 Test Plan

Targeted to hit the highest-leverage gaps (no test framework currently for many of these — node `--test` is already used and sufficient).

| # | Test | Target | Why |
|---|---|---|---|
| 1 | **SSRF allow-list — image.fetch** | Mock DNS + http server returning `Location: http://169.254.169.254/`; assert fetch rejects with `IMAGE_URL_PROTOCOL` / SSRF error after fix. | Closes P1-1 regression. |
| 2 | **SSRF allow-list — outbound.fetch** | Verify `assertPublicOutboundUrl` rejects RFC1918, loopback, IPv6 ULA, link-local, and DNS-rebind. | Lock the existing strong policy. |
| 3 | **Stripe webhook — checkout success + idempotent replay** | Construct event via `stripe.webhooks.generateTestHeaderString`; first call writes user patch + event marker; second call short-circuits as duplicate. Assert single user-doc write. | Closes B-2 regression. |
| 4 | **Stripe webhook — plan/price mismatch returns terminal** | After fix (P3-8), assert `200 ok` with `failed:true,reason:'WEBHOOK_PLAN_PRICE_MISMATCH'` instead of 500. | Prevents Stripe retry storms. |
| 5 | **idempotencyFinalize — same key, two calls** | Reserve once, return `enqueued`; second call returns `active_same_key` 202; assert `usage.cycleReservedSec` increases exactly once. | Locks the canonical reservation invariant. |
| 6 | **idempotencyFinalize — different key, active session** | Active attempt for key A; new request with key B for same session returns 409 `STORY_FINALIZE_ALREADY_ACTIVE` and reserves nothing. | Locks the contract in F. |
| 7 | **planGuards.enforceRenderTimeForRender — insufficient seconds** | User with `cycleUsedSec ≈ cycleIncludedSec`; assert 402 `INSUFFICIENT_RENDER_TIME` and no reservation. | Locks the gate against drift. |
| 8 | **respond.js contract scan (AST)** | New script: walk `src/**/*.js`, fail if `res.status(...).json(` appears outside `src/http/respond.js`. | Replaces regex scanner; catches diag drifts. |
| 9 | **/api/limits/usage matches canonical usage** (after P1-3 fix) | Seed user with known seconds; assert `/api/limits/usage` payload matches `getUsageSummary(uid)`. | Prevents regression to dual-truth. |
| 10 | **assets.controller dedupe smoke** (after P1-2 fix) | Two sequential calls within same auth context; assert returned items differ when dedupe is intended (or remove dedupe and assert no `req.session` access). | Locks the chosen behavior. |

---

## K. Phased Roadmap

### Phase 1 — Pre-launch (must) — ≈1–2 weeks

1. **P1-1**: Migrate `image.fetch.js` to `fetchWithOutboundPolicy` (or factor a shared `safeStream` that handles size + MIME caps on top of outbound.fetch). Add test #1 + #2.
2. **P1-2**: Decide assets dedupe: either (a) move to a Firestore-backed per-uid TTL set, or (b) drop the feature and document. Remove `req.isPro` until plan is plumbed in. Add test #10.
3. **P1-3**: Reimplement `/api/limits/usage` against `getUsageSummary(uid)`; delete the `generations` subcollection read; align response shape with what the client actually consumes (review docs/ACTIVE_SURFACES). Add test #9.
4. **P1-4**: Delete `src/controllers/health.controller.js` (no callers).
5. **P1-5**: Verify `checkout.controller.js` always sets `subscription_data.metadata.uid`. Then make `resolveUid` **fail closed** when `metadata.uid` is missing (no email fallback). Add test #3.
6. Remove orphan `idempotencyFirestore` default export (P2-2).
7. Add a global `express-rate-limit` (`/api/*`) with stricter buckets on `/api/users/ensure` and `/api/checkout/start`.
8. Re-enable `helmet` CSP (`default-src 'none'; frame-ancestors 'none'`). Remove placeholder Netlify origin.

**Exit criteria:** Tests 1, 2, 3, 5, 6, 7, 9, 10 green. Sentry SLO dashboards show no SSRF or 500-stripe spikes for one week of synthetic traffic.

### Phase 2 — Pre-paid-beta hardening — ≈2–3 weeks

1. Map permanent webhook errors to terminal 200 (P3-8). Add test #4.
2. Move `stripe_webhook_events` to top-level collection (P2-10). Backfill existing nested docs by a one-shot migration script.
3. Replace `scripts/check-responses.js` with AST scan. Add test #8.
4. Convert remaining `console.*` → `logger`/`emitFinalizeEvent` (P2-8). Tag `requireAuthOptional` to log decoded-token failures at WARN (P2-7).
5. Consolidate inline zod schemas into `src/schemas/story/*` (P2-9). Wire `validate(...)` middleware uniformly.
6. Decommission `/api/story/render` legacy path (P2-4) once metrics confirm no callers for 14 days. Drop `renderStory`/`withRenderSlot` from `story.service`.
7. Unify free-tier counters under a single accounting model (P2-1) — pick `freeShortsUsed` and remove `shortDayKey/shortCountToday` (or vice versa).
8. Deploy composite Firestore index for `shorts(ownerId, createdAt desc)`; convert `INDEX_FALLBACK` log line to a Sentry alert (P2-5).

### Phase 3 — Maintainability & confidence — ≈3–4 weeks

1. Refactor mega-files (P3-2):
   - `story-finalize.attempts.js` → `admit.js` / `claim.js` / `settle.js` / `recover.js` / `metrics.js`.
   - `caption.preview.routes.js` → split route, stage runner, presenter.
   - `story.service.js` → split by lifecycle (`session`, `preview`, `sync`, `finalize-bridge`).
2. Migrate `/api/user/*` callers to `/api/users/ensure`; delete `user.routes.js`.
3. Remove dead `users/{uid}/generations` reads (P3-5) and add a guard test asserting the collection is unread.
4. Make diag routes use canonical envelope (P2-3) — even DBG-only.
5. Fix mojibake placeholder (P3-1) once client emits proper UTF-8.
6. Document poll cadence for `GET /api/story/:sessionId` (recovery) and add a server-side cooldown hint header.

**End state:** No file > 1500 lines; all responses go through `respond.js`; SSRF-safe outbound fetches enforced by lint rule (`no-restricted-globals: fetch` + allowed import); rate-limited; webhook test coverage; single source of truth for usage.

---

*End of report. No source files were modified during this audit.*
