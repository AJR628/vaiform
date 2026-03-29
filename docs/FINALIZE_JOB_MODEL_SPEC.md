# FINALIZE_JOB_MODEL_SPEC

- Status: CANONICAL
- Owner repo: backend
- Source of truth for: target finalize job model, canonical status ownership, billing ownership, retry ownership, client recovery projection rules, and current-to-target mapping
- Canonical counterpart/source: `docs/FINALIZE_CURRENT_STATE_AUDIT.md`, `docs/FINALIZE_FACTORY_CONVERSION_PLAN.md`
- Last verified against: backend repo plus current mobile repo on 2026-03-28

## Purpose

This document resolves the current job-vs-attempt ambiguity for the target factory conversion.

## Proven Current Truth

- Today one Firestore attempt doc in `idempotency` owns admission state, running/queued state, lease fields, reservation data, settlement data, and failure data: `src/services/story-finalize.attempts.js:136-161`, `src/services/story-finalize.attempts.js:395-418`, `src/services/story-finalize.attempts.js:764-781`.
- Today retries rewrite that same durable attempt doc back to `queued`: `src/services/story-finalize.attempts.js:817-858`.
- Today callers treat the stable external `attemptId` as the recovery identity: `client/screens/story-editor/model.ts:63-72`, `src/services/story.service.js:349-409`.

## Phase 3 Design Decision

### Canonical durable object

- The canonical durable object is `FinalizeJob`.
- Phase 3 implements `FinalizeJob` by reusing the existing `idempotency/<uid:attemptId>` durable doc keyspace.
- `FinalizeJob.jobId` is the stable external finalize identity.
- Compatibility rule: the existing external field name `attemptId` remains caller-visible during this conversion, but it maps 1:1 to `FinalizeJob.jobId`.

### Retry lineage object

- The retry lineage object is `FinalizeExecutionAttempt`.
- Phase 3 stores that lineage as embedded `executionAttempts[]` plus `currentExecution` on the same canonical durable job doc.
- Each worker claim/retry produces a new `FinalizeExecutionAttempt`.
- `FinalizeExecutionAttempt.executionAttemptId` is internal and not a replacement for caller-visible `attemptId`.

## Why This Model Is Chosen

- Current callers already need one stable identity for replay/recovery: `client/screens/story-editor/useStoryEditorFinalize.ts:390-425`, `web/public/js/pages/creative/creative.article.mjs:3863-3910`.
- A queue-backed worker system needs retry lineage that the current single-doc attempt model does not preserve: `src/services/story-finalize.attempts.js:817-858`.
- This split preserves current caller behavior while making retries and worker history explicit without introducing a second top-level storage authority in Phase 3.

## Canonical Ownership Decisions

### Canonical status owner

- Owner after conversion: `FinalizeJob`
- Meaning: one place answers "what is the current status of this finalize request?"

### Canonical stage truth owner

- Owner after conversion: `FinalizeJob.currentStage` for current truth, with `FinalizeExecutionAttempt` owning attempt-local stage timings/history.
- Meaning: operators can answer current stage from the job record without scanning every child attempt.

### Canonical retry truth owner

- Owner after conversion: `FinalizeJob` plus child `FinalizeExecutionAttempt` lineage.
- Meaning:
  - `FinalizeJob` owns retry policy snapshot, retry counters, next eligible retry time, and terminal dead-letter state.
  - `FinalizeExecutionAttempt` owns attempt-local failure reason and timing.

### Canonical billing settlement truth owner

- Owner after conversion: `FinalizeJob.billing`
- Meaning:
  - finalize-specific reserve/settle/release truth is recorded on the job
  - `users/<uid>.usage` remains the account ledger applied from job settlement
  - `shorts/<shortId>.billing` remains a readback copy, not the canonical finalize settlement owner

### Canonical client recovery truth owner

- Owner after conversion: `FinalizeJob.projection.renderRecovery` in backend storage, projected into session `renderRecovery` for caller compatibility only.
- Compatibility rule: `GET /api/story/:sessionId` remains the caller-facing recovery surface.

## Phase 3 Canonical Data Model

### FinalizeJob

Required fields:

- `schemaVersion`
- `jobId`
- `uid`
- `sessionId`
- `externalAttemptId`
- `jobState`
- `currentStage`
- `queue`
- `billing`
- `result`
- `retry`
- `projection`
- `currentExecution`
- `executionAttempts`
- `createdAt`
- `updatedAt`

### FinalizeJob.jobState values

- `queued`
- `claimed`
- `started`
- `retry_scheduled`
- `failed_terminal`
- `settled`

These state names are fixed for the conversion target.

### FinalizeExecutionAttempt

Required fields:

- `executionAttemptId`
- `attemptNumber`
- `workerId`
- `createdAt`
- `claimedAt`
- `state`
- `startedAt`
- `finishedAt`
- `failure`
- `stageTimings`
- `lease`

### FinalizeExecutionAttempt.state values

- `created`
- `claimed`
- `running`
- `succeeded`
- `failed_retryable`
- `failed_terminal`
- `abandoned`

## Compatibility Mirror Policy

Phase 3 keeps only the required top-level compatibility mirrors on the canonical durable job doc:

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

These mirrors exist for caller, route, diag, worker, test, and rollback compatibility only. Canonical lifecycle truth lives in `jobState`, `currentExecution`, and `executionAttempts`.

## Stale-Worker Mapping

- When a running worker lease expires, the active `FinalizeExecutionAttempt.state` becomes `abandoned`.
- The canonical job becomes terminal failed using the existing caller-visible `FINALIZE_WORKER_LOST` semantics.
- This mapping is frozen for Phase 3 and does not introduce new public failure semantics.

## Projection Rules

### Session renderRecovery

- `renderRecovery` remains an additive session projection for caller compatibility.
- It must be derived from `FinalizeJob.projection.renderRecovery`, not treated as the canonical operational truth.
- Compatibility shape remains `{ state, attemptId, startedAt, updatedAt, shortId, finishedAt, failedAt, code, message }`: `src/services/story.service.js:349-409`.
- Phase 5 canonicalization makes session `renderRecovery` compatibility-only storage; read paths must prefer canonical finalize job truth and only use session data as a hint/cache.

### Shorts read model

- `shorts/<shortId>` remains the library/detail read model.
- It is not the canonical current-status owner.
- It may lag job completion briefly without changing the canonical job state.

### Usage/account ledger

- `users/<uid>.usage` remains the canonical account-usage ledger used by `/api/usage`: `src/services/usage.service.js:111-134`.
- It is not the canonical current finalize status owner.

## Current-To-Target Mapping

| Current object | Current role | Target mapping |
| --- | --- | --- |
| `idempotency` attempt doc | admission + running + retry + settlement + failure | reused as canonical `FinalizeJob` on the same durable keyspace, with embedded `FinalizeExecutionAttempt` lineage |
| `storyFinalizeSessions` lock doc | same-session active lock | remains a helper/lock record only and is not the canonical status owner |
| `story.json.renderRecovery` | caller-facing recovery storage | remains compatibility projection/cache only |
| `users/<uid>.usage` | usage ledger | remains usage ledger |
| `shorts/<jobId>` | readback/library model | remains readback/library model |

## Canonical Read Path Decision

- Backend canonical current render status after conversion: read `FinalizeJob`.
- Caller-facing canonical recovery path after conversion: read `GET /api/story/:sessionId`, which projects from `FinalizeJob`.
- Phase 5 canonical helper: `src/services/finalize-status.service.js`.
- Frozen resolution order:
  1. active `storyFinalizeSessions` helper lock -> active attempt
  2. attempt referenced by `session.renderRecovery.attemptId`
  3. latest finalize attempt for the same `uid + sessionId + flow`
  4. short/readback reconciliation using settled `shortId`
- Phase 5 fallback-query note: because the helper now uses step 3 when steps 1 and 2 do not resolve a canonical attempt, the repo ships a minimal composite Firestore index for `idempotency(flow ASC, uid ASC, sessionId ASC, createdAt DESC)` in `firestore.indexes.json`.

This split is intentional:

- backend operations/debugging need one canonical job truth
- current callers must not be forced off `GET /api/story/:sessionId`

## Non-Goals

- This document does not authorize a second top-level jobs collection in Phase 3.
- This document does not authorize a Firestore execution-attempt subcollection in Phase 3.
- This document does not authorize changing the caller-visible `attemptId` field name.
- This document does not change billing semantics or short/library route contracts.
- Phase 6 threshold tuning/load testing remains deferred.
