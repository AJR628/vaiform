# FINALIZE_RUNTIME_TOPOLOGY_SPEC

- Status: CANONICAL
- Owner repo: backend
- Source of truth for: current and target finalize runtime roles, process boundaries, entrypoints, worker/API separation rules, and health/startup ownership
- Canonical counterpart/source: `docs/FINALIZE_FACTORY_CONVERSION_PLAN.md`, `docs/FINALIZE_OBSERVABILITY_SPEC.md`
- Last verified against: backend repo on 2026-03-28

## Proven Current Topology

- One HTTP API process is started from `server.js`: `server.js:27-43`.
- API startup no longer boots finalize execution from `src/app.js`; the Express app composes HTTP middleware and routes only: `src/app.js:1-292`.
- Finalize worker startup is now explicit and separate:
  - repo runtime module: `src/workers/story-finalize.worker.js:1-49`
  - process entrypoint: `story-finalize.worker.js:1-14`
  - npm scripts: `package.json:25-40`
- The worker owns the drain/claim loop by starting the runner explicitly through `ensureStoryFinalizeRunner({ keepProcessAlive: true })`: `src/workers/story-finalize.worker.js:6-44`, `src/services/story-finalize.runner.js:30-53`, `src/services/story-finalize.runner.js:335-342`.
- The API finalize route no longer nudges execution ownership directly; it admits/replays/conflicts and returns the prepared response: `src/routes/story.routes.js:970-1084`.
- Finalize render capacity primary truth is now shared Firestore-backed render leases owned by `executionAttemptId`, while the local `RENDER_SLOT_LIMIT` semaphore remains a secondary in-process safety guard: `src/services/finalize-control.service.js`, `src/services/story.service.js:2613-2624`, `src/utils/render.semaphore.js:1-23`.

## Target Design Decision

The conversion target has three runtime responsibilities:

1. API/front desk
2. Queue/durable state substrate
3. Finalize worker/factory floor

## Current API Role

### Meaning

The API role owns:

- finalize front-door auth
- request validation
- idempotency admission
- usage reserve/reject decisions
- durable enqueue creation
- fast caller-facing finalize responses
- caller-facing recovery/readback routes

Current evidence:

- finalize front door and auth: `src/routes/story.routes.js:35-36`, `src/routes/story.routes.js:970-1084`
- request validation: `src/routes/story.routes.js:973-976`
- idempotency admission and reserve/reject/enqueue: `src/middleware/idempotency.firestore.js:33-132`, `src/services/story-finalize.attempts.js:364-593`
- recovery/readback HTTP surfaces: `src/routes/story.routes.js:1183-1213`, `src/controllers/shorts.controller.js:95-295`

### Explicit non-ownership

The API role does not:

- claim finalize jobs
- execute finalize worker stages
- own worker leases
- own render concurrency

### Current entrypoint

- `server.js` remains the API entrypoint unless a later replacement doc changes that.
- `src/app.js` remains the HTTP app composition owner.

## Current Worker Role

### Meaning

The worker role owns:

- claiming queued finalize jobs
- stage execution
- heartbeats / leases
- retry scheduling
- settlement completion
- updates to canonical `jobState` and embedded execution-attempt lineage on the durable finalize job doc
- reaping shared render/provider leases through the finalize control service

Current evidence:

- explicit worker runtime startup: `src/workers/story-finalize.worker.js:6-49`, `story-finalize.worker.js:1-14`
- queued-attempt claim / lease / heartbeat / retry / settle: `src/services/story-finalize.attempts.js:1025-1148`, `src/services/story-finalize.runner.js:61-304`

### Explicit non-ownership

The worker role does not:

- bind public HTTP for caller traffic
- perform auth or request validation for mobile/web clients
- emit caller-facing response envelopes

### Current entrypoint

- Dedicated worker runtime module: `src/workers/story-finalize.worker.js`
- Dedicated process entrypoint: `story-finalize.worker.js`
- Explicit npm script: `npm run start:worker:finalize`

## Target Queue / Substrate Role

- Firestore remains the durable queue/state substrate for this conversion, per `docs/FINALIZE_FACTORY_CONVERSION_PLAN.md`.
- The queue/substrate role does not expose caller HTTP.
- In Phase 3, the existing durable `idempotency/<uid:attemptId>` doc keyspace becomes the canonical `FinalizeJob` storage truth.
- In Phase 3, `executionAttempts[]` plus `currentExecution` are embedded on that same durable doc, and `storyFinalizeSessions` remains a helper/lock record only.
- In Phase 4, Firestore also becomes the shared finalize pressure-control substrate through one backend-owned finalize control service.
- Phase 4 shared render leases are owned by `executionAttemptId`.
- Phase 4 overload gating is evaluated on new finalize admissions only, after replay/conflict checks and before billing reserve plus enqueue.
- Phase 5 storage/recovery tightening and Phase 6 threshold tuning/load testing remain later-phase work.

## Process-Boundary Rules

### API process

- binds HTTP
- exposes existing health routes
- may emit queue-admission metrics
- must not execute finalize worker stages after Finalize Factory Phase 2

### Worker process

- does not bind public HTTP
- may optionally expose internal-only health if a deployment platform requires it, but public caller traffic must never rely on it
- health authority is worker heartbeat plus queue-processing signals defined in `docs/FINALIZE_OBSERVABILITY_SPEC.md`
- shared render/provider pressure truth is not owned by worker local memory; it is read/written through the Firestore-backed finalize control service

## Health / Startup Ownership

### API health

- API health remains tied to API route availability, not to finalize worker activity.
- Existing API health routes remain the public health surface: `docs/ACTIVE_SURFACES.md:40-43`.

### Worker health

- Worker health after Finalize Factory Phase 2 is owned by:
  - worker process liveness
  - worker heartbeat metrics/events
  - lease freshness
  - successful claim-loop activity
- Current worker health evidence lives in:
  - worker runtime start/stop: `src/workers/story-finalize.worker.js:6-49`
  - canonical worker events: `src/services/story-finalize.runner.js:64-74`, `src/services/story-finalize.runner.js:110-146`, `src/services/story-finalize.runner.js:268-276`, `src/services/story-finalize.runner.js:310-325`
  - lease freshness / missed heartbeat / stale-work reaping: `src/services/story-finalize.attempts.js:956-1012`, `src/services/story-finalize.attempts.js:1116-1148`

### Startup rule

- Starting the API must not implicitly start finalize execution after Finalize Factory Phase 2.
- Starting a worker must not require binding the public API listener.

## Finalize Factory Phase 2 Success Definition

Finalize Factory Phase 2 is only complete when all of the following are true:

- `server.js` / `src/app.js` no longer bootstrap finalize execution
- worker startup is explicit and separate
- API can admit finalize requests while workers are stopped
- accepted finalize work can remain queued while workers are stopped and later complete after a worker starts, with no client resubmission
- workers can restart without changing API request handling
- no caller-visible finalize contract changes were introduced

## Phase 4 Runtime Clarifications

- Shared render capacity is enforced at the expensive render stage inside `finalizeStory()`, not as a route-level blocking behavior and not as a worker-process-only memory ceiling: `src/services/story.service.js:2613-2624`.
- Local worker inflight pacing remains useful for per-process safety, but it is not the primary render-capacity truth: `src/services/story-finalize.runner.js:26-33`, `src/services/story-finalize.runner.js:252-304`.
- Finalize-relevant OpenAI, story-search, and TTS pressure now use shared Firestore-backed admission/cooldown truth first and retain their existing local guards as secondary process safety: `src/services/story.llm.service.js:152-184`, `src/services/story.service.js:98-212`, `src/services/tts.service.js:166-345`, `src/services/tts.service.js:489-657`.
- `/diag/finalize-control-room` must expose shared-system pressure truth separately from local-process observability: `src/routes/diag.routes.js:66-81`.

## Non-Goals

- This spec does not choose the infra platform or process manager.
- This spec does not require a dedicated worker-only repository.
- This spec does not authorize adding new public HTTP surfaces for finalize.
