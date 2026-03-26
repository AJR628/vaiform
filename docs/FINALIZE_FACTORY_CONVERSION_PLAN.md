# FINALIZE_FACTORY_CONVERSION_PLAN

- Status: CANONICAL
- Owner repo: backend
- Source of truth for: target finalize factory architecture, frozen external contracts, phase-by-phase implementation authority, and required proof artifacts
- Canonical counterpart/source: `docs/FINALIZE_CURRENT_STATE_AUDIT.md`, `docs/FINALIZE_JOB_MODEL_SPEC.md`, `docs/FINALIZE_OBSERVABILITY_SPEC.md`, `docs/FINALIZE_RUNTIME_TOPOLOGY_SPEC.md`
- Last verified against: backend repo plus current mobile repo on 2026-03-26

## Purpose

This document turns the finalize audit into an implementation authority for later phases.

Current-state truth lives in `docs/FINALIZE_CURRENT_STATE_AUDIT.md`.

## Phase 0 Design Decisions

These are design decisions for the conversion target. They are not claims that the current code already works this way.

### 1. Durable queue substrate

- Decision: Firestore remains the durable queue substrate for this conversion through Phase 6.
- Why: the current finalize queue, idempotency state, usage reservation, stale-work recovery, source-controlled index, and contract tests are already Firestore-backed: `src/services/story-finalize.attempts.js:395-444`, `src/services/story-finalize.attempts.js:860-1012`, `firestore.indexes.json:11-19`, `test/contracts/phase4a.contract.test.js:920-1015`.
- Scope implication: later phases may restructure the Firestore model, but they should not swap queue technologies during this conversion unless a separate decision doc replaces this one.

### 2. Job vs attempt model

- Decision: the target model introduces a canonical `FinalizeJob` plus child `FinalizeExecutionAttempt` lineage.
- Compatibility rule: the current client-visible `attemptId` field remains frozen and maps to the stable `FinalizeJob` identity for external callers, even if internal worker attempts multiply beneath it.
- Why: current callers already key recovery on one stable admission identity, while a factory system needs explicit retry lineage beneath that identity: `client/screens/story-editor/model.ts:63-72`, `src/services/story-finalize.attempts.js:305-319`, `src/services/story-finalize.attempts.js:817-858`.

### 3. Canonical current render status after conversion

- Decision: the canonical backend source of truth for current finalize status after conversion is the `FinalizeJob` record defined in `docs/FINALIZE_JOB_MODEL_SPEC.md`.
- Compatibility rule: `GET /api/story/:sessionId` remains the canonical caller-facing recovery read path, and `renderRecovery` remains an additive projection derived from job truth.
- Why: current callers already depend on `GET /api/story/:sessionId`, but the current backend truth is fragmented across attempts, session JSON, usage, and shorts: `src/routes/story.routes.js:1183-1213`, `src/services/story.service.js:436-462`, `src/services/story-finalize.attempts.js:395-418`.

### 4. Active web creative surfaces frozen alongside mobile

- Decision: the external contract freeze applies to:
  - mobile `POST /api/story/finalize`
  - mobile `GET /api/story/:sessionId`
  - mobile `/api/shorts/:jobId` and `/api/shorts/mine` readback behavior
  - web creative `POST /api/story/finalize`
  - web creative `GET /api/story/:sessionId`
  - web creative redirect/readback expectation via `session.finalVideo.jobId` into `/my-shorts.html?id=<jobId>`
- Why: the active web creative caller still hits finalize and recovery today: `docs/ACTIVE_SURFACES.md:83-85`, `web/public/js/pages/creative/creative.article.mjs:3998-4065`.

### 5. API-contract finalize metadata exceptions

- Decision: the API-contract layer must explicitly document both established top-level finalize exceptions:
  - top-level `shortId`
  - top-level `finalize = { state, attemptId, pollSessionId }`
- Why: both are live route behavior today: `src/services/story-finalize.attempts.js:105-122`, `src/services/story-finalize.attempts.js:517-587`.

## Out Of Scope For This Conversion

- Product UX redesign
- Billing model redesign
- Script-writing or storyboard-generation redesign
- General library redesign beyond readback-stability clarifications
- Mobile navigation/state rewrite
- Feature expansion unrelated to finalize durability/observability/runtime separation
- Casual caller-visible finalize contract changes
- Queue technology migration away from Firestore during this conversion

## Frozen External Contracts

These contracts stay stable unless later repo evidence proves a change is unavoidable.

### POST /api/story/finalize

- Request shape remains `{ sessionId }` plus `X-Idempotency-Key`: `src/middleware/idempotency.firestore.js:33-55`, `client/api/client.ts:804-823`, `web/public/js/pages/creative/creative.article.mjs:4004-4013`.
- Accepted work continues to return quickly with accepted finalize state instead of blocking full render completion: `src/routes/story.routes.js:964-1021`, `src/services/story-finalize.attempts.js:517-526`.
- Same-key replay, same-session different-key conflict, and terminal success replay semantics stay stable: `src/services/story-finalize.attempts.js:527-593`.

### GET /api/story/:sessionId

- Remains the canonical caller-facing finalize recovery route for mobile and active web creative: `client/screens/story-editor/useStoryEditorFinalize.ts:177-249`, `web/public/js/pages/creative/creative.article.mjs:3863-3910`.
- `renderRecovery` remains additive and keyed to the stable external `attemptId`: `src/services/story.service.js:349-409`.

### Additive finalize metadata and billing fields

- Top-level `shortId` stays caller-visible on terminal success replay: `src/services/story-finalize.attempts.js:98-103`, `src/services/story-finalize.attempts.js:580-586`.
- Top-level `finalize` stays caller-visible on accepted/conflict responses: `src/services/story-finalize.attempts.js:105-122`, `src/services/story-finalize.attempts.js:517-560`.
- Additive `data.billing` stays nested under `data`: `src/services/story-finalize.attempts.js:580-586`.

### Short / library eventual-readback behavior

- Current mobile short-detail retry behavior and list fallback stay stable: `client/screens/short-detail/useShortDetailAvailability.ts:148-269`.
- Current bridge behavior for `GET /api/shorts/:jobId` returning `404 NOT_FOUND` while availability settles stays stable: `src/controllers/shorts.controller.js:173-180`.
- Current web creative redirect via `finalVideo.jobId` stays stable: `web/public/js/pages/creative/creative.article.mjs:3847-3860`.

## Phase Sequence

- Phase 0: Current-state truth freeze
- Phase 1: Observability/control-room foundation
- Phase 2: API/worker role split
- Phase 3: Durable queue/job lifecycle conversion
- Phase 4: Global concurrency/provider throttle/backpressure
- Phase 5: State/storage/recovery tightening
- Phase 6: Load testing, thresholds, and runbooks

## Phase 0 — Current-State Truth Freeze

- Objective: publish exact current truth and exact target authority docs before runtime changes begin.
- Why it matters: current truth is split across route code, Firestore attempt logic, session JSON recovery, mobile recovery hooks, and active web creative behavior: `src/routes/story.routes.js:964-1213`, `src/services/story-finalize.attempts.js:395-1012`, `src/services/story.service.js:349-462`, `client/screens/story-editor/useStoryEditorFinalize.ts:164-477`, `web/public/js/pages/creative/creative.article.mjs:3863-4065`.
- Scope / blast radius: docs only, cross-repo verification.
- Ownership: cross-repo, backend-owned spec set.
- Deliverables:
  - `docs/FINALIZE_CURRENT_STATE_AUDIT.md`
  - `docs/FINALIZE_FACTORY_CONVERSION_PLAN.md`
  - `docs/FINALIZE_OBSERVABILITY_SPEC.md`
  - `docs/FINALIZE_JOB_MODEL_SPEC.md`
  - `docs/FINALIZE_RUNTIME_TOPOLOGY_SPEC.md`
  - aligned front-door/contract doc updates
- Acceptance criteria:
  - an engineer can explain current finalize end to end without opening code
  - target job model, observability contract, and runtime topology are explicit
  - frozen external contracts are listed and evidenced
- What stays frozen: all runtime behavior.
- What may change: docs only.
- Dependencies: none.
- Required proof artifacts:
  - exact file:line citations in the Phase 0 doc set
  - drift callouts for any contract/doc mismatch
  - front-door docs updated to point at the new spec set

## Phase 1 — Observability/Control-Room Foundation

- Objective: add durable, queryable visibility before changing execution machinery.
- Why it matters: current observability is still stdout-only on backend and in-memory only on mobile: `docs/INCIDENT_TRACE_RUNBOOK.md:12-16`.
- Exact motivating evidence:
  - backend request-scoped logging exists but is event/log based, not dashboard/metric based: `src/observability/logger.js:18-39`
  - finalize runner/attempt modules do not expose queue depth, worker saturation, or provider pain metrics: `src/services/story-finalize.runner.js:127-156`, `src/services/story-finalize.attempts.js:803-810`
- Scope / blast radius: backend observability modules, dashboards, runbooks, possibly additive mobile diagnostics.
- Ownership: backend primary, cross-repo verification.
- Deliverables:
  - metrics/event implementation matching `docs/FINALIZE_OBSERVABILITY_SPEC.md`
  - dashboard definitions
  - alert definitions
  - updated incident/runbook docs
- Acceptance criteria:
  - operators can answer what failed, where, and whether the queue/workers/providers are unhealthy
  - queue age/depth, active workers, retry reasons, and billing mismatches are visible without code inspection
- What stays frozen:
  - finalize HTTP contract
  - `GET /api/story/:sessionId` recovery contract
  - short readback behavior
- What may change:
  - logging structure
  - metrics emission
  - dashboard/runbook docs
- Dependencies: Phase 0 docs.
- Required proof artifacts:
  - metrics schema test or snapshot
  - event-name contract doc
  - dashboard screenshots or exported definitions
  - alert policy definitions
  - updated `docs/INCIDENT_TRACE_RUNBOOK.md`

## Phase 2 — API/Worker Role Split

- Objective: stop running finalize execution as an API-owned in-process singleton.
- Why it matters: the API app currently boots the runner directly: `src/app.js:32-33`.
- Exact motivating evidence:
  - runner is a process-global singleton: `src/services/story-finalize.runner.js:18`, `src/services/story-finalize.runner.js:182-191`
  - API still owns runner startup and notification: `src/app.js:32-33`, `src/routes/story.routes.js:984-1000`
- Scope / blast radius: backend runtime entrypoints, deploy scripts/docs, worker lifecycle docs.
- Ownership: backend.
- Deliverables:
  - dedicated worker entrypoint and startup model matching `docs/FINALIZE_RUNTIME_TOPOLOGY_SPEC.md`
  - API no longer auto-boots finalize execution
  - worker separation documentation
- Acceptance criteria:
  - API can serve finalize admission with workers down or saturated
  - worker can restart independently without HTTP ownership confusion
  - ownership is obvious from repo/runtime structure
- What stays frozen:
  - finalize HTTP contract
  - job identity and replay semantics
  - caller-facing recovery contract
- What may change:
  - process boundaries
  - boot scripts
  - worker loop implementation
- Dependencies: Phase 1 observability foundation.
- Required proof artifacts:
  - startup topology doc update
  - worker separation test or verification script
  - proof that API process no longer executes finalize work
  - health/heartbeat proof for worker role

## Phase 3 — Durable Queue/Job Lifecycle Conversion

- Objective: convert the current Firestore attempt model into the target `FinalizeJob` plus `FinalizeExecutionAttempt` lifecycle.
- Why it matters: the current single-doc attempt model cannot express retry lineage cleanly while preserving one stable caller identity: `src/services/story-finalize.attempts.js:305-319`, `src/services/story-finalize.attempts.js:817-858`.
- Exact motivating evidence:
  - one durable attempt doc currently owns admission, running state, retry schedule, and settlement: `src/services/story-finalize.attempts.js:136-161`, `src/services/story-finalize.attempts.js:395-418`, `src/services/story-finalize.attempts.js:764-781`
  - retries currently rewrite the same doc rather than create lineage: `src/services/story-finalize.attempts.js:817-858`
- Scope / blast radius: backend job storage, worker claim logic, status projection.
- Ownership: backend with mobile/web contract verification.
- Deliverables:
  - job/attempt storage implementation matching `docs/FINALIZE_JOB_MODEL_SPEC.md`
  - canonical lifecycle state machine
  - dead-letter and stuck-job handling
- Acceptance criteria:
  - one stable external job identity remains replayable
  - retry lineage is durable and inspectable
  - queue backlog and terminal failures are easy to query
- What stays frozen:
  - external `attemptId` semantics
  - `renderRecovery` contract
  - client recovery/readback paths
- What may change:
  - internal Firestore collections/doc shapes
  - claim/lease/retry implementation
- Dependencies: Phase 2 worker split.
- Required proof artifacts:
  - state-machine tests
  - idempotency/replay tests
  - retry/dead-letter tests
  - migration/backfill plan if data shape changes
  - doc updates to job model and current-state audit

## Phase 4 — Global Concurrency / Provider Throttle / Backpressure

- Objective: replace process-local concurrency and provider pressure handling with system-wide controls.
- Why it matters: render, OpenAI, story-search, and TTS pressure are all currently managed in process memory: `src/utils/render.semaphore.js:1-23`, `src/services/story.llm.service.js:160-170`, `src/services/story.service.js:100-130`, `src/services/tts.service.js:44-54`.
- Exact motivating evidence:
  - render limit is per-process and explicitly documented as such: `src/utils/render.semaphore.js:5-8`
  - provider admission/cooldown state is process-local: `src/services/story.service.js:67-71`, `src/services/story.service.js:120-130`
- Scope / blast radius: worker scheduler, provider wrappers, queue admission behavior.
- Ownership: backend.
- Deliverables:
  - global render-capacity policy
  - provider throttle policy
  - overload/backpressure behavior
- Acceptance criteria:
  - scaling workers increases capacity predictably
  - provider pain does not multiply blindly with worker count
  - overload produces bounded queueing and stable caller behavior
- What stays frozen:
  - external finalize contract
  - external billing semantics
- What may change:
  - internal concurrency governors
  - retry pacing
  - provider wrappers
- Dependencies: Phase 3 job model.
- Required proof artifacts:
  - concurrency policy doc
  - saturation test results
  - provider throttle tests
  - alert/dash updates for saturation signals

## Phase 5 — State/Storage/Recovery Tightening

- Objective: make operational render truth explicit and reduce accidental coupling to the broader session blob.
- Why it matters: `renderRecovery` currently lives inside `story.json` while job truth, usage truth, and short truth live elsewhere: `src/services/story.service.js:414-417`, `src/services/story.service.js:436-462`, `src/services/story.service.js:2415-2455`.
- Exact motivating evidence:
  - current render status is fragmented across multiple stores: `docs/FINALIZE_CURRENT_STATE_AUDIT.md`
  - client recovery currently depends on a session projection, not a canonical job record: `client/screens/story-editor/useStoryEditorFinalize.ts:200-225`
- Scope / blast radius: backend storage boundaries and recovery projection rules.
- Ownership: backend with cross-repo verification.
- Deliverables:
  - canonical status read path
  - projection rules from job truth into `renderRecovery`
  - clarified relation between job truth and short truth
- Acceptance criteria:
  - current render status is easy to inspect from one canonical backend source
  - client recovery remains stable without hidden fallback behavior
- What stays frozen:
  - `GET /api/story/:sessionId`
  - `renderRecovery` caller contract
  - short-detail and library behavior
- What may change:
  - internal storage ownership
  - projection pipeline
- Dependencies: Phase 3 durable job model.
- Required proof artifacts:
  - canonical-status tests
  - projection tests for `renderRecovery`
  - billing/readback consistency tests
  - doc updates to current-state audit and job spec

## Phase 6 — Load Testing, Thresholds, And Runbooks

- Objective: replace intuition with measured capacity and operating thresholds.
- Why it matters: current docs prove the per-process limitation, but do not prove safe multi-worker thresholds: `docs/CROSS_REPO_PRODUCTION_HARDENING_PLAN.md:579-583`.
- Exact motivating evidence:
  - current runner/process model is local: `src/app.js:32-33`, `src/utils/render.semaphore.js:1-23`
  - current short-detail retry behavior implies caller-visible eventual consistency that must still be observed under load: `client/screens/short-detail/useShortDetailAvailability.ts:130-269`
- Scope / blast radius: verification, infra sizing docs, runbooks.
- Ownership: backend primary, cross-repo verification.
- Deliverables:
  - load-test scripts
  - threshold report
  - scaling runbook
  - must-fix list for any observed bottlenecks
- Acceptance criteria:
  - safe queue depth and worker counts are documented
  - worker restart, provider slowdown, retry storm, and readback behavior are measured
  - scaling levers are explicit
- What stays frozen:
  - external finalize contract
  - caller recovery/readback semantics
- What may change:
  - infra sizing
  - alert thresholds
  - runbooks
- Dependencies: Phases 1 through 5.
- Required proof artifacts:
  - load-test scripts and results
  - threshold doc with green/yellow/red ranges
  - worker restart test results
  - billing correctness verification under failure
  - updated runbooks and dashboards

## Unresolved Decisions

- None currently block Phase 1. The queue substrate, job-vs-attempt model, canonical status owner, active web freeze scope, and finalize API-contract exceptions are all explicitly decided in this Phase 0 doc set.
- If a later phase needs to overturn one of those decisions, it must replace this document with a new decision record instead of drifting silently.
