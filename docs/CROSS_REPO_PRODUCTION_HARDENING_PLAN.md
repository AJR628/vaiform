# CROSS_REPO_PRODUCTION_HARDENING_PLAN

- Status: CANONICAL
- Owner repo: backend
- Source of truth for: phased cross-repo execution order for production hardening and anti-drift work
- Canonical counterpart/source: mobile repo `docs/MOBILE_USED_SURFACES.md` for caller truth, backend repo `docs/MOBILE_BACKEND_CONTRACT.md` for contract truth, backend repo `docs/MOBILE_HARDENING_PLAN.md` for route-hardening status
- Last verified against: both repos on 2026-03-21

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
- Backend middleware: `src/middleware/idempotency.firestore.js:29-117`
- Backend async path:
  - `src/services/story-finalize.attempts.js:91-132`
  - `src/services/story-finalize.runner.js:59-125`
  - `src/services/story.service.js:2525-2629`
- Backend process limits: `server.js:27-43`, `src/utils/render.semaphore.js:1-22`
- Proven behavior:
  - `POST /api/story/finalize` now returns prepared async finalize replies, including `202 pending` when work is accepted
  - backend reserves usage seconds before background render work, settles after success, and releases on terminal failure
  - `GET /api/story/:sessionId` is the canonical poll/recovery surface through additive session `renderRecovery`
  - `GET /api/shorts/:jobId` remains secondary detail/availability only
  - mobile reuses or adopts the active `X-Idempotency-Key` for same-attempt replay and recovery

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

- Async finalize is live: `POST /api/story/finalize` now returns prepared async replies, `GET /api/story/:sessionId` is the canonical recovery surface, and `GET /api/shorts/:jobId` is secondary detail only.
- Backend now has first-party contract tests and CI for the active mobile-used routes, including async finalize acceptance/replay/conflict/reaping coverage.
- Request IDs now propagate through a backend `AsyncLocalStorage` request context, and Phase 3 added structured/redacted boundary logging plus mobile in-memory diagnostics on the named hot paths only.
- The mobile runtime path is now only the hand-written API client. Phase 7 removed the dormant React Query runtime path from the mobile repo.

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

- Phase 1: Truth Freeze And Front Door Cleanup
- Phase 1.5: Mobile Transport Ownership Freeze
- Phase 2: Contract And Error Semantics Hardening
- Phase 3: Request-Scoped Observability And Diagnostics
- Phase 4A: Backend Active-Path Contract Tests
- Phase 5: Admission Control And Expensive-Route Determinism
- Phase 6: Render Isolation And Async Completion
- Phase 4B: Mobile Test Expansion And CI
- Phase 7: Mobile Surface Consolidation
- Phase 8: Release Operations And Runbooks

## Phase 1 - Truth Freeze And Front Door Cleanup

- Status: COMPLETE in current repo state as of 2026-03-16.
- Completion note: both repos now have one clear docs front door, overlapping stale root docs were archived or bannered, and active docs are explicit. Phase 1.5 has since landed, so transport ownership remains explicitly frozen on `client/api/client.ts`.

### 1. Goal

Make it easy for any engineer or agent to identify the live mobile path, the live backend contract path, and the non-canonical or historical paths that should not drive edits.

### 2. In-scope flow(s)

- Cross-repo docs ownership
- Mobile transport/front-door ownership
- Backend mobile-used route ownership
- Repo-level "where to start" guidance

### 3. Mobile entrypoints involved

- `client/App.tsx:33-53`
- `client/api/client.ts:1-823`
- `docs/DOCS_INDEX.md`
- `docs/MOBILE_USED_SURFACES.md`

### 4. Backend routes involved

- No runtime behavior change in this phase.
- Documentation scope is derived from mounted routes in `src/app.js:213-288`.

### 5. Current wiring summary

- Mobile requests flow through `client/api/client.ts`.
- Phase 7 later removed the dormant React Query runtime path, leaving the hand-written API client as the only active transport owner.
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
5. Keep transport ownership explicit in the canonical docs so later tests and refactors do not broaden drift from the wrong layer.

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
- Completion note: the mobile docs front door now explicitly freezes transport ownership on `client/api/client.ts`. Phase 7 later completed the runtime cleanup by removing the dormant React Query path from the mobile repo.

### 1. Goal

Stop mobile transport ambiguity before tests, diagnostics, or screen refactors build on the wrong ownership model.

### 2. In-scope flow(s)

- Mobile API transport ownership
- React Query versus hand-written API client status
- Mobile docs language about live transport truth

### 3. Mobile entrypoints involved

- `client/App.tsx:33-53`
- `client/api/client.ts:1-823`
- mobile `docs/DOCS_INDEX.md`
- mobile `docs/MOBILE_USED_SURFACES.md`

### 4. Backend routes involved

- No backend runtime behavior change in this phase.
- This phase exists to prevent drift in how mobile consumes the already-traced backend routes.

### 5. Current wiring summary

- The active runtime caller path for the traced mobile-used flows is `client/api/client.ts`.
- Phase 7 later removed the dormant React Query runtime path, preserving `client/api/client.ts` as the sole active caller path for those flows.
- Leaving both patterns half-live would contaminate test setup, diagnostics, and future refactors.

### 6. Proven issues / risks

- Docs can still imply two possible transport owners.
- Future tests could be written against the wrong layer.
- Future agent work could accidentally widen drift by "completing" an ownership decision implicitly instead of explicitly.

### 7. Proposed plan in order

1. Declare the current runtime owner explicitly in mobile docs.
2. Treat `client/api/client.ts` as the active transport owner until an intentional migration plan says otherwise.
3. Keep React Query out of current-runtime truth for the active mobile-used backend flows.
4. Revisit any future React Query adoption only as a later intentional migration, not as incidental cleanup.

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
- Confirm the declared transport owner stays `client/api/client.ts` and React Query is not described as active runtime truth for these flows.
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
  - current async finalize `202 pending` acceptance and same-key replay behavior
  - current finalize `402 INSUFFICIENT_RENDER_TIME`, `404 SESSION_NOT_FOUND`, and different-key `409 FINALIZE_ALREADY_ACTIVE` behavior
  - stale-attempt reaping into terminal failure plus persisted `renderRecovery.failed`
  - the fresh-session finalize branch that generates captions before render
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

Status: COMPLETE (implemented 2026-03-20).

### 1. Goal

Reject overload predictably instead of degrading ambiguously when generation, search, caption preview, or finalize traffic spikes.

### 2. Implemented scope

- Primary backend hardening landed on the active expensive mobile-used routes:
  - `POST /api/story/generate`
  - `POST /api/story/plan`
  - `POST /api/story/search`
  - `POST /api/story/search-shot`
  - `POST /api/story/finalize`
- Shared upstream scope landed on the dependencies those routes actually use:
  - OpenAI story generation and planning calls
  - Pexels, Pixabay, and NASA stock-video search providers
- `POST /api/caption/preview` remained validation-only in this phase because the backend already had auth, explicit `20/min` rate limiting, and a `200kb` body cap.

### 3. Implemented behavior

- `generate` and `plan` keep their existing explicit `429 SCRIPT_LIMIT_REACHED` daily-cap guardrail.
- `generate` and `plan` now also have explicit transient busy/timeout behavior:
  - route-local retryable `503 SERVER_BUSY`
  - `Retry-After: 15`
  - deterministic LLM timeout handling around the OpenAI call path
- `search` and `search-shot` now have explicit route-local transient admission behavior plus provider timeout/cooldown handling.
- Search success now preserves usable results whenever at least one consulted provider returns usable clips.
- `search` / `search-shot` now surface retryable `503 SERVER_BUSY` only when:
  - no usable results exist, and
  - all consulted providers failed for transient reasons.
- Pixabay and NASA now use explicit timeout handling; Pexels keeps its existing timeout path.
- Provider transient failures now feed a small per-process cooldown state instead of collapsing repeatedly into ambiguous empty results.
- Finalize-specific caller semantics from Phase 5 were superseded by Phase 6's async attempt flow.
- The still-relevant Phase 5 carry-forward is that when finalize has to invoke missing upstream generation/planning/search stages, those internal stages inherit the new deterministic retryable `503` behavior instead of falling through generic expensive-route failures before the attempt completes.

### 4. Verification standard

- Backend contract coverage stayed on the existing first-party suite at `test/contracts/phase4a.contract.test.js`.
- The suite now proves:
  - retryable `503` mapping for `generate`
  - retryable `503` mapping for `plan`
  - search/search-shot success preservation when at least one provider returns usable results
  - search/search-shot retryable `503` only when all consulted providers fail transiently and no usable results exist
  - current finalize assertions in the same suite now follow Phase 6 async acceptance/replay/conflict/reaping semantics rather than the pre-Phase-6 blocking render-slot path
- `npm run test:contracts` passes locally.
- Backend CI continues to run `npm run test:contracts`.

### 5. Current caveats

- Route-local admission controls and provider cooldowns are intentionally per-process. Phase 5 did not introduce a generalized shared framework or distributed coordination layer.
- `withRenderSlot()` remains single-process only. Phase 6 preserved that local semaphore, so distributed render coordination remains outside the current repo-backed hardening scope.
- Capacity thresholds still live in code constants, not config. Phase 5 made behavior deterministic; it did not claim final capacity tuning.

### 6. Open questions / uncertainties, if any

- None that block Phase 5 completion. Future threshold tuning still needs real load data, but the expensive-route behavior is now deterministic enough to move on.

## Phase 6 - Render Isolation And Async Completion

### 1. Goal

DONE: take finalize completion off the long-lived request path without changing the canonical session-recovery surface.

### 2. In-scope flow(s)

- `POST /api/story/finalize`
- `GET /api/story/:sessionId`
- short creation and availability
- usage reservation/settlement
- render recovery

### 3. Mobile entrypoints involved

- `client/screens/StoryEditorScreen.tsx`
- `client/screens/ShortDetailScreen.tsx`
- `client/api/client.ts`

### 4. Backend routes involved

- `POST /api/story/finalize`
- `GET /api/story/:sessionId`
- `GET /api/shorts/:jobId`

### 5. Current wiring summary

- `POST /api/story/finalize` now reserves render usage, enqueues a Firestore-backed finalize attempt, persists `renderRecovery.pending`, and returns `202 Accepted` with additive finalize metadata.
- A backend-owned finalize runner now claims queued attempts, heartbeats running attempts, executes the existing finalize pipeline in the background, and settles or releases billing exactly once.
- The queued-attempt claimant in `src/services/story-finalize.attempts.js` depends on a Firestore composite index for `idempotency(flow ASC, state ASC, createdAt ASC)`. That index is now tracked in root `firestore.indexes.json`, and root `firebase.json` wires Firestore rules plus indexes for deploy via `firebase deploy --project <firebase-project-id> --only firestore`.
- `GET /api/story/:sessionId` remains the canonical poll/recovery surface through additive `renderRecovery`.
- `GET /api/shorts/:jobId` remains a secondary detail/availability bridge after completion.
- Mobile now treats `202 pending` and `409 FINALIZE_ALREADY_ACTIVE` as recovery-entry conditions and persists the active finalize attempt for same-session restart-safe continuation.

### 6. Proven issues / risks

- `src/utils/render.semaphore.js` is still per-process only.
- The Firestore finalize runner coordinates attempt ownership and stale-attempt cleanup, but it does not create a global multi-instance render-slot ceiling.
- `server.js` still keeps a 15-minute timeout for legacy blocking render flows such as `POST /api/story/render`; that timeout is no longer the finalize scalability strategy.

### 7. Proposed plan in order

1. Preserve `GET /api/story/:sessionId` as the canonical finalize recovery surface.
2. Keep Firestore idempotency as the finalize-attempt SSOT and reject same-session concurrent finalize attempts under different keys.
3. Use the in-repo finalize runner plus lease/heartbeat reaper to complete, fail, or expire attempts deterministically.
4. Keep top-level `shortId` on terminal success replay and keep shorts detail as a secondary post-completion bridge.
5. Document the remaining per-process concurrency limitation explicitly instead of implying Phase 6 solved it.

### 8. Files likely to change

- `src/routes/story.routes.js`
- `src/middleware/idempotency.firestore.js`
- `src/services/story.service.js`
- `src/services/story-finalize.attempts.js`
- `src/services/story-finalize.runner.js`
- `src/app.js`
- `server.js`
- mobile finalize and recovery helpers
- backend contract and hardening docs

### 9. Docs that must be checked/updated

- backend `docs/MOBILE_BACKEND_CONTRACT.md`
- backend `docs/MOBILE_HARDENING_PLAN.md`
- backend `docs/DOCS_INDEX.md` if a worker/runbook doc becomes front-door relevant
- mobile `docs/MOBILE_USED_SURFACES.md`

### 10. Verification steps

- `POST /api/story/finalize` returns quickly with stable attempt identity and `202 pending`.
- Same-key replay returns `202 pending` while queued/running, `200` with top-level `shortId` when done, and terminal failure replay when failed/expired.
- Different-key same-session finalize returns `409 FINALIZE_ALREADY_ACTIVE` without a second reservation.
- Stale queued/running attempts are reaped into terminal failure and release reserved usage once.
- Mobile can continue the same attempt through `GET /api/story/:sessionId` after timeout, backgrounding, or process restart on the same session.

### 11. Open questions / uncertainties, if any

- Worker/runtime placement for Phase 6 is now chosen in repo code.
- Remaining limitation: multi-instance global render concurrency is still unchosen and intentionally out of scope for this phase.

## Phase 4B - Mobile Test Expansion And CI

Status: COMPLETE (implemented 2026-03-21).

### 1. Goal

DONE: add first-party mobile regression coverage around the highest-risk live client behavior after backend contract truth stabilized, and land truthful mobile CI for the verification surface that the repo can actually support today.

### 2. Implemented scope

- Mobile test harness in the mobile repo using `jest`, `jest-expo`, and `@testing-library/react-native`
- Direct regression coverage for:
  - `client/api/client.ts`
  - `client/lib/renderUsage.ts`
  - `client/lib/storyFinalizeAttemptStorage.ts`
  - `client/lib/diagnostics.ts`
  - `client/contexts/AuthContext.tsx`
  - `client/screens/StoryEditorScreen.tsx`
  - `client/screens/ShortDetailScreen.tsx`
- Mobile-only CI workflow in the mobile repo

### 3. Implemented behavior

- Response normalization, requestId handling, caption-preview payload shaping, network/timeout normalization, and finalize metadata extraction in `client/api/client.ts` now have first-party regression coverage.
- Render-time formatting, finalize-attempt storage cleanup, and the in-memory diagnostics buffer now have direct unit coverage.
- `AuthContext` bootstrap remains `ensureUser()` then `getUsage()`, with bootstrap sign-out on failure; those success and failure paths now have direct coverage.
- `StoryEditorScreen` finalize and recovery remain screen-owned in current code. Phase 4B did not widen into a screen refactor; tests use the existing seams and cover:
  - insufficient render-time gating
  - accepted `202 pending` recovery
  - `409 FINALIZE_ALREADY_ACTIVE` adoption of the active attempt
- `ShortDetailScreen` retains the current `404` retry window, library fallback, and terminal non-404 handling; those paths now have direct coverage.

### 4. Implemented CI scope

- The mobile repo now has `.github/workflows/mobile-ci.yml`.
- The workflow runs:
  - `npm ci`
  - `npm run test:ci`
- Verified locally on 2026-03-21 in the implementation environment, `npm run check:types` and `npm run lint` were not clean in the current mobile repo baseline. Phase 4B therefore landed truthful tests-only CI instead of claiming blocking lint/type gates that the repo does not currently support.

### 5. Verification standard

- `npm run test:ci` passes locally in the mobile repo.
- The mobile CI workflow runs the same test command that passed locally.
- No backend runtime behavior changed in this phase.
- Mobile test setup does not create a second source of backend contract truth; backend contract behavior remains dependency input, not the target of Phase 4B.

### 6. Current caveats

- Mobile lint and typecheck remain outside blocking Phase 4B CI because the verified local baseline was not clean.
- `HomeScreen` was not added to first-wave coverage in the landed work. Current repo risk remained materially higher in API normalization, auth bootstrap, finalize recovery, and short-detail availability handling.

### 7. Open questions / uncertainties, if any

- None that block Phase 4B completion in current repo state.

## Phase 7 - Mobile Surface Consolidation

- Status: COMPLETE in current repo state as of 2026-03-22.
- Completion note: the mobile runtime now uses only the hand-written API client, StoryEditor and ShortDetail non-UI orchestration has been extracted into dedicated hooks/modules, and the mobile `server/` subtree plus `replit.md` are now explicitly classified as local build/deployment support rather than backend contract truth. No backend runtime behavior changed in this phase.

### 1. Goal

Reduce agent confusion inside the mobile repo by separating transport, state orchestration, and large-screen UI responsibilities.

### 2. In-scope flow(s)

- Story editor orchestration
- Short detail eventual consistency and asset probing
- API client layering and transport-owner clarity
- Replit server/build surface classification

### 3. Mobile entrypoints involved

- `client/App.tsx:33-53`
- `client/screens/StoryEditorScreen.tsx:36-120`
- `client/screens/story-editor/useStoryEditorSession.ts:20-245`
- `client/screens/story-editor/useStoryEditorFinalize.ts:76-562`
- `client/screens/story-editor/useStoryEditorCaptionPlacement.ts:23-194`
- `client/screens/ShortDetailScreen.tsx:17-127`
- `client/screens/short-detail/useShortDetailAvailability.ts:18-369`
- `client/screens/short-detail/useMediaReachability.ts:15-80`
- `client/components/shorts/ShortMediaViewer.tsx:37-178`
- `client/api/client.ts:1-823`
- `server/index.ts:1-220`
- `.replit:7-79`

### 4. Backend routes involved

- No new backend routes in this phase.
- Changes are about keeping mobile consumption understandable against the existing backend surface.

### 5. Current wiring summary

- `client/api/client.ts` is the sole active transport owner for the current mobile-used backend flows.
- `StoryEditorScreen` now acts as a container that composes extracted session, finalize/recovery, caption-placement, and presentation modules.
- `ShortDetailScreen` now acts as a container that composes extracted availability/retry, media reachability, and playback/presentation modules.
- The repo still contains a separate `server/` build/deployment surface for Expo/Replit workflows, but that surface is explicitly non-canonical for backend contract truth.

### 6. Proven issues / risks

- Before this phase, very large mobile screens and a dormant second transport path made ownership easy to misread.
- The highest confusion points were StoryEditor finalize/recovery, StoryEditor caption placement, ShortDetail availability/fallback, and the local `server/` subtree.
- The landed phase removes those ambiguity points without changing backend/mobile contract behavior.

### 7. Implemented work in order

1. Retired the dormant React Query runtime path and made the hand-written mobile API client the only active transport owner.
2. Split `StoryEditorScreen` into a container plus extracted session, finalize/recovery, caption-placement, and presentation modules.
3. Split `ShortDetailScreen` into a container plus extracted availability/retry, media reachability, and playback/presentation modules.
4. Classified the mobile `server/` subtree and `replit.md` as local build/deployment support only, not backend contract truth.
5. Refreshed the mobile docs front door and caller-truth docs to match the landed ownership model.

### 8. Landed file groups

- `client/screens/StoryEditorScreen.tsx`
- `client/screens/ShortDetailScreen.tsx`
- `client/screens/story-editor/*`
- `client/screens/short-detail/*`
- `client/components/story-editor/*`
- `client/components/shorts/ShortMediaViewer.tsx`
- `client/api/client.ts`
- mobile docs around active surfaces and repo front door
- mobile `server/README.md`
- mobile `replit.md`

### 9. Docs updated

- mobile `docs/MOBILE_USED_SURFACES.md`
- mobile `docs/DOCS_INDEX.md`
- mobile `server/README.md`
- mobile `replit.md`
- backend docs where Phase 7 status wording needed to match the landed repo truth

### 10. Verification standard

- `client/App.tsx` no longer mounts `QueryClientProvider`, and repo source search shows no active `@tanstack/react-query`, `QueryClientProvider`, or `query-client` usage in the mobile source/docs surfaces.
- StoryEditor and ShortDetail ownership is now obvious from the container imports and the extracted hook/component modules.
- The active mobile docs now distinguish client runtime code from build/deployment helper code quickly.

### 11. Open questions / uncertainties, if any

- None that block truthful Phase 7 closure in the current repo state.

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
- Phase 5 hardens the expensive upstream paths before the larger Phase 6 finalize architecture change.
- Phase 6 is the largest architectural change and should happen after contracts, logs, and backend tests are trustworthy.
- Phase 4B then expands mobile-side protection once backend contract drift is less likely.
- Phase 7 and Phase 8 simplify maintenance and shipping discipline around the stabilized core.
