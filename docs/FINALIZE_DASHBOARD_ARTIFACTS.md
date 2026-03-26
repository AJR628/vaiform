# FINALIZE_DASHBOARD_ARTIFACTS

- Status: CANONICAL
- Owner repo: backend
- Source of truth for: Phase 1 vendor-neutral finalize dashboard panels and required signal groupings
- Last verified against repo code: 2026-03-26

Dashboard contract authority:

- [docs/FINALIZE_OBSERVABILITY_SPEC.md](C:/Users/ajrhe/OneDrive/Desktop/vaiform-1-clean/docs/FINALIZE_OBSERVABILITY_SPEC.md)
- [src/observability/finalize-observability.js](C:/Users/ajrhe/OneDrive/Desktop/vaiform-1-clean/src/observability/finalize-observability.js)

Phase 1 rule:

- these artifacts are vendor-neutral
- they define the required panels and metric names
- they do not lock the repo to Grafana, Cloud Monitoring, or any other export sink yet

## Dashboard 1: Finalize Queue And Admission

Purpose:

- answer whether requests are entering the system
- answer whether accepted work is piling up before claim

Required panels:

- `Finalize API Requests by Outcome`
  - metric: `finalize_api_requests_total`
  - split: `outcome`
- `Finalize Jobs Created`
  - metric: `finalize_jobs_created_total`
- `Queue Depth`
  - metric: `finalize_queue_depth`
- `Oldest Queued Age`
  - metric: `finalize_queue_oldest_age_seconds`
- `Queued Retry Backlog`
  - metric: `finalize_jobs_retry_scheduled`
- `Admission Duration`
  - metric: `finalize_api_admission_duration_ms`

Operator questions:

- are requests being rejected before enqueue?
- are accepted jobs stacking up?
- is queue age rising even when request volume is stable?

## Dashboard 2: Worker Activity And Saturation

Purpose:

- answer whether the current in-process worker is alive, claiming, and saturated

Required panels:

- `Worker Claims`
  - metric: `finalize_worker_claims_total`
- `Jobs Running`
  - metric: `finalize_jobs_running`
- `Workers Active`
  - metric: `finalize_workers_active`
- `Worker Saturation Ratio`
  - metric: `finalize_worker_saturation_ratio`
- `Lease Expirations`
  - metric: `finalize_worker_lease_expirations_total`

Operator questions:

- is the worker claiming jobs?
- is the current process saturated?
- are lease losses happening?

## Dashboard 3: Stage Durations And Failures

Purpose:

- answer which current finalize stage is slow or failing

Required panels:

- `Stage Duration by Stage`
  - metric: `finalize_stage_duration_ms`
  - split: `stage`
- `Queue Wait Duration`
  - metric: `finalize_queue_wait_duration_ms`
- `Total Job Duration`
  - metric: `finalize_job_total_duration_ms`
- `Job Failures by Stage and Error Code`
  - metric: `finalize_job_failures_total`
  - split: `stage`, `error_code`

Canonical stage values:

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

## Dashboard 4: Billing And Settlement

Purpose:

- answer whether reserve/settle behavior is drifting

Required panels:

- `Billing Unsettled Jobs`
  - metric: `finalize_billing_unsettled_jobs`
- `Billing Mismatches`
  - metric: `finalize_billing_mismatches_total`
  - split: `type`

Operator questions:

- are accepted jobs failing to settle or release?
- are billing mismatches appearing at settle time?

## Dashboard 5: Readback And Completion Lag

Purpose:

- answer whether finalize finished but detail/library readback is lagging

Required panels:

- `Readback Retries by Surface`
  - metric: `finalize_readback_retries_total`
  - split: `surface`
- `Readback Completion Lag`
  - metric: `finalize_readback_completion_lag_ms`
  - split: `surface`

Required surfaces in Phase 1:

- `short_detail`
- `library_fallback`

Operator questions:

- is Short Detail lagging behind completion?
- is the library fallback rescuing detail lag, or failing too?

## Dashboard 6: Event Stream Lens

Purpose:

- give operators a recent canonical event list for local/debug triage

Required sources:

- `observability.recentEvents` from `GET /diag/finalize-control-room`
- stdout-backed canonical `finalize.*` event logs

Required columns:

- `ts`
- `event`
- `requestId`
- `sessionId`
- `attemptId`
- `finalizeJobId`
- `workerId`
- `shortId`
- `stage`
- `errorCode`
- `failureReason`
- `durationMs`

Phase 1 note:

- this lens is a proof and local-debug surface, not the production dashboard backend
