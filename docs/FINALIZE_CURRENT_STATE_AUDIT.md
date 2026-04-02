# FINALIZE_CURRENT_STATE_AUDIT

- Status: CANONICAL
- Owner repo: backend
- Source of truth for: current finalize/render behavior, active caller ownership, current storage/runtime topology, and frozen external finalize contracts for the factory conversion
- Canonical counterpart/source: `docs/FINALIZE_FACTORY_CONVERSION_PLAN.md`, `docs/FINALIZE_JOB_MODEL_SPEC.md`, `docs/FINALIZE_OBSERVABILITY_SPEC.md`, `docs/FINALIZE_RUNTIME_TOPOLOGY_SPEC.md`
- Last verified against: backend repo plus current mobile repo on 2026-04-01

## Purpose

This document freezes how finalize works after Phase 5 landed and alongside the additive Phase 6 proof artifacts.

Every statement below is current-state repo truth unless explicitly marked otherwise.

## Source Order

1. Backend runtime code
2. Current mobile caller code
3. Current active web creative caller code
4. Backend canonical docs
5. Mobile caller-truth docs

If docs and code disagree, code wins for this audit.

## In-Scope Active Callers

### Mobile finalize caller

- Screen ownership: `client/screens/StoryEditorScreen.tsx:112-133`
- Hook ownership: `client/screens/story-editor/useStoryEditorFinalize.ts:76-552`
- Transport ownership: `client/api/client.ts:804-953`
- Recovery storage: `client/lib/storyFinalizeAttemptStorage.ts:12-60`
- Recovery read helpers: `client/screens/story-editor/model.ts:19-80`
- Readback after success: `client/screens/ShortDetailScreen.tsx:90-119`, `client/screens/short-detail/useShortDetailAvailability.ts:130-269`

### Active web creative finalize caller

- Caller-backed ownership note: `docs/ACTIVE_SURFACES.md:83-85`
- UI entrypoint: `web/public/creative.html:34-47`
- Transport owner: `web/public/api.mjs:127-220`
- Finalize caller and recovery poller: `web/public/js/pages/creative/creative.article.mjs:3694-4065`

## Proven Current Lifecycle

### 1. API boot and route ownership

- API startup no longer boots finalize execution. `src/app.js` now composes HTTP middleware and routes only: `src/app.js:1-292`.
- The story finalize worker now has explicit runtime ownership outside API startup:
  - worker runtime module: `src/workers/story-finalize.worker.js:1-49`
  - worker process entrypoint: `story-finalize.worker.js:1-14`
  - worker npm script: `package.json:25-40`
- The story router is mounted at `/api/story`, and all story routes require auth through router-level `requireAuth`: `src/app.js:244-246`, `src/routes/story.routes.js:45-46`.

### 2. Finalize admission request

- `POST /api/story/finalize` runs `idempotencyFinalize({ getSession })` before the route handler, so idempotency and reservation happen before the route emits JSON: `src/routes/story.routes.js:993-994`.
- The middleware requires `X-Idempotency-Key`, rejects unauthenticated calls, validates `sessionId` before any Firestore reservation, and seeds request context with `sessionId` and `attemptId`: `src/middleware/idempotency.firestore.js:44-113`.

### 3. Durable admission and billing reservation

- `prepareFinalizeAttempt()` is the current durable admission path. It:
  - replays same-key prior state from Firestore `idempotency`: `src/services/story-finalize.attempts.js:305-319`
  - loads the session and requires `billingEstimate.estimatedSec`: `src/services/story-finalize.attempts.js:321-339`
  - rejects same-session different-key conflicts via `storyFinalizeSessions`: `src/services/story-finalize.attempts.js:356-374`
  - applies the shared overload gate only for genuinely new admissions after replay/conflict checks and before reserve/enqueue: `src/services/story-finalize.attempts.js:779-840`
  - checks available render time from canonical usage state: `src/services/story-finalize.attempts.js:376-393`
  - reuses the existing `idempotency/<uid:attemptId>` doc keyspace as the canonical `FinalizeJob` record, creates embedded `executionAttempts[0]` plus `currentExecution`, preserves the required top-level compatibility fields, creates a session lock doc, and increments `users.usage.cycleReservedSec`

### 4. Current finalize response behavior

- Accepted work returns `202` with the session in `data`, top-level `shortId: null`, and top-level `finalize: { state: "pending", attemptId, pollSessionId }`: `src/services/story-finalize.attempts.js:535-541`, `src/services/story-finalize.attempts.js:1121-1129`.
- Same-key active replay returns the same `202 pending` shape: `src/services/story-finalize.attempts.js:535-541`, `src/services/story-finalize.attempts.js:1131-1155`.
- Same-session different-key conflict returns `409 FINALIZE_ALREADY_ACTIVE` with top-level `finalize`: `src/services/story-finalize.attempts.js:543-552`, `src/services/story-finalize.attempts.js:1157-1164`.
- Same-key terminal success replay returns `200` with session `data`, top-level `shortId`, and additive `data.billing`: `src/services/story-finalize.attempts.js:528-533`, `src/services/story-finalize.attempts.js:1184-1191`.
- Same-key terminal failure replay returns the stored terminal failure payload: `src/services/story-finalize.attempts.js:554-564`, `src/services/story-finalize.attempts.js:1193-1197`.
- Genuinely new admissions may now return `503 SERVER_BUSY` with `Retry-After` when the shared backlog gate is over cap; those rejections do not reserve usage, do not create finalize job docs, and do not create session lock docs: `src/services/story-finalize.attempts.js:779-840`, `src/services/story-finalize.attempts.js:1199-1210`, `src/routes/story.routes.js:1150-1190`.

### 5. Session recovery state

- On a newly enqueued finalize attempt, the middleware persists `renderRecovery.pending` before replying `202`: `src/middleware/idempotency.firestore.js:69-93`.
- `renderRecovery` is still stored inside the broader session `story.json` blob through `saveJSON/loadJSON`, but after Phase 5 it is compatibility storage only rather than the primary status source: `src/services/story.service.js:414-417`, `src/services/story.service.js:422-433`, `src/services/story.service.js:436-462`, `src/services/finalize-status.service.js`.
- The canonical caller-facing recovery projection is now `attempt.projection.renderRecovery` on the finalize job doc in `idempotency`: `src/services/story-finalize.attempts.js`, `src/services/finalize-status.service.js`.
- The caller-visible `renderRecovery` shape remains `{ state, attemptId, startedAt, updatedAt, shortId, finishedAt, failedAt, code, message }`: `src/services/story.service.js:349-409`, `src/services/finalize-status.service.js`.
- `GET /api/story/:sessionId` remains the canonical recovery poll surface, but it now overlays canonical attempt truth via `src/services/finalize-status.service.js` and emits `story.recovery.poll` from canonical attempt/projection data rather than raw session state: `src/routes/story.routes.js`, `src/services/finalize-status.service.js`.
- The frozen Phase 5 resolution order is now:
  1. active `storyFinalizeSessions` helper lock -> active attempt
  2. attempt referenced by `session.renderRecovery.attemptId`
  3. latest finalize attempt for the same `uid + sessionId + flow`
  4. short/readback reconciliation using settled `shortId`

### 6. Background execution

- The route handler itself does not execute the render pipeline. It returns the prepared reply and no longer nudges finalize execution directly; worker discovery is independent of the route: `src/routes/story.routes.js:993-1222`.
- The runner is a process-global singleton stored on `globalThis`: `src/services/story-finalize.runner.js:28-29`, `src/services/story-finalize.runner.js:359-365`.
- The dedicated worker runtime starts that runner explicitly with `keepProcessAlive: true`: `src/workers/story-finalize.worker.js:10-48`, `src/services/story-finalize.runner.js:35-59`, `src/services/story-finalize.runner.js:359-365`.
- The runner polls for queued attempts, claims them, heartbeats leases, runs `finalizeStory()`, settles success, requeues `SERVER_BUSY`, and marks terminal failure otherwise: `src/services/story-finalize.runner.js:30-89`, `src/services/story-finalize.runner.js:90-226`, `src/services/story-finalize.runner.js:252-304`.

### 7. Current durable queue substrate

- The durable queue substrate today is Firestore:
  - canonical finalize jobs still live in collection `idempotency`, reusing the existing durable doc id/keyspace
  - embedded execution lineage now lives on that same durable job doc through `executionAttempts[]` plus `currentExecution`
  - same-session active locks still live in `storyFinalizeSessions`, but only as helper/lock records
  - queue claim still uses the existing `idempotency` query and then reads canonical `jobState` plus embedded execution lineage from the claimed durable doc
  - the required composite indexes are source-controlled for both queue claim ordering and the Phase 5 latest-attempt fallback query: `firestore.indexes.json`, `firebase.json:1-5`

### 8. Current finalize pipeline internals

- `finalizeStory()` is not render-only. It can still backfill missing story generation, shot planning, clip search, and caption timings before rendering: `src/services/story.service.js:2522-2586`.
- Finalize segment renders flow through `renderVideoQuoteOverlay()`. Active backend colorspace policy is now explicit there: raster/PNG mode never injects the colorspace filter, non-raster `auto` only applies `colorspace=all=bt709:fast=1` for explicit `bt709` inputs, the helper retries once without that filter only for the known colorspace failure family, and the shared render-job `colorMetaCache` now carries job-local incompatibility memory so later segments in the same job skip the colorspace-first attempt after one classified retry success; unrelated FFmpeg failures do not take that fallback: `src/services/story.service.js:2037-2054`, `src/services/story.service.js:2327-2344`, `src/utils/ffmpeg.video.js:172-390`, `src/utils/ffmpeg.video.js:2309-2362`, `src/utils/ffmpeg.video.js:2535-2562`.
- Successful render uploads the final video and thumbnail, writes `shorts/<jobId>`, persists `session.finalVideo.jobId`, sets `session.status = rendered`, and then persists `renderRecovery.done`; Phase 5 read paths now reconcile that compatibility session data back against canonical attempt `result.shortId` and `projection.renderRecovery.shortId`: `src/services/story.service.js:2373-2455`, `src/services/story.service.js:2588-2603`, `src/services/finalize-status.service.js`.
- Failure persists `renderRecovery.failed` and rethrows: `src/services/story.service.js:2604-2625`.

### 9. Billing reserve / settle / release truth

- Reservation happens once during admission by incrementing `usage.cycleReservedSec`: `src/services/story-finalize.attempts.js:431-444`.
- Success settlement:
  - requires the attempt still be active: `src/services/story-finalize.attempts.js:676-695`
  - requires `billedSec <= estimatedSec`: `src/services/story-finalize.attempts.js:697-713`
  - increments `usage.cycleUsedSec`, decrements `usage.cycleReservedSec`, records `billingSettlement`, deletes the session lock, and writes additive `shorts/<shortId>.billing`: `src/services/story-finalize.attempts.js:715-815`
- Terminal failure releases the reserved seconds exactly once and deletes the session lock: `src/services/story-finalize.attempts.js:600-674`.

### 10. Current stale-work and retry behavior

- Busy render-slot failures preserve one stable external `attemptId`, append a new embedded execution attempt, close the prior execution attempt as `failed_retryable`, and schedule the canonical job back to `retry_scheduled` with compatibility `state = queued`.
- Queued attempts that expire are marked `expired`, have reservations released, and persist `renderRecovery.failed` with `FINALIZE_ATTEMPT_EXPIRED`: `src/services/story-finalize.attempts.js:956-989`.
- Running attempts with expired leases mark the active embedded execution attempt `abandoned`, mark the canonical job terminally failed with the existing caller-visible `FINALIZE_WORKER_LOST` semantics, release reservations, and persist `renderRecovery.failed`.

## Phase 3 Compatibility Mirror Fields

Phase 3 keeps these top-level fields readable and writable on the canonical durable job doc for rollback safety and current route/test compatibility:

- `flow`
- `uid`
- `attemptId`
- `sessionId`
- `state`
- `status`
- `isActive`
- `shortId`
- `requestId`
- `usageReservation`
- `billingSettlement`
- `failure`
- `createdAt`
- `updatedAt`
- `enqueuedAt`
- `startedAt`
- `finishedAt`
- `expiresAt`
- `availableAfter`
- `leaseHeartbeatAt`
- `leaseExpiresAt`
- `runnerId`

## Current Caller Behavior

### Mobile caller truth

- Mobile generates a UUID-shaped idempotency key per finalize attempt: `client/screens/story-editor/useStoryEditorFinalize.ts:58-74`.
- Mobile sends `POST /api/story/finalize` with that key in `X-Idempotency-Key`: `client/api/client.ts:804-823`.
- Mobile treats `202 pending`, `409 FINALIZE_ALREADY_ACTIVE`, timeout, network loss, `IDEMPOTENT_IN_PROGRESS`, and `status === 0` as recovery-entry conditions and polls `GET /api/story/:sessionId`: `client/screens/story-editor/useStoryEditorFinalize.ts:390-425`, `client/screens/story-editor/useStoryEditorFinalize.ts:453-462`.
- Mobile only trusts `renderRecovery` when `renderRecovery.attemptId` matches the active attempt key: `client/screens/story-editor/model.ts:63-72`, `client/screens/story-editor/useStoryEditorFinalize.ts:204-225`.
- On success, mobile refreshes `/api/usage` and navigates to Short Detail using `shortId`: `client/screens/story-editor/useStoryEditorFinalize.ts:135-162`, `client/contexts/AuthContext.tsx:211-241`.

### Active web creative caller truth

- The web creative caller uses `apiFetch('/story/finalize', { headers: { 'X-Idempotency-Key': sessionId } })`, so its idempotency key is the current story session id rather than a generated UUID: `web/public/js/pages/creative/creative.article.mjs:3998-4013`.
- The web creative caller does not consume top-level `finalize.*`. It treats a successful finalize response as complete only when `data.finalVideo.url` is present; otherwise it polls `GET /api/story/:sessionId`: `web/public/js/pages/creative/creative.article.mjs:4051-4060`, `web/public/js/pages/creative/creative.article.mjs:3863-3910`.
- The web creative caller currently treats only `HTTP_502`, `HTTP_504`, and legacy `IDEMPOTENT_IN_PROGRESS` as recoverable finalize errors before switching to polling: `web/public/js/pages/creative/creative.article.mjs:3707-3710`, `web/public/js/pages/creative/creative.article.mjs:3788-3821`, `web/public/js/pages/creative/creative.article.mjs:4036-4043`.
- On completion, the web creative caller redirects to `/my-shorts.html?id=<jobId>` using `session.finalVideo.jobId` if present, then falls back to parsing it from the final video URL: `web/public/js/pages/creative/creative.article.mjs:3847-3860`.

## Current State / Storage Truth Map

| Concern | Current canonical owner | Current evidence |
| --- | --- | --- |
| Durable admission state | Firestore `idempotency` canonical finalize job doc on the existing durable keyspace | `src/services/story-finalize.attempts.js` |
| Execution lineage | Embedded `executionAttempts[]` plus `currentExecution` on that same `idempotency` job doc | `src/services/story-finalize.attempts.js` |
| Same-session active lock | Firestore `storyFinalizeSessions` helper/lock doc | `src/services/story-finalize.attempts.js` |
| Usage reserve/release/settle ledger | Firestore `users/<uid>.usage` | `src/services/usage.service.js:65-134`, `src/services/story-finalize.attempts.js:431-444`, `src/services/story-finalize.attempts.js:748-762` |
| Client recovery projection | Finalize job `projection.renderRecovery`; session `story.json.renderRecovery` remains compatibility-only storage | `src/services/story-finalize.attempts.js`, `src/services/finalize-status.service.js`, `src/services/story.service.js:349-462` |
| Completed short read model | Firestore `shorts/<jobId>` plus storage objects | `src/services/story.service.js:2415-2455`, `src/controllers/shorts.controller.js:122-227` |
| Client-facing current render status | `GET /api/story/:sessionId` response projected by `src/services/finalize-status.service.js` | `src/routes/story.routes.js`, `src/services/finalize-status.service.js`, `client/screens/story-editor/useStoryEditorFinalize.ts:177-249`, `web/public/js/pages/creative/creative.article.mjs:3863-3910` |

## Current Runtime Topology

- There is one HTTP API process today. `server.js` starts Express and keeps a 15-minute server timeout for remaining blocking render routes: `server.js:27-43`.
- Finalize execution is now its own runtime role. The API process does not boot the finalize runner singleton: `src/app.js:1-292`.
- The current dedicated finalize worker runtime is booted separately through:
  - `story-finalize.worker.js:1-14`
  - `src/workers/story-finalize.worker.js:1-49`
  - `package.json:25-40`
- The runner still has a local per-process inflight guard, but it no longer uses `RENDER_SLOT_LIMIT` as the primary render-capacity truth: `src/services/story-finalize.runner.js:26-33`, `src/services/story-finalize.runner.js:252-304`.
- Shared render capacity is now Firestore-backed and lease-owned by `executionAttemptId`, with stale leases reaped by the worker loop: `src/services/finalize-control.service.js`, `src/services/story.service.js:2613-2624`, `src/services/story-finalize.runner.js:61-89`.
- The local `RENDER_SLOT_LIMIT` semaphore remains as a secondary in-process safety guard only: `src/utils/render.semaphore.js:1-23`, `src/services/story.service.js:2613-2624`.
- Current OpenAI admission, story-search admission/cooldown, and TTS throttle/cooldown are now shared for finalize-context work through the Firestore-backed control layer while retaining their existing local guards as secondary process safety: `src/services/finalize-control.service.js`, `src/services/story.llm.service.js:152-184`, `src/services/story.service.js:98-212`, `src/services/tts.service.js:166-345`, `src/services/tts.service.js:489-657`.

## Current Pressure Map Freeze

- Render capacity primary truth is now the shared Firestore lease layer owned by `executionAttemptId`; the local semaphore is secondary only: `src/services/finalize-control.service.js`, `src/services/story.service.js:2613-2624`, `src/utils/render.semaphore.js:1-23`.
- Worker inflight/saturation remains local-process observability and local claim pacing; it is no longer the system-wide render ceiling: `src/services/story-finalize.runner.js:26-33`, `src/services/story-finalize.runner.js:252-304`, `src/observability/finalize-observability.js:614-621`.
- OpenAI admission for finalize-triggered story generation/planning now consults shared Firestore provider pressure first, then local process safety: `src/services/finalize-control.service.js`, `src/services/story.llm.service.js:152-184`.
- Story-search admission/cooldown for finalize-triggered clip search now consult shared Firestore provider pressure first, then local process safety: `src/services/finalize-control.service.js`, `src/services/story.service.js:98-212`.
- TTS throttle/cooldown for finalize-triggered rendering now consult shared Firestore provider pressure first, then local process safety: `src/services/finalize-control.service.js`, `src/services/tts.service.js:166-345`, `src/services/tts.service.js:489-657`.
- Shared overload truth is defined as `queued + running + retry_scheduled` across canonical finalize job docs and is evaluated only for genuinely new finalize admissions after replay/conflict checks: `src/services/finalize-control.service.js`, `src/services/story-finalize.attempts.js:779-840`.
- Finalize is still a wide pipeline rather than a narrow render-only worker task because it can backfill story, plan, search, and captions before rendering: `src/services/story.service.js:2577-2617`.

## Current Observability That Already Exists

- Request IDs are assigned early and echoed in `X-Request-Id`: `src/middleware/reqId.js:4-8`, `src/app.js:46-49`.
- Backend request context carries `requestId`, `uid`, `sessionId`, `attemptId`, and `shortId`: `src/observability/request-context.js:48-67`.
- Backend logger emits structured JSON with those fields: `src/observability/logger.js:18-39`.
- `/diag/finalize-control-room` now distinguishes shared-system pressure truth from local-process observability. Shared backlog/render/provider state comes from the Firestore-backed control service, while the existing in-process metrics snapshot remains visible under an explicit local label: `src/routes/diag.routes.js:66-81`, `src/services/finalize-control.service.js`, `src/observability/finalize-observability.js:614-621`.
- There is an operator runbook for finalize/replay/recovery and readback incidents: `docs/INCIDENT_TRACE_RUNBOOK.md:5-16`, `docs/INCIDENT_TRACE_RUNBOOK.md:29-128`.
- Mobile keeps a bounded in-memory diagnostics buffer for API/client failures and enriches finalize/recovery/readback failures with context: `client/lib/diagnostics.ts:36-66`, `client/lib/diagnostics.ts:81-143`.
- Phase 6 proof artifacts are now checked in under `docs/artifacts/finalize-phase6/`, with the schema frozen in `docs/artifacts/finalize-phase6/ARTIFACT_SCHEMA.md` and thresholds summarized in `docs/FINALIZE_THRESHOLD_REPORT.md`.

## Frozen External Contracts

These behaviors are frozen for the factory conversion unless later code evidence proves a change is required.

### POST /api/story/finalize

- The route must remain authenticated and idempotent on `X-Idempotency-Key`: `src/routes/story.routes.js:45-46`, `src/middleware/idempotency.firestore.js:44-68`.
- Accepted work must continue to return quickly rather than block on full render completion: `src/routes/story.routes.js:993-1017`, `src/services/story-finalize.attempts.js:1121-1129`.
- Same-key replay and same-session different-key conflict semantics must remain stable: `src/services/story-finalize.attempts.js:1131-1164`.
- Admission precedence is now frozen to: same-key replay, same-session active conflict, shared overload gate, then billing reserve plus enqueue: `src/services/story-finalize.attempts.js:779-840`.
- Shared overload uses backlog definition `queued + running + retry_scheduled` and returns `503 SERVER_BUSY` plus `Retry-After` only for genuinely new admissions: `src/services/finalize-control.service.js`, `src/services/story-finalize.attempts.js:779-840`, `src/services/story-finalize.attempts.js:1199-1210`.
- Success replay must continue to expose top-level `shortId` and additive `data.billing`: `src/services/story-finalize.attempts.js:1184-1190`.

### GET /api/story/:sessionId recovery expectations

- This remains the canonical caller-facing recovery read path for both mobile and the active web creative caller: `src/routes/story.routes.js`, `src/services/finalize-status.service.js`, `client/screens/story-editor/useStoryEditorFinalize.ts:177-249`, `web/public/js/pages/creative/creative.article.mjs:3863-3910`.
- Additive `renderRecovery` remains caller-visible and keyed by the current external `attemptId` identity, but the route now derives it from canonical finalize job truth before returning the session: `src/services/story.service.js:349-409`, `src/services/finalize-status.service.js`, `client/screens/story-editor/model.ts:63-72`.

### Additive billing metadata

- `billingEstimate.estimatedSec` remains the admission-time reservation source: `src/services/story-finalize.attempts.js:331-339`.
- Additive `data.billing.billedSec` on terminal success replay remains caller-visible: `src/services/story-finalize.attempts.js:1186-1189`, `client/lib/renderUsage.ts:30-35`.

### Short / library eventual readback

- Mobile short-detail retry and `/api/shorts/mine?limit=50` fallback behavior are frozen: `client/screens/short-detail/useShortDetailAvailability.ts:148-269`.
- `GET /api/shorts/:jobId` remains a readback bridge that can return `404 NOT_FOUND` while availability settles: `src/controllers/shorts.controller.js:173-180`.
- The active web creative caller's completion redirect via `finalVideo.jobId` or URL-derived id is frozen: `web/public/js/pages/creative/creative.article.mjs:3847-3860`.

## Current Doc Truth Map

### Current authoritative docs

- Backend front door and doc ownership: `README.md:3-17`, `docs/DOCS_INDEX.md:9-13`, `docs/DOCS_INDEX.md:15-77`
- Backend finalize/mobile contract truth: `docs/MOBILE_BACKEND_CONTRACT.md:47-248`
- Backend hardening status: `docs/MOBILE_HARDENING_PLAN.md:59-120`
- Cross-repo hardening audit: `docs/CROSS_REPO_PRODUCTION_HARDENING_PLAN.md:68-108`, `docs/CROSS_REPO_PRODUCTION_HARDENING_PLAN.md:570-583`
- Incident/runbook truth: `docs/INCIDENT_TRACE_RUNBOOK.md:5-128`
- Mobile caller-truth doc: sibling mobile repo `docs/MOBILE_USED_SURFACES.md:13-19` and `docs/MOBILE_USED_SURFACES.md:23-110`

### Proven drift / gaps

- `docs/API_CONTRACT.md` now documents both established top-level finalize exceptions (`shortId` and `finalize`), so the earlier drift note is closed: `docs/API_CONTRACT.md:56-66`.
- Mobile TypeScript does not strongly encode session truth because `StorySession` is still `any`; current caller truth is therefore the hooks/screens, not the type file: `client/types/story.ts:1-6`.
- Active web creative caller behavior is not fully described by the mobile contract docs and must be frozen alongside mobile for this conversion: `docs/ACTIVE_SURFACES.md:83-85`, `web/public/js/pages/creative/creative.article.mjs:3998-4065`.
- Phase 5 storage/recovery tightening is now landed through the canonical finalize-status read helper and GET/replay projection alignment.
- Phase 6 proof is now additive only: scripts, checked-in artifacts, threshold docs, and runbooks. It does not change finalize/mobile/web caller contracts, render-slot retry semantics, or billing heuristics.

## Out Of Scope For This Audit

- This document does not prescribe later implementation details beyond freezing current truth.
- Target design decisions live in the companion Phase 0 spec docs, not here.
