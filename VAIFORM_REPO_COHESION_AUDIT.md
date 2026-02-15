# Vaiform Repo Cohesion Audit (C1 Baseline Truth Snapshot)

**Audit date**: 2026-02-15  
**Branch**: `feat/voice-ssot-tts`  
**Scope**: Docs-only truth snapshot from current code. No runtime changes.

Companion docs:
- `ROUTE_TRUTH_TABLE.md`
- `docs/ACTIVE_SURFACES.md`

## Executive Summary

| Category | Current truth | Evidence |
|---|---|---|
| Runtime entrypoint | `server.js` boots `src/app.js` | `server.js`, `src/app.js:1-383` |
| Legacy gate predicate | `ENABLE_LEGACY_ROUTES === "1"` | `src/app.js:35`, `src/app.js:259`, `src/app.js:283`, `src/app.js:298`, `src/app.js:314` |
| Debug gate predicate | `VAIFORM_DEBUG === "1"` | `src/app.js:34`, `src/app.js:216`, `src/app.js:225`, `src/app.js:369` |
| Default flag values | legacy/debug both OFF by default | `env.example:3`, `env.example:7` |
| Dual mounts exist | yes (`/` and `/api`, plus `/limits` and `/api/limits`) | `src/app.js:211-223`, `src/app.js:279-280` |
| Precedence/shadowing risk | yes (ordered root routers include multiple `GET /`) | `src/app.js:211`, `src/app.js:212`, `src/app.js:214`, `src/app.js:237`; route defs in `src/routes/health.routes.js:10`, `src/routes/whoami.routes.js:10`, `src/routes/credits.routes.js:11`, `src/routes/index.js:24` |
| CI enforced checks | `format:check`, `test:security`, `check:responses:changed` | `.github/workflows/ci.yml:35-45` |
| CI non-blocking check | `npm audit --audit-level=high` | `.github/workflows/ci.yml:31-33` |
| Repo-wide envelope drift (observed) | still present in reachable and gated files | `node scripts/check-responses.js` output (latest audit run) |

## 1. Mount Topology Truth

`src/app.js` is the authoritative mount source.

### 1.1 Always-mounted core surfaces

- `GET/HEAD /health` inline route: `src/app.js:170-177`
- `POST /stripe/webhook` and `GET /stripe/webhook`: `src/app.js:120`, `src/routes/stripe.webhook.js:12`, `src/routes/stripe.webhook.js:144`
- Root + `/api` mounts for health/whoami/credits/generate: `src/app.js:211-223`
- Enhance: `/`, `/enhance`, `/api`: `src/app.js:241-243`
- Checkout: `/checkout`, `/api`: `src/app.js:247-248`
- Shorts: `/api/shorts`: `src/app.js:253`
- CDN: `/cdn`: `src/app.js:257`
- Assets: `/api/assets`: `src/app.js:275`
- Limits: `/api/limits` and `/limits`: `src/app.js:279-280`
- Creative page route: `/creative`: `src/app.js:289`
- Story: `/api/story`: `src/app.js:303`
- Caption preview: `/api/caption/preview` via `/api` mount: `src/app.js:308-310`, `src/routes/caption.preview.routes.js:101`
- User routes: `/api/user`, `/api/users`: `src/app.js:321`, `src/app.js:326`
- Legacy alias no-op: `POST /api/user/setup`: `src/app.js:330-333`

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

Primary evidence for served entrypoints:

- `/creative` serves `public/creative.html`: `src/routes/creative.routes.js:11-13`
- `public/creative.html` loads `creative.article.mjs`: `public/creative.html:724`
- `public/creative.html` loads auth bridge/firebase modules: `public/creative.html:39-43`
- `web/dist` is served when present: `src/app.js:341-347`

## 3. Response Contract Drift Truth

### 3.1 Enforced in CI (ratchet)

- Changed-file response gate only: `npm run check:responses:changed`  
  Evidence: `.github/workflows/ci.yml:41-45`, `scripts/check-responses-changed.mjs:59-83`, `scripts/check-responses-changed.mjs:84-86`.

### 3.2 Observed baseline (full scan, informational)

- Full drift scan command: `node scripts/check-responses.js`  
- Latest audit run confirms violations in reachable files (examples):
  - `src/app.js` (`code/message` on `/generate` 405)
  - `src/handlers/credits.get.js` (`code/message`)
  - `src/routes/user.routes.js` (`ok/reason`)
  - `src/routes/stripe.webhook.js` (`ok/reason`)
- Latest run also confirms many gated/unmounted legacy drifts.

## 4. SSOT Collision Truth

| Concern | Current operational SSOT | Parallel/legacy surface | Notes |
|---|---|---|---|
| Auth middleware | `src/middleware/requireAuth.js` | `src/middleware/auth.middleware.js` | Mounted routes import `requireAuth` directly. |
| Plan guards | split usage | `planGuards.js` and `planGuard.js` | `story.routes.js` uses `planGuards.js`; `assets.routes.js` still imports `planGuard.js` (`src/routes/assets.routes.js:4`, `src/routes/assets.routes.js:12`). |
| Idempotency | `idempotency.firestore.js` | `idempotency.js` exists | Generate/finalize paths reference Firestore middleware (`src/routes/generate.routes.js:3`, `src/routes/story.routes.js:5`). |
| Validation | `src/schemas/*` + `validate.middleware.js` | inline Zod in route files | Story routes perform inline `safeParse` checks (`src/routes/story.routes.js`, multiple). |

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
- Separated CI-enforced ratchet (`check:responses:changed`) from observed repo-wide drift (`check-responses.js`).

## 7. Canonical References

- Route inventory and per-endpoint classifications: `ROUTE_TRUTH_TABLE.md`
- Caller map and production active surfaces: `docs/ACTIVE_SURFACES.md`
