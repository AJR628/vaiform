# MOBILE_HARDENING_PLAN

Cross-repo verification date: 2026-03-07.

Goal: harden only the backend surface that the current mobile app actually depends on. This is a continuation plan for the current repo, not a rebuild proposal.

## Working Rules

- `docs/MOBILE_USED_SURFACES.md` is the source of truth for current mobile usage.
- Only `MOBILE_CORE_NOW` and `MOBILE_CORE_SOON` routes are first-class launch scope.
- `LEGACY_WEB` work is allowed only when it directly affects mobile auth, billing, security, credits, or shared render stability.
- `REMOVE_LATER` work is containment or retirement only.

## Must Harden Now vs Cleanup Later

- Must harden now: Phase 0 and Phase 1.
- Useful after launch hardening: Phase 2.
- Cleanup later: Phase 3.

## Phase 0: Blockers / Contract Mismatches

- ? Resolve finalize idempotency mismatch.
  - Route classification: `MOBILE_CORE_NOW`
  - Mobile caller(s): `client/screens/StoryEditorScreen.tsx:834-911`, `client/api/client.ts:676-760`
  - Backend handler(s): `src/middleware/idempotency.firestore.js:33-37`, `src/routes/story.routes.js:818-856`
  - Contract mismatch or risk: backend requires `X-Idempotency-Key`, but the current mobile finalize client does not send it.
  - Why it matters to mobile launch: current mobile render requests can be rejected before render starts.
  - Minimal fix: add a stable per-render idempotency key in the mobile caller, or explicitly change backend policy if that is lower risk.
  - Docs to update when fixed: `docs/MOBILE_USED_SURFACES.md`, `docs/MOBILE_BACKEND_CONTRACT.md`

- ? Resolve credits path truth.
  - Route classification: `MOBILE_CORE_NOW`
  - Mobile caller(s): `client/api/client.ts:478-484`, `client/contexts/AuthContext.tsx:87-103`
  - Backend handler(s): `src/app.js:215-217`, `src/routes/credits.routes.js:7-11`, `src/controllers/credits.controller.js:5-17`
  - Contract mismatch or risk: mobile calls `"/credits"`; backend mounts `/api/credits`.
  - Why it matters to mobile launch: route correctness currently depends on unverified runtime config or proxy behavior outside repo code.
  - Minimal fix: either align the mobile wrapper path or explicitly pin `EXPO_PUBLIC_API_BASE_URL` to include `/api` and document that convention.
  - Docs to update when fixed: `docs/MOBILE_USED_SURFACES.md`, `docs/MOBILE_BACKEND_CONTRACT.md`

- ? Fix shorts detail contract drift.
  - Route classification: `MOBILE_CORE_NOW`
  - Mobile caller(s): `client/screens/ShortDetailScreen.tsx:143-333`, `client/screens/ShortDetailScreen.tsx:357-379`
  - Backend handler(s): `src/controllers/shorts.controller.js:93-175`, `src/services/story.service.js:1921-1945`
  - Contract mismatch or risk: detail route returns `jobId` instead of `id`, and probes `short.mp4` / `cover.jpg` / `meta.json` while story finalize writes `story.mp4` / `thumb.jpg`.
  - Why it matters to mobile launch: direct post-render detail is not a clean contract; mobile already compensates with repeated 404 retries and list fallback.
  - Minimal fix: make detail resolve current story outputs and return the same identifier shape mobile already uses elsewhere.
  - Docs to update when fixed: `docs/MOBILE_USED_SURFACES.md`, `docs/MOBILE_BACKEND_CONTRACT.md`

- ? Map mobile editor domain failures to stable 4xx/404 behavior.
  - Route classification: `MOBILE_CORE_NOW`
  - Mobile caller(s): `client/screens/ScriptScreen.tsx:162-235`, `client/screens/ClipSearchModal.tsx:49-104`, `client/screens/StoryEditorScreen.tsx:679-820`
  - Backend handler(s): `src/routes/story.routes.js:497-725`, `src/services/story.service.js:427-550`, `src/services/story.service.js:628-700`
  - Contract mismatch or risk: several live mobile mutation routes still collapse domain errors into generic 500s.
  - Why it matters to mobile launch: mobile cannot distinguish bad session state from a true server fault.
  - Minimal fix: map known service errors to explicit 400/404 responses without redesigning the routes.
  - Docs to update when fixed: `docs/MOBILE_BACKEND_CONTRACT.md`

## Phase 1: Launch-Critical Hardening

- ? Add focused rate limits to `POST /api/story/search`, `POST /api/story/search-shot`, and `POST /api/story/finalize`.
  - Route classification: `MOBILE_CORE_NOW`
  - Mobile caller(s): `client/screens/ScriptScreen.tsx:141-159`, `client/screens/ClipSearchModal.tsx:49-80`, `client/screens/StoryEditorScreen.tsx:834-911`
  - Backend handler(s): `src/routes/story.routes.js:497-516`, `src/routes/story.routes.js:594-633`, `src/routes/story.routes.js:818-856`
  - Contract mismatch or risk: caption preview already has rate limiting and plan/generate already have daily caps, but the remaining expensive mobile-core routes are still exposed.
  - Why it matters to mobile launch: protects shared search/render capacity.
  - Minimal fix: add per-UID/per-IP rate limits without changing envelopes.
  - Docs to update when fixed: `docs/MOBILE_BACKEND_CONTRACT.md`

- ? Default-disable `POST /api/story/render`.
  - Route classification: `REMOVE_LATER`
  - Mobile caller(s): none
  - Backend handler(s): `src/routes/story.routes.js:775-816`
  - Contract mismatch or risk: legacy render route bypasses finalize's idempotent credit-reservation path while still competing for render slots.
  - Why it matters to mobile launch: unnecessary shared risk on the same render infrastructure.
  - Minimal fix: keep `DISABLE_STORY_RENDER_ROUTE=1` behavior on by default.
  - Docs to update when fixed: `docs/LEGACY_WEB_SURFACES.md`

- ? Apply revocation-aware auth at least to finalize.
  - Route classification: `MOBILE_CORE_NOW`
  - Mobile caller(s): `client/screens/StoryEditorScreen.tsx:834-911`
  - Backend handler(s): `src/middleware/requireAuth.js:5-19`, `src/routes/story.routes.js:818-856`
  - Contract mismatch or risk: current auth verifies token validity, not revocation.
  - Why it matters to mobile launch: finalize is the highest-value authenticated write surface.
  - Minimal fix: add revocation checking on finalize first; expand only if latency is acceptable.
  - Docs to update when fixed: `docs/MOBILE_BACKEND_CONTRACT.md`

- ? Preserve `GET /api/story/:sessionId` as the render-recovery contract.
  - Route classification: `MOBILE_CORE_NOW`
  - Mobile caller(s): `client/screens/ScriptScreen.tsx:64-84`, `client/screens/StoryEditorScreen.tsx:367-449`
  - Backend handler(s): `src/routes/story.routes.js:1002-1024`, `server.js:32-39`, `src/utils/render.semaphore.js:1-22`
  - Contract mismatch or risk: renders remain synchronous and bounded to three concurrent slots.
  - Why it matters to mobile launch: this is the existing repo shape mobile already fits.
  - Minimal fix: harden around this route rather than adding a queue prelaunch.
  - Docs to update when fixed: `docs/MOBILE_BACKEND_CONTRACT.md`

## Phase 2: Reliability Improvements

- ? Canonicalize mobile mutation envelopes around the fields mobile actually reads.
  - Route classification: `MOBILE_CORE_NOW`
  - Mobile caller(s): `client/screens/ScriptScreen.tsx:184-195`, `client/screens/ClipSearchModal.tsx:61-70`, `client/screens/StoryEditorScreen.tsx:686-701`
  - Backend handler(s): `src/routes/story.routes.js:518-725`
  - Contract mismatch or risk: mobile currently survives because it either ignores mutation payloads or uses fallback helpers on partial envelopes.
  - Why it matters to mobile launch: fewer fallback assumptions and cleaner error recovery.
  - Minimal fix: keep current routes, but make the envelopes and failure semantics consistent.
  - Docs to update when fixed: `docs/MOBILE_USED_SURFACES.md`, `docs/MOBILE_BACKEND_CONTRACT.md`

- ? Make `POST /api/users/ensure` symmetric enough for mobile profile bootstrap.
  - Route classification: `MOBILE_CORE_NOW`
  - Mobile caller(s): `client/contexts/AuthContext.tsx:63-76`, `client/api/client.ts:469-472`
  - Backend handler(s): `src/routes/users.routes.js:15-92`
  - Contract mismatch or risk: mobile stores the returned profile, but new-user and existing-user responses do not expose the same fields.
  - Why it matters to mobile launch: current wrapper has to patch missing `plan` defensively.
  - Minimal fix: return the same shape for both new and existing users.
  - Docs to update when fixed: `docs/MOBILE_USED_SURFACES.md`, `docs/MOBILE_BACKEND_CONTRACT.md`

- ?? Promote `POST /api/story/insert-beat` only when the mobile caller lands.
  - Route classification: `MOBILE_CORE_SOON`
  - Mobile caller(s): none yet
  - Backend handler(s): `src/routes/story.routes.js:635-662`, `src/services/story.service.js:555-623`
  - Why it matters to mobile launch: it does not today.
  - Minimal fix: none until caller exists.
  - Docs to update when fixed: `docs/MOBILE_USED_SURFACES.md`, `docs/MOBILE_BACKEND_CONTRACT.md`

- ?? Revisit checkout/webhook surfaces only if mobile billing is blocked.
  - Route classification: `LEGACY_WEB`
  - Mobile caller(s): none direct
  - Backend handler(s): `src/routes/checkout.routes.js`, `src/routes/stripe.webhook.js`
  - Why it matters to mobile launch: only through credits acquisition, not through direct mobile API usage.
  - Minimal fix: keep scope narrow to billing correctness.
  - Docs to update when fixed: `docs/LEGACY_WEB_SURFACES.md`

## Phase 3: Legacy Containment / Cleanup

- ? Freeze non-mobile product routes into `LEGACY_WEB` and `REMOVE_LATER` buckets.
  - Why: backend drift already came from treating every mounted route as equal launch scope.
  - Docs: `docs/LEGACY_WEB_SURFACES.md`

- ?? Retire `REMOVE_LATER` routes after current caller freeze.
  - Routes: `POST /api/story/update-script`, `POST /api/story/timeline`, `POST /api/story/captions`, `POST /api/story/render`, `POST /api/user/setup`, `GET /api/user/me`, `GET /api/whoami`, `GET /api/limits/usage`
  - Why: no current mobile caller and no current user-facing web caller.

- ? Do not expand scope into voice/TTS, stale profile routes, or old web-studio cleanup.
  - Why: not caller-backed for the current mobile product.

- ? Do not propose a full backend rebuild or queue migration before mobile launch.
  - Why: the lower-risk path is narrow contract repair, route gating, and admission control on the existing code.

## Exit Criteria

- Mobile finalize and backend finalize agree on idempotency behavior.
- Credits path truth is explicit in code, not hidden in env assumptions.
- Shorts detail resolves current story outputs and returns the identifier shape the mobile app reads.
- Mobile editor mutations return diagnosable failures instead of generic 500s.
- Only `MOBILE_CORE_NOW` routes remain in the launch-critical hardening queue.
- `LEGACY_WEB` and `REMOVE_LATER` surfaces stay documented and out of the mobile-first queue.
