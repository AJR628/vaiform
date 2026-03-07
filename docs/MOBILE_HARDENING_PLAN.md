# MOBILE_HARDENING_PLAN

Audit date: 2026-03-07

Goal: harden only the backend surface that the mobile app uses now or is about to use next.
This is a continuation plan for the current repo, not a rebuild proposal.

## Working Rules

- `docs/MOBILE_USED_SURFACES.md` is the source of truth for current mobile usage.
- Only `MOBILE_CORE_NOW` and `MOBILE_CORE_SOON` routes are first-class launch scope.
- `LEGACY_WEB` work is allowed only when it directly affects mobile auth, billing, security, or
  shared stability.
- `REMOVE_LATER` work is containment or retirement only.

## Must Harden Now vs Cleanup Later

- Must harden now: Phase 0 and Phase 1.
- Useful after launch hardening: Phase 2.
- Cleanup later: Phase 3.

## Phase 0: Blockers / Contract Mismatches

- ✅ Fix the shorts detail storage-name drift.
  - Why: story finalize writes `artifacts/${uid}/${jobId}/story.mp4` and `thumb.jpg`, but
    short-detail fallback probing still expects `short.mp4`, `cover.jpg`, and `meta.json`.
    Mobile already compensates with a list-route fallback, which is a launch smell rather than a
    durable contract.
  - Evidence: `src/services/story.service.js:1921-1945`, `src/controllers/shorts.controller.js:104-168`,
    `docs/MOBILE_USED_SURFACES.md`.

- ✅ Freeze the finalize contract around what mobile already depends on.
  - Why: mobile launch depends on `X-Idempotency-Key`, top-level `shortId`,
    `IDEMPOTENT_IN_PROGRESS`, `INSUFFICIENT_CREDITS`, `SERVER_BUSY`, and `GET /api/story/:sessionId`
    as recovery truth.
  - Evidence: `src/middleware/idempotency.firestore.js:33-84`, `src/routes/story.routes.js:818-856`,
    `src/routes/story.routes.js:1002-1024`, `docs/MOBILE_USED_SURFACES.md`.

- ✅ Normalize all mobile docs and tests on canonical `GET /api/credits`.
  - Why: root `/credits` aliases are already removed from runtime truth, so mobile launch docs must
    not keep accidental root-path drift alive.
  - Evidence: `src/app.js:216`, `src/routes/credits.routes.js:11`, `ROUTE_TRUTH_TABLE.md:52`.

- ✅ Map mobile editor domain failures to stable 4xx/404 behavior instead of generic 500s.
  - Why: `search`, `search-shot`, `update-shot`, `delete-beat`, and `update-beat-text` all sit on
    the live mobile path, but several service-level errors currently collapse into generic 500s.
  - Evidence: `src/routes/story.routes.js:497-725`, `src/services/story.service.js:427-550`,
    `src/services/story.service.js:628-700`.

## Phase 1: Launch-Critical Hardening

- ✅ Add explicit route-level rate limits to `POST /api/story/search`,
  `POST /api/story/search-shot`, and `POST /api/story/finalize`.
  - Why: these are mobile-core-now expensive routes. Caption preview already has rate limiting, and
    generate/plan already have a daily cap, but search/search-shot/finalize are still exposed.
  - Evidence: `src/routes/caption.preview.routes.js:91-113`, `src/routes/story.routes.js:148`,
    `src/routes/story.routes.js:477`, `src/routes/story.routes.js:498`,
    `src/routes/story.routes.js:595`, `src/routes/story.routes.js:819`.

- ✅ Default-disable `POST /api/story/render`.
  - Why: it is outside the current mobile caller set, has no user-facing web caller, and bypasses
    finalize's idempotent credit-reservation path while still competing for render slots.
  - Evidence: `src/routes/story.routes.js:775-816`, `src/routes/story.routes.js:819-856`,
    `docs/ACTIVE_SURFACES.md:79`.

- ✅ Apply revocation-aware auth at least to finalize.
  - Why: finalize is the highest-value authenticated mobile write surface, but auth currently uses
    `verifyIdToken(idToken)` without revocation checks.
  - Evidence: `src/middleware/requireAuth.js:5-19`, `src/routes/story.routes.js:819-856`.

- ✅ Verify and preserve `GET /api/story/:sessionId` as the render-recovery contract.
  - Why: renders remain synchronous, the server timeout is 15 minutes, and concurrency is bounded to
    3 per process. Mobile launch should harden around this repo shape instead of adding a queue
    prelaunch.
  - Evidence: `server.js:32-39`, `src/utils/render.semaphore.js:1-22`,
    `src/routes/story.routes.js:830-841`.

## Phase 2: Reliability Improvements

- ✅ Canonicalize the mobile mutation envelopes around the fields mobile actually reads.
  - Why: mobile mostly uses success/failure control flow plus refetches, but route shapes still vary
    and some legacy conventions survive. Align the editor mutations to one stable contract.
  - Evidence: `src/http/respond.js:14-34`, `docs/MOBILE_USED_SURFACES.md`,
    `src/routes/story.routes.js:518-725`.

- ✅ Make `POST /api/users/ensure` symmetric enough for mobile profile bootstrap.
  - Why: mobile stores the returned object, but new-user and existing-user payloads do not expose the
    same fields today.
  - Evidence: `src/routes/users.routes.js:51-59`, `src/routes/users.routes.js:80-87`.

- ⚠️ Promote `POST /api/story/insert-beat` only when the mobile caller lands.
  - Why: it is the only plausible `MOBILE_CORE_SOON` route, but it is not mobile-core-now today.
  - Evidence: `src/routes/story.routes.js:635-662`, `docs/MOBILE_USED_SURFACES.md`.

- ⚠️ Revisit checkout/webhook surfaces only if mobile billing deep-link behavior is broken.
  - Why: mobile production still depends on credits existing, but billing APIs are web-first, not
    mobile-core APIs.
  - Evidence: `src/routes/checkout.routes.js:16-31`, `src/routes/stripe.webhook.js`,
    `web/public/js/pricing.js:114`, `web/public/js/buy-credits.js:67-167`.

## Phase 3: Legacy Containment / Cleanup

- ✅ Freeze non-mobile product routes into `LEGACY_WEB` and `REMOVE_LATER` buckets.
  - Why: backend drift already came from treating all mounted routes as equally important.
  - Evidence: `docs/ACTIVE_SURFACES.md`, `ROUTE_TRUTH_TABLE.md`,
    `docs/TRUTH_FREEZE_AUDIT_2026-02-28.md`.

- ⚠️ Retire `REMOVE_LATER` routes after current caller freeze:
  `POST /api/story/update-script`, `POST /api/story/timeline`, `POST /api/story/captions`,
  `POST /api/story/render`, `POST /api/user/setup`, `GET /api/user/me`, `GET /api/whoami`,
  `GET /api/limits/usage`.
  - Why: they have no current mobile caller and no current user-facing web caller.
  - Evidence: `src/routes/story.routes.js:174-205`, `src/routes/story.routes.js:727-816`,
    `src/routes/user.routes.js:13-56`, `src/routes/whoami.routes.js:11-16`,
    `src/routes/limits.routes.js:7`, `docs/TRUTH_FREEZE_AUDIT_2026-02-28.md:41-43`.

- ⛔ Do not expand scope into voice/TTS, stale profile routes, or old web-studio cleanup.
  - Why: those routes are not caller-backed for the current mobile product.
  - Evidence: `docs/MOBILE_USED_SURFACES.md`, `docs/MOBILE_SPEC_PACK.md`.

- ⛔ Do not propose a full backend rebuild or queue migration before mobile launch.
  - Why: the current repo already supports the mobile flow; the lower-risk path is narrow contract
    repair, route gating, and admission control on the existing code.
  - Evidence: `server.js:32-39`, `src/utils/render.semaphore.js:1-22`,
    `src/routes/story.routes.js:818-856`.

## Exit Criteria

- `POST /api/story/finalize` has an explicit mobile contract, required idempotency, and documented
  recovery behavior.
- `GET /api/shorts/:jobId` resolves freshly rendered story outputs without depending on list-route
  fallback behavior.
- Mobile editor mutations return stable, diagnosable failures instead of generic 500s.
- Only `MOBILE_CORE_NOW` routes are in the launch-critical hardening queue.
- `LEGACY_WEB` and `REMOVE_LATER` surfaces are documented and no longer treated as equal-priority
  launch scope.
