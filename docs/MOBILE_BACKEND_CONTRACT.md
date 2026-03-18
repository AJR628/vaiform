# MOBILE_BACKEND_CONTRACT

Cross-repo verification date: 2026-03-18.

Purpose: canonical backend-owned contract, guarantees, and open mismatch record for mobile production. Current mobile caller-truth lives in the mobile repo. If a route is not `MOBILE_CORE_NOW` or `MOBILE_CORE_SOON` here, it is not first-class for mobile launch.

## Source Order

1. Actual current mobile repo usage and callsites
2. Actual mounted backend behavior
3. mobile repo `docs/MOBILE_USED_SURFACES.md`
4. this doc and `docs/MOBILE_HARDENING_PLAN.md`
5. Older spec docs only as historical context

## Request Rules

- Authenticated mobile requests use `Authorization: Bearer <Firebase ID token>` when a token is available (`client/api/client.ts:167-183`, `client/api/client.ts:227-241`, `src/middleware/requireAuth.js:7-27`).
- JSON requests use `Content-Type: application/json`.
- Mobile callers send `x-client: mobile` (`client/api/client.ts:171-175`, `client/api/client.ts:231-235`). Caption preview uses that header as part of the mobile/server-measured path selection when `measure` is omitted (`src/routes/caption.preview.routes.js:131-145`).
- Backend finalize requires `X-Idempotency-Key`, and the current mobile finalize caller sends it (`src/middleware/idempotency.firestore.js:69-94`, `client/api/client.ts:743-780`).
- `GET /api/usage` is the active mobile billing surface (`client/api/client.ts:547-551`, `client/contexts/AuthContext.tsx:159-180`, `src/routes/usage.routes.js:1-8`).

## Billing Cutover Note

- Phase 1 of the hard-cutover billing migration adds canonical backend `GET /api/usage` and additive session `billingEstimate`.
- Phase 2 of the hard-cutover billing migration moves backend render reservation/settlement to canonical usage seconds and adds additive finalize `data.billing`.
- Phase 3 moves active mobile callers to `GET /api/usage`, updates mobile billing copy/gating to render-time semantics, and removes `/api/credits` from active caller usage.
- Current backend `billingEstimate.estimatedSec` is reservation-safe, not raw. The active source order is `speech_duration -> shot_durations -> caption_timeline`, where `speech_duration` is the backend-owned composite text heuristic and `caption_timeline` is retained only as an emergency fallback. Representative manual verification is still required before the estimate-proof gate is considered complete.
- Phases 1 through 5 of the billing migration are now landed in code, but the overall integration is still not production-ready until the Phase 2 estimate-proof gate is manually closed and live Stripe/manual end-to-end verification is completed.

## Response Rules

- Standard backend success envelope: `{ success: true, data, requestId }` (`src/http/respond.js:14-17`).
- Standard backend failure envelope: `{ success: false, error, detail, requestId, fields? }` (`src/http/respond.js:28-34`).
- Mobile normalization layer now preserves `requestId` while converting success envelopes to `{ ok: true, data, requestId }` and failure envelopes to `{ ok: false, status, code, message, requestId }` (`client/api/client.ts:94-160`, `client/api/client.ts:223-289`).
- Finalize is the current launch exception: the backend returns top-level `shortId`, and the mobile client explicitly extracts it from the raw response (`src/routes/story.routes.js:35-41`, `src/routes/story.routes.js:967-975`, `client/api/client.ts:818-845`).
- Cross-Repo Phase 3 observability is now live on the named hot paths only: backend request context is seeded immediately after request ID assignment, backend hot-path boundary events flow through one structured stdout logger with built-in redaction, and mobile keeps a bounded in-memory diagnostics buffer for normalized failures with additive context from auth bootstrap, finalize/recovery, and short-detail retry surfaces.
- Phase 3 caveat: deeper finalize/render internals inside the active finalize path still contain legacy `console.*` logging and were not fully migrated in this phase.

## Current Open Contract Notes

- `STATUS`: Active mobile editor/search routes now map known domain failures to stable 4xx/404 responses instead of collapsing them into generic 500s.
- `STATUS`: Cross-Repo Phase 3 request-scoped observability is landed for auth bootstrap, provider-backed story generation/search, finalize/idempotent replay/recovery, and short-detail recovery.
- `OPEN`: Phase 2 admission-control review remains tracked separately in `docs/MOBILE_HARDENING_PLAN.md`.

## MOBILE_CORE_NOW Contract
### Auth Bootstrap And Usage

- `POST /api/users/ensure`
  - Mobile caller(s): `client/contexts/AuthContext.tsx:133-188`
  - Backend handler(s): `src/routes/users.routes.js:18-48`, `src/services/user-doc.service.js:5-36`, `src/services/usage.service.js:133-168`
  - Mobile sends: no body.
  - Backend returns: full success envelope with `{ uid, email, plan, freeShortsUsed }`.
  - Mobile reads: stores the returned profile for auth/account bootstrap only; active billing screens rely on `/api/usage`.
  - Contract note: the app now waits for both provisioning and canonical usage fetch to succeed before treating the signed-in user as app-ready.
  - Diagnostics note: failed bootstrap calls now keep `requestId` in normalized mobile failures and enrich the in-memory diagnostics buffer with the active Firebase `uid` when available.

- `GET /api/usage`
  - Mobile caller(s): `client/contexts/AuthContext.tsx:159-180`, `client/screens/SettingsScreen.tsx:43-59`, `client/screens/StoryEditorScreen.tsx:930-951`
  - Backend handler(s): `src/routes/usage.routes.js`, `src/controllers/usage.controller.js`, `src/services/usage.service.js`
  - Backend returns: `{ success: true, data: { plan, membership, usage }, requestId }`.
  - Mobile reads: `data.usage.availableSec` for render-time balance, plus the rest of the usage snapshot for canonical billing state.
  - Contract note: this is now the active mobile billing surface.

### Story Creation And Session Truth

- `POST /api/story/start`
  - Mobile caller(s): `client/screens/HomeScreen.tsx:79-107`
  - Backend handler(s): `src/routes/story.routes.js:189-216`, `src/services/story.service.js:324-348`
  - Mobile sends: `{ input, inputType }`.
  - Backend returns: full session in `data`.
  - Mobile reads: `data.id` only.

- `POST /api/story/generate`
  - Mobile caller(s): `client/screens/HomeScreen.tsx:109-127`
  - Backend handler(s): `src/routes/story.routes.js:218-255`, `src/services/story.service.js:362-397`
  - Mobile sends: `{ sessionId }`.
  - Backend returns: full session in `data`.
  - Mobile reads: success/failure only.
  - Guardrail: `enforceScriptDailyCap(300)` (`src/routes/story.routes.js:218-233`).

- `GET /api/story/:sessionId`
  - Mobile caller(s): `client/screens/ScriptScreen.tsx:64-84`, `client/screens/StoryEditorScreen.tsx:459-541`, `client/screens/StoryEditorScreen.tsx:974-1024`
  - Backend handler(s): `src/routes/story.routes.js:1147-1178`, `src/services/story.service.js:355-357`
  - Recovery-state writer(s): `src/services/story.service.js:2325-2417`
  - Mobile sends: no body.
  - Backend returns: full session in `data`.
  - Mobile reads: `story.sentences` with helper fallbacks, `shots`, `overlayCaption.placement`, additive `billingEstimate.estimatedSec`, `shot.selectedClip.thumbUrl`, `shot.searchQuery`, and `renderRecovery` during finalize recovery polling.
  - Recovery role: this route is now the backend-backed finalize recovery contract. Additive `renderRecovery` fields expose `{ state, attemptId, startedAt, updatedAt, shortId, finishedAt, failedAt, code, message }`, and mobile trusts them only when `renderRecovery.attemptId` matches the active finalize attempt.
  - Stable failure now: `404 SESSION_NOT_FOUND`.
  - Diagnostics note: failed recovery polls now keep `requestId` in normalized mobile failures and enrich diagnostics with `sessionId` plus the active finalize `attemptId`.

- `POST /api/story/plan`
  - Mobile caller(s): `client/screens/ScriptScreen.tsx:126-159`
  - Backend handler(s): `src/routes/story.routes.js:557-576`, `src/services/story.service.js:437-448`
  - Mobile sends: `{ sessionId }`.
  - Backend returns: full session in `data`.
  - Mobile reads: success/failure only.
  - Guardrail: `enforceScriptDailyCap(300)`.

- `POST /api/story/search`
  - Mobile caller(s): `client/screens/ScriptScreen.tsx:141-159`
  - Backend handler(s): `src/routes/story.routes.js:578-610`, `src/services/story.service.js:677-715`
  - Mobile sends: `{ sessionId }`.
  - Backend returns: full session in `data`.
  - Mobile reads: success/failure only.
  - Stable failures now:
    - `404 SESSION_NOT_FOUND`
    - `400 PLAN_REQUIRED`

### Story Editing And Caption Preview

- `POST /api/story/update-beat-text`
  - Mobile caller(s): `client/screens/ScriptScreen.tsx:162-209`, `client/screens/StoryEditorScreen.tsx:776-803`
  - Backend handler(s): `src/routes/story.routes.js:815-857`, `src/services/story.service.js:926-949`
  - Mobile sends: `{ sessionId, sentenceIndex, text }`.
  - Backend returns: partial `{ sentences, shots }` in `data`, not a full session.
  - Mobile reads:
    - `ScriptScreen`: re-runs `extractBeats()` against the partial payload.
    - `StoryEditorScreen`: ignores returned data and updates local state.
  - Stable failures now:
    - `404 SESSION_NOT_FOUND`
    - `400 STORY_REQUIRED`
    - `400 INVALID_SENTENCE_INDEX`
  - Guardrail: service now checks `SESSION_NOT_FOUND` / `STORY_REQUIRED` before dereferencing `session.story`.

- `POST /api/story/delete-beat`
  - Mobile caller(s): `client/screens/ScriptScreen.tsx:222-235`, `client/screens/StoryEditorScreen.tsx:826-854`
  - Backend handler(s): `src/routes/story.routes.js:778-813`, `src/services/story.service.js:883-911`
  - Mobile sends: `{ sessionId, sentenceIndex }`.
  - Backend returns: partial `{ sentences, shots }` in `data`.
  - Mobile reads: success/failure only, then refetches `GET /api/story/:sessionId`.
  - Stable failures now:
    - `404 SESSION_NOT_FOUND`
    - `400 STORY_REQUIRED`
    - `400 SHOTS_REQUIRED`
    - `400 INVALID_SENTENCE_INDEX`

- `POST /api/story/search-shot`
  - Mobile caller(s): `client/screens/ClipSearchModal.tsx:49-80`
  - Backend handler(s): `src/routes/story.routes.js:692-776`, `src/services/story.service.js:722-773`, `src/services/story.service.js:531-660`
  - Mobile sends: `{ sessionId, sentenceIndex, query, page }`.
  - Backend returns: `{ shot, page, hasMore }` in `data`.
  - Mobile reads: `shot.candidates`, `page`, `hasMore`, and candidate `id`, `thumbUrl`, `provider`, `duration`.
  - Stable failures now:
    - `404 SESSION_NOT_FOUND`
    - `400 SHOTS_REQUIRED`
    - `404 SHOT_NOT_FOUND` (detail may include `sentenceIndex` context)
    - `400 NO_SEARCH_QUERY_AVAILABLE`

- `POST /api/story/update-shot`
  - Mobile caller(s): `client/screens/ClipSearchModal.tsx:83-104`
  - Backend handler(s): `src/routes/story.routes.js:612-655`, `src/services/story.service.js:782-801`
  - Mobile sends: `{ sessionId, sentenceIndex, clipId }`.
  - Backend returns: `{ shots }` in `data`.
  - Mobile reads: success/failure only.
  - Stable failures now:
    - `404 SESSION_NOT_FOUND`
    - `400 SHOTS_REQUIRED`
    - `404 SHOT_NOT_FOUND`
    - `400 NO_CANDIDATES_AVAILABLE`
    - `400 CLIP_NOT_FOUND_IN_CANDIDATES`

- `POST /api/caption/preview`
  - Mobile caller(s): `client/hooks/useCaptionPreview.ts:59-120`, `client/screens/StoryEditorScreen.tsx:507-516`
  - Backend handler(s): `src/routes/caption.preview.routes.js:109-313`
  - Mobile sends: `{ ssotVersion: 3, mode: "raster", measure: "server", text, placement, yPct, frameW, frameH }`; current screen does not send `style`.
  - Backend returns: `data.meta` including `rasterUrl`, `rasterW`, `rasterH`, `yPx_png`, `frameW`, `frameH`, and other compiler metadata.
  - Mobile reads: `meta.rasterUrl`, `rasterW`, `rasterH`, `yPx_png`, and uses fallback centering when `xPx_png` is absent.
  - Guardrails: auth-required, `20/min`, `200kb` body cap.

- `POST /api/story/update-caption-style`
  - Mobile caller(s): `client/screens/StoryEditorScreen.tsx:876-899`
  - Backend handler(s): `src/routes/story.routes.js:287-354`
  - Mobile sends: `{ sessionId, overlayCaption: { placement, yPct } }`.
  - Backend returns: `{ overlayCaption }` in `data`.
  - Mobile reads: success/failure only.

### Render, Recovery, And Shorts

- `POST /api/story/finalize`
  - Mobile caller(s): `client/screens/StoryEditorScreen.tsx:1060-1177`, `client/api/client.ts:743-859`
  - Backend handler(s): `src/routes/story.routes.js:940-989`, `src/middleware/idempotency.firestore.js:69-467`, `src/services/story.service.js:2325-2417`
  - Mobile sends now: `{ sessionId }` plus `X-Idempotency-Key`.
  - Backend requires now: `{ sessionId }` plus `X-Idempotency-Key`.
  - Backend returns on success: full session in `data`, additive `data.billing`, plus top-level `shortId`.
  - Mobile reads: `shortId`, additive `data.billing.billedSec` when available, and on failures `retryAfter`, `code/error`, `message/detail`, `status`.
  - Guardrails: Firestore-backed idempotency and usage-second reservation/settlement, `withRenderSlot()` semaphore, synchronous HTTP render path.
  - Current 402 semantics: backend uses time-based billing failures such as `INSUFFICIENT_RENDER_TIME`, and mobile now mirrors that render-time wording.
  - Recovery contract: backend persists additive `renderRecovery.pending` before the blocking render starts, then persists `renderRecovery.done` or `renderRecovery.failed` with the same `attemptId` used for `X-Idempotency-Key`. On `TIMEOUT`, `NETWORK_ERROR`, or `IDEMPOTENT_IN_PROGRESS`, mobile keeps the active attempt key and polls `GET /api/story/:sessionId` until that same-attempt recovery state reaches a terminal result.
  - Contract caveat: recovery is currently same-screen and bounded. If polling exhausts its attempts while state remains `pending`, mobile leaves the attempt key in memory and asks the user to resume the same attempt or check Library shortly.
  - Diagnostics note: finalize, idempotent replay, and recovery boundary events now correlate by `requestId` plus additive `sessionId` / `attemptId`, and mobile failure diagnostics enrich the same request/attempt context in memory.
  - Observability caveat: deeper render internals invoked by finalize still contain legacy `console.*` logging; Phase 3 did not complete a full render-path logger migration.

- `GET /api/shorts/mine`
  - Mobile caller(s): `client/screens/LibraryScreen.tsx:80-118`, `client/screens/ShortDetailScreen.tsx:227-248`
  - Backend handler(s): `src/routes/shorts.routes.js:7-9`, `src/controllers/shorts.controller.js:5-90`
  - Mobile sends: `limit` and optional `cursor`.
  - Backend returns: `{ items, nextCursor, hasMore }` in `data`.
  - Mobile reads: list items and pagination fields.
  - Additive Phase 2 note: finalized short docs now persist backend-owned `billing` metadata in Firestore; current mobile callers ignore it.
  - Stability note: controller has an index-missing fallback path that disables pagination semantics when the composite index is absent.

- `GET /api/shorts/:jobId`
  - Mobile caller(s): `client/screens/ShortDetailScreen.tsx:183-345`, `client/screens/ShortDetailScreen.tsx:594-602`
  - Backend handler(s): `src/routes/shorts.routes.js:7-9`, `src/controllers/shorts.controller.js:95-235`
  - Mobile sends: no body.
  - Backend returns now: bridge payload containing both `id` and `jobId`.
  - Mobile reads: `id`, `videoUrl`, `coverImageUrl`, `durationSec`, `usedQuote.text`, `usedTemplate`, `createdAt`.
  - Compatibility bridge:
    - detail now probes `story.mp4` / `thumb.jpg` first and falls back to `short.mp4` / `cover.jpg`
    - mobile still ignores `jobId`
    - mobile still keeps `GET /api/shorts/mine` fallback during the bridge period
  - Intentional pending semantics: `404 NOT_FOUND` still means the detail asset is not available yet; mobile treats that as pending availability and retries / falls back to `GET /api/shorts/mine`.
  - Diagnostics note: mobile short-detail retries now retain `requestId` when present and enrich diagnostics with `shortId` plus retry/fallback stage context.

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
| `POST /api/checkout/start` | `LEGACY_WEB` | Web pricing page only (`web/public/js/pricing.js`) | Touch only for direct billing risk to mobile launch. |
| `POST /api/checkout/portal` | `LEGACY_WEB` | Web pricing/account state only (`web/public/js/pricing.js`) | Touch only for direct billing risk to mobile launch. |
| `POST /stripe/webhook` | `LEGACY_WEB` | External Stripe caller; no mobile API caller (`src/app.js:111-116`) | Keep correct, but do not broaden launch scope around it. |
| `POST /api/story/update-script` | `REMOVE_LATER` | No current mobile caller; no current `web/public` caller found in repo search | Retire after freeze. |
| `POST /api/story/timeline` | `REMOVE_LATER` | No current mobile caller; no current `web/public` caller found in repo search | Retire after freeze. |
| `POST /api/story/captions` | `REMOVE_LATER` | No current mobile caller; no current `web/public` caller found in repo search | Retire after freeze. |
| `POST /api/story/render` | `REMOVE_LATER` | No current mobile caller; no current `web/public` caller found in repo search | Default-disable now; remove later. |
| `POST /api/user/setup` | `REMOVE_LATER` | No current mobile caller; no current `web/public` caller found in repo search | Retire after freeze. |
| `GET /api/user/me` | `REMOVE_LATER` | No current mobile caller; no current `web/public` caller found in repo search | Retire after freeze unless mobile adopts it explicitly. |
| `GET /api/whoami` | `REMOVE_LATER` | No current mobile caller; no current `web/public` caller found in repo search | Retire after freeze. |
| `GET /api/limits/usage` | `REMOVE_LATER` | No current mobile caller; no current `web/public` caller found in repo search | Retire after freeze. |

Removed in Phase 5 (not mounted):
- `GET /api/credits`
- `POST /api/checkout/session`
- `POST /api/checkout/subscription`
