# FINALIZE_PHASE6_ARTIFACT_SCHEMA

- Status: CANONICAL
- Owner repo: backend
- Source of truth for: Phase 6 measurement contract, artifact schema, and checked-in result layout
- Artifact root: `docs/artifacts/finalize-phase6/`

## Measurement Contract

- Routes exercised by the reusable Phase 6 harness:
  - `POST /api/story/start`
  - `POST /api/story/finalize`
  - `GET /api/story/:sessionId`
  - `GET /api/shorts/:jobId`
  - `GET /api/shorts/mine?limit=50`
  - `GET /diag/finalize-control-room`
- Control-room payload fields frozen for Phase 6:
  - `queueSnapshot`
  - `sharedSystemPressure`
  - `pressureConfig`
  - `localProcessObservability`
- Metrics/signals captured from repo truth:
  - `finalize_queue_depth`
  - `finalize_queue_oldest_age_seconds`
  - `finalize_jobs_running`
  - `finalize_jobs_retry_scheduled`
  - `finalize_workers_active`
  - `finalize_worker_saturation_ratio`
  - `finalize_provider_cooldown_active`
  - `finalize_billing_unsettled_jobs`
  - `finalize_billing_mismatches_total`
  - `finalize_queue_wait_duration_ms`
  - `finalize_readback_completion_lag_ms`
  - `finalize_readback_retries_total`
- Caller contract note:
  - Phase 6 artifacts measure the existing finalize/mobile/web behavior only.
  - They do not change `POST /api/story/finalize`, `GET /api/story/:sessionId`, `GET /api/shorts/:jobId`, or `GET /api/shorts/mine`.

## Directory Layout

- One scenario directory per scenario family:
  - `baseline/`
  - `worker-restart/`
  - `provider-slowdown/`
  - `retry-storm/`
- One run directory per deterministic run name inside each scenario directory.
- Every run directory must contain:
  - `run-summary.json`
  - `samples.ndjson`
  - `verdict.json`
  - `control-room/*.json`

## Common Envelope

- Every JSON or NDJSON record carries:
  - `schemaVersion`
  - `artifactType`
- `schemaVersion` is currently `1`.
- `artifactType` is one of:
  - `run-summary`
  - `sample`
  - `control-room`
  - `scenario-verdict`

## run-summary.json

- One file per run.
- Purpose:
  - freeze the run configuration
  - summarize counts and observations
  - record per-attempt outcome and billing/readback state
- Required top-level fields:
  - `runId`
  - `scenario`
  - `runName`
  - `description`
  - `startedAt`
  - `finishedAt`
  - `durationMs`
  - `execution`
  - `measurementContract`
  - `controlRoomFieldMap`
  - `counts`
  - `observations`
  - `results`
  - `artifacts`
- `execution` must record:
  - `mode`
  - `requestCount`
  - `concurrency`
  - `workerCount`
  - `autoStartWorkers`
- `counts` must include:
  - `totalAttempts`
  - `acceptedOrReplayed`
  - `queuedOrPending`
  - `completed`
  - `failed`
  - `conflicts`
  - `overloadRejections`
  - `readback404s`
  - `billingMismatches`
- `observations` must include:
  - `maxQueueDepth`
  - `maxQueueOldestAgeSeconds`
  - `maxQueueWaitMs`
  - `maxJobsRunning`
  - `maxJobsRetryScheduled`
  - `maxLocalWorkersActive`
  - `maxLocalWorkerSaturationRatio`
  - `maxSharedRenderLeases`
  - `maxReadbackLagMs`
  - `billingUnsettledJobsMax`
  - `openAiCooldownSeen`
  - `ttsCooldownSeen`
  - `storySearchCooldownSeen`
  - `storySearchCooldownProviders`
- Each `results[]` entry must record:
  - `attemptId`
  - `sessionId`
  - `requestId`
  - `finalizeStatus`
  - `finalizeState`
  - `finalizeCode`
  - `attemptState`
  - `attemptJobState`
  - `shortId`
  - `shortDetailStatus`
  - `fallbackStatus`
  - `readbackPending`
  - `estimatedSec`
  - `reservedSec`
  - `billedSec`
  - `billingMismatch`
  - `billingUnsettled`

## samples.ndjson

- Append-only ordered event stream for the run.
- One JSON object per line.
- Required fields:
  - `runId`
  - `scenario`
  - `sampleIndex`
  - `capturedAt`
  - `eventType`
- Event-specific fields vary by event type:
  - finalize submit: `attemptId`, `sessionId`, `requestId`, `status`, `finalizeState`, `code`
  - recovery poll: `attemptId`, `sessionId`, `pollAttempt`, `recoveryState`, `attemptJobState`
  - short readback: `shortId`, `status`, `surface`
  - control-room sample: `checkpoint`, `controlRoomFile`, `controlRoomSummary`

## control-room/*.json

- Full raw control-room snapshots captured before, during, and after a run.
- File naming must stay checkpoint-oriented and deterministic, for example:
  - `01-before.json`
  - `02-submit-attempt-01.json`
  - `03-recovery-attempt-01-poll-0.json`
  - `99-after.json`
- Each snapshot must preserve the exact route payload and add:
  - `artifactType: "control-room"`
  - `runId`
  - `scenario`
  - `checkpoint`
  - `capturedAt`

## verdict.json

- One file per run.
- Purpose:
  - record pass/fail
  - record the expected checkpoints for semi-manual scenarios
  - record carry-forward risks observed in that run
- Required fields:
  - `runId`
  - `scenario`
  - `status`
  - `checkpoints`
  - `notes`
  - `carryForwardRisks`
- Each checkpoint entry should include:
  - `checkpoint`
  - `status`
  - `observed`

## Scenario Discipline

- Baseline must cover both:
  - single-worker low-concurrency baseline
  - multi-worker baseline
- Worker restart scenarios may remain semi-manual, but the artifacts must still record:
  - when the worker was absent or restarted
  - whether queue backlog or stale-running recovery was observed
  - what control-room state proved pass/fail
- Carry-forward risks are measured, not auto-fixed in Phase 6:
  - render contention still retries at render stage
  - `BILLING_ESTIMATE_TOO_LOW` remains a mismatch risk to watch
  - the local semaphore remains per-process only
