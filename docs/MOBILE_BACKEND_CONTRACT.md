# MOBILE_BACKEND_CONTRACT

Cross-repo verification date: 2026-03-20.

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

- Billing migration Phase 1 adds canonical backend `GET /api/usage` and additive session `billingEstimate`.
- Billing migration Phase 2 moves backend render reservation/settlement to canonical usage seconds and adds additive finalize `data.billing`.
- Billing migration Phase 3 moves active mobile callers to `GET /api/usage`, updates mobile billing copy/gating to render-time semantics, and removes `/api/credits` from active caller usage.
- Current backend `billingEstimate.estimatedSec` is reservation-safe, not raw. The active source order is `speech_duration -> shot_durations -> caption_timeline`, where `speech_duration` is the backend-owned composite text heuristic and `caption_timeline` is retained only as an emergency fallback. Representative manual verification is still required before the estimate-proof gate is considered complete.
- Phases 1 through 5 of the billing migration are now landed in code, but the overall integration is still not production-ready until the Phase 2 estimate-proof gate is manually closed and live Stripe/manual end-to-end verification is completed.

## Response Rules

- Standard backend success envelope: `{ success: true, data, requestId }` (`src/http/respond.js:14-17`).
- Standard backend failure envelope: `{ success: false, error, detail, requestId, fields? }` (`src/http/respond.js:28-34`).
- Mobile normalization layer now preserves `requestId` while converting success envelopes to `{ ok: true, data, requestId }` and failure envelopes to `{ ok: false, status, code, message, requestId }` (`client/api/client.ts:94-160`, `client/api/client.ts:223-289`).
- Finalize is the current launch exception: the backend returns top-level `shortId`, and accepted/conflict responses also return top-level `finalize = { state, attemptId, pollSessionId }`; the mobile client explicitly extracts both from the raw response (`src/services/story-finalize.attempts.js:105-122`, `src/services/story-finalize.attempts.js:517-587`, `client/api/client.ts:898-937`).
- Cross-Repo Phase 3 observability is now live on the named hot paths only: backend request context is seeded immediately after request ID assignment, backend hot-path boundary events flow through one structured stdout logger with built-in redaction, and mobile keeps a bounded in-memory diagnostics buffer for normalized failures with additive context from auth bootstrap, finalize/recovery, and short-detail retry surfaces.
- Phase 3 caveat: deeper finalize/render internals inside the active finalize path still contain legacy `console.*` logging and were not fully migrated in this phase.

## Current Open Contract Notes

- `STATUS`: Active mobile editor/search routes now map known domain failures to stable 4xx/404 responses instead of collapsing them into generic 500s.
- `STATUS`: Cross-Repo Phase 3 request-scoped observability is landed for auth bootstrap, provider-backed story generation/search, finalize/idempotent replay/recovery, and short-detail recovery.
- `STATUS`: Phase 5 expensive-route admission control and deterministic busy/timeout mapping are now landed on the active generation/planning/search/finalize paths.

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
  - Mobile caller(s): `client/contexts/AuthContext.tsx:159-180`, `client/screens/SettingsScreen.tsx:43-59`, `client/screens/story-editor/useStoryEditorFinalize.ts:135-145`
  - Backend handler(s): `src/routes/usage.routes.js`, `src/controllers/usage.controller.js`, `src/services/usage.service.js`
  - Backend returns: `{ success: true, data: { plan, membership, usage }, requestId }`.
  - Mobile reads: `data.usage.availableSec` for render-time balance, plus the rest of the usage snapshot for canonical billing state.
  - Contract note: this is now the active mobile billing surface.

### Story Creation And Session Truth

- `POST /api/story/start`
  - Mobile caller(s): mobile `client/screens/HomeScreen.tsx:89-123`
  - Backend handler(s): `src/routes/story.routes.js:188-220`, `src/services/story.service.js:486-511`
  - Mobile sends: `{ input, inputType, styleKey? }`. Home omits `styleKey` unless the user explicitly selects `default`, `hype`, or `cozy`.
  - Backend returns: full session in `data`.
  - Mobile reads: `data.id` only.

- `POST /api/story/generate`
  - Mobile caller(s): mobile `client/screens/HomeScreen.tsx:120-138`
  - Backend handler(s): `src/routes/story.routes.js:233-268`, `src/services/story.service.js:524-552`, `src/services/story.llm.service.js:223-323`
  - Mobile sends: `{ sessionId }` only. `styleKey` is stored at start-time and is not part of the generate request.
  - Backend returns: full session in `data`.
  - Mobile reads: success/failure only.
  - Guardrails:
    - `enforceScriptDailyCap(300)` remains the explicit daily quota gate.
    - transient LLM busy/timeout paths now return retryable `503 SERVER_BUSY` with `Retry-After: 15`.

- `GET /api/story/:sessionId`
  - Mobile caller(s): `client/screens/ScriptScreen.tsx:64-84`, `client/screens/story-editor/useStoryEditorSession.ts:36-78`, `client/screens/story-editor/useStoryEditorFinalize.ts:182-225`
  - Backend handler(s): `src/routes/story.routes.js:1147-1178`, `src/services/story.service.js:355-357`
  - Recovery-state writer(s): `src/services/story.service.js:2325-2417`
  - Mobile sends: no body.
  - Backend returns: full session in `data`.
  - Mobile reads: `story.sentences` with helper fallbacks, `shots`, `overlayCaption.placement`, additive `billingEstimate.estimatedSec`, `shot.selectedClip.thumbUrl`, `shot.searchQuery`, and `renderRecovery` during finalize recovery polling and same-session restart-safe finalize resume.
  - Recovery role: this route remains the canonical finalize recovery contract. Additive `renderRecovery` fields expose `{ state, attemptId, startedAt, updatedAt, shortId, finishedAt, failedAt, code, message }`, and mobile trusts them only when `renderRecovery.attemptId` matches the active finalize attempt.
  - Stable failure now: `404 SESSION_NOT_FOUND`.
  - Diagnostics note: failed recovery polls now keep `requestId` in normalized mobile failures and enrich diagnostics with `sessionId` plus the active finalize `attemptId`.

- `POST /api/story/plan`
  - Mobile caller(s): `client/screens/ScriptScreen.tsx:126-159`
  - Backend handler(s): `src/routes/story.routes.js:577-605`, `src/services/story.service.js:583-597`, `src/services/story.llm.service.js:670-727`
  - Mobile sends: `{ sessionId }`.
  - Backend returns: full session in `data`.
  - Mobile reads: success/failure only.
  - Guardrails:
    - `enforceScriptDailyCap(300)` remains the explicit daily quota gate.
    - transient LLM busy/timeout paths now return retryable `503 SERVER_BUSY` with `Retry-After: 15`.

- `POST /api/story/search`
  - Mobile caller(s): `client/screens/ScriptScreen.tsx:141-159`
  - Backend handler(s): `src/routes/story.routes.js:607-639`, `src/services/story.service.js:682-903`
  - Mobile sends: `{ sessionId }`.
  - Backend returns: full session in `data`.
  - Mobile reads: success/failure only.
  - Success rule: preserve success whenever at least one consulted provider returns usable clips.
  - Stable failures now:
    - `404 SESSION_NOT_FOUND`
    - `400 PLAN_REQUIRED`
    - retryable `503 SERVER_BUSY` with `Retry-After: 15` only when no usable results exist and all consulted providers failed for transient reasons
  - Guardrails: route-local admission gate plus provider timeout/cooldown handling now sit behind the current session-based search flow.

### Story Editing And Caption Preview

- `POST /api/story/update-beat-text`
  - Mobile caller(s): `client/screens/ScriptScreen.tsx:174-236`, `client/screens/story-editor/useStoryEditorSession.ts:131-176`
  - Backend handler(s): `src/routes/story.routes.js:833-856`, `src/services/story.service.js:1126-1160`
  - Mobile sends: `{ sessionId, sentenceIndex, text }`.
  - Backend returns: partial `{ sentences, shots }` in `data`, not a full session.
  - Mobile reads:
    - `ScriptScreen`: treats the response as success/failure only, keeps the edited sentence visible locally, then refetches session SSOT.
    - Story editor session hook: treats the response as success/failure only, updates local beat text state, then refetches session SSOT.
  - Stable failures now:
    - `404 SESSION_NOT_FOUND`
    - `400 STORY_REQUIRED`
    - `400 INVALID_SENTENCE_INDEX`
  - Guardrail: service now checks `SESSION_NOT_FOUND` / `STORY_REQUIRED` before dereferencing `session.story`.

- `POST /api/story/delete-beat`
  - Mobile caller(s): `client/screens/ScriptScreen.tsx:222-235`, `client/screens/story-editor/useStoryEditorSession.ts:190-231`
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
  - Backend handler(s): `src/routes/story.routes.js:721-775`, `src/services/story.service.js:682-903`
  - Mobile sends: `{ sessionId, sentenceIndex, query, page }`.
  - Backend returns: `{ shot, page, hasMore }` in `data`.
  - Mobile reads: `shot.candidates`, `page`, `hasMore`, and candidate `id`, `thumbUrl`, `provider`, `duration`.
  - Success rule: preserve success whenever at least one consulted provider returns usable clips.
  - Stable failures now:
    - `404 SESSION_NOT_FOUND`
    - `400 SHOTS_REQUIRED`
    - `404 SHOT_NOT_FOUND` (detail may include `sentenceIndex` context)
    - `400 NO_SEARCH_QUERY_AVAILABLE`
    - retryable `503 SERVER_BUSY` with `Retry-After: 15` only when no usable results exist and all consulted providers failed for transient reasons

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
  - Mobile caller(s): `client/hooks/useCaptionPreview.ts:45-259`, `client/screens/story-editor/useStoryEditorCaptionPlacement.ts:58-66`
  - Backend handler(s): `src/routes/caption.preview.routes.js:109-313`
  - Mobile sends: `{ ssotVersion: 3, mode: "raster", measure: "server", text, placement, yPct, frameW, frameH }`; current mobile preview flow does not send `style`.
  - Backend returns: `data.meta` including `rasterUrl`, `rasterW`, `rasterH`, `yPx_png`, `frameW`, `frameH`, and other compiler metadata.
  - Mobile reads: `meta.rasterUrl`, `rasterW`, `rasterH`, `yPx_png`, and uses fallback centering when `xPx_png` is absent.
  - Guardrails: auth-required, `20/min`, `200kb` body cap.

- `POST /api/story/update-caption-style`
  - Mobile caller(s): `client/screens/story-editor/useStoryEditorCaptionPlacement.ts:115-155`
  - Backend handler(s): `src/routes/story.routes.js:287-354`
  - Mobile sends: `{ sessionId, overlayCaption: { placement, yPct } }`.
  - Backend returns: `{ overlayCaption }` in `data`.
  - Mobile reads: success/failure only.

### Render, Recovery, And Shorts

- Deep current-state and target-state finalize authority now lives in:
  - `docs/FINALIZE_CURRENT_STATE_AUDIT.md`
  - `docs/FINALIZE_FACTORY_CONVERSION_PLAN.md`
  - `docs/FINALIZE_JOB_MODEL_SPEC.md`
  - `docs/FINALIZE_OBSERVABILITY_SPEC.md`
  - `docs/FINALIZE_RUNTIME_TOPOLOGY_SPEC.md`

- `POST /api/story/finalize`
  - Mobile caller(s): `client/screens/story-editor/useStoryEditorFinalize.ts:344-562`, `client/api/client.ts:756-902`
  - Backend handler(s): `src/routes/story.routes.js`, `src/middleware/idempotency.firestore.js`, `src/services/story-finalize.attempts.js`, `src/services/story-finalize.runner.js`, `src/services/story.service.js`
  - Mobile sends now: `{ sessionId }` plus `X-Idempotency-Key`.
  - Backend requires now: `{ sessionId }` plus `X-Idempotency-Key`.
  - Firestore deploy prerequisite: the queued-attempt claim query in `src/services/story-finalize.attempts.js` depends on the composite index tracked in root `firestore.indexes.json` for `idempotency(flow ASC, state ASC, createdAt ASC)`. Root `firebase.json` now wires `firestore.rules` plus `firestore.indexes.json`, and the repo-managed deploy path is `firebase deploy --project <firebase-project-id> --only firestore`.
  - Backend returns now:
    - initial accepted response: `202` with full session in `data`, top-level `shortId: null`, and additive `finalize: { state: "pending", attemptId, pollSessionId }`
    - same-key active replay: `202` with the same pending finalize metadata
    - same-key terminal success replay: `200` with full session in `data`, additive `data.billing`, and top-level `shortId`
    - same-key terminal failure replay: stored terminal failure payload
    - same-session different-key conflict while another attempt is active: `409 FINALIZE_ALREADY_ACTIVE` with additive `finalize: { state: "pending", attemptId, pollSessionId }`
  - Mobile reads: `status`, `shortId`, additive `finalize.state`, `finalize.attemptId`, `finalize.pollSessionId`, additive `data.billing.billedSec` when available, and on failures `retryAfter`, `code/error`, `message/detail`.
  - Guardrails: Firestore-backed async finalize attempt SSOT, exact-once usage reservation/settlement/release helpers, session-scoped active-attempt lockout, backend lease/heartbeat reaping, and per-process `withRenderSlot()` execution inside the finalize runner.
  - Retryable busy behavior:
    - finalize no longer returns route-level `503` for render-slot saturation; accepted attempts queue instead
    - the legacy blocking `POST /api/story/render` route still owns direct render-slot `503 SERVER_BUSY` behavior
  - Current 402 semantics: backend uses time-based billing failures such as `INSUFFICIENT_RENDER_TIME`, and mobile now mirrors that render-time wording.
  - Recovery contract: backend persists additive `renderRecovery.pending` before returning `202`, then persists `renderRecovery.done` or `renderRecovery.failed` with the same attempt identity. On `202 pending`, `409 FINALIZE_ALREADY_ACTIVE`, `TIMEOUT`, `NETWORK_ERROR`, or legacy same-key in-progress replay, mobile keeps or adopts the active attempt key and polls `GET /api/story/:sessionId` until that same-attempt recovery state reaches a terminal result.
  - Contract caveat: recovery is now same-session and restart-safe through stored finalize attempt identity, but it does not widen into a global recovery inbox or background mobile job system.
  - Diagnostics note: finalize, idempotent replay, and recovery boundary events now correlate by `requestId` plus additive `sessionId` / `attemptId`, and mobile failure diagnostics enrich the same request/attempt context in memory.
  - Observability caveat: render-slot concurrency remains per-process even though finalize attempt claiming and stale-attempt cleanup are now Firestore-backed.

- `GET /api/shorts/mine`
  - Mobile caller(s): `client/screens/LibraryScreen.tsx:80-118`, `client/screens/short-detail/useShortDetailAvailability.ts:149-205`
  - Backend handler(s): `src/routes/shorts.routes.js:7-9`, `src/controllers/shorts.controller.js:5-90`
  - Mobile sends: `limit` and optional `cursor`.
  - Backend returns: `{ items, nextCursor, hasMore }` in `data`.
  - Mobile reads: list items and pagination fields.
  - Additive billing migration Phase 2 note: finalized short docs now persist backend-owned `billing` metadata in Firestore; current mobile callers ignore it.
  - Stability note: controller has an index-missing fallback path that disables pagination semantics when the composite index is absent.

- `GET /api/shorts/:jobId`
  - Mobile caller(s): `client/screens/short-detail/useShortDetailAvailability.ts:83-356`
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

| Route                                   | Classification     | Verified caller evidence                                                                                                                                                                                                  | Handling policy                                          |
| --------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `POST /api/users/ensure`                | `MOBILE_CORE_NOW`  | Mobile auth bootstrap (`client/contexts/AuthContext.tsx:63-76`)                                                                                                                                                           | Harden and document now.                                 |
| `GET /api/usage`                        | `MOBILE_CORE_NOW`  | Mobile auth bootstrap and billing refresh (`client/api/client.ts:519-527`, `client/contexts/AuthContext.tsx:142-178`)                                                                                                     | Harden and document now.                                 |
| `POST /api/story/start`                 | `MOBILE_CORE_NOW`  | Mobile home create flow (`client/screens/HomeScreen.tsx:79-107`)                                                                                                                                                          | Harden now.                                              |
| `POST /api/story/generate`              | `MOBILE_CORE_NOW`  | Mobile create flow (`client/screens/HomeScreen.tsx:109-127`)                                                                                                                                                              | Harden now.                                              |
| `GET /api/story/:sessionId`             | `MOBILE_CORE_NOW`  | Mobile script/editor and finalize-recovery truth (`client/screens/ScriptScreen.tsx:65-82`, `client/screens/story-editor/useStoryEditorSession.ts:36-78`, `client/screens/story-editor/useStoryEditorFinalize.ts:182-225`) | Harden now.                                              |
| `POST /api/story/plan`                  | `MOBILE_CORE_NOW`  | Mobile storyboard step (`client/screens/ScriptScreen.tsx:126-159`)                                                                                                                                                        | Harden now.                                              |
| `POST /api/story/search`                | `MOBILE_CORE_NOW`  | Mobile storyboard step (`client/screens/ScriptScreen.tsx:141-159`)                                                                                                                                                        | Harden now.                                              |
| `POST /api/story/update-beat-text`      | `MOBILE_CORE_NOW`  | Mobile script/editor beat editing (`client/screens/ScriptScreen.tsx:174-236`, `client/screens/story-editor/useStoryEditorSession.ts:131-176`)                                                                             | Harden now.                                              |
| `POST /api/story/delete-beat`           | `MOBILE_CORE_NOW`  | Mobile script/editor deletion (`client/screens/ScriptScreen.tsx:260-266`, `client/screens/story-editor/useStoryEditorSession.ts:190-231`)                                                                                 | Harden now.                                              |
| `POST /api/story/search-shot`           | `MOBILE_CORE_NOW`  | Mobile clip picker (`client/screens/ClipSearchModal.tsx:49-80`)                                                                                                                                                           | Harden now.                                              |
| `POST /api/story/update-shot`           | `MOBILE_CORE_NOW`  | Mobile clip replacement (`client/screens/ClipSearchModal.tsx:83-104`)                                                                                                                                                     | Harden now.                                              |
| `POST /api/caption/preview`             | `MOBILE_CORE_NOW`  | Mobile beat-card preview (`client/hooks/useCaptionPreview.ts:59-120`)                                                                                                                                                     | Harden now.                                              |
| `POST /api/story/update-caption-style`  | `MOBILE_CORE_NOW`  | Mobile caption placement persistence (`client/screens/story-editor/useStoryEditorCaptionPlacement.ts:115-155`)                                                                                                            | Harden now.                                              |
| `POST /api/story/finalize`              | `MOBILE_CORE_NOW`  | Mobile render action (`client/screens/story-editor/useStoryEditorFinalize.ts:344-562`)                                                                                                                                    | Harden now; highest-risk contract surface.               |
| `GET /api/shorts/mine`                  | `MOBILE_CORE_NOW`  | Mobile library list and detail fallback (`client/screens/LibraryScreen.tsx:80-118`, `client/screens/short-detail/useShortDetailAvailability.ts:149-205`)                                                                  | Harden now.                                              |
| `GET /api/shorts/:jobId`                | `MOBILE_CORE_NOW`  | Mobile post-render detail path (`client/screens/short-detail/useShortDetailAvailability.ts:83-356`)                                                                                                                       | Harden now; compatibility bridge is active.              |
| `POST /api/story/insert-beat`           | `MOBILE_CORE_SOON` | No current mobile caller                                                                                                                                                                                                  | Do not harden until mobile adopts it.                    |
| `POST /api/assets/options`              | `LEGACY_WEB`       | Web creative editor only (`web/public/js/pages/creative/creative.article.mjs:3483`)                                                                                                                                       | Ignore unless shared security risk crosses into mobile.  |
| `POST /api/story/manual`                | `LEGACY_WEB`       | Web manual flow only (`web/public/js/pages/creative/creative.article.mjs:1487`)                                                                                                                                           | Ignore for mobile launch.                                |
| `POST /api/story/create-manual-session` | `LEGACY_WEB`       | Web manual-first render only (`web/public/js/pages/creative/creative.article.mjs:3930`)                                                                                                                                   | Ignore for mobile launch.                                |
| `POST /api/story/update-video-cuts`     | `LEGACY_WEB`       | Web editor only (`web/public/js/pages/creative/creative.article.mjs:1922`, `web/public/js/pages/creative/creative.article.mjs:1950`)                                                                                      | Ignore for mobile launch.                                |
| `POST /api/story/update-caption-meta`   | `LEGACY_WEB`       | Web caption preview persistence only (`web/public/js/caption-preview.js:108`)                                                                                                                                             | Ignore unless it breaks shared render stability.         |
| `POST /api/checkout/start`              | `LEGACY_WEB`       | Web pricing page only (`web/public/js/pricing.js`)                                                                                                                                                                        | Touch only for direct billing risk to mobile launch.     |
| `POST /api/checkout/portal`             | `LEGACY_WEB`       | Web pricing/account state only (`web/public/js/pricing.js`)                                                                                                                                                               | Touch only for direct billing risk to mobile launch.     |
| `POST /stripe/webhook`                  | `LEGACY_WEB`       | External Stripe caller; no mobile API caller (`src/app.js:111-116`)                                                                                                                                                       | Keep correct, but do not broaden launch scope around it. |
| `POST /api/story/update-script`         | `REMOVE_LATER`     | No current mobile caller; no current `web/public` caller found in repo search                                                                                                                                             | Retire after freeze.                                     |
| `POST /api/story/timeline`              | `REMOVE_LATER`     | No current mobile caller; no current `web/public` caller found in repo search                                                                                                                                             | Retire after freeze.                                     |
| `POST /api/story/captions`              | `REMOVE_LATER`     | No current mobile caller; no current `web/public` caller found in repo search                                                                                                                                             | Retire after freeze.                                     |
| `POST /api/story/render`                | `REMOVE_LATER`     | No current mobile caller; no current `web/public` caller found in repo search                                                                                                                                             | Default-disable now; remove later.                       |
| `POST /api/user/setup`                  | `REMOVE_LATER`     | No current mobile caller; no current `web/public` caller found in repo search                                                                                                                                             | Retire after freeze.                                     |
| `GET /api/user/me`                      | `REMOVE_LATER`     | No current mobile caller; no current `web/public` caller found in repo search                                                                                                                                             | Retire after freeze unless mobile adopts it explicitly.  |
| `GET /api/whoami`                       | `REMOVE_LATER`     | No current mobile caller; no current `web/public` caller found in repo search                                                                                                                                             | Retire after freeze.                                     |
| `GET /api/limits/usage`                 | `REMOVE_LATER`     | No current mobile caller; no current `web/public` caller found in repo search                                                                                                                                             | Retire after freeze.                                     |

Removed in Phase 5 (not mounted):

- `GET /api/credits`
- `POST /api/checkout/session`
- `POST /api/checkout/subscription`
