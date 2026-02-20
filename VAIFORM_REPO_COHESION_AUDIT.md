# Vaiform Repo Cohesion Audit (C1 Baseline Truth Snapshot)

**Audit date**: 2026-02-19  
**Branch**: `feat/voice-ssot-tts`  
**Scope**: Docs-only truth snapshot from current code. No runtime changes.

Companion docs:

- `ROUTE_TRUTH_TABLE.md`
- `docs/ACTIVE_SURFACES.md`

## Executive Summary

| Category                            | Current truth                                                                                             | Evidence                                                                                                                                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime entrypoint                  | `server.js` boots `src/app.js`                                                                            | `server.js`, `src/app.js:1-398`                                                                                                                                                                                       |
| Legacy gate predicate               | `ENABLE_LEGACY_ROUTES === "1"`                                                                            | `src/app.js:35`, `src/app.js:259`, `src/app.js:283`, `src/app.js:298`, `src/app.js:314`                                                                                                                               |
| Debug gate predicate                | `VAIFORM_DEBUG === "1"`                                                                                   | `src/app.js:34`, `src/app.js:223`, `src/app.js:232`, `src/app.js:384`                                                                                                                                                 |
| Default flag values                 | legacy/debug both OFF by default                                                                          | `env.example:3`, `env.example:7`                                                                                                                                                                                      |
| Default static mode                 | dist static first, then `public` static, SPA fallback last                                                | `src/app.js:354`, `src/app.js:374-378`, `web/dist`                                                                                                                                                                    |
| Dual mounts exist                   | yes (`/` and `/api`, plus `/limits` and `/api/limits`)                                                    | `src/app.js:218-230`, `src/app.js:279-280`                                                                                                                                                                            |
| Precedence/shadowing risk           | yes (ordered root routers include multiple `GET /`)                                                       | `src/app.js:218`, `src/app.js:219`, `src/app.js:221`, `src/app.js:244`; route defs in `src/routes/health.routes.js:10`, `src/routes/whoami.routes.js:10`, `src/routes/credits.routes.js:11`, `src/routes/index.js:24` |
| Whoami surface truth                | `/whoami` and `/api/whoami` are not mounted API routes; whoami router roots are shadowed                  | `src/routes/whoami.routes.js:10`, `src/app.js:218-219`, `src/app.js:226-227`; runtime probe: `/api/whoami` -> `404`                                                                                                   |
| Checkout API alias truth            | mounted alias is `/api/start`, `/api/session`, `/api/subscription`, `/api/portal` (not `/api/checkout/*`) | `src/routes/checkout.routes.js:16-26`, `src/app.js:247-248`; runtime probe: `/api/checkout/start` -> `404`                                                                                                            |
| Caller mapping truth                | `apiFetch("/x")` resolves to `/api/x`; fallback only for GET `/credits`, `/whoami`, `/health`             | `web/dist/api.mjs:152`, `web/dist/api.mjs:156-163`                                                                                                                                                                    |
| CI enforced checks                  | `format:check`, `test:security`, `check:responses:changed`                                                | `.github/workflows/ci.yml:35-45`                                                                                                                                                                                      |
| CI non-blocking check               | `npm audit --audit-level=high`                                                                            | `.github/workflows/ci.yml:31-33`                                                                                                                                                                                      |
| Repo-wide envelope drift (observed) | still present in reachable and gated files                                                                | `node scripts/check-responses.js` output (latest audit run)                                                                                                                                                           |

## 1. Mount Topology Truth

`src/app.js` is the authoritative mount source.

### 1.1 Always-mounted core surfaces

- `GET/HEAD /health` inline route: `src/app.js:170-177`
- `POST /stripe/webhook` and `GET /stripe/webhook`: `src/app.js:120`, `src/routes/stripe.webhook.js:15`, `src/routes/stripe.webhook.js:159`
- Root + `/api` mounts for health/whoami/credits/generate: `src/app.js:211-223`
- Enhance: `/`, `/enhance`, `/api`: `src/app.js:241-243`
- Checkout: `/checkout` and `/api` prefixes; concrete paths become `/checkout/start|session|subscription|portal` and `/api/start|session|subscription|portal`: `src/app.js:247-248`, `src/routes/checkout.routes.js:16-26`
- Shorts: `/api/shorts`: `src/app.js:253`
- CDN: `/cdn`: `src/app.js:257`
- Assets: `/api/assets`: `src/app.js:275`
- Limits: `/api/limits` and `/limits`: `src/app.js:279-280`
- Creative page route: `/creative`: `src/app.js:298`
- Story: `/api/story`: `src/app.js:303`
- Caption preview: `/api/caption/preview` via `/api` mount: `src/app.js:308-310`, `src/routes/caption.preview.routes.js:101`
- User routes: `/api/user`, `/api/users`: `src/app.js:321`, `src/app.js:326`
- Inline no-op alias `POST /api/user/setup` exists but is shadowed by earlier `/api/user` router mount (`userRoutes` handles the request first): `src/app.js:321`, `src/routes/user.routes.js:12`, `src/app.js:330-333`

### 1.2 Legacy-gated surfaces

Mounted only when `ENABLE_LEGACY_ROUTES === "1"`:

- Uploads: `src/app.js:259-262`
- Voice: `src/app.js:283-287`
- TTS preview route mount: `src/app.js:298-301`
- Caption render: `src/app.js:314-317`

### 1.3 Debug-gated surfaces

Mounted only when `VAIFORM_DEBUG === "1"`:

- `POST /diag/echo`: `src/app.js:178-185`
- `app.use("/diag", diagRoutes)`: `src/app.js:216`
- `app.use("/api", diagHeadersRoutes)`: `src/app.js:225-227`

### 1.4 Commented/unmounted surfaces

- Studio routes (`/api/studio`): `src/app.js:264-267`
- Quotes routes (`/api/quotes`, `/quotes`): `src/app.js:269-273`
- Preview routes (`/api/preview`): `src/app.js:294-297`

## 2. Active vs Reachable Classification

C1 classification uses separate facts:

- `Default-Reachable`: endpoint is reachable with default env flags (`ENABLE_LEGACY_ROUTES=0`, `VAIFORM_DEBUG=0`).
- `Caller-Backed`: endpoint is called by files actually served/loaded by runtime entrypoints.
- `Active`: `Default-Reachable && Caller-Backed`.
- Callsite mapping: `apiFetch(\"/x\")` targets `/api/x`, with fallback only for GET `/credits|/whoami|/health`.

Primary evidence for served entrypoints:

- Default entrypoints redirect/link to `/creative`: `web/dist/index.html:40`, `web/dist/index.html:142`, `web/dist/components/header.js:13`, `public/components/header.js:34`
- `/creative` serves `public/creative.html` and article flow modules: `src/routes/creative.routes.js:11-13`, `public/creative.html:904`
- `web/dist` is served when present: `src/app.js:356`
- Dist/static precedence: with dist present, dist static is first, then `public` static, then SPA fallback: `src/app.js:356`, `src/app.js:376-380`

## 2.1 Dist-Mode Implication (C1 Caller Evidence Rule)

- With `web/dist` present, treat `web/dist` as the canonical source for served static assets and caller evidence.
- `public/` still matters, but only when reached by explicit routes (for example `/creative`) or when a file is absent in dist.
- Dist bundle strings are not caller evidence unless the bundle is referenced by a served entrypoint HTML.
- Net effect: Caller-Backed and Active sets must be computed from entrypoint-loaded dist files first, not `public/**` source callsites.

## 3. Response Contract Drift Truth

### 3.1 Enforced in CI (ratchet)

- Changed-file response gate only: `npm run check:responses:changed`  
  Evidence: `.github/workflows/ci.yml:41-45`, `scripts/check-responses-changed.mjs:59-83`, `scripts/check-responses-changed.mjs:84-86`.

### 3.2 Observed baseline (full scan, informational)

- Full drift scan command: `node scripts/check-responses.js`
- Latest audit run confirms C9 scope is canonicalized for:
  - `src/routes/stripe.webhook.js`
  - `src/controllers/generate.controller.js`
  - `src/controllers/shorts.controller.js`
- Latest run still confirms many non-C9 gated/unmounted legacy drifts.

## 4. SSOT Collision Truth

| Concern         | Current operational SSOT                   | Parallel/legacy surface             | Notes                                                                                                                                               |
| --------------- | ------------------------------------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth middleware | `src/middleware/requireAuth.js`            | _Removed in C10_                    | Mounted routes import `requireAuth` directly; duplicate `src/middleware/auth.middleware.js` was removed after import-proof confirmed no runtime usage. |
| Plan guards     | `src/middleware/planGuards.js`             | _Removed in C11_                    | Route imports use `planGuards.js` in story/shorts/quotes/studio; `/api/assets/ai-images` is hard-disabled with canonical `410` (`src/routes/assets.routes.js:12-20`). |
| Idempotency     | `idempotency.firestore.js`                 | `idempotency.js` exists             | Generate/finalize paths reference Firestore middleware (`src/routes/generate.routes.js:3`, `src/routes/story.routes.js:5`).                         |
| Validation      | `src/schemas/*` + `validate.middleware.js` | inline Zod in route files           | Story routes perform inline `safeParse` checks (`src/routes/story.routes.js`, multiple).                                                            |

## 5. CI Truth Snapshot

Current `.github/workflows/ci.yml` behavior:

1. `npm ci` (`.github/workflows/ci.yml:28-29`)
2. non-blocking `npm audit --audit-level=high` (`.github/workflows/ci.yml:31-33`)
3. blocking `npm run format:check` (`.github/workflows/ci.yml:35-36`)
4. blocking `npm run test:security` (`.github/workflows/ci.yml:38-39`)
5. blocking `npm run check:responses:changed` with PR SHA envs (`.github/workflows/ci.yml:41-45`)

## 6. What Was Corrected From Prior Docs

- Removed stale claim that CI does not run response/security checks.
- Corrected gating truth to exact predicates (`ENABLE_LEGACY_ROUTES === "1"`, `VAIFORM_DEBUG === "1"`).
- Corrected active-surface logic to computed `Active = Default-Reachable && Caller-Backed`.
- Added explicit precedence/shadowing treatment for ordered root mounts.
- Corrected whoami route truth: `/whoami` and `/api/whoami` are not mounted API endpoints.
- Corrected checkout alias truth: `/api/checkout/*` is absent; concrete alias is `/api/start|session|subscription|portal`.
- Corrected caller-evidence semantics using `apiFetch` path resolution (`/api`-prefixed by default).
- Marked inline `/api/user/setup` no-op as shadowed by router order.
- Added dist-aware caller rule: dist is canonical for static caller evidence when present; `public/` remains explicit-route/missing-file fallback.
- Separated CI-enforced ratchet (`check:responses:changed`) from observed repo-wide drift (`check-responses.js`).

## 7. Canonical References

- Route inventory and per-endpoint classifications: `ROUTE_TRUTH_TABLE.md`
- Caller map and production active surfaces: `docs/ACTIVE_SURFACES.md`
