# FINALIZE_THRESHOLD_REPORT

- Status: CANONICAL
- Owner repo: backend
- Source of truth for: Phase 6 measured finalize proof artifacts, operating ranges, and carry-forward must-fix candidates
- Artifact root: `docs/artifacts/finalize-phase6/`

## Measurement Contract

- Routes exercised: /api/story/start, /api/story/finalize, /api/story/:sessionId, /api/shorts/:jobId, /api/shorts/mine?limit=50, /diag/finalize-control-room
- Control-room payload fields frozen for Phase 6: `queueSnapshot`, `sharedSystemPressure`, `pressureConfig`, `localProcessObservability`
- Artifact inputs only: this report is generated from checked-in Phase 6 artifacts and does not infer new thresholds outside those artifacts
- Phase 2 live paid-trust verification is tracked separately in `docs/PHASE2_PAID_TRUST_PROOF_LOG.md`; this report remains the historical Phase 6 artifact record and should not be read as the full launch-path proof by itself

## Tested Matrix

- Worker counts tested: 1, 2
- Concurrency levels tested: 1, 2
- Scenario runs:
  - `baseline/multi-worker-baseline`: verdict=pass, workerCount=2, concurrency=2, attempts=4
  - `baseline/single-worker-low-concurrency`: verdict=pass, workerCount=1, concurrency=1, attempts=2
  - `provider-slowdown/pexels-cooldown`: verdict=pass, workerCount=1, concurrency=1, attempts=1
  - `retry-storm/controlled-retries-and-billing`: verdict=pass, workerCount=1, concurrency=2, attempts=3
  - `worker-restart/queued-job-restart`: verdict=pass, workerCount=1, concurrency=1, attempts=1
  - `worker-restart/running-job-restart`: verdict=pass, workerCount=1, concurrency=1, attempts=1

## Observations

- Queue depth observed: max 1
- Queue oldest age observed: max 0s
- Queue wait observed: max 114ms
- Jobs running observed: max 2
- Worker saturation observed: max 1
- Shared render leases observed: max 2
- Provider cooldown observed: yes (pexels, pixabay)
- Readback lag observed: max 0ms
- Retry-scheduled observed: max 0
- Billing mismatches observed: 1

## Operating Ranges

- Queue depth: green <= 1; yellow <= 2; red > 2 (current max 1)
- Queue oldest age: green <= 0; yellow <= 1; red > 1 (current max 0)
- Queue wait: green <= 114; yellow <= 164; red > 164 (current max 114)
- Worker saturation ratio: green <= 1; yellow <= 1; red > 1 (current max 1)
- Readback lag: green <= 0; yellow <= 100; red > 100 (current max 0)
- Retry-scheduled count: green <= 0; yellow <= 1; red > 1 (current max 0)
- Billing mismatches: green = 0; yellow = investigate immediately; red = repeated or sustained mismatch

## Must-Fix List

- `BILLING_ESTIMATE_TOO_LOW` was reproduced in the mismatch probe; keep billing mismatch alerts active and do not tune estimates inside Phase 6.
