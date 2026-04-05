# MAINTENANCE_FRONT_DOOR
- Status: CANONICAL
- Owner repo: backend
- Source of truth for: founder/operator maintenance front door, runtime route-mount authority, monitored surface tiers, and maintenance-first canonical doc entrypoints
- Canonical counterpart/source: mobile repo `docs/DOCS_INDEX.md`, mobile repo `docs/MOBILE_USED_SURFACES.md`, backend repo `docs/API_CONTRACT.md`, backend repo `docs/MOBILE_BACKEND_CONTRACT.md`, backend repo `docs/LEGACY_WEB_SURFACES.md`
- Last verified against: both repos on 2026-04-04

## Start Here
Use this doc first for live maintenance and incident triage.
- `src/app.js` - runtime route-mount authority
- `docs/API_CONTRACT.md` - canonical backend envelope/error vocabulary
- `docs/MOBILE_BACKEND_CONTRACT.md` - backend-owned mobile contract truth
- `docs/LEGACY_WEB_SURFACES.md` - legacy and remove-later classification
- `docs/INCIDENT_TRACE_RUNBOOK.md` - finalize/control-room incident entry point
- mobile repo `docs/MOBILE_USED_SURFACES.md` - caller truth

## Live Product Path
1. Auth bootstrap -> `POST /api/users/ensure` -> `GET /api/usage`
2. Story creation -> `POST /api/story/start` -> `POST /api/story/generate`
3. Story editing -> `GET /api/story/:sessionId` plus mobile-used `POST /api/story/plan`, `/search`, `/update-beat-text`, `/delete-beat`, `/search-shot`, `/update-shot`, `/update-caption-style`, and `POST /api/caption/preview`
4. Finalize -> `POST /api/story/finalize` with recovery/readback through `GET /api/story/:sessionId`
5. Readback -> `GET /api/shorts/:jobId` with `GET /api/shorts/mine` fallback during eventual consistency
6. Payment-critical settlement -> `POST /stripe/webhook`
Other mounted `src/app.js` surfaces still present:
- health/liveness: `GET|HEAD /health`, `GET|HEAD /api/health`
- required backend-served assets: `GET /assets/*`, including `/assets/fonts/*`
- internal dashboard: `/admin/finalize`, `GET /api/admin/finalize/data`
- legacy/remove-later support surfaces: see `docs/LEGACY_WEB_SURFACES.md`
- debug-gated routes: `/diag/*`, `GET /api/diag/headers`

## Route Authority
- Runtime route mounts are owned by `src/app.js`.
- `src/routes/index.js` is an internal export/helper map for a subset of routers still mounted from `src/app.js`.
- Do not use `src/routes/index.js` to answer "where are routes mounted?"

## Monitored Tiers
Tier 1 product surfaces:
- auth/bootstrap: `POST /api/users/ensure`
- usage: `GET /api/usage`
- finalize admission/recovery: `POST /api/story/finalize`, `GET /api/story/:sessionId`
- short detail readback: `GET /api/shorts/:jobId`
- library readback: `GET /api/shorts/mine`
- payment-critical settlement: `POST /stripe/webhook`
Tier 1 operational signals:
- worker/finalize pressure
- queue health and oldest queued age
- failure correlation context: `requestId`, `sessionId`, `attemptId`, `shortId`
- shared-vs-local pressure distinction in finalize control-room views
Tier 2 product support surfaces:
- story editing: beat save/delete, clip replacement
- plan/search helpers
- caption preview and caption placement persistence
Tier 3 surfaces:
- legacy web/manual/editor flows
- debug/diag routes
- mounted remove-later support surfaces with no current caller

## Ops Contract Truth
- Future ops tooling and maintenance automation must trust backend canonical envelope fields only.
- Success fields: `success`, `data`, `requestId`
- Failure fields: `success`, `error`, `detail`, `requestId`, optional `fields`
- Mobile normalization to `ok`, `code`, and `message` is a compatibility boundary, not contract SSOT.
- Contract authority lives in `docs/API_CONTRACT.md` and the live helper implementation in `src/http/respond.js`.

## Dashboard Scope
Current purpose:
- shared finalize pressure and queue health
- shared-vs-local observability distinction
- recent failure/correlation support for operators
Current non-goals:
- full BI or product analytics
- historical throughput analysis
- replacement for incident packets or canonical runbooks

## Reference Only
- `ROUTE_TRUTH_TABLE.md`
- `docs/ACTIVE_SURFACES.md`
- `docs/TRUTH_FREEZE_AUDIT_2026-02-28.md`
- `docs/CROSS_REPO_PRODUCTION_HARDENING_PLAN.md`
- `docs/security-notes.md`
