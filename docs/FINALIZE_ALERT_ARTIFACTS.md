# FINALIZE_ALERT_ARTIFACTS

- Status: CANONICAL
- Owner repo: backend
- Source of truth for: Phase 1 vendor-neutral finalize alert definitions and minimum alert semantics
- Last verified against repo code: 2026-03-26

Alert contract authority:

- [docs/FINALIZE_OBSERVABILITY_SPEC.md](C:/Users/ajrhe/OneDrive/Desktop/vaiform-1-clean/docs/FINALIZE_OBSERVABILITY_SPEC.md)
- [src/observability/finalize-observability.js](C:/Users/ajrhe/OneDrive/Desktop/vaiform-1-clean/src/observability/finalize-observability.js)

Phase 1 rule:

- these alerts define required conditions and routing semantics
- they do not pick a monitoring vendor
- thresholds may be tuned later, but the alert families and signal dependencies should remain stable

## Alert 1: Queue Backlog Growing

- Severity: warning
- Trigger:
  - `finalize_queue_depth > 0`
  - and `finalize_queue_oldest_age_seconds` is rising across consecutive windows
- Required context:
  - current `finalize_queue_depth`
  - current `finalize_queue_oldest_age_seconds`
  - current `finalize_jobs_running`
  - current `finalize_worker_saturation_ratio`
- Purpose:
  - distinguish backlog from idle worker failure

## Alert 2: Worker Not Claiming

- Severity: critical
- Trigger:
  - `finalize_queue_depth > 0`
  - and no meaningful increase in `finalize_worker_claims_total`
  - across the same period
- Required context:
  - `finalize_workers_active`
  - `finalize_jobs_running`
  - recent `finalize.worker.claim_loop_error`
- Purpose:
  - answer whether accepted work is stranded before claim

## Alert 3: Retry Storm Risk

- Severity: warning
- Trigger:
  - `finalize_job_retries_total` accelerating
  - or `finalize_jobs_retry_scheduled` remaining elevated
- Required labels:
  - retry `reason`
- Purpose:
  - detect bounded retries becoming sustained pressure

## Alert 4: Lease Loss / Worker Loss

- Severity: critical
- Trigger:
  - `finalize_worker_lease_expirations_total > 0`
  - or repeated `finalize.worker.heartbeat_missed`
- Required context:
  - `workerId`
  - `attemptId`
  - `sessionId`
  - `stage`
- Purpose:
  - detect work lost after claim

## Alert 5: Stage Failure Spike

- Severity: warning
- Trigger:
  - abnormal increase in `finalize_job_failures_total`
- Required split:
  - `stage`
  - `error_code`
- Purpose:
  - isolate whether the failure class is queue, render, persistence, or billing aligned

## Alert 6: Stage Slowdown

- Severity: warning
- Trigger:
  - abnormal increase in:
    - `finalize_stage_duration_ms`
    - `finalize_queue_wait_duration_ms`
    - or `finalize_job_total_duration_ms`
- Required split:
  - `stage`
- Purpose:
  - surface slowdown before total failure

## Alert 7: Billing Drift

- Severity: critical
- Trigger:
  - `finalize_billing_mismatches_total > 0`
  - or `finalize_billing_unsettled_jobs` remains elevated beyond expected finalize completion windows
- Required context:
  - `attemptId`
  - `sessionId`
  - `shortId`
  - `estimatedSec`
  - `reservedSec`
  - `billedSec`
  - `settlementState`
- Purpose:
  - detect reserve/settle mismatch or stuck settlement

## Alert 8: Readback Lag

- Severity: warning
- Trigger:
  - `finalize_readback_retries_total` growing
  - or `finalize_readback_completion_lag_ms` elevated
- Required split:
  - `surface`
- Purpose:
  - detect jobs that completed but are not surfacing promptly in detail/readback

## Minimum Routing / Runbook Linkage

Every finalize alert should link operators to:

- [docs/INCIDENT_TRACE_RUNBOOK.md](C:/Users/ajrhe/OneDrive/Desktop/vaiform-1-clean/docs/INCIDENT_TRACE_RUNBOOK.md)
- the canonical stage map in [src/observability/finalize-observability.js](C:/Users/ajrhe/OneDrive/Desktop/vaiform-1-clean/src/observability/finalize-observability.js):15-34
- the canonical metric definitions in [src/observability/finalize-observability.js](C:/Users/ajrhe/OneDrive/Desktop/vaiform-1-clean/src/observability/finalize-observability.js):111-240

Every alert payload should include, when known:

- `requestId`
- `sessionId`
- `attemptId`
- `finalizeJobId`
- `shortId`
- `workerId`
- `stage`
- `surface`
- `errorCode`
- `failureReason`
