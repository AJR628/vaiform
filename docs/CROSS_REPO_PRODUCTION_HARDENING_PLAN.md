# CROSS_REPO_PRODUCTION_HARDENING_PLAN

- Status: CANONICAL
- Owner repo: backend
- Source of truth for: phased cross-repo execution order for production hardening and anti-drift work
- Canonical counterpart/source: mobile repo `docs/MOBILE_USED_SURFACES.md` for caller truth, backend repo `docs/MOBILE_BACKEND_CONTRACT.md` for contract truth, backend repo `docs/MOBILE_HARDENING_PLAN.md` for route-hardening status
- Last verified against: both repos on 2026-03-18

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

- Mobile entrypoint: `client/contexts/AuthContext.tsx:133-230`
- Mobile transport: `client/api/client.ts:223-289`, `client/api/client.ts:537-551`
- Backend routes: `src/routes/users.routes.js:18-52`, `src/routes/usage.routes.js:1-9`
- Backend services: `src/services/user-doc.service.js:5-34`, `src/services/usage.service.js:137-167`
- Proven behavior:
  - app readiness waits for Firebase auth, then `POST /api/users/ensure`, then `GET /api/usage`
  - missing provisioning or usage fetch signs the user back out instead of entering a half-ready app

### Story create -> generate -> plan -> search

- Mobile entrypoints:
  - `client/screens/HomeScreen.tsx:79-137`
  - `client/screens/ScriptScreen.tsx:64-235`
- Mobile transport: `client/api/client.ts:594-708`
- Backend routes: `src/routes/story.routes.js:189-255`, `src/routes/story.routes.js:557-610`
- Backend services: `src/services/story.service.js:324-397`, `src/services/story.service.js:437-448`, `src/services/story.service.js:677-773`
- Proven behavior:
  - create flow is `start` then `generate`
  - storyboard flow is `plan` then `search`
  - `generate` and `plan` are guarded by `enforceScriptDailyCap(300)` in `src/routes/story.routes.js:151-175` and `src/routes/story.routes.js:480-497`

### Editor, clip search, and caption preview

- Mobile entrypoints:
  - `client/screens/ScriptScreen.tsx:162-235`
  - `client/screens/StoryEditorScreen.tsx:459-951`
  - `client/screens/ClipSearchModal.tsx:49-105`
  - `client/hooks/useCaptionPreview.ts:45-220`
- Backend routes:
  - `src/routes/story.routes.js:287-857`
  - `src/routes/caption.preview.routes.js:109-313`
- Backend services:
  - `src/services/story.service.js:531-949`
- Proven behavior:
  - `update-beat-text`, `delete-beat`, `search-shot`, and `update-shot` are mobile-used mutations
  - caption preview is server-measured for mobile and keyed by `x-client: mobile`
  - caption preview already has auth, request-size, and per-user rate limiting

### Finalize and recovery

- Mobile entrypoint: `client/screens/StoryEditorScreen.tsx:974-1177`
- Mobile transport: `client/api/client.ts:743-859`
- Backend route: `src/routes/story.routes.js:940-989`
- Backend middleware: `src/middleware/idempotency.firestore.js:69-467`
- Backend services: `src/services/story.service.js:2325-2417`
- Backend process limits: `server.js:27-43`, `src/utils/render.semaphore.js:1-22`
- Proven behavior:
  - finalize still blocks the HTTP request until render completion
  - backend reserves usage seconds before render, settles after success, and releases on 5xx
  - mobile reuses the same `X-Idempotency-Key` for retry and recovery polling
  - recovery truth is additive session state on `GET /api/story/:sessionId`

### Library and short detail

- Mobile entrypoints:
  - `client/screens/LibraryScreen.tsx:80-142`
  - `client/screens/ShortDetailScreen.tsx:183-602`
- Backend routes: `src/routes/shorts.routes.js:1-10`
- Backend controller: `src/controllers/shorts.controller.js:7-235`
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
- Request IDs now propagate through a backend `AsyncLocalStorage` request context, and Phase 3 added structured/redacted boundary logging plus mobile in-memory diagnostics on the named hot paths only.
- The mobile runtime path is the hand-written API client, while the React Query client remains mostly unused in active flows.

### Corrected or tightened from code truth

- File-size risk is worse than the pasted audit suggested in line count terms:
  - backend `src/utils/ffmpeg.video.js`: 2787 lines
  - backend `src/services/story.service.js`: 2441 lines
  - backend `src/routes/caption.preview.routes.js`: 1995 lines
  - mobile `client/screens/StoryEditorScreen.tsx`: 1872 lines
  - mobile `client/screens/ShortDetailScreen.tsx`: 980 lines
  - mobile `client/api/client.ts`: 860 lines
- Console usage remains high in hot paths:
  - backend `src/**`: 500+ console calls
  - mobile `client/**`: 66 console calls
- The mobile `server/` subtree is not random dead code; it is still part of the repo's Replit build/deploy path via `.replit:7-10` and `package.json:6-11`, but it is not part of the client runtime path that calls the backend.

## Phase Map

1. Truth Freeze And Front Door Cleanup
1.5. Mobile Transport Ownership Freeze
2. Contract And Error Semantics Hardening
3. Request-Scoped Observability And Diagnostics
4A. Backend Active-Path Contract Tests
5. Admission Control And Expensive-Route Determinism
6. Render Isolation And Async Completion
4B. Mobile Test Expansion And CI
7. Mobile Surface Consolidation
8. Release Operations And Runbooks

## Phase 1 - Truth Freeze And Front Door Cleanup

- Status: COMPLETE in current repo state as of 2026-03-16.
- Completion note: both repos now have one clear docs front door, overlapping stale root docs were archived or bannered, and active docs are explicit. Phase 1.5 remains the next step for transport ownership freeze.

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
3. Publish one short active-docs map naming the small set of docs agents are allowed to treat as live.
4. Move overlapping stale plan and audit docs to archive first, and add a canonical/historical banner rule so archived or retained stale documents point back to the active front door instead of competing with it.
5. Do not let transport ownership remain implicit; Phase 1.5 must resolve it before test and refactor work broadens.

### 8. Files likely to change

- backend `README.md`
- backend `docs/DOCS_INDEX.md`
- backend `docs/CROSS_REPO_PRODUCTION_HARDENING_PLAN.md`
- backend `docs/_archive/INDEX.md`
- backend `docs/archive/root-md/INDEX.md`
- backend overlapping plan/audit docs that still look active
- mobile `README.md`
- mobile `docs/DOCS_INDEX.md`

### 9. Docs that must be checked/updated

- backend `docs/DOCS_INDEX.md`
- backend `README.md`
- mobile `docs/DOCS_INDEX.md`

### 10. Verification steps

- Open backend `README.md`, mobile `README.md`, and both repos' `docs/DOCS_INDEX.md` and confirm each repo points to one clear docs front door.
- Confirm no route contract details were duplicated outside the existing contract docs.
- Confirm backend `README.md` points to one docs entry path.
- Confirm backend `docs/DOCS_INDEX.md` points to one active set.
- Confirm mobile `docs/DOCS_INDEX.md` clearly remains consumer-note only.
- Confirm overlapping non-canonical plan/audit docs either carry a historical banner or point directly at the active canonical doc set.
- Confirm one short active-docs map names the only docs to treat as live.

### 11. Open questions / uncertainties, if any

- None for this phase. The evidence is local and verified.

### Phase 1 Exit Criteria

Phase 1 is not complete until all of the following are true:

- backend `README.md` points to one docs entry path
- backend `docs/DOCS_INDEX.md` points to one active canonical set
- mobile `docs/DOCS_INDEX.md` clearly stays consumer-note only
- overlapping non-canonical plans and audits have been moved to archive first or carry an explicit historical/canonical-pointer banner
- archived docs are only deleted later after canonical docs are confirmed complete and no unique operational truth remains
- one short active-docs map exists naming the small allowed live-doc set

## Phase 1.5 - Mobile Transport Ownership Freeze

- Status: COMPLETE in current repo state as of 2026-03-17.
- Completion note: the mobile docs front door now explicitly freezes transport ownership on `client/api/client.ts`, while keeping React Query documented as present but non-owning for the current mobile-used backend flows. No runtime transport migration occurred in this phase.

### 1. Goal

Stop mobile transport ambiguity before tests, diagnostics, or screen refactors build on the wrong ownership model.

### 2. In-scope flow(s)

- Mobile API transport ownership
- React Query versus hand-written API client status
- Mobile docs language about live transport truth

### 3. Mobile entrypoints involved

- `client/App.tsx:9-56`
- `client/api/client.ts:1-823`
- `client/lib/query-client.ts:1-79`
- mobile `docs/DOCS_INDEX.md`
- mobile `docs/MOBILE_USED_SURFACES.md`

### 4. Backend routes involved

- No backend runtime behavior change in this phase.
- This phase exists to prevent drift in how mobile consumes the already-traced backend routes.

### 5. Current wiring summary

- The active runtime caller path for the traced mobile-used flows is `client/api/client.ts`.
- React Query is mounted through `QueryClientProvider`, but the traced screens and contexts do not use `useQuery`, `useMutation`, or the query transport for those flows.
- Leaving both patterns half-live would contaminate test setup, diagnostics, and future refactors.

### 6. Proven issues / risks

- Docs can still imply two possible transport owners.
- Future tests could be written against the wrong layer.
- Future agent work could accidentally widen drift by "completing" an ownership decision implicitly instead of explicitly.

### 7. Proposed plan in order

1. Declare the current runtime owner explicitly in mobile docs.
2. Treat `client/api/client.ts` as the active transport owner until an intentional migration plan says otherwise.
3. Mark React Query as present but non-owning for the current mobile-used backend flows.
4. Revisit full React Query adoption only as a later intentional migration, not as incidental cleanup.

### 8. Files likely to change

- mobile `docs/DOCS_INDEX.md`
- mobile `docs/MOBILE_USED_SURFACES.md`
- optionally a short mobile transport note doc if the existing docs become too crowded

### 9. Docs that must be checked/updated

- mobile `docs/DOCS_INDEX.md`
- mobile `docs/MOBILE_USED_SURFACES.md`
- backend docs only if cross-repo front-door language needs a pointer update

### 10. Verification steps

- Confirm mobile docs explicitly state that `client/api/client.ts` is the current transport owner.
- Confirm React Query is described as present but non-canonical for the active runtime path.
- Confirm future phases refer to the declared owner consistently.

### 11. Open questions / uncertainties, if any

- None for the current repo state. The present code path clearly favors the hand-written client.

## Phase 2 - Contract And Error Semantics Hardening

- Status: COMPLETE in current repo state as of 2026-03-17.
- Completion note: active mobile-used story editor/search routes now return stable explicit domain-level 4xx/404 codes, `updateBeatText()` no longer dereferences a missing session before guarding it, `GET /api/story/:sessionId` now uses `SESSION_NOT_FOUND`, and `GET /api/shorts/:jobId` remains runtime-unchanged with docs clarifying its intentional `404 NOT_FOUND` bridge semantics.

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
- The in-scope story editor/search routes now map known domain failures to stable 4xx/404 responses while leaving unknown errors on route-specific 500 wrappers.
- `updateBeatText()` now checks `SESSION_NOT_FOUND` / `STORY_REQUIRED` before dereferencing `session.story`.
- `GET /api/shorts/:jobId` remains a docs-only clarification in this phase; its pending-availability bridge behavior is unchanged.

### 6. Proven issues / risks

- The repo previously collapsed known editor/search domain failures into generic 500s; this phase closed that contract gap on the active mobile-used routes.
- Unknown or truly unexpected failures still need to fall through to route-specific 500 wrappers to avoid over-classifying server faults.
- Mobile recovery and support flows still depend on stable `status`, `code`, `message`, and `requestId`, so docs must stay aligned with the exact emitted codes.

### 7. Proposed plan in order

1. Enumerate every service-thrown domain error for the mobile-used story editor/search routes.
2. Add explicit route-level mapping in `src/routes/story.routes.js` so mobile gets stable 4xx and 404 responses where the failure is not a server fault.
3. Fix `updateBeatText()` null/session guards before changing any mobile messaging.
4. Record the exact stable route failures in `docs/MOBILE_BACKEND_CONTRACT.md`; no separate error-matrix doc was needed.
5. Update backend contract and hardening docs only after route behavior is verified in code.

### 8. Files likely to change

- `src/routes/story.routes.js`
- `src/services/story.service.js`
- `docs/MOBILE_BACKEND_CONTRACT.md`
- `docs/MOBILE_HARDENING_PLAN.md`
- `docs/CROSS_REPO_PRODUCTION_HARDENING_PLAN.md`

### 9. Docs that must be checked/updated

- backend `docs/MOBILE_BACKEND_CONTRACT.md`
- backend `docs/MOBILE_HARDENING_PLAN.md`
- mobile `docs/MOBILE_USED_SURFACES.md` only if caller handling changes

### 10. Verification steps

- Exercise each live mobile mutation with invalid session, missing prerequisites, and out-of-range indices.
- Confirm mobile receives stable `ok/status/code/message/requestId` outputs via `client/api/client.ts`.
- Re-check that docs list the same codes actually emitted.

### 11. Open questions / uncertainties, if any

- None for this phase after implementation. The in-scope token-to-status mapping is now explicit in route code and backend contract docs.

## Phase 3 - Request-Scoped Observability And Diagnostics

Status: COMPLETE (implemented 2026-03-18).

### 1. Goal

Make incident tracing deterministic across async boundaries and across the mobile-to-backend handoff without widening into repo-wide logging cleanup.

### 2. Implemented scope

- Backend `AsyncLocalStorage` request context is seeded immediately after request ID assignment.
- One canonical backend structured stdout logger now emits redacted JSON.
- Phase 3 migrated boundary/request logging only for:
  - auth bootstrap
  - provider-backed story generation/search
  - finalize / idempotent replay / recovery
  - short-detail recovery
- Mobile now keeps one bounded in-memory diagnostics buffer. Transport-owned normalized failures are recorded automatically, and `AuthContext`, `StoryEditorScreen`, and `ShortDetailScreen` add local context where available.
- Backend now has one incident trace runbook for failed finalize/recovery and missing short detail.

### 3. Required spillover

- Backend request context and the canonical logger are shared primitives mounted globally in `src/app.js`.
- Mobile normalized-failure capture now applies to callers that already use `apiRequestNormalized(...)` or `storyFinalize(...)`.

### 4. Current caveats

- Phase 3 did not perform a repo-wide backend console migration.
- Deeper finalize/render internals inside the active finalize path still contain legacy `console.*` logging and were not fully migrated in Phase 3.
- Phase 3 did not add persistent mobile diagnostics storage or a mobile diagnostics UI.

### 5. Verification standard

- Trigger an auth bootstrap failure, a finalize in-progress replay, and a short-detail 404 retry.
- Confirm the same request/attempt context is visible from the mobile diagnostics buffer through the migrated backend boundary logs.
- Confirm the canonical logger path redacts auth headers, cookies, API keys/secrets, full public/storage URLs, and unsafe raw payload blobs.

### 6. Open questions / uncertainties, if any

- Structured log sink and deployment destination are not represented in repo code yet. That remains an environment-specific decision outside this phase.

## Phase 4A - Backend Active-Path Contract Tests

Status: COMPLETE (implemented 2026-03-19).

### 1. Goal

Add a regression net around the actual mobile-used backend contract before mobile test infrastructure becomes a dependency.

### 2. Implemented scope

- Backend now has a first-party Node 22 `node:test` contract suite at `test/contracts/phase4a.contract.test.js`.
- The suite covers the current active mobile-used backend route inventory only:
  - `POST /api/users/ensure`
  - `GET /api/usage`
  - `POST /api/story/start`
  - `POST /api/story/generate`
  - `GET /api/story/:sessionId`
  - `POST /api/story/plan`
  - `POST /api/story/search`
  - `POST /api/story/update-beat-text`
  - `POST /api/story/delete-beat`
  - `POST /api/story/search-shot`
  - `POST /api/story/update-shot`
  - `POST /api/story/update-caption-style`
  - `POST /api/caption/preview`
  - `POST /api/story/finalize`
  - `GET /api/shorts/mine`
  - `GET /api/shorts/:jobId`
- The suite locks:
  - route-by-route `401 AUTH_REQUIRED` behavior
  - current success envelopes and the specific fields mobile reads
  - current `GET /api/shorts/:jobId` pending `404 NOT_FOUND` bridge behavior
  - current caption preview mobile/server-measured path
  - current finalize top-level `shortId` replay/idempotency behavior
  - current finalize `402 INSUFFICIENT_RENDER_TIME` and `404 SESSION_NOT_FOUND` behavior
- Backend `package.json` now exposes the suite through `npm run test:contracts`, and backend CI runs that command.

### 3. Required spillover

- Backend test-mode startup now has one explicit Firebase seam via `src/config/firebase.js` and `src/testing/firebase-admin.mock.js`.
- Backend test-only provider/render seams are explicit and narrow:
  - `src/testing/runtime-overrides.js`
  - `src/services/story.llm.service.js`
  - `src/services/pexels.videos.provider.js`
  - `src/services/pixabay.videos.provider.js`
  - `src/services/nasa.videos.provider.js`
  - `src/services/story.service.js`
- This spillover is limited to deterministic backend contract execution under `NODE_ENV=test` and does not change production behavior.

### 4. Current caveats

- Phase 4A remains backend-only. It does not add mobile tests or mobile CI.
- Phase 4A does not widen into admission-control redesign or async render architecture work.
- Conditional burst/collision/load-oriented checks were not added because this phase only commits deterministic backend contract coverage.
- Finalize success-path coverage is deterministic via the backend test seam, not a full live render/provider stack.

### 5. Verification standard

- `npm run test:contracts` passes locally against the backend app export.
- Backend CI now runs `npm run test:contracts`.
- Every in-scope active mobile-used route above has at least one success-path assertion and one failure-path assertion.
- Out-of-scope routes were not added to the suite.

### 6. Open questions / uncertainties, if any

- None for Phase 4A completion. Optional load-oriented checks remain deferred unless they can be kept deterministic without widening scope.

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

## Phase 4B - Mobile Test Expansion And CI

### 1. Goal

Add mobile-side regression coverage after backend contract truth is protected and after the highest-risk backend work is no longer waiting on mobile test infrastructure.

### 2. In-scope flow(s)

- Response normalization
- Auth bootstrap
- Render-time messaging and helpers
- Finalize timeout and recovery
- Mobile CI

### 3. Mobile entrypoints involved

- `client/api/client.ts`
- `client/contexts/AuthContext.tsx`
- `client/screens/HomeScreen.tsx`
- `client/screens/StoryEditorScreen.tsx`
- `client/screens/ShortDetailScreen.tsx`
- mobile CI config files to be added

### 4. Backend routes involved

- Backend route behavior remains the dependency input, not the target of this phase.

### 5. Current wiring summary

- The mobile repo has no first-party tests and no CI workflow.
- Mobile state and recovery logic are already complex enough to justify tests, but backend contract protection should land first.

### 6. Proven issues / risks

- Mobile test harness setup could create execution drag if treated as a prerequisite for backend hardening.
- Recovery and normalization logic can still regress quietly without a mobile test layer.

### 7. Proposed plan in order

1. Add unit tests for normalization helpers and render-time helpers.
2. Add focused tests for bootstrap failure handling and finalize recovery handling.
3. Add a mobile CI workflow for typecheck, lint, and tests.
4. Keep screen-flow tests narrow so they verify real behavior without turning into unstable UI test scaffolding too early.

### 8. Files likely to change

- mobile `package.json`
- mobile test setup and fixtures
- mobile new test files
- mobile new CI workflow

### 9. Docs that must be checked/updated

- mobile `docs/DOCS_INDEX.md` if testing guidance becomes front-door material
- backend docs only if shared CI/release guidance needs a pointer

### 10. Verification steps

- Mobile CI runs typecheck, lint, and the new tests.
- Finalize recovery and normalization behavior have direct test coverage.
- Mobile test setup does not redefine backend contract truth locally.

### 11. Open questions / uncertainties, if any

- Test runner choice is still open in repo code and should be decided only after backend contract tests are underway.

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
2. Phase 1.5
3. Phase 2
4. Phase 3
5. Phase 4A
6. Phase 5
7. Phase 6
8. Phase 4B
9. Phase 7
10. Phase 8

Reason:

- Phase 1 reduces navigation and ownership confusion before deeper edits.
- Phase 1.5 freezes the mobile transport owner before diagnostics, tests, and refactors build on the wrong layer.
- Phase 2 removes the biggest contract ambiguity on already-live mobile paths.
- Phase 3 and Phase 4A create the traceability and backend regression net needed before aggressive architecture work.
- Phase 5 protects the system while finalize remains synchronous.
- Phase 6 is the largest architectural change and should happen after contracts, logs, and backend tests are trustworthy.
- Phase 4B then expands mobile-side protection once backend contract drift is less likely.
- Phase 7 and Phase 8 simplify maintenance and shipping discipline around the stabilized core.
