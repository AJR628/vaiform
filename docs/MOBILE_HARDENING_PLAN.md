# MOBILE_HARDENING_PLAN

Cross-repo verification date: 2026-03-09.

Goal: harden only the backend surface that the current mobile app actually depends on, in the same phase order used for implementation and docs. This is a continuation plan for the current repos, not a rebuild proposal.

## Working Rules

- The mobile repo's `docs/MOBILE_USED_SURFACES.md` is the source of truth for current mobile caller usage.
- Backend runtime and contract truth live here and in `docs/MOBILE_BACKEND_CONTRACT.md`.
- Only `MOBILE_CORE_NOW` and `MOBILE_CORE_SOON` routes are first-class launch scope.
- `LEGACY_WEB` work is allowed only when it directly affects mobile auth, billing, security, credits, or shared render stability.
- Keep the original phase numbering unchanged across code, docs, and commit history.

## Locked Phase Order

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

- `DONE`: `/api/users/ensure` and `GET /api/credits` now share one canonical backend provisioning helper.
  - Backend evidence: `src/services/credit.service.js:81-87`, `src/services/credit.service.js:225-268`, `src/routes/users.routes.js:15-31`, `src/controllers/credits.controller.js:4-15`
  - Why it mattered: the prior credits path could create a partial user doc with missing mobile profile fields.

- `DONE`: `/api/users/ensure` now returns a symmetric mobile profile shape for both new and existing users.
  - Backend evidence: `src/routes/users.routes.js:24-26`
  - Mobile evidence: `client/api/client.ts:491-496`

- `DONE`: Mobile auth readiness now waits for successful backend provisioning instead of treating Firebase auth alone as app-ready.
  - Mobile evidence: `client/contexts/AuthContext.tsx:82-149`, `client/navigation/RootStackNavigator.tsx:20-60`

- `DONE`: `refreshCredits()` can now seed a null `userProfile` instead of preserving `null` forever after a prior ensure failure.
  - Mobile evidence: `client/contexts/AuthContext.tsx:157-179`

- `DONE`: persisted active story session state is now scoped by UID so sign-out/account switch does not leak the previous account's active session.
  - Mobile evidence: `client/contexts/ActiveStorySessionContext.tsx:28-89`, `client/navigation/HomeStackNavigator.tsx:30-57`

## Phase 1 Completed: Finalize Recovery + Shorts Detail Bridge

- `DONE`: Finalize recovery is now backend-backed through additive session `renderRecovery` state.
  - Backend evidence: `src/routes/story.routes.js:829-843`, `src/services/story.service.js:61-167`, `src/services/story.service.js:2144-2218`
  - Mobile evidence: `client/screens/StoryEditorScreen.tsx:122-155`, `client/screens/StoryEditorScreen.tsx:943-1099`
  - Contract: `renderRecovery` now persists `pending`, `done`, and `failed` states with the active finalize `attemptId`, and mobile only trusts those states when the attempt identity matches the active `X-Idempotency-Key`.

- `DONE`: `renderRecovery.pending` is persisted before the blocking finalize work begins, and existing session readers remain untouched.
  - Backend evidence: `src/services/story.service.js:2148-2156`
  - Guardrail: Phase 1 adds only additive session fields; it does not repurpose top-level pipeline `status`.

- `DONE`: Mobile timeout/network-loss recovery now keeps the same finalize attempt identity and polls `GET /api/story/:sessionId` until that same-attempt recovery state becomes terminal.
  - Mobile evidence: `client/api/client.ts:696-804`, `client/screens/StoryEditorScreen.tsx:1001-1099`
  - Current limit: recovery remains same-screen and bounded; if polling stays `pending`, the active attempt key remains in memory and the user is prompted to resume the same attempt or check Library shortly.

- `DONE`: Shorts detail now uses a compatibility bridge.
  - Backend evidence: `src/controllers/shorts.controller.js:107-129`, `src/controllers/shorts.controller.js:150-208`
  - Mobile evidence: `client/api/client.ts:318-334`, `client/screens/ShortDetailScreen.tsx:356-379`
  - Contract: detail now returns `id` while keeping `jobId`, probes `story.mp4` / `thumb.jpg` first, and retains legacy filename fallback during the bridge period.

## Phase 2 Next: Mutation Reliability + Admission-Control Review

- `NEXT`: Map editor/search domain failures to stable 4xx/404 responses.
  - Backend routes: `src/routes/story.routes.js:497-725`
  - Backend services: `src/services/story.service.js:468-550`, `src/services/story.service.js:628-700`
  - Minimal boundary: keep envelopes stable; fix the error mapping and `updateBeatText()` null-session guard.

- `NEXT`: Review explicit admission control for expensive mobile-used routes.
  - Review set: `POST /api/story/generate`, `POST /api/story/search`, `POST /api/story/search-shot`, `POST /api/story/finalize`
  - Current evidence: `src/routes/story.routes.js:148`, `src/routes/story.routes.js:497-516`, `src/routes/story.routes.js:594-633`, `src/routes/story.routes.js:818-856`, `src/routes/caption.preview.routes.js:91-108`
  - Important nuance: `generate` already has a daily cap; review it before adding new per-request rate limits.

## Phase 3 Explicit Scale Track

- `TRACK`: keep render-architecture scale visible without letting it jump ahead of launch-critical fixes.
  - Current backend evidence: `src/utils/render.semaphore.js:4-22`, `src/routes/story.routes.js:830-841`, `server.js:32-37`
  - Direction: queue-backed or async job/status finalize path with multi-instance-safe concurrency.

## Exit Criteria

- `Phase 0`: no mobile user can appear app-ready before backend provisioning succeeds, and request correlation is preserved in the mobile normalization layer.
- `Phase 1`: timeout/network-loss recovery is backend-backed, and newly rendered shorts load directly from detail without relying on list fallback.
- `Phase 2`: editor/search routes stop collapsing known domain failures into generic 500s, and expensive mobile-used routes have explicit admission-control coverage.
- `Phase 3`: render work no longer depends on a long-lived blocking HTTP request or per-process-only concurrency control.
