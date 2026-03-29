# FINALIZE_SCALING_RUNBOOK

- Status: CANONICAL
- Owner repo: backend
- Source of truth for: Phase 6 finalize scenario execution, threshold interpretation, and operator actions
- Artifact/report companions:
  - `docs/artifacts/finalize-phase6/ARTIFACT_SCHEMA.md`
  - `docs/FINALIZE_THRESHOLD_REPORT.md`

## Scope

- This runbook is for Finalize Factory Phase 6 operations proof only.
- It does not change public finalize/mobile/web contracts.
- It does not redesign render-slot wait behavior, billing heuristics, or finalize storage/runtime architecture.

## Scenario Entry Points

Run these from the backend repo root:

- `npm run load:finalize:baseline`
- `npm run load:finalize:restart`
- `npm run load:finalize:provider`
- `npm run load:finalize:retry-storm`
- `npm run report:finalize:thresholds`

Each scenario writes deterministic artifacts under `docs/artifacts/finalize-phase6/`.
Those artifacts and the threshold report are generated proof bundles committed in repo; rerunning the Phase 6 scripts refreshes those tracked files in place.

## Healthy vs Degraded

Healthy signals:

- `queueSnapshot.queueDepth` returns to `0` after the run
- `queueSnapshot.queueOldestAgeSeconds` does not keep climbing after workers resume
- `sharedSystemPressure.backlog.backlog` stays below the documented threshold range
- `sharedSystemPressure.render.activeLeases` returns to steady-state after completion
- `localProcessObservability.metrics` shows workers active and claim/readback activity without sustained retry backlog
- `GET /api/story/:sessionId` reaches `renderRecovery.state = done` for successful attempts
- `GET /api/shorts/:jobId` returns `200` without sustained readback lag

Degraded signals:

- queue age grows across consecutive control-room snapshots
- backlog remains non-zero with no corresponding claims
- retry-scheduled jobs accumulate or churn repeatedly
- provider cooldown remains active across the after-snapshot
- readback stays pending after success
- billing mismatch appears outside the dedicated mismatch probe

## Scaling Levers

- Worker count: increase only after the threshold report says the current queue depth, queue age, and worker saturation remain in green/yellow range.
- Concurrency: raise only if queue wait and readback lag remain controlled and retry-scheduled stays near zero outside the retry-storm scenario.
- Shared pressure config: use the live `pressureConfig` control-room section as the current source of backlog/render/provider limits.
- Local process safety: remember the render semaphore is still per-process only; treat it as a guardrail, not the whole-system limit.

## Queue-Age Growth

Symptoms:

- `queueSnapshot.queueOldestAgeSeconds` rising
- `sharedSystemPressure.backlog.backlog` elevated
- `finalize_queue_wait_duration_ms` increasing

Operator actions:

- Confirm workers are actually running and claiming.
- Check whether `localProcessObservability.recentEvents` shows `finalize.job.claimed` or repeated retry scheduling instead.
- Compare queue growth with `sharedSystemPressure.render.activeLeases`.
- If workers are healthy but queue age still grows, reduce admission pressure or add workers only after rerunning the baseline scenario and updating the threshold report.

## Zero-Claim Backlog

Symptoms:

- backlog exists
- `queueSnapshot.jobsRunning` stays `0`
- claims do not advance

Operator actions:

- Confirm the finalize worker runtime is started separately from the API runtime.
- Use the worker-restart scenario to prove whether queued work drains once a worker comes back.
- Inspect `localProcessObservability.recentEvents` for claim-loop errors or missed heartbeats.

## Worker Restart

Use:

- `npm run load:finalize:restart`

Queued-job restart pass signals:

- finalize is accepted while no worker is running
- queue/control-room snapshots show backlog before restart
- after worker start, the same attempt reaches `renderRecovery.state = done`

Running-job restart pass signals:

- the scenario records stale running state
- after restart/reap, the attempt reaches the existing `FINALIZE_WORKER_LOST` failure semantics

Operator note:

- this scenario is intentionally semi-manual in discipline only. The script still emits deterministic artifacts and verdict checkpoints.

## Sustained Provider Cooldown

Use:

- `npm run load:finalize:provider`

Symptoms:

- `sharedSystemPressure.providers.*.cooldownActive = true`
- scenario verdict shows cooldown was observed

Operator actions:

- confirm which provider family activated cooldown
- do not change provider control architecture in Phase 6
- keep callers unchanged and treat sustained cooldown as a scaling or provider-health signal

## Retry Storm

Use:

- `npm run load:finalize:retry-storm`

Symptoms:

- `queueSnapshot.jobsRetryScheduled` rises
- retry-scheduled checkpoints appear in artifacts
- queue wait or backlog grows during retries

Operator actions:

- confirm the retry reason is controlled `SERVER_BUSY` pressure rather than a new failure class
- do not redesign render wait-vs-retry inside Phase 6
- keep this as a carry-forward measurement target if retry backlog becomes routine outside the controlled scenario

## Readback Lag

Symptoms:

- successful finalize completion but delayed `GET /api/shorts/:jobId` readiness
- `finalize_readback_completion_lag_ms` rises

Operator actions:

- inspect run artifacts for `shortDetailStatus`, `fallbackStatus`, and `readbackPending`
- confirm whether `/api/shorts/mine?limit=50` rescued the readback
- keep short-detail/list semantics unchanged; Phase 6 measures, it does not redesign them

## Billing Mismatch

Symptoms:

- `billingMismatch = true`
- `finalize_billing_mismatches_total` increments

Operator actions:

- treat mismatch outside the dedicated retry-storm probe as operator attention required
- confirm `estimatedSec`, `reservedSec`, and `billedSec` from the run summary
- do not tune billing heuristics in Phase 6; capture the mismatch and keep alerting enabled

## Report Refresh Procedure

1. Run the required scenarios.
2. Confirm each run directory contains `run-summary.json`, `samples.ndjson`, `verdict.json`, and `control-room/*.json`.
3. Run `npm run report:finalize:thresholds`.
4. Review `docs/FINALIZE_THRESHOLD_REPORT.md` for green/yellow/red ranges before changing worker count or admission pressure.
