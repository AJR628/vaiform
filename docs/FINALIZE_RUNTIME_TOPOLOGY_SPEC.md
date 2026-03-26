# FINALIZE_RUNTIME_TOPOLOGY_SPEC

- Status: CANONICAL
- Owner repo: backend
- Source of truth for: current and target finalize runtime roles, process boundaries, entrypoints, worker/API separation rules, and health/startup ownership
- Canonical counterpart/source: `docs/FINALIZE_FACTORY_CONVERSION_PLAN.md`, `docs/FINALIZE_OBSERVABILITY_SPEC.md`
- Last verified against: backend repo on 2026-03-26

## Proven Current Topology

- One HTTP API process is started from `server.js`: `server.js:27-43`.
- The API app boots the finalize runner singleton from `src/app.js`: `src/app.js:32-33`.
- Finalize execution therefore still lives inside the API role today: `src/services/story-finalize.runner.js:182-191`.
- The current render-capacity ceiling is process-local through `RENDER_SLOT_LIMIT = 3`: `src/utils/render.semaphore.js:1-23`.

## Target Design Decision

The conversion target has three runtime responsibilities:

1. API/front desk
2. Queue/durable state substrate
3. Finalize worker/factory floor

## Target API Role

### Meaning

The API role owns:

- authentication
- request validation
- idempotency admission
- usage reserve/reject decisions
- durable job creation
- fast HTTP responses
- caller-facing recovery/readback routes

### Explicit non-ownership

The API role does not:

- claim finalize jobs
- execute finalize worker stages
- own worker leases
- own render concurrency

### Target entrypoint

- `server.js` remains the API entrypoint unless a later replacement doc changes that.
- `src/app.js` remains the HTTP app composition owner.

## Target Worker Role

### Meaning

The worker role owns:

- claiming queued finalize jobs
- creating execution-attempt lineage
- stage execution
- heartbeats / leases
- retry scheduling
- dead-letter transitions
- settlement completion

### Explicit non-ownership

The worker role does not:

- bind public HTTP for caller traffic
- perform auth or request validation for mobile/web clients
- emit caller-facing response envelopes

### Target entrypoint

- Phase 2 must introduce a dedicated worker entrypoint under backend runtime ownership.
- Phase 0 decision: that worker entrypoint is expected to live outside `src/app.js` and outside `server.js`.
- Recommended repo boundary: `src/workers/story-finalize.worker.js` or equivalent dedicated worker module plus an explicit npm script.

This is a target design decision, not current code truth.

## Target Queue / Substrate Role

- Firestore remains the durable queue/state substrate for this conversion, per `docs/FINALIZE_FACTORY_CONVERSION_PLAN.md`.
- The queue/substrate role does not expose caller HTTP.
- It owns durable enqueue order, job state, execution-attempt lineage, leases, retry schedule, and dead-letter durability.

## Process-Boundary Rules

### API process

- binds HTTP
- exposes existing health routes
- may emit queue-admission metrics
- must not execute finalize worker stages after Phase 2

### Worker process

- does not bind public HTTP
- may optionally expose internal-only health if a deployment platform requires it, but public caller traffic must never rely on it
- health authority is worker heartbeat plus queue-processing signals defined in `docs/FINALIZE_OBSERVABILITY_SPEC.md`

## Health / Startup Ownership

### API health

- API health remains tied to API route availability, not to finalize worker activity.
- Existing API health routes remain the public health surface: `docs/ACTIVE_SURFACES.md:40-43`.

### Worker health

- Worker health after Phase 2 is owned by:
  - worker process liveness
  - worker heartbeat metrics/events
  - lease freshness
  - successful claim-loop activity

### Startup rule

- Starting the API must not implicitly start finalize execution after Phase 2.
- Starting a worker must not require binding the public API listener.

## Phase 2 Success Definition

Phase 2 is only complete when all of the following are true:

- `server.js` / `src/app.js` no longer bootstrap finalize execution
- worker startup is explicit and separate
- API can admit finalize requests while workers are stopped
- workers can restart without changing API request handling
- no caller-visible finalize contract changes were introduced

## Non-Goals

- This spec does not choose the infra platform or process manager.
- This spec does not require a dedicated worker-only repository.
- This spec does not authorize adding new public HTTP surfaces for finalize.
