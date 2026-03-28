# FINALIZE_OBSERVABILITY_SPEC

- Status: CANONICAL
- Owner repo: backend
- Source of truth for: finalize identifiers, stage names, event names, metrics, dashboards, alerts, and operator-answerability requirements
- Canonical counterpart/source: `docs/FINALIZE_FACTORY_CONVERSION_PLAN.md`, `docs/FINALIZE_RUNTIME_TOPOLOGY_SPEC.md`, `docs/FINALIZE_JOB_MODEL_SPEC.md`
- Last verified against: backend repo plus current mobile repo on 2026-03-28

## Purpose

This document defines the observability contract required for the finalize factory conversion.

Current observability truth exists today through request IDs, AsyncLocalStorage request context, structured backend logs, the incident runbook, and mobile in-memory diagnostics: `src/middleware/reqId.js:4-8`, `src/observability/request-context.js:48-67`, `src/observability/logger.js:18-39`, `docs/INCIDENT_TRACE_RUNBOOK.md:5-128`, `client/lib/diagnostics.ts:36-143`.

Phase 4 now lands the canonical identifier contract, queue/job lifecycle signals, and the shared-vs-local control-room truth below. Later phases may extend this spec, but they must not break these identifiers or metric meanings.

## Current Observability Baseline

- Backend request correlation exists: `src/middleware/reqId.js:4-8`, `src/http/respond.js:14-34`
- Backend finalize boundary logging exists: `src/routes/story.routes.js:975-1018`, `src/services/story-finalize.attempts.js:804-810`, `src/services/story.service.js:2532-2600`
- Manual runbook exists: `docs/INCIDENT_TRACE_RUNBOOK.md:29-128`
- Mobile diagnostics exist but are in-memory only: `docs/INCIDENT_TRACE_RUNBOOK.md:12-16`, `client/lib/diagnostics.ts:36-66`

## Target Requirement: Canonical Identifiers

All finalize signals must use the following identifiers consistently.

### Required on every finalize event

- `requestId`
- `uid`
- `sessionId`
- `finalizeJobId`
- `route` when the event originates from an HTTP request
- `sourceRole` with value `api`, `worker`, or `mobile`
- `ts`

### Required on worker/job events

- `executionAttemptId`
- `workerId`
- `jobState`
- `stage`

### Required on failure/retry/provider events

- `errorCode`
- `errorClass`
- `retryable`
- `provider` when provider-backed
- `httpStatus` when HTTP-backed

### Compatibility rule

- The current caller-visible `attemptId` remains the external compatibility identifier and maps to `finalizeJobId`.
- Internal worker retry lineage uses `executionAttemptId` and must not replace the caller-visible `attemptId`.
- In Phase 3, `executionAttemptId` must come from the canonical embedded `executionAttempts[]` lineage on the durable finalize job doc. Observability must not synthesize placeholder execution ids anymore.

## Target Requirement: Canonical Stage Names

These stage names are fixed for later phases.

### Admission / queue stages

- `admission_validate`
- `admission_reserve_usage`
- `queue_enqueue`
- `queue_wait`
- `worker_claim`

### Execution stages

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

### Readback / recovery stages

- `client_recovery_poll`
- `short_detail_readback`
- `library_fallback_readback`

Stage names are intentionally narrower than route names so operators can answer where work is spending time or failing.

Phase 1 clarification on repeated happy-path stages:

- `hydrate_session` is expected to occur more than once on a successful finalize because the current engine loads the session before execution and reloads it after render to pick up `finalVideo`.
- `persist_recovery` is expected to occur more than once on a successful finalize because the current engine projects `renderRecovery.pending` before work and `renderRecovery.done` after work.

## Target Requirement: Canonical Event Names

### API/front-desk events

- `finalize.api.requested`
- `finalize.api.rejected`
- `finalize.api.accepted`
- `finalize.api.replayed_pending`
- `finalize.api.replayed_done`
- `finalize.api.replayed_failed`
- `finalize.api.conflict_active`

### Queue/job lifecycle events

- `finalize.job.created`
- `finalize.job.queued`
- `finalize.job.claimed`
- `finalize.job.started`
- `finalize.job.stage.started`
- `finalize.job.stage.completed`
- `finalize.job.retry.scheduled`
- `finalize.job.failed`
- `finalize.job.dead_lettered`
- `finalize.job.completed`
- `finalize.job.settled`

### Worker runtime events

- `finalize.worker.started`
- `finalize.worker.stopped`
- `finalize.worker.heartbeat`
- `finalize.worker.heartbeat_missed`
- `finalize.worker.claim_loop_error`

### Projection/readback events

- `finalize.recovery.projected`
- `finalize.recovery.poll`
- `finalize.readback.short_detail_pending`
- `finalize.readback.short_detail_ready`
- `finalize.readback.library_fallback_hit`
- `finalize.readback.library_fallback_miss`

### Provider events

- `finalize.provider.request`
- `finalize.provider.retryable_failure`
- `finalize.provider.terminal_failure`
- `finalize.provider.cooldown_started`
- `finalize.provider.cooldown_cleared`

Phase 4 clarification:

- provider admission/cooldown truth only becomes shared for finalize-relevant OpenAI, story-search, and TTS traffic in this phase
- standalone non-finalize provider routes may still retain their existing local behavior unless they execute inside finalize context

## Target Requirement: Required Fields By Event Family

### All finalize events

- `ts`
- `sourceRole`
- `requestId`
- `uid`
- `sessionId`
- `finalizeJobId`

### Stage start / complete events

- all common fields
- `executionAttemptId`
- `workerId`
- `stage`
- `stageOrdinal`
- `jobState`
- `queuedAt`
- `startedAt`
- `durationMs` on completed events

### Failure / retry / dead-letter events

- all common fields
- `executionAttemptId`
- `workerId`
- `jobState`
- `stage`
- `errorCode`
- `errorClass`
- `retryable`
- `failureReason`
- `retryAfterMs` when retry scheduled
- `provider` when applicable

### Billing events

- all common fields
- `estimatedSec`
- `reservedSec`
- `billedSec`
- `settlementState`
- `usageLedgerApplied`
- `billingMismatch` boolean

## Target Requirement: Metrics

Metric names below are required. Implementation may use any metrics backend, but names and meanings must stay stable.

### Counters

- `finalize_api_requests_total{outcome}`
- `finalize_jobs_created_total`
- `finalize_job_retries_total{reason}`
- `finalize_job_failures_total{stage,error_code}`
- `finalize_dead_letters_total{reason}`
- `finalize_worker_claims_total`
- `finalize_worker_lease_expirations_total`
- `finalize_provider_failures_total{provider,error_code}`
- `finalize_billing_mismatches_total{type}`
- `finalize_readback_retries_total{surface}`

### Gauges

- `finalize_queue_depth`
- `finalize_queue_oldest_age_seconds`
- `finalize_jobs_running`
- `finalize_jobs_retry_scheduled`
- `finalize_dead_letter_depth`
- `finalize_workers_active`
- `finalize_worker_saturation_ratio`
- `finalize_provider_cooldown_active{provider}`
- `finalize_billing_unsettled_jobs`

Phase 4 sourcing rule:

- queue depth, running count, retry-scheduled count, and job-state control-room views read canonical `jobState` from the existing durable finalize job doc, not the legacy single-doc interpretation alone
- `attemptId` remains the external alias to `finalizeJobId`
- `executionAttemptId` comes from the active embedded execution attempt lineage
- shared render capacity truth comes from Firestore lease ownership keyed by `executionAttemptId`, not from local `RENDER_SLOT_LIMIT`
- shared provider cooldown/admission truth comes from the Firestore-backed finalize control service
- in-process metrics remain useful, but they must be labeled local-process observability rather than whole-system truth

### Histograms

- `finalize_api_admission_duration_ms`
- `finalize_queue_wait_duration_ms`
- `finalize_job_total_duration_ms`
- `finalize_stage_duration_ms{stage}`
- `finalize_provider_request_duration_ms{provider,stage}`
- `finalize_readback_completion_lag_ms{surface}`

## Target Requirement: Control-Room Truth

`/diag/finalize-control-room` must distinguish shared-system pressure from local-process observability.

### Shared-system truth section

- backlog snapshot sourced from canonical finalize job state
- backlog definition frozen to `queued + running + retry_scheduled`
- overload state sourced from shared backlog vs configured cap
- shared render lease usage sourced from Firestore leases owned by `executionAttemptId`
- shared provider admission/cooldown state sourced from Firestore finalize-control records

### Local-process observability section

- local worker inflight count
- local worker saturation ratio
- local metrics/events registry output

### Compatibility rule

- control-room may add shared/local sections, but it must not imply that API-process-local counters are whole-system truth

## Target Requirement: Dashboards

Minimum dashboard set:

### 1. Queue Overview

- queue depth
- oldest queued age
- jobs by state
- retry-scheduled count
- dead-letter depth
- overload gate state

### 2. Worker Health

- active workers
- running jobs
- worker saturation ratio
- claim rate
- lease expiration count
- shared render leases in use

### 3. Stage Timing

- total finalize duration
- queue wait
- per-stage durations
- stage failure breakdown

### 4. Provider Pressure

- OpenAI busy/timeout/failure rate
- story-search provider transient failures and cooldown activity
- TTS retry/quota/429 activity
- shared provider cooldown/admission state by provider

### 5. Billing / Reconciliation

- reserved vs running vs settled jobs
- billing mismatch count
- estimate-too-low failures
- release/settle failures

### 6. Client Recovery / Readback

- recovery poll count
- short-detail pending retries
- library fallback hits/misses
- readback completion lag

## Target Requirement: Minimum Alerts

- `finalize_queue_depth > 0` and `finalize_workers_active == 0` for 5 minutes
- `finalize_queue_oldest_age_seconds` above agreed SLA
- dead-letter increase above zero in a 15-minute window
- repeated worker lease expirations above threshold
- sustained provider cooldown for any required provider
- any nonzero billing mismatch count
- sharp increase in short-detail retry timeouts or recovery-poll exhaustion

## Target Requirement: Minimum Runbook Answers

Operators and agents must be able to answer these questions from dashboards + logs without code inspection:

- Is admission failing before jobs are enqueued?
- Is work piling up in the queue?
- Are workers healthy and claiming jobs?
- Which stage is failing or slowing down?
- Which provider is the bottleneck?
- Are retries bounded or storming?
- Did billing reserve, settle, or release drift?
- Did the job finish but readback lag?

## Open Implementation Detail

- Metrics sink and dashboard vendor are intentionally not fixed here.
- That is not a blocker for Phase 1 because the event names, stage names, fields, metrics, dashboard requirements, and alert semantics are fixed in this document.
