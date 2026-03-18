# MOBILE_HARDENING_PLAN

Cross-repo verification date: 2026-03-18.

Goal: harden only the backend surface that the current mobile app actually depends on. This is a continuation ledger for the current repos, not a rebuild proposal.

## Phase Naming Note

- Execution-order authority lives only in `docs/CROSS_REPO_PRODUCTION_HARDENING_PLAN.md`.
- This document remains a separate backend route-hardening ledger. References to `Phase 0` through `Phase 3` below are `MOBILE_HARDENING_PLAN` phases only.
- Cross-Repo Phase 3 (`Request-Scoped Observability And Diagnostics`) landed on 2026-03-18 and is tracked in the cross-repo execution-order doc, not as this ledger's `Phase 3`.

## Parallel Billing Cutover Note

- The canonical billing-model replacement plan is `docs/TIME_BASED_RENDER_USAGE_MIGRATION_PLAN.md`.
- Phase 1 of that plan adds backend-only `GET /api/usage` and additive session `billingEstimate`.
- Phase 2 of that plan cuts backend finalize reservation/settlement over to usage seconds and adds additive finalize `data.billing`, but the estimate-proof gate still requires representative manual verification before the backend cutover can be marked verified.
- Phase 3 moved active mobile billing callers to `GET /api/usage`, render-time copy, and backend-owned estimate/availability checks; Phase 5 removed `GET /api/credits` from runtime.
- The Phase 5 cleanup/removal work is now landed. The overall cutover is still not release-ready until the Phase 2 estimate-proof gate and live Stripe/manual end-to-end verification are empirically closed.

## Working Rules

- The mobile repo's `docs/MOBILE_USED_SURFACES.md` is the source of truth for current mobile caller usage.
- Backend runtime and contract truth live here and in `docs/MOBILE_BACKEND_CONTRACT.md`.
- Only `MOBILE_CORE_NOW` and `MOBILE_CORE_SOON` routes are first-class launch scope.
- `LEGACY_WEB` work is allowed only when it directly affects mobile auth, billing, security, credits, or shared render stability.
- Keep the original phase numbering unchanged across code, docs, and commit history.

## This Ledger's Phase Order

- `Phase 0`: bootstrap + traceability
- `Phase 1`: finalize recovery + shorts detail bridge
- `Phase 2`: mutation reliability + admission-control review
- `Phase 3`: render-architecture scale track

## Phase 0 Completed

- `DONE`: Mobile normalization now preserves backend `requestId` on both success and failure envelopes.
  - Backend evidence: `src/http/respond.js:14-34`, `src/middleware/reqId.js:4-8`
  - Mobile evidence: `client/api/client.ts:77-145`, `client/api/client.ts:207-260`, `client/api/client.ts:697-805`

- `DONE`: Mobile now fails fast on missing production-critical backend/Firebase env instead of silently using placeholder values.
  - Mobile evidence: `client/api/client.ts:4-12`, `client/lib/firebase.ts:11-27`

- `DONE`: `/api/users/ensure` now provisions through a canonical neutral helper and canonical usage state; legacy `/api/credits` compatibility plumbing is removed in Phase 5.
  - Backend evidence: `src/services/user-doc.service.js:5-36`, `src/services/usage.service.js:133-168`, `src/routes/users.routes.js:16-37`
  - Why it mattered: bootstrap no longer depends on removed credit compatibility paths.

- `DONE`: `/api/users/ensure` now returns a symmetric mobile profile shape for both new and existing users.
  - Backend evidence: `src/routes/users.routes.js:24-26`
  - Mobile evidence: `client/api/client.ts:491-496`

- `DONE`: Mobile auth readiness now waits for successful backend provisioning instead of treating Firebase auth alone as app-ready.
  - Mobile evidence: `client/contexts/AuthContext.tsx:82-149`, `client/navigation/RootStackNavigator.tsx:20-60`

- `DONE`: persisted active story session state is now scoped by UID so sign-out/account switch does not leak the previous account's active session.
  - Mobile evidence: `client/contexts/ActiveStorySessionContext.tsx:28-89`, `client/navigation/HomeStackNavigator.tsx:30-57`

## Phase 1 Completed: Finalize Recovery + Shorts Detail Bridge

- `DONE`: Finalize recovery is now backend-backed through additive session `renderRecovery` state.
  - Backend evidence: `src/routes/story.routes.js:940-989`, `src/routes/story.routes.js:1147-1175`, `src/services/story.service.js:2325-2417`
  - Mobile evidence: `client/screens/StoryEditorScreen.tsx:974-1094`
  - Contract: `renderRecovery` now persists `pending`, `done`, and `failed` states with the active finalize `attemptId`, and mobile only trusts those states when the attempt identity matches the active `X-Idempotency-Key`.

- `DONE`: `renderRecovery.pending` is persisted before the blocking finalize work begins, and existing session readers remain untouched.
  - Backend evidence: `src/services/story.service.js:2330-2346`
  - Guardrail: Phase 1 adds only additive session fields; it does not repurpose top-level pipeline `status`.

- `DONE`: Mobile timeout/network-loss recovery now keeps the same finalize attempt identity and polls `GET /api/story/:sessionId` until that same-attempt recovery state becomes terminal.
  - Mobile evidence: `client/api/client.ts:743-859`, `client/screens/StoryEditorScreen.tsx:993-1094`
  - Current limit: recovery remains same-screen and bounded; if polling stays `pending`, the active attempt key remains in memory and the user is prompted to resume the same attempt or check Library shortly.

- `DONE`: Shorts detail now uses a compatibility bridge.
  - Backend evidence: `src/controllers/shorts.controller.js:101-131`, `src/controllers/shorts.controller.js:157-227`
  - Mobile evidence: `client/api/client.ts:578-584`, `client/screens/ShortDetailScreen.tsx:183-345`
  - Contract: detail now returns `id` while keeping `jobId`, probes `story.mp4` / `thumb.jpg` first, retains legacy filename fallback during the bridge period, and mobile still keeps `/api/shorts/mine?limit=50` fallback while eventual consistency settles.

## Phase 2 In Progress: Mutation Reliability + Admission-Control Review

- `DONE`: Active mobile editor/search routes now return stable domain-level 4xx/404 responses instead of collapsing known failures into generic 500s.
  - Backend routes: `src/routes/story.routes.js:578-827`, `src/routes/story.routes.js:1147-1175`
  - Backend services: `src/services/story.service.js:677-949`
  - Scope landed: `POST /api/story/search`, `POST /api/story/update-beat-text`, `POST /api/story/delete-beat`, `POST /api/story/search-shot`, `POST /api/story/update-shot`, and `GET /api/story/:sessionId`.
  - Guardrail: `GET /api/shorts/:jobId` stays runtime-unchanged; its current `404 NOT_FOUND` remains the intentional mobile pending-availability bridge.

- `NEXT`: Review explicit admission control for expensive mobile-used routes.
  - Review set: `POST /api/story/generate`, `POST /api/story/search`, `POST /api/story/search-shot`, `POST /api/story/finalize`
  - Current evidence: `src/routes/story.routes.js:218-233`, `src/routes/story.routes.js:578-610`, `src/routes/story.routes.js:692-776`, `src/routes/story.routes.js:940-989`, `src/routes/caption.preview.routes.js:109-145`
  - Important nuance: `generate` already has a daily cap; review it before adding new per-request rate limits.
  - Phase status: overall Phase 2 remains in progress until this admission-control review is complete.

## MOBILE_HARDENING_PLAN Phase 3 Explicit Scale Track

- `TRACK`: keep render-architecture scale visible without letting it jump ahead of launch-critical fixes.
  - Current backend evidence: `src/utils/render.semaphore.js:4-22`, `src/routes/story.routes.js:956-958`, `server.js:32-37`
  - Direction: queue-backed or async job/status finalize path with multi-instance-safe concurrency.

## Exit Criteria

- `Phase 0`: no mobile user can appear app-ready before backend provisioning succeeds, and request correlation is preserved in the mobile normalization layer.
- `Phase 1`: timeout/network-loss recovery is backend-backed, and newly rendered shorts use the current shorts-detail compatibility bridge while `/api/shorts/mine` fallback remains available during eventual consistency.
- `Phase 2`: editor/search routes stop collapsing known domain failures into generic 500s, and expensive mobile-used routes have explicit admission-control coverage.
- `Phase 3`: render work no longer depends on a long-lived blocking HTTP request or per-process-only concurrency control.
