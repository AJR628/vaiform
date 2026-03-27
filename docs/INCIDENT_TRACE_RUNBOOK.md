# INCIDENT_TRACE_RUNBOOK

- Status: CANONICAL
- Owner repo: backend
- Source of truth for: Phase 1 finalize control-room triage on the current finalize engine
- Last verified against repo code: 2026-03-26

## Scope

Use this runbook for:

- failed finalize admission / replay / async execution
- queue growth / worker claim / retry / lease-loss incidents
- billing reserve vs settle drift triage
- completion vs readback lag triage

Phase 1 scope boundary:

- this runbook instruments the current finalize engine through the explicit finalize worker runtime introduced by Finalize Factory Phase 2
- API health and worker health are now separate concerns
- this runbook does not assume a dead-letter queue yet

## Control-Room Sources

Use these sources in this order:

1. Canonical finalize logs emitted through `src/observability/finalize-observability.js`
2. Canonical finalize metrics emitted through the same module and exposed by the Phase 1 diagnostic proof surface
3. Mobile in-memory diagnostics for finalize recovery and readback
4. Legacy stdout log events only when extra local detail is needed

Diagnostic proof surface:

- `GET /diag/finalize-control-room`
- Mounted only when `VAIFORM_DEBUG=1` via [src/app.js](C:/Users/ajrhe/OneDrive/Desktop/vaiform-1-clean/src/app.js):217-223 and [src/routes/diag.routes.js](C:/Users/ajrhe/OneDrive/Desktop/vaiform-1-clean/src/routes/diag.routes.js):1-145
- Returns:
  - `queueSnapshot`
  - `observability.metrics`
  - `observability.recentEvents`

Known boundaries that still apply:

- backend logs are still stdout-backed even though the event schema is now canonical ([src/observability/logger.js](C:/Users/ajrhe/OneDrive/Desktop/vaiform-1-clean/src/observability/logger.js):18-39)
- mobile diagnostics are still in-memory only and are cleared on app restart ([client/lib/diagnostics.ts](C:/Users/ajrhe/OneDrive/Desktop/vaiform-mobile-ed4c17b4253fd8138e52349f5468ac1cc794cbe1/client/lib/diagnostics.ts):36-153)
- the API process no longer boots finalize execution; worker startup is separate through [story-finalize.worker.js](C:/Users/ajrhe/OneDrive/Desktop/vaiform-1-clean/story-finalize.worker.js):1-14 and [src/workers/story-finalize.worker.js](C:/Users/ajrhe/OneDrive/Desktop/vaiform-1-clean/src/workers/story-finalize.worker.js):1-49

## Correlation Keys

Capture as many of these as possible:

- `requestId`
- `sessionId`
- `attemptId`
- `finalizeJobId`
- `shortId`
- `workerId`
- `route`
- `stage`
- `surface`
- `status` / `code`

Phase 1 bridge rule:

- `finalizeJobId` is an observability alias of the current external `attemptId`; Phase 1 has not migrated runtime job storage yet ([src/observability/finalize-observability.js](C:/Users/ajrhe/OneDrive/Desktop/vaiform-1-clean/src/observability/finalize-observability.js):276-278)

## Canonical Stage Map

Use these stage names when triaging:

- `admission_validate`
- `admission_reserve_usage`
- `queue_enqueue`
- `queue_wait`
- `worker_claim`
- `hydrate_session`
- `story_generate`
- `plan_shots`
- `clip_search`
- `caption_generate`
- `render_video`
- `upload_artifacts`
- `write_short`
- `persist_recovery`
- `billing_settle`
- `client_recovery_poll`
- `short_detail_readback`
- `library_fallback_readback`

Stage authority: [src/observability/finalize-observability.js](C:/Users/ajrhe/OneDrive/Desktop/vaiform-1-clean/src/observability/finalize-observability.js):15-34

Repeated happy-path stage note:

- `hydrate_session` can appear twice on a successful finalize because the current engine loads the session up front and reloads it after render before terminal projection.
- `persist_recovery` can appear twice on a successful finalize because the current engine writes `renderRecovery.pending` before work and `renderRecovery.done` after work.

## Canonical Metrics

Use these Phase 1 metrics first:

- `finalize_queue_depth`
- `finalize_queue_oldest_age_seconds`
- `finalize_jobs_running`
- `finalize_jobs_retry_scheduled`
- `finalize_workers_active`
- `finalize_worker_saturation_ratio`
- `finalize_billing_unsettled_jobs`
- `finalize_api_requests_total`
- `finalize_jobs_created_total`
- `finalize_worker_claims_total`
- `finalize_job_retries_total`
- `finalize_job_failures_total`
- `finalize_worker_lease_expirations_total`
- `finalize_billing_mismatches_total`
- `finalize_readback_retries_total`
- `finalize_api_admission_duration_ms`
- `finalize_queue_wait_duration_ms`
- `finalize_job_total_duration_ms`
- `finalize_stage_duration_ms`
- `finalize_readback_completion_lag_ms`

Metric authority: [src/observability/finalize-observability.js](C:/Users/ajrhe/OneDrive/Desktop/vaiform-1-clean/src/observability/finalize-observability.js):111-240

## Finalize Admission / Replay / Queue Triage

1. Start from mobile or web caller evidence.
- Mobile finalize callers preserve `requestId`, `sessionId`, `attemptId`, `surface`, and stage context in diagnostics ([client/screens/story-editor/useStoryEditorFinalize.ts](C:/Users/ajrhe/OneDrive/Desktop/vaiform-mobile-ed4c17b4253fd8138e52349f5468ac1cc794cbe1/client/screens/story-editor/useStoryEditorFinalize.ts):164-245, [client/screens/story-editor/useStoryEditorFinalize.ts](C:/Users/ajrhe/OneDrive/Desktop/vaiform-mobile-ed4c17b4253fd8138e52349f5468ac1cc794cbe1/client/screens/story-editor/useStoryEditorFinalize.ts):365-512)
- Active web creative still uses the same finalize and recovery surfaces; Phase 1 must preserve those semantics ([web/public/js/pages/creative/creative.article.mjs](C:/Users/ajrhe/OneDrive/Desktop/vaiform-1-clean/web/public/js/pages/creative/creative.article.mjs):3788-3909, [web/public/js/pages/creative/creative.article.mjs](C:/Users/ajrhe/OneDrive/Desktop/vaiform-1-clean/web/public/js/pages/creative/creative.article.mjs):4004-4060)

2. Check canonical API events by `requestId` or `attemptId`.
- `finalize.api.requested`
- `finalize.api.rejected`
- `finalize.api.accepted`
- `finalize.api.replayed_pending`
- `finalize.api.replayed_done`
- `finalize.api.replayed_failed`
- `finalize.api.conflict_active`

Current emitters:
- [src/middleware/idempotency.firestore.js](C:/Users/ajrhe/OneDrive/Desktop/vaiform-1-clean/src/middleware/idempotency.firestore.js)
- [src/routes/story.routes.js](C:/Users/ajrhe/OneDrive/Desktop/vaiform-1-clean/src/routes/story.routes.js)

3. Answer the first split immediately:
- If the latest terminal event is `finalize.api.rejected`, failure happened before enqueue.
- If `finalize.job.created` and `finalize.job.queued` exist, admission succeeded and the failure is after enqueue.

4. Check queue metrics.
- `finalize_queue_depth > 0` means accepted work is waiting.
- `finalize_queue_oldest_age_seconds` rising means backlog is aging.
- `finalize_jobs_retry_scheduled > 0` means retry-delayed jobs are accumulating.

## Worker / Retry / Lease Triage

1. Check canonical worker events:
- `finalize.worker.started`
- `finalize.worker.stopped`
- `finalize.worker.heartbeat`
- `finalize.worker.heartbeat_missed`
- `finalize.worker.claim_loop_error`
- `finalize.job.claimed`
- `finalize.job.started`
- `finalize.job.retry.scheduled`
- `finalize.job.failed`
- `finalize.job.completed`
- `finalize.job.settled`

Current emitters:
- [src/services/story-finalize.runner.js](C:/Users/ajrhe/OneDrive/Desktop/vaiform-1-clean/src/services/story-finalize.runner.js)
- [src/services/story-finalize.attempts.js](C:/Users/ajrhe/OneDrive/Desktop/vaiform-1-clean/src/services/story-finalize.attempts.js)

2. Interpret queue vs worker conditions.
- `finalize_queue_depth` rising while `finalize_worker_claims_total` is flat means the current finalize worker runtime is not claiming work.
- `finalize_jobs_running` near the render slot limit with `finalize_worker_saturation_ratio` near `1` means the current worker process is saturated, not idle.
- `finalize_job_retries_total` growing with `reason=server_busy` means retries are bounded but pressure is rising.
- `finalize_worker_lease_expirations_total` or repeated `finalize.worker.heartbeat_missed` means a job was lost after claim or a queued attempt expired unrecovered.

3. Use queue snapshot when local verification is needed.
- `queueSnapshot.queueDepth`
- `queueSnapshot.queueOldestAgeSeconds`
- `queueSnapshot.jobsRunning`
- `queueSnapshot.jobsRetryScheduled`
- `queueSnapshot.billingUnsettledJobs`

## Stage Failure / Slowdown Triage

1. Filter `finalize.job.stage.started` and `finalize.job.stage.completed` by `attemptId` / `finalizeJobId`.
2. Compare missing terminal stage-complete events and long `finalize_stage_duration_ms{stage=...}` values.
3. Current stage emitters are narrow wrappers around the existing monolith, not a new pipeline split:
- [src/services/story.service.js](C:/Users/ajrhe/OneDrive/Desktop/vaiform-1-clean/src/services/story.service.js):2373-2627

Interpretation:

- failure before `worker_claim` means admission/queue-side problem
- failure after `worker_claim` but before `render_video` usually means story/session/provider-side work
- failure during `render_video`, `upload_artifacts`, or `write_short` means render or asset persistence pain
- repeated long `persist_recovery` or `billing_settle` times mean post-render state write pressure, not render generation itself

## Billing Drift Triage

1. Check:
- `finalize.job.settled`
- `finalize.job.failed` with `stage=billing_settle`
- `finalize_billing_mismatches_total`
- `finalize_billing_unsettled_jobs`

2. Interpret:
- `finalize_billing_unsettled_jobs` rising means accepted work has not yet settled or released.
- `finalize_billing_mismatches_total > 0` means reserve/settle drift has been observed. Current mismatch emission is wired at settle time in [src/services/story-finalize.attempts.js](C:/Users/ajrhe/OneDrive/Desktop/vaiform-1-clean/src/services/story-finalize.attempts.js):676-943.
- If `/api/usage` looks wrong after terminal finalize, correlate the same `attemptId` against `finalize.job.settled` or terminal `finalize.job.failed`.

## Readback Lag Triage

1. Start from mobile diagnostics.
- Short Detail readback diagnostics now preserve:
  - `requestId`
  - `shortId`
  - `retryAttempt`
  - canonical stage `short_detail_readback` or `library_fallback_readback`
  - `surface` of `short_detail`, `library_fallback`, or `short_detail_manual_retry`
  ([client/screens/short-detail/useShortDetailAvailability.ts](C:/Users/ajrhe/OneDrive/Desktop/vaiform-mobile-ed4c17b4253fd8138e52349f5468ac1cc794cbe1/client/screens/short-detail/useShortDetailAvailability.ts):77-316)

2. Check canonical readback events:
- `finalize.readback.short_detail_pending`
- `finalize.readback.short_detail_ready`

Emitter:
- [src/controllers/shorts.controller.js](C:/Users/ajrhe/OneDrive/Desktop/vaiform-1-clean/src/controllers/shorts.controller.js):3-295

3. Interpret:
- `finalize.job.completed` and `finalize.job.settled` exist, but `finalize.readback.short_detail_pending` continues: completion happened, readback is lagging.
- `finalize.readback_completion_lag_ms` growing means details are surfacing slower even after success.
- `DETAIL_PENDING_RETRY` plus `LIBRARY_FALLBACK_HIT` means the detail endpoint lagged, but library readback saw the short first.
- `DETAIL_RETRY_TIMEOUT` without terminal backend failure means availability stayed pending past the mobile retry window.

## Quick Answer Paths

Use these shortcuts when someone asks the common operator questions:

- Did finalize fail before enqueue or after enqueue?
  - Check for `finalize.job.created` / `finalize.job.queued`. Absence means before enqueue.
- Are queued jobs growing?
  - Check `finalize_queue_depth` and `finalize_queue_oldest_age_seconds`.
- Are workers claiming work?
  - Check `finalize_worker_claims_total`, `finalize_jobs_running`, and recent `finalize.job.claimed`.
- Which stage is slow or failing?
  - Check `finalize_stage_duration_ms` by stage and the latest `finalize.job.failed.stage`.
- Are retries bounded or storming?
  - Check `finalize_job_retries_total` and `finalize_jobs_retry_scheduled`.
- Did billing reserve/settle drift?
  - Check `finalize_billing_mismatches_total` and `finalize_billing_unsettled_jobs`.
- Did completion happen but readback lag?
  - Check `finalize.job.completed` / `finalize.job.settled` against `finalize.readback.short_detail_pending` and `finalize_readback_completion_lag_ms`.

## Redaction Checklist

When inspecting backend logs or the diagnostic proof surface, verify the canonical logger path is not emitting:

- raw `Authorization` headers
- raw cookies
- API keys or secrets
- raw provider payloads
- full storage/public URLs beyond intended API payloads
- unsafe raw prompt, caption, or request body blobs

If any of the above appear in the canonical finalize event stream, treat that as an observability bug before widening coverage further.
