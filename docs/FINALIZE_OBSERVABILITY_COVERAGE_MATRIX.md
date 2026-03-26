# FINALIZE_OBSERVABILITY_COVERAGE_MATRIX

- Status: CANONICAL FOR PHASE 1
- Owner repo: backend
- Source of truth for: Phase 1 mapping from the Phase 0 finalize observability contract to current code owners, missing gaps, and Phase 1 instrumentation boundaries
- Canonical counterpart/source: `docs/FINALIZE_OBSERVABILITY_SPEC.md`, `docs/FINALIZE_FACTORY_CONVERSION_PLAN.md`
- Last verified against: backend repo plus current mobile repo on 2026-03-26

## Purpose

This matrix freezes the Phase 1 observability build scope before deeper factory-conversion work begins.

It answers:

- which canonical finalize events already have live owner boundaries
- which canonical stages can be instrumented now without Phase 2 or Phase 3 work
- which identifiers already exist today
- which target signals remain intentionally deferred because the current runtime has not changed yet

## Identifier Coverage

| Target identifier | Current status | Current owner / evidence | Phase 1 action |
| --- | --- | --- | --- |
| `requestId` | Present on HTTP flows; absent on background runner unless carried forward | `src/middleware/reqId.js:4-8`, `src/observability/request-context.js:48-67` | Carry into canonical finalize context and persist on current attempt docs for background correlation |
| `uid` | Present | `src/observability/request-context.js:48-67` | Reuse |
| `sessionId` | Present | `src/middleware/idempotency.firestore.js:43-55`, `src/routes/story.routes.js:1190-1210` | Reuse |
| current external `attemptId` | Present | `src/middleware/idempotency.firestore.js:54-63`, `src/services/story-finalize.attempts.js:395-418` | Reuse |
| `finalizeJobId` | Missing as explicit field; Phase 0 says it aliases current external `attemptId` in Phase 1 | `docs/FINALIZE_JOB_MODEL_SPEC.md:23-32`, `docs/FINALIZE_OBSERVABILITY_SPEC.md:53-56` | Add explicit internal observability alias only; no runtime job-model migration |
| `workerId` | Present in runner but not standardized in logs/context | `src/services/story-finalize.runner.js:21-23`, `src/services/story-finalize.attempts.js:158-160` | Add to canonical worker context and events |
| `executionAttemptId` | Not truthful in the current single-doc attempt model | `src/services/story-finalize.attempts.js:817-858`, `docs/FINALIZE_JOB_MODEL_SPEC.md:27-32` | Defer; do not invent a fake retry lineage id in Phase 1 |
| `jobState` | Present today as current attempt `state` | `src/services/story-finalize.attempts.js:144`, `src/services/story-finalize.attempts.js:395-418` | Alias current attempt state into canonical observability payloads |
| `shortId` | Present on success/readback paths | `src/services/story-finalize.attempts.js:147`, `src/controllers/shorts.controller.js:103-104` | Reuse |

## Canonical Event Coverage

| Canonical event | Current code owner / boundary | Current status | Phase 1 instrumentation status |
| --- | --- | --- | --- |
| `finalize.api.requested` | `src/routes/story.routes.js:972-977` | Legacy route log exists | Emit now |
| `finalize.api.rejected` | `src/routes/story.routes.js:1022-1034`, `src/middleware/idempotency.firestore.js:36-52`, `src/services/story-finalize.attempts.js:493-510` | Boundary exists through failure mapping | Emit now |
| `finalize.api.accepted` | `src/routes/story.routes.js:984-990` | Legacy route log exists | Emit now |
| `finalize.api.replayed_pending` | `src/routes/story.routes.js:991-997` | Legacy route log exists | Emit now |
| `finalize.api.replayed_done` | `src/routes/story.routes.js:1006-1010` | Legacy route log exists | Emit now |
| `finalize.api.replayed_failed` | `src/routes/story.routes.js:1012-1018` | Legacy route log exists | Emit now |
| `finalize.api.conflict_active` | `src/routes/story.routes.js:998-1005` | Legacy route log exists | Emit now |
| `finalize.job.created` | `src/services/story-finalize.attempts.js:395-418` | Durable enqueue boundary exists | Emit now |
| `finalize.job.queued` | `src/services/story-finalize.attempts.js:395-418`, `src/services/story-finalize.attempts.js:817-858` | Durable queue/retry boundary exists | Emit now |
| `finalize.job.claimed` | `src/services/story-finalize.attempts.js:860-932` | Claim boundary exists, no current event | Emit now |
| `finalize.job.started` | `src/services/story-finalize.runner.js:59-77` | Start boundary exists, no current event | Emit now |
| `finalize.job.stage.started` | `src/services/story.service.js:2528-2586`, `src/services/story.service.js:2379-2455` | Stage boundaries exist implicitly | Emit now via narrow wrappers |
| `finalize.job.stage.completed` | `src/services/story.service.js:2528-2586`, `src/services/story.service.js:2379-2455` | Stage boundaries exist implicitly | Emit now via narrow wrappers |
| `finalize.job.retry.scheduled` | `src/services/story-finalize.runner.js:86-94`, `src/services/story-finalize.attempts.js:817-858` | Retry boundary exists | Emit now |
| `finalize.job.failed` | `src/services/story-finalize.runner.js:96-121`, `src/services/story-finalize.attempts.js:600-674`, `src/services/story-finalize.attempts.js:956-1010` | Failure boundary exists | Emit now |
| `finalize.job.dead_lettered` | No current dead-letter state | Not truthful yet | Defer to Phase 3 |
| `finalize.job.completed` | `src/services/story.service.js:2596-2603` | Completion boundary exists | Emit now |
| `finalize.job.settled` | `src/services/story-finalize.attempts.js:676-815` | Settlement boundary exists | Emit now |
| `finalize.worker.started` | `src/services/story-finalize.runner.js:21-28`, `src/services/story-finalize.runner.js:172-179` | Worker start boundary exists, no current event | Emit now |
| `finalize.worker.stopped` | `src/services/story-finalize.runner.js:164-179` | Stop boundary exists | Emit now |
| `finalize.worker.heartbeat` | `src/services/story-finalize.runner.js:60-67`, `src/services/story-finalize.attempts.js:934-954` | Heartbeat boundary exists | Emit now |
| `finalize.worker.heartbeat_missed` | `src/services/story-finalize.attempts.js:991-1010` | Missed-heartbeat boundary exists through reaper | Emit now |
| `finalize.worker.claim_loop_error` | `src/services/story-finalize.runner.js:45-51`, `src/services/story-finalize.runner.js:139-145` | Claim/reaper error boundary exists | Emit now |
| `finalize.recovery.projected` | `src/services/story.service.js:436-462` | Projection boundary exists | Emit now |
| `finalize.recovery.poll` | `src/routes/story.routes.js:1201-1210` | Legacy poll log exists | Emit now |
| `finalize.readback.short_detail_pending` | `src/controllers/shorts.controller.js:173-180` | Pending readback boundary exists | Emit now |
| `finalize.readback.short_detail_ready` | `src/controllers/shorts.controller.js:142-155`, `src/controllers/shorts.controller.js:214-227` | Ready readback boundary exists | Emit now |
| `finalize.readback.library_fallback_hit` | Mobile only: `client/screens/short-detail/useShortDetailAvailability.ts:176-205` | Current mobile diagnostic boundary exists | Emit as mobile diagnostic context only in Phase 1 |
| `finalize.readback.library_fallback_miss` | Mobile only: `client/screens/short-detail/useShortDetailAvailability.ts:208-216` | Current mobile diagnostic boundary exists | Emit as mobile diagnostic context only in Phase 1 |

## Canonical Stage Coverage

| Canonical stage | Current owner / evidence | Phase 1 instrumentable now? | Notes |
| --- | --- | --- | --- |
| `admission_validate` | `src/middleware/idempotency.firestore.js:43-55` | Yes | Current request validation boundary |
| `admission_reserve_usage` | `src/services/story-finalize.attempts.js:376-444` | Yes | Current reservation boundary |
| `queue_enqueue` | `src/services/story-finalize.attempts.js:395-418` | Yes | Current queued doc write |
| `queue_wait` | `src/services/story-finalize.attempts.js:404-408`, `src/services/story-finalize.attempts.js:860-932` | Yes | Compute from `enqueuedAt -> claim` |
| `worker_claim` | `src/services/story-finalize.attempts.js:860-932` | Yes | Current claim transaction |
| `hydrate_session` | `src/services/story.service.js:2528-2545` | Yes | Narrow timing wrapper only |
| `story_generate` | `src/services/story.service.js:2552-2560` | Yes | Existing conditional boundary |
| `plan_shots` | `src/services/story.service.js:2562-2565` | Yes | Existing conditional boundary |
| `clip_search` | `src/services/story.service.js:2567-2570` | Yes | Existing conditional boundary |
| `caption_generate` | `src/services/story.service.js:2575-2578` | Yes | Existing conditional boundary |
| `render_video` | `src/services/story.service.js:2580-2586` | Yes | Existing render boundary |
| `upload_artifacts` | `src/services/story.service.js:2380-2406` | Yes | Instrument in place only |
| `write_short` | `src/services/story.service.js:2415-2444` | Yes | Instrument in place only |
| `persist_recovery` | `src/services/story.service.js:2539-2550`, `src/services/story.service.js:2588-2595`, `src/services/story.service.js:2610-2623` | Yes | Current projection writes |
| `billing_settle` | `src/services/story-finalize.attempts.js:676-815` | Yes | Existing settlement boundary |
| `client_recovery_poll` | `src/routes/story.routes.js:1201-1210`, `client/screens/story-editor/useStoryEditorFinalize.ts:177-249` | Yes | Backend + mobile context alignment |
| `short_detail_readback` | `src/controllers/shorts.controller.js:142-233`, `client/screens/short-detail/useShortDetailAvailability.ts:92-146` | Yes | Backend + mobile context alignment |
| `library_fallback_readback` | `client/screens/short-detail/useShortDetailAvailability.ts:148-235` | Partially | Mobile-only signal in Phase 1; no backend metric source yet |

## Metrics Coverage

| Metric | Current runtime status | Phase 1 owner |
| --- | --- | --- |
| `finalize_api_requests_total{outcome}` | Missing | canonical finalize event emitter |
| `finalize_jobs_created_total` | Missing | enqueue boundary |
| `finalize_job_retries_total{reason}` | Missing | retry scheduling boundary |
| `finalize_job_failures_total{stage,error_code}` | Missing | terminal failure boundary |
| `finalize_worker_claims_total` | Missing | claim boundary |
| `finalize_worker_lease_expirations_total` | Missing | stale-running reaper boundary |
| `finalize_provider_failures_total{provider,error_code}` | Missing | optional provider wrappers only where finalize already depends on them |
| `finalize_billing_mismatches_total{type}` | Missing | settle/release mismatch checks |
| `finalize_readback_retries_total{surface}` | Missing | short-detail 404 boundary now; library fallback remains mobile-only in Phase 1 |
| `finalize_queue_depth` | Missing | current attempt-state snapshot + event-driven refresh |
| `finalize_queue_oldest_age_seconds` | Missing | current queued-attempt snapshot |
| `finalize_jobs_running` | Missing | current attempt-state snapshot + runner inflight refresh |
| `finalize_jobs_retry_scheduled` | Missing | current queued attempts with future `availableAfter` |
| `finalize_workers_active` | Missing | runner start/stop ownership |
| `finalize_worker_saturation_ratio` | Missing | current `inflight.size / RENDER_SLOT_LIMIT` |
| `finalize_billing_unsettled_jobs` | Missing | current active attempt count |
| `finalize_api_admission_duration_ms` | Missing | route + idempotency duration |
| `finalize_queue_wait_duration_ms` | Missing | `enqueuedAt -> claim` |
| `finalize_job_total_duration_ms` | Missing | `enqueuedAt -> terminal settle/fail` |
| `finalize_stage_duration_ms{stage}` | Missing | stage wrappers |
| `finalize_provider_request_duration_ms{provider,stage}` | Missing | optional finalize-path provider wrappers |
| `finalize_readback_completion_lag_ms{surface}` | Missing | short-detail ready path from current short completion time |

## Explicit Phase 1 Deferrals

- Do not emit `finalize.job.dead_lettered` yet. The current queue does not have a real dead-letter state.
- Do not invent `executionAttemptId` while the current runtime still rewrites one durable attempt doc on retry.
- Do not implement a global mobile telemetry upload path. Phase 1 only aligns local mobile diagnostics with the control-room contract.
- Do not change API/worker ownership, queue substrate, or finalize caller contracts in order to make observability easier.
