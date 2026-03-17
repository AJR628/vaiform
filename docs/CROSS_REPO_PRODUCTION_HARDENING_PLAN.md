# CROSS_REPO_PRODUCTION_HARDENING_PLAN

- Status: CANONICAL
- Owner repo: backend
- Source of truth for: phased cross-repo execution order for production hardening and anti-drift work
- Canonical counterpart/source: mobile repo `docs/MOBILE_USED_SURFACES.md` for caller truth, backend repo `docs/MOBILE_BACKEND_CONTRACT.md` for contract truth, backend repo `docs/MOBILE_HARDENING_PLAN.md` for route-hardening status
- Last verified against: both repos on 2026-03-16

## Purpose

This document does not replace the backend contract docs or the mobile caller-truth docs. It exists to answer a different question:

- what order the repos should be hardened in
- what must be proven before each phase starts
- what files and docs own each truth surface
- how to keep future agent work from drifting across duplicate or ambiguous paths

## Non-Goals

- It is not a second route contract document.
- It does not redefine the mobile-used surface set already tracked in `docs/MOBILE_BACKEND_CONTRACT.md` and mobile repo `docs/MOBILE_USED_SURFACES.md`.
- It does not mark backend `docs/MOBILE_HARDENING_PLAN.md` obsolete. That doc remains the route-level hardening status ledger for the mobile-used backend surface.

## Current Proven Wiring Snapshot

### Auth bootstrap

- Mobile entrypoint: `client/contexts/AuthContext.tsx:78-190`
- Mobile transport: `client/api/client.ts:147-260`, `client/api/client.ts:509-523`
- Backend routes: `src/routes/users.routes.js:16-40`, `src/routes/usage.routes.js:1-9`
- Backend services: `src/services/user-doc.service.js:5-34`, `src/services/usage.service.js:137-167`
- Proven behavior:
  - app readiness waits for Firebase auth, then `POST /api/users/ensure`, then `GET /api/usage`
  - missing provisioning or usage fetch signs the user back out instead of entering a half-ready app

### Story create -> generate -> plan -> search

- Mobile entrypoints:
  - `client/screens/HomeScreen.tsx:79-137`
  - `client/screens/ScriptScreen.tsx:64-235`
- Mobile transport: `client/api/client.ts:566-676`
- Backend routes: `src/routes/story.routes.js:121-175`, `src/routes/story.routes.js:479-518`
- Backend services: `src/services/story.service.js:323-392`, `src/services/story.service.js:427-440`, `src/services/story.service.js:665-760`
- Proven behavior:
  - create flow is `start` then `generate`
  - storyboard flow is `plan` then `search`
  - `generate` and `plan` are guarded by `enforceScriptDailyCap(300)` in `src/routes/story.routes.js:151-175` and `src/routes/story.routes.js:480-497`

### Editor, clip search, and caption preview

- Mobile entrypoints:
  - `client/screens/ScriptScreen.tsx:162-235`
  - `client/screens/StoryEditorScreen.tsx:459-917`
  - `client/screens/ClipSearchModal.tsx:49-105`
  - `client/hooks/useCaptionPreview.ts:45-220`
- Backend routes:
  - `src/routes/story.routes.js:500-728`
  - `src/routes/caption.preview.routes.js:109-313`
- Backend services:
  - `src/services/story.service.js:706-942`
- Proven behavior:
  - `update-beat-text`, `delete-beat`, `search-shot`, and `update-shot` are mobile-used mutations
  - caption preview is server-measured for mobile and keyed by `x-client: mobile`
  - caption preview already has auth, request-size, and per-user rate limiting

### Finalize and recovery

- Mobile entrypoint: `client/screens/StoryEditorScreen.tsx:930-1149`
- Mobile transport: `client/api/client.ts:715-823`
- Backend route: `src/routes/story.routes.js:821-864`
- Backend middleware: `src/middleware/idempotency.firestore.js:67-400`
- Backend services: `src/services/story.service.js:211-318`, `src/services/story.service.js:2303-2377`
- Backend process limits: `server.js:27-43`, `src/utils/render.semaphore.js:1-22`
- Proven behavior:
  - finalize still blocks the HTTP request until render completion
  - backend reserves usage seconds before render, settles after success, and releases on 5xx
  - mobile reuses the same `X-Idempotency-Key` for retry and recovery polling
  - recovery truth is additive session state on `GET /api/story/:sessionId`

### Library and short detail

- Mobile entrypoints:
  - `client/screens/LibraryScreen.tsx:80-142`
  - `client/screens/ShortDetailScreen.tsx:143-530`
- Backend routes: `src/routes/shorts.routes.js:1-10`
- Backend controller: `src/controllers/shorts.controller.js:5-211`
- Proven behavior:
  - library reads `GET /api/shorts/mine`
  - detail reads `GET /api/shorts/:jobId`
  - detail screen also has a library-list fallback while post-render consistency settles

## Audit Assessment

The prior audit was directionally right on the biggest production risks, but this plan uses repo evidence rather than inheriting its wording.

### Confirmed by code

- Finalize is still synchronous in the request path.
- Backend and mobile have no first-party test files in their source trees.
- Mobile has no `eas.json`, no `runtimeVersion` or `updates` block in `app.json`, and no mobile CI workflow.
- Request IDs exist, but request context is not propagated through an async context layer.
- The mobile runtime path is the hand-written API client, while the React Query client remains mostly unused in active flows.

### Corrected or tightened from code truth

- File-size risk is worse than the pasted audit suggested in line count terms:
  - backend `src/utils/ffmpeg.video.js`: 2547 lines
  - backend `src/services/story.service.js`: 2149 lines
  - backend `src/routes/caption.preview.routes.js`: 1792 lines
  - mobile `client/screens/StoryEditorScreen.tsx`: 1680 lines
  - mobile `client/screens/ShortDetailScreen.tsx`: 819 lines
  - mobile `client/api/client.ts`: 735 lines
- Console usage remains high in hot paths:
  - backend `src/**`: 538 console calls
  - mobile `client/**`: 66 console calls
- The mobile `server/` subtree is not random dead code; it is still part of the repo's Replit build/deploy path via `.replit:7-10` and `package.json:6-11`, but it is not part of the client runtime path that calls the backend.

## Phase Map

1. Truth Freeze And Front Door Cleanup
2. Contract And Error Semantics Hardening
3. Request-Scoped Observability And Diagnostics
4. Active-Path Tests And CI
5. Admission Control And Expensive-Route Determinism
6. Render Isolation And Async Completion
7. Mobile Surface Consolidation
8. Release Operations And Runbooks

## Phase 1 - Truth Freeze And Front Door Cleanup

### 1. Goal

Make it easy for any engineer or agent to identify the live mobile path, the live backend contract path, and the non-canonical or historical paths that should not drive edits.

### 2. In-scope flow(s)

- Cross-repo docs ownership
- Mobile transport/front-door ownership
- Backend mobile-used route ownership
- Repo-level "where to start" guidance

### 3. Mobile entrypoints involved

- `client/App.tsx:9-56`
- `client/api/client.ts:1-823`
- `client/lib/query-client.ts:1-79`
- `docs/DOCS_INDEX.md`
- `docs/MOBILE_USED_SURFACES.md`

### 4. Backend routes involved

- No runtime behavior change in this phase.
- Documentation scope is derived from mounted routes in `src/app.js:213-288`.

### 5. Current wiring summary

- Mobile requests flow through `client/api/client.ts`.
- `QueryClientProvider` is mounted globally, but active screens do not use React Query for the traced mobile-used backend routes.
- Backend canonical docs already exist, but there is no single execution-order document for cross-repo production hardening.
- Historical docs volume in backend `docs/archive` and `docs/_archive` increases the chance of future drift unless the front door stays explicit.

### 6. Proven issues / risks

- Engineers can still start from the wrong layer because two mobile data-access patterns are present.
- The mobile repo still contains a separate Replit/Express deployment surface in `server/`, which is operationally real but not part of the live backend caller path.
- The current docs set explains ownership, but not the phased execution order for anti-drift hardening work.

### 7. Proposed plan in order

1. Keep this document backend-owned and explicitly mark its relationship to the existing contract and caller-truth docs.
2. Add this document to the backend and mobile docs front doors.
3. Add a small "transport ownership" note to mobile docs if later work retires or promotes React Query.
4. Create a short archive/active policy for future audits so new plans do not become accidental SSOT.

### 8. Files likely to change

- backend `README.md`
- backend `docs/DOCS_INDEX.md`
- backend `docs/CROSS_REPO_PRODUCTION_HARDENING_PLAN.md`
- mobile `docs/DOCS_INDEX.md`

### 9. Docs that must be checked/updated

- backend `docs/DOCS_INDEX.md`
- backend `README.md`
- mobile `docs/DOCS_INDEX.md`

### 10. Verification steps

- Open backend `README.md` and both repos' `docs/DOCS_INDEX.md` and confirm they all point to the same front door.
- Confirm no route contract details were duplicated outside the existing contract docs.

### 11. Open questions / uncertainties, if any

- None for this phase. The evidence is local and verified.

## Phase 2 - Contract And Error Semantics Hardening

### 1. Goal

Make mobile-used backend mutations return deterministic, debuggable error semantics instead of generic 500 collapse.

### 2. In-scope flow(s)

- Story search
- Beat editing
- Shot search and shot update
- Finalize and short detail mismatch surfaces only where contract semantics are ambiguous

### 3. Mobile entrypoints involved

- `client/screens/ScriptScreen.tsx:162-235`
- `client/screens/StoryEditorScreen.tsx:741-849`
- `client/screens/ClipSearchModal.tsx:49-105`
- `client/screens/ShortDetailScreen.tsx:203-333`

### 4. Backend routes involved

- `POST /api/story/search`
- `POST /api/story/update-beat-text`
- `POST /api/story/delete-beat`
- `POST /api/story/search-shot`
- `POST /api/story/update-shot`
- `GET /api/story/:sessionId`
- `GET /api/shorts/:jobId`

### 5. Current wiring summary

- Routes listed above are live mobile callers in current code.
- Several route handlers still catch all service failures and return generic 500 wrappers.
- `updateBeatText()` reads `session.story?.sentences` before checking whether the loaded session exists.

### 6. Proven issues / risks

- `src/routes/story.routes.js:500-728` collapses domain failures for `search`, `update-shot`, `search-shot`, `delete-beat`, and `update-beat-text`.
- `src/services/story.service.js:910-942` can throw a null-dereference-style failure path instead of a stable `SESSION_NOT_FOUND` or `STORY_REQUIRED` code.
- Mobile recovery and support flows depend on stable `status`, `code`, `message`, and `requestId`, but not all backend routes preserve domain intent today.

### 7. Proposed plan in order

1. Enumerate every service-thrown domain error for the mobile-used story editor/search routes.
2. Add route-level mapping so mobile gets stable 4xx and 404 responses where the failure is not a server fault.
3. Fix `updateBeatText()` null/session guards before changing any mobile messaging.
4. Write one error-code matrix for the mobile-used routes, including retryability and UI handling expectations.
5. Update backend contract docs only after route behavior is verified in code.

### 8. Files likely to change

- `src/routes/story.routes.js`
- `src/services/story.service.js`
- `docs/MOBILE_BACKEND_CONTRACT.md`
- `docs/MOBILE_HARDENING_PLAN.md`
- new backend error matrix doc if split out later

### 9. Docs that must be checked/updated

- backend `docs/MOBILE_BACKEND_CONTRACT.md`
- backend `docs/MOBILE_HARDENING_PLAN.md`
- mobile `docs/MOBILE_USED_SURFACES.md` only if caller handling changes

### 10. Verification steps

- Exercise each live mobile mutation with invalid session, missing prerequisites, and out-of-range indices.
- Confirm mobile receives stable `ok/status/code/message/requestId` outputs via `client/api/client.ts`.
- Re-check that docs list the same codes actually emitted.

### 11. Open questions / uncertainties, if any

- Domain error taxonomy is partly implicit in thrown `Error` messages today. That needs explicit enumeration before edits.

## Phase 3 - Request-Scoped Observability And Diagnostics

### 1. Goal

Make incident tracing deterministic across async boundaries and across the mobile-to-backend handoff.

### 2. In-scope flow(s)

- All mobile-used routes
- Finalize/recovery
- Provider-backed story generation and clip search
- Mobile network failure reporting

### 3. Mobile entrypoints involved

- `client/api/client.ts:77-145`
- `client/contexts/AuthContext.tsx:105-188`
- `client/screens/StoryEditorScreen.tsx:930-1116`
- `client/screens/ShortDetailScreen.tsx:143-530`

### 4. Backend routes involved

- Mounted API routes in `src/app.js:213-288`
- Error handler in `src/middleware/error.middleware.js:15-50`
- Request ID middleware in `src/middleware/reqId.js:4-8`

### 5. Current wiring summary

- Backend sets `req.id` and `X-Request-Id`.
- Success and failure envelopes carry `requestId`.
- Mobile normalization preserves `requestId`.
- Logging remains mostly unstructured console output without request-scoped async context.

### 6. Proven issues / risks

- No `AsyncLocalStorage` usage exists in backend source.
- Hot paths log many freeform strings, which makes cross-request correlation difficult during render failures and provider incidents.
- Mobile has no unified diagnostic surface for recent normalized failures and request IDs.

### 7. Proposed plan in order

1. Add a request context layer that binds `requestId`, `uid`, `sessionId`, `attemptId`, and route metadata.
2. Introduce a structured logger wrapper and a redaction policy.
3. Migrate finalize, auth bootstrap, provider search/generate, and short-detail recovery logs first.
4. Add a mobile-only diagnostics abstraction that stores normalized failures with route, status, code, and requestId.
5. Add one manual incident workflow document: "how to trace a failed finalize or missing short."

### 8. Files likely to change

- `src/middleware/reqId.js`
- new backend logging/context utilities
- hot backend routes and services on mobile-used paths
- `client/api/client.ts`
- new mobile diagnostics module or screen
- backend runbook docs

### 9. Docs that must be checked/updated

- backend `docs/MOBILE_HARDENING_PLAN.md`
- backend `docs/DOCS_INDEX.md` if a new runbook becomes front-door relevant
- mobile `docs/DOCS_INDEX.md` if a local diagnostics note is added

### 10. Verification steps

- Trigger an auth bootstrap failure, a finalize in-progress replay, and a short-detail 404 retry.
- Confirm the same request/attempt context is visible from mobile logs through backend logs.
- Confirm no sensitive tokens, private URLs, or raw provider payloads are logged.

### 11. Open questions / uncertainties, if any

- Structured log sink and deployment destination are not represented in repo code yet. That will need an environment-specific decision later.

## Phase 4 - Active-Path Tests And CI

### 1. Goal

Add a regression net around the actual mobile-used routes and the actual mobile normalization/state paths.

### 2. In-scope flow(s)

- Auth bootstrap
- Usage fetch
- Story create/generate/plan/search
- Editor/search mutations
- Caption preview
- Finalize and recovery
- Library/detail

### 3. Mobile entrypoints involved

- `client/api/client.ts`
- `client/contexts/AuthContext.tsx`
- `client/screens/HomeScreen.tsx`
- `client/screens/ScriptScreen.tsx`
- `client/screens/StoryEditorScreen.tsx`
- `client/screens/ShortDetailScreen.tsx`

### 4. Backend routes involved

- Mobile-used routes listed in backend `docs/MOBILE_BACKEND_CONTRACT.md`

### 5. Current wiring summary

- Backend `package.json:31-35` has checks and lint, but `package.json:27` still sets `test` to `(no tests yet)`.
- Mobile repo has no first-party test files and no CI workflow.
- Backend CI exists in `.github/workflows/ci.yml`, but it does not run a route test suite.

### 6. Proven issues / risks

- Route behavior can drift without a failing test.
- Mobile normalization and recovery logic are complex enough to regress silently.
- The mobile repo has no CI lane to catch type, lint, and future tests together in pull requests.

### 7. Proposed plan in order

1. Stand up backend tests for the active mobile-used route contract only.
2. Add failure-path tests for auth failures, invalid input, insufficient render time, idempotent replay, and session-not-found scenarios.
3. Add mobile unit tests for normalization, render-time helpers, and finalize recovery helpers.
4. Add at least one thin screen-flow test for bootstrap and one for finalize timeout/recovery.
5. Add a mobile CI workflow that runs typecheck, lint, and the new tests.

### 8. Files likely to change

- backend `package.json`
- backend new test directory and fixtures
- backend CI workflow
- mobile `package.json`
- mobile new test setup and test files
- mobile new CI workflow

### 9. Docs that must be checked/updated

- backend `docs/MOBILE_HARDENING_PLAN.md`
- backend `docs/DOCS_INDEX.md` if test docs become a front door
- mobile `docs/DOCS_INDEX.md` if test guidance is added

### 10. Verification steps

- Every active mobile-used route gets at least one success-path and one failure-path test.
- Mobile CI fails if normalization or recovery contract drifts.
- Pull-request automation runs in both repos.

### 11. Open questions / uncertainties, if any

- Test framework choices are still open. The repo evidence only proves the absence of tests, not the preferred runner.

## Phase 5 - Admission Control And Expensive-Route Determinism

### 1. Goal

Reject overload predictably instead of degrading ambiguously when generation, search, caption preview, or finalize traffic spikes.

### 2. In-scope flow(s)

- `POST /api/story/generate`
- `POST /api/story/search`
- `POST /api/story/search-shot`
- `POST /api/story/finalize`
- provider-backed upstream fetches these routes depend on

### 3. Mobile entrypoints involved

- `client/screens/HomeScreen.tsx:79-137`
- `client/screens/ScriptScreen.tsx:126-159`
- `client/screens/ClipSearchModal.tsx:49-80`
- `client/screens/StoryEditorScreen.tsx:1016-1149`

### 4. Backend routes involved

- `src/routes/story.routes.js:150-175`
- `src/routes/story.routes.js:500-635`
- `src/routes/story.routes.js:821-864`
- `src/routes/caption.preview.routes.js:91-113`

### 5. Current wiring summary

- Caption preview already has explicit per-user rate limiting.
- `generate` and `plan` have script-cap gating.
- Finalize has idempotency reservation and a per-process semaphore.
- Search routes have no explicit per-route admission control or provider cooldown behavior.

### 6. Proven issues / risks

- `withRenderSlot()` is single-process only.
- Search/generate upstream failure behavior is partly hidden inside service catch blocks or generic route 500s.
- Provider outages can turn into latency and retry storms instead of fast, clear failures.

### 7. Proposed plan in order

1. Define explicit admission-control policy per expensive route.
2. Add deterministic upstream timeout and error-mapping rules across story generation and provider search.
3. Add provider-level cooldown or circuit-breaker behavior for repeated upstream failures.
4. Extend docs to specify retryable versus non-retryable overload responses.
5. Verify mobile copy and recovery behavior matches those semantics.

### 8. Files likely to change

- `src/routes/story.routes.js`
- `src/services/story.service.js`
- provider services under `src/services/`
- timeout/retry utilities under `src/utils/`
- backend contract docs
- possibly mobile error copy if codes change

### 9. Docs that must be checked/updated

- backend `docs/MOBILE_BACKEND_CONTRACT.md`
- backend `docs/MOBILE_HARDENING_PLAN.md`
- mobile `docs/MOBILE_USED_SURFACES.md` if client handling changes

### 10. Verification steps

- Simulate provider slowdowns and repeated failures.
- Verify route responses stay stable under overload.
- Confirm mobile does not spin indefinitely on failures that should fail fast.

### 11. Open questions / uncertainties, if any

- Final capacity targets are not encoded in repo config yet. That will need stress-test data.

## Phase 6 - Render Isolation And Async Completion

### 1. Goal

Remove the largest production risk by taking render completion off the long-lived request path.

### 2. In-scope flow(s)

- `POST /api/story/finalize`
- `GET /api/story/:sessionId`
- short creation and availability
- usage reservation/settlement
- render recovery

### 3. Mobile entrypoints involved

- `client/screens/StoryEditorScreen.tsx:958-1149`
- `client/screens/ShortDetailScreen.tsx:143-333`
- `client/api/client.ts:715-823`

### 4. Backend routes involved

- `POST /api/story/finalize`
- `GET /api/story/:sessionId`
- `GET /api/shorts/:jobId`

### 5. Current wiring summary

- Backend already has the core semantics needed for async finalize:
  - idempotency key
  - usage reservation and settlement
  - render recovery state
  - same-attempt polling in mobile
- The remaining problem is that `finalizeStory()` still performs the whole pipeline before the response completes.

### 6. Proven issues / risks

- `server.js:32-39` raises timeouts as a mitigation, not a scale fix.
- `src/routes/story.routes.js:821-864` still awaits `finalizeStory()` inline.
- `src/utils/render.semaphore.js:1-22` only protects a single process.
- Long finalize requests increase fairness, throughput, and recovery ambiguity risks under real load.

### 7. Proposed plan in order

1. Preserve current finalize semantics while changing completion to async under the hood.
2. Split finalize into reserve/enqueue/respond, then process in a background worker.
3. Keep `renderRecovery` and idempotency as the continuity layer so mobile changes stay minimal.
4. Add explicit job status or keep `GET /api/story/:sessionId` as the primary polling source, but choose one canonical poll surface.
5. Update short creation/detail bridge only after async finalize truth is stable.

### 8. Files likely to change

- `src/routes/story.routes.js`
- `src/middleware/idempotency.firestore.js`
- `src/services/story.service.js`
- render/worker utilities and job storage
- mobile finalize and recovery helpers
- backend contract and hardening docs

### 9. Docs that must be checked/updated

- backend `docs/MOBILE_BACKEND_CONTRACT.md`
- backend `docs/MOBILE_HARDENING_PLAN.md`
- backend `docs/DOCS_INDEX.md` if a worker/runbook doc becomes front-door relevant
- mobile `docs/MOBILE_USED_SURFACES.md`

### 10. Verification steps

- Finalize returns quickly with stable attempt identity.
- A completed async job settles billing once and only once.
- Mobile can recover after timeout, backgrounding, or process restart without inventing a new attempt.
- Shorts detail availability is still understandable and traceable.

### 11. Open questions / uncertainties, if any

- Worker/runtime placement is not yet chosen in repo code. The plan should preserve current contract semantics regardless of implementation choice.

## Phase 7 - Mobile Surface Consolidation

### 1. Goal

Reduce agent confusion inside the mobile repo by separating transport, state orchestration, and large-screen UI responsibilities.

### 2. In-scope flow(s)

- Story editor orchestration
- Short detail eventual consistency and asset probing
- API client layering
- React Query versus hand-written client ownership
- Replit server/build surface classification

### 3. Mobile entrypoints involved

- `client/screens/StoryEditorScreen.tsx:459-1680`
- `client/screens/ShortDetailScreen.tsx:143-819`
- `client/api/client.ts:1-823`
- `client/lib/query-client.ts:1-79`
- `server/index.ts:1-220`
- `.replit:7-79`

### 4. Backend routes involved

- No new backend routes in this phase.
- Changes are about keeping mobile consumption understandable against the existing backend surface.

### 5. Current wiring summary

- The screen layer currently owns large chunks of transport, recovery, rendering, and local state coordination.
- QueryClient exists, but active data fetching does not use it for the mobile-used backend routes.
- The repo also still contains a separate server/build surface for Expo/Replit deployment workflows.

### 6. Proven issues / risks

- Very large mobile files slow safe refactors and increase agent drift.
- Two client-side data-layer patterns coexist without a single declared winner.
- The `server/` subtree can be mistaken for part of the live backend integration path unless its role is clearly classified.

### 7. Proposed plan in order

1. Pick one ownership model for mobile backend data access: keep the hand-written client or actively migrate to React Query. Do not leave both half-live.
2. Split `StoryEditorScreen` by responsibility: finalize orchestration, caption placement persistence, preview coordination, and deck UI.
3. Split `ShortDetailScreen` by responsibility: fetch/retry state, media reachability diagnostics, and playback UI.
4. Classify the mobile `server/` subtree explicitly as dev/build/deployment support, not backend contract truth.
5. Update mobile docs only after the live ownership decision is made.

### 8. Files likely to change

- `client/screens/StoryEditorScreen.tsx`
- `client/screens/ShortDetailScreen.tsx`
- `client/api/client.ts`
- `client/lib/query-client.ts`
- mobile docs around active surfaces and repo front door

### 9. Docs that must be checked/updated

- mobile `docs/MOBILE_USED_SURFACES.md`
- mobile `docs/DOCS_INDEX.md`
- backend docs only if caller behavior changes

### 10. Verification steps

- No single mobile screen owns transport, recovery, and full UI orchestration after the split.
- The chosen data-access model is obvious from `client/App.tsx` and docs.
- Engineers can distinguish client runtime code from build/deployment helper code quickly.

### 11. Open questions / uncertainties, if any

- The repo does not yet prove whether the team wants React Query adoption or deliberate removal. That decision should happen before deep refactors.

## Phase 8 - Release Operations And Runbooks

### 1. Goal

Make store releases, hotfixes, and incident response repeatable instead of improvised.

### 2. In-scope flow(s)

- Mobile build and update lanes
- Backend deploy/rollback
- Render incident response
- Production configuration discipline

### 3. Mobile entrypoints involved

- `app.json:1-49`
- `package.json:1-74`
- `.replit:7-79`

### 4. Backend routes involved

- No route logic change is required to start this phase, but finalize and short-detail runbooks must cover the live mobile-used paths.

### 5. Current wiring summary

- Mobile repo has no `eas.json`.
- `app.json` has no `runtimeVersion` or `updates` policy.
- Mobile repo has no CI workflow and no explicit store-build lane.
- Backend repo has CI, but no production runbook or rollback/run-response doc for the mobile-used backend surface.

### 6. Proven issues / risks

- OTA/update behavior is not explicitly controlled in repo config.
- Production release and rollback steps are not encoded in docs.
- Incident response for failed finalize, missing short detail, or usage mismatch would still depend too heavily on tribal knowledge.

### 7. Proposed plan in order

1. Add mobile build/update profiles and runtime-version policy.
2. Define preview versus production channels and release checklist.
3. Add backend deploy checklist, rollback checklist, and failed-render tracing runbook.
4. Add one shared "known failure modes" document tied to requestId and attemptId tracing.
5. Rehearse one release and one rollback path before calling the app production-ready.

### 8. Files likely to change

- mobile `eas.json`
- mobile `app.json`
- mobile CI/release docs
- backend runbook docs
- backend README or docs front door if runbooks become required starting points

### 9. Docs that must be checked/updated

- backend `docs/DOCS_INDEX.md`
- backend `README.md` if a runbook becomes top-level
- mobile `docs/DOCS_INDEX.md`

### 10. Verification steps

- Produce one preview build and one production build from documented config.
- Verify runtime-version and update-channel behavior explicitly.
- Walk through a failed-render trace using only the written runbooks.

### 11. Open questions / uncertainties, if any

- Release infrastructure accounts and signing setup are not represented in repo code and will need separate operational confirmation.

## Recommended Start Order

Work phases in this order unless a production incident forces a hot fix:

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 4
5. Phase 5
6. Phase 6
7. Phase 7
8. Phase 8

Reason:

- Phase 1 reduces navigation and ownership confusion before deeper edits.
- Phase 2 removes the biggest contract ambiguity on already-live mobile paths.
- Phase 3 and Phase 4 create the traceability and regression net needed before aggressive architecture work.
- Phase 5 protects the system while finalize remains synchronous.
- Phase 6 is the largest architectural change and should happen after contracts, logs, and tests are trustworthy.
- Phase 7 and Phase 8 then simplify maintenance and shipping discipline around the stabilized core.
