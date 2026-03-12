# MOBILE_BACKEND_CONTRACT

Cross-repo verification date: 2026-03-12.

Purpose: canonical backend-owned contract, guarantees, and open mismatch record for mobile production. Current mobile caller-truth lives in the mobile repo. If a route is not `MOBILE_CORE_NOW` or `MOBILE_CORE_SOON` here, it is not first-class for mobile launch.

## Source Order

1. Actual current mobile repo usage and callsites
2. Actual mounted backend behavior
3. mobile repo `docs/MOBILE_USED_SURFACES.md`
4. this doc and `docs/MOBILE_HARDENING_PLAN.md`
5. Older spec docs only as historical context

## Request Rules

- Authenticated mobile requests use `Authorization: Bearer <Firebase ID token>` when a token is available (`client/api/client.ts:161-167`, `client/api/client.ts:221-227`, `src/middleware/requireAuth.js:5-19`).
- JSON requests use `Content-Type: application/json`.
- Mobile callers send `x-client: mobile` (`client/api/client.ts:155-159`, `client/api/client.ts:215-219`). Caption preview uses that header as part of the mobile/server-measured path selection when `measure` is omitted (`src/routes/caption.preview.routes.js:131-145`).
- Backend finalize requires `X-Idempotency-Key`, and the current mobile finalize caller sends it (`src/middleware/idempotency.firestore.js:33-37`, `client/api/client.ts:697-720`).
- `GET /api/usage` is now the active mobile billing surface, and `GET /api/credits` is mounted only as an explicit deprecated/dead endpoint (`client/api/client.ts:519-527`, `client/contexts/AuthContext.tsx:142-178`, `src/app.js:217-218`, `src/routes/credits.routes.js:1-11`).

## Billing Cutover Note

- Phase 1 of the hard-cutover billing migration adds canonical backend `GET /api/usage` and additive session `billingEstimate`.
- Phase 2 of the hard-cutover billing migration moves backend render reservation/settlement to canonical usage seconds and adds additive finalize `data.billing`.
- Phase 3 moves active mobile callers to `GET /api/usage`, updates mobile billing copy/gating to render-time semantics, and removes `/api/credits` from active caller usage.
- Current backend `billingEstimate.estimatedSec` is reservation-safe, not raw; Phase 2 now applies a server-side per-beat safety buffer before reserve and still requires representative manual verification before the estimate-proof gate is considered complete.
- Phases 1 through 3 of the billing migration are one continuous branch track; backend billing truth is being cut over before mobile caller migration, so the branch is not meant to represent a release-coherent end state until all three phases land and verify together.

## Response Rules

- Standard backend success envelope: `{ success: true, data, requestId }` (`src/http/respond.js:14-17`).
- Standard backend failure envelope: `{ success: false, error, detail, requestId, fields? }` (`src/http/respond.js:28-34`).
- Mobile normalization layer now preserves `requestId` while converting success envelopes to `{ ok: true, data, requestId }` and failure envelopes to `{ ok: false, status, code, message, requestId }` (`client/api/client.ts:77-145`, `client/api/client.ts:207-260`).
- Finalize is the current launch exception: the backend returns top-level `shortId`, and the mobile client explicitly extracts it from the raw response (`src/routes/story.routes.js:35-41`, `src/routes/story.routes.js:840-841`, `client/api/client.ts:740-760`).

## Current Open Contract Mismatches

- `OPEN`: Several live mobile editor/search routes still collapse service-level domain failures into generic 500s.
  - Backend routes: `src/routes/story.routes.js:497-725`
  - Backend services: `src/services/story.service.js:468-550`, `src/services/story.service.js:628-700`
  - Why it matters: mobile cannot reliably distinguish session-state errors from real server faults.

## MOBILE_CORE_NOW Contract
### Auth Bootstrap And Usage

- `POST /api/users/ensure`
  - Mobile caller(s): `client/contexts/AuthContext.tsx:78-170`
  - Backend handler(s): `src/routes/users.routes.js:15-31`, `src/services/credit.service.js:225-268`
  - Mobile sends: no body.
  - Backend returns: full success envelope with a symmetric mobile profile shape.
  - Mobile reads: stores the returned profile for auth/account bootstrap only; active billing screens no longer read `userProfile.credits`.
  - Contract note: the app now waits for both provisioning and canonical usage fetch to succeed before treating the signed-in user as app-ready.

- `GET /api/usage`
  - Mobile caller(s): `client/contexts/AuthContext.tsx:142-178`, `client/screens/SettingsScreen.tsx:43-59`, `client/screens/StoryEditorScreen.tsx:926-951`
  - Backend handler(s): `src/routes/usage.routes.js`, `src/controllers/usage.controller.js`, `src/services/usage.service.js`
  - Backend returns: `{ success: true, data: { plan, membership, usage }, requestId }`.
  - Mobile reads: `data.usage.availableSec` for render-time balance, plus the rest of the usage snapshot for canonical billing state.
  - Contract note: this is now the active mobile billing surface.

- `GET /api/credits`
  - Mobile caller(s): none in the current mobile repo.
  - Backend handler(s): `src/routes/credits.routes.js:1-11`, `src/controllers/credits.controller.js:1-10`
  - Backend returns: `410 CREDITS_REMOVED`.
  - Contract note: this endpoint is intentionally dead and must not be revived for compatibility.

### Story Creation And Session Truth

- `POST /api/story/start`
  - Mobile caller(s): `client/screens/HomeScreen.tsx:79-107`
  - Backend handler(s): `src/routes/story.routes.js:118-145`, `src/services/story.service.js:88-113`
  - Mobile sends: `{ input, inputType }`.
  - Backend returns: full session in `data`.
  - Mobile reads: `data.id` only.

- `POST /api/story/generate`
  - Mobile caller(s): `client/screens/HomeScreen.tsx:109-127`
  - Backend handler(s): `src/routes/story.routes.js:147-172`, `src/services/story.service.js:125-156`
  - Mobile sends: `{ sessionId }`.
  - Backend returns: full session in `data`.
  - Mobile reads: success/failure only.
  - Guardrail: `enforceScriptDailyCap(300)` (`src/routes/story.routes.js:148`).

- `GET /api/story/:sessionId`
  - Mobile caller(s): `client/screens/ScriptScreen.tsx:64-84`, `client/screens/StoryEditorScreen.tsx:459-541`, `client/screens/StoryEditorScreen.tsx:954-1009`
  - Backend handler(s): `src/routes/story.routes.js:1002-1024`, `src/services/story.service.js:202-203`
  - Recovery-state writer(s): `src/services/story.service.js:149-167`, `src/services/story.service.js:2144-2218`
  - Mobile sends: no body.
  - Backend returns: full session in `data`.
  - Mobile reads: `story.sentences` with helper fallbacks, `shots`, `overlayCaption.placement`, additive `billingEstimate.estimatedSec`, `shot.selectedClip.thumbUrl`, `shot.searchQuery`, and `renderRecovery` during finalize recovery polling.
  - Recovery role: this route is now the backend-backed finalize recovery contract. Additive `renderRecovery` fields expose `{ state, attemptId, startedAt, updatedAt, shortId, finishedAt, failedAt, code, message }`, and mobile trusts them only when `renderRecovery.attemptId` matches the active finalize attempt.

- `POST /api/story/plan`
  - Mobile caller(s): `client/screens/ScriptScreen.tsx:126-159`
  - Backend handler(s): `src/routes/story.routes.js:476-495`, `src/services/story.service.js:189-201`
  - Mobile sends: `{ sessionId }`.
  - Backend returns: full session in `data`.
  - Mobile reads: success/failure only.
  - Guardrail: `enforceScriptDailyCap(300)`.

- `POST /api/story/search`
  - Mobile caller(s): `client/screens/ScriptScreen.tsx:141-159`
  - Backend handler(s): `src/routes/story.routes.js:497-516`, `src/services/story.service.js:427-462`
  - Mobile sends: `{ sessionId }`.
  - Backend returns: full session in `data`.
  - Mobile reads: success/failure only.
  - Contract caveat: service-level `SESSION_NOT_FOUND` and `PLAN_REQUIRED` still collapse into generic 500s today.

### Story Editing And Caption Preview

- `POST /api/story/update-beat-text`
  - Mobile caller(s): `client/screens/ScriptScreen.tsx:162-209`, `client/screens/StoryEditorScreen.tsx:679-701`
  - Backend handler(s): `src/routes/story.routes.js:691-725`, `src/services/story.service.js:670-700`
  - Mobile sends: `{ sessionId, sentenceIndex, text }`.
  - Backend returns: partial `{ sentences, shots }` in `data`, not a full session.
  - Mobile reads:
    - `ScriptScreen`: re-runs `extractBeats()` against the partial payload.
    - `StoryEditorScreen`: ignores returned data and updates local state.
  - Contract caveat: service dereferences `session.story` before a session-null check, so some domain errors turn into 500s.

- `POST /api/story/delete-beat`
  - Mobile caller(s): `client/screens/ScriptScreen.tsx:222-235`, `client/screens/StoryEditorScreen.tsx:715-749`
  - Backend handler(s): `src/routes/story.routes.js:664-689`, `src/services/story.service.js:628-665`
  - Mobile sends: `{ sessionId, sentenceIndex }`.
  - Backend returns: partial `{ sentences, shots }` in `data`.
  - Mobile reads: success/failure only, then refetches `GET /api/story/:sessionId`.
  - Contract caveat: service-level `SESSION_NOT_FOUND`, `STORY_REQUIRED`, `SHOTS_REQUIRED`, and `INVALID_SENTENCE_INDEX` collapse into generic 500s today.

- `POST /api/story/search-shot`
  - Mobile caller(s): `client/screens/ClipSearchModal.tsx:49-80`
  - Backend handler(s): `src/routes/story.routes.js:594-633`, `src/services/story.service.js:468-523`, `src/services/story.service.js:286-421`
  - Mobile sends: `{ sessionId, sentenceIndex, query, page }`.
  - Backend returns: `{ shot, page, hasMore }` in `data`.
  - Mobile reads: `shot.candidates`, `page`, `hasMore`, and candidate `id`, `thumbUrl`, `provider`, `duration`.
  - Contract caveat: several domain errors still collapse into generic 500s today.

- `POST /api/story/update-shot`
  - Mobile caller(s): `client/screens/ClipSearchModal.tsx:83-104`
  - Backend handler(s): `src/routes/story.routes.js:518-545`, `src/services/story.service.js:528-550`
  - Mobile sends: `{ sessionId, sentenceIndex, clipId }`.
  - Backend returns: `{ shots }` in `data`.
  - Mobile reads: success/failure only.
  - Contract caveat: `SESSION_NOT_FOUND`, `SHOTS_REQUIRED`, `SHOT_NOT_FOUND`, `NO_CANDIDATES_AVAILABLE`, and `CLIP_NOT_FOUND_IN_CANDIDATES` still collapse into generic 500s today.

- `POST /api/caption/preview`
  - Mobile caller(s): `client/hooks/useCaptionPreview.ts:59-120`, `client/screens/StoryEditorScreen.tsx:507-516`
  - Backend handler(s): `src/routes/caption.preview.routes.js:109-313`
  - Mobile sends: `{ ssotVersion: 3, mode: "raster", measure: "server", text, placement, yPct, frameW, frameH }`; current screen does not send `style`.
  - Backend returns: `data.meta` including `rasterUrl`, `rasterW`, `rasterH`, `yPx_png`, `frameW`, `frameH`, and other compiler metadata.
  - Mobile reads: `meta.rasterUrl`, `rasterW`, `rasterH`, `yPx_png`, and uses fallback centering when `xPx_png` is absent.
  - Guardrails: auth-required, `20/min`, `200kb` body cap.

- `POST /api/story/update-caption-style`
  - Mobile caller(s): `client/screens/StoryEditorScreen.tsx:765-820`
  - Backend handler(s): `src/routes/story.routes.js:207-283`
  - Mobile sends: `{ sessionId, overlayCaption: { placement, yPct } }`.
  - Backend returns: `{ overlayCaption }` in `data`.
  - Mobile reads: success/failure only.

### Render, Recovery, And Shorts

- `POST /api/story/finalize`
  - Mobile caller(s): `client/screens/StoryEditorScreen.tsx:1012-1139`, `client/api/client.ts:716-804`
  - Backend handler(s): `src/routes/story.routes.js:818-856`, `src/middleware/idempotency.firestore.js:12-208`, `src/services/story.service.js:2144-2218`
  - Mobile sends now: `{ sessionId }` plus `X-Idempotency-Key`.
  - Backend requires now: `{ sessionId }` plus `X-Idempotency-Key`.
  - Backend returns on success: full session in `data`, additive `data.billing`, plus top-level `shortId`.
  - Mobile reads: `shortId`, additive `data.billing.billedSec` when available, and on failures `retryAfter`, `code/error`, `message/detail`, `status`.
  - Guardrails: Firestore-backed idempotency and usage-second reservation/settlement, `withRenderSlot()` semaphore, synchronous HTTP render path.
  - Current 402 semantics: backend uses time-based billing failures such as `INSUFFICIENT_RENDER_TIME`, and mobile now mirrors that render-time wording.
  - Recovery contract: backend persists additive `renderRecovery.pending` before the blocking render starts, then persists `renderRecovery.done` or `renderRecovery.failed` with the same `attemptId` used for `X-Idempotency-Key`. On `TIMEOUT`, `NETWORK_ERROR`, or `IDEMPOTENT_IN_PROGRESS`, mobile keeps the active attempt key and polls `GET /api/story/:sessionId` until that same-attempt recovery state reaches a terminal result.
  - Contract caveat: recovery is currently same-screen and bounded. If polling exhausts its attempts while state remains `pending`, mobile leaves the attempt key in memory and asks the user to resume the same attempt or check Library shortly.

- `GET /api/shorts/mine`
  - Mobile caller(s): `client/screens/LibraryScreen.tsx:80-118`, `client/screens/ShortDetailScreen.tsx:227-248`
  - Backend handler(s): `src/routes/shorts.routes.js:7-9`, `src/controllers/shorts.controller.js:5-90`
  - Mobile sends: `limit` and optional `cursor`.
  - Backend returns: `{ items, nextCursor, hasMore }` in `data`.
  - Mobile reads: list items and pagination fields.
  - Additive Phase 2 note: finalized short docs now persist backend-owned `billing` metadata in Firestore; current mobile callers ignore it.
  - Stability note: controller has an index-missing fallback path that disables pagination semantics when the composite index is absent.

- `GET /api/shorts/:jobId`
  - Mobile caller(s): `client/screens/ShortDetailScreen.tsx:143-333`, `client/screens/ShortDetailScreen.tsx:513-529`
  - Backend handler(s): `src/routes/shorts.routes.js:7-9`, `src/controllers/shorts.controller.js:93-208`
  - Mobile sends: no body.
  - Backend returns now: bridge payload containing both `id` and `jobId`.
  - Mobile reads: `id`, `videoUrl`, `coverImageUrl`, `durationSec`, `usedQuote.text`, `usedTemplate`, `createdAt`.
  - Compatibility bridge:
    - detail now probes `story.mp4` / `thumb.jpg` first and falls back to `short.mp4` / `cover.jpg`
    - mobile still ignores `jobId`
    - mobile still keeps `GET /api/shorts/mine` fallback during the bridge period

## MOBILE_CORE_SOON Contract

- `POST /api/story/insert-beat`
  - Backend route exists: `src/routes/story.routes.js:635-662`
  - Backend service exists: `src/services/story.service.js:555-623`
  - Current mobile caller: none.
  - Promotion rule: only harden when a real mobile caller lands.

## Route Classification Table

| Route | Classification | Verified caller evidence | Handling policy |
| --- | --- | --- | --- |
| `POST /api/users/ensure` | `MOBILE_CORE_NOW` | Mobile auth bootstrap (`client/contexts/AuthContext.tsx:63-76`) | Harden and document now. |
| `GET /api/credits` | `REMOVE_LATER` | No current mobile caller; endpoint now returns `410 CREDITS_REMOVED` | Keep dead until final removal. |
| `GET /api/usage` | `MOBILE_CORE_NOW` | Mobile auth bootstrap and billing refresh (`client/api/client.ts:519-527`, `client/contexts/AuthContext.tsx:142-178`) | Harden and document now. |
| `POST /api/story/start` | `MOBILE_CORE_NOW` | Mobile home create flow (`client/screens/HomeScreen.tsx:79-107`) | Harden now. |
| `POST /api/story/generate` | `MOBILE_CORE_NOW` | Mobile create flow (`client/screens/HomeScreen.tsx:109-127`) | Harden now. |
| `GET /api/story/:sessionId` | `MOBILE_CORE_NOW` | Mobile script/editor and finalize-recovery truth (`client/screens/ScriptScreen.tsx:64-84`, `client/screens/StoryEditorScreen.tsx:367-449`, `client/screens/StoryEditorScreen.tsx:943-999`) | Harden now. |
| `POST /api/story/plan` | `MOBILE_CORE_NOW` | Mobile storyboard step (`client/screens/ScriptScreen.tsx:126-159`) | Harden now. |
| `POST /api/story/search` | `MOBILE_CORE_NOW` | Mobile storyboard step (`client/screens/ScriptScreen.tsx:141-159`) | Harden now. |
| `POST /api/story/update-beat-text` | `MOBILE_CORE_NOW` | Mobile script/editor beat editing (`client/screens/ScriptScreen.tsx:162-209`, `client/screens/StoryEditorScreen.tsx:679-701`) | Harden now. |
| `POST /api/story/delete-beat` | `MOBILE_CORE_NOW` | Mobile script/editor deletion (`client/screens/ScriptScreen.tsx:222-235`, `client/screens/StoryEditorScreen.tsx:715-749`) | Harden now. |
| `POST /api/story/search-shot` | `MOBILE_CORE_NOW` | Mobile clip picker (`client/screens/ClipSearchModal.tsx:49-80`) | Harden now. |
| `POST /api/story/update-shot` | `MOBILE_CORE_NOW` | Mobile clip replacement (`client/screens/ClipSearchModal.tsx:83-104`) | Harden now. |
| `POST /api/caption/preview` | `MOBILE_CORE_NOW` | Mobile beat-card preview (`client/hooks/useCaptionPreview.ts:59-120`) | Harden now. |
| `POST /api/story/update-caption-style` | `MOBILE_CORE_NOW` | Mobile caption placement persistence (`client/screens/StoryEditorScreen.tsx:765-820`) | Harden now. |
| `POST /api/story/finalize` | `MOBILE_CORE_NOW` | Mobile render action (`client/screens/StoryEditorScreen.tsx:915-1099`) | Harden now; highest-risk contract surface. |
| `GET /api/shorts/mine` | `MOBILE_CORE_NOW` | Mobile library list and detail fallback (`client/screens/LibraryScreen.tsx:80-118`, `client/screens/ShortDetailScreen.tsx:227-248`) | Harden now. |
| `GET /api/shorts/:jobId` | `MOBILE_CORE_NOW` | Mobile post-render detail path (`client/screens/ShortDetailScreen.tsx:143-333`) | Harden now; compatibility bridge is active. |
| `POST /api/story/insert-beat` | `MOBILE_CORE_SOON` | No current mobile caller | Do not harden until mobile adopts it. |
| `POST /api/assets/options` | `LEGACY_WEB` | Web creative editor only (`web/public/js/pages/creative/creative.article.mjs:3483`) | Ignore unless shared security risk crosses into mobile. |
| `POST /api/story/manual` | `LEGACY_WEB` | Web manual flow only (`web/public/js/pages/creative/creative.article.mjs:1487`) | Ignore for mobile launch. |
| `POST /api/story/create-manual-session` | `LEGACY_WEB` | Web manual-first render only (`web/public/js/pages/creative/creative.article.mjs:3930`) | Ignore for mobile launch. |
| `POST /api/story/update-video-cuts` | `LEGACY_WEB` | Web editor only (`web/public/js/pages/creative/creative.article.mjs:1922`, `web/public/js/pages/creative/creative.article.mjs:1950`) | Ignore for mobile launch. |
| `POST /api/story/update-caption-meta` | `LEGACY_WEB` | Web caption preview persistence only (`web/public/js/caption-preview.js:108`) | Ignore unless it breaks shared render stability. |
| `POST /api/checkout/start` | `LEGACY_WEB` | Web pricing page only (`web/public/js/pricing.js:114`) | Touch only for direct billing risk to mobile launch. |
| `POST /api/checkout/session` | `LEGACY_WEB` | Web buy-credits only (`web/public/js/buy-credits.js:67`) | Touch only for direct billing risk to mobile launch. |
| `POST /api/checkout/subscription` | `LEGACY_WEB` | Web buy-credits only (`web/public/js/buy-credits.js:84`) | Touch only for direct billing risk to mobile launch. |
| `POST /api/checkout/portal` | `LEGACY_WEB` | Web billing portal only (`web/public/js/buy-credits.js:167`) | Touch only for direct billing risk to mobile launch. |
| `POST /stripe/webhook` | `LEGACY_WEB` | External Stripe caller; no mobile API caller (`src/app.js:111-116`) | Keep correct, but do not broaden launch scope around it. |
| `POST /api/story/update-script` | `REMOVE_LATER` | No current mobile caller; no current `web/public` caller found in repo search | Retire after freeze. |
| `POST /api/story/timeline` | `REMOVE_LATER` | No current mobile caller; no current `web/public` caller found in repo search | Retire after freeze. |
| `POST /api/story/captions` | `REMOVE_LATER` | No current mobile caller; no current `web/public` caller found in repo search | Retire after freeze. |
| `POST /api/story/render` | `REMOVE_LATER` | No current mobile caller; no current `web/public` caller found in repo search | Default-disable now; remove later. |
| `POST /api/user/setup` | `REMOVE_LATER` | No current mobile caller; no current `web/public` caller found in repo search | Retire after freeze. |
| `GET /api/user/me` | `REMOVE_LATER` | No current mobile caller; no current `web/public` caller found in repo search | Retire after freeze unless mobile adopts it explicitly. |
| `GET /api/whoami` | `REMOVE_LATER` | No current mobile caller; no current `web/public` caller found in repo search | Retire after freeze. |
| `GET /api/limits/usage` | `REMOVE_LATER` | No current mobile caller; no current `web/public` caller found in repo search | Retire after freeze. |
