# Cohesion Guardrails

## 1) Purpose + Definitions

This document is the SSOT policy for ownership, anti-duplication, and route/middleware cohesion in this repo. It is docs-only governance and does not itself change runtime behavior.

For mobile/backend contract work, start at `docs/DOCS_INDEX.md`. Historical inventories such as `ROUTE_TRUTH_TABLE.md` and `docs/ACTIVE_SURFACES.md` are retained as evidence, not as the primary route-truth docs to update.

Definitions used here:

- `Canonical (SSOT)`: module/path that new and active code must use.
- `Deprecated/Duplicate`: parallel surface kept only for legacy compatibility until consolidation.
- `Default-Reachable`: reachable with default flags (`VAIFORM_DEBUG=0`) (`env.example:3`).
- `Debug-Gated`: only reachable when `VAIFORM_DEBUG=1` (`src/app.js:216`, `src/app.js:220-227`, `src/routes/caption.preview.routes.js` debug-gated `/diag` handlers).
- `Caller-Backed`: called by verified entrypoints/assets, not by unreferenced strings.

## 2) SSOT Ownership Table

| Category                                            | Canonical (SSOT)                                                      | Deprecated / Duplicate                                            | Key import/call sites (current)                                                                                                                                                                                                                                                   | Scope             | Notes / Evidence                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth (`requireAuth`, auth helpers)                  | `src/middleware/requireAuth.js`                                       | _Removed in C10_                                                  | `src/routes/story.routes.js:3`, `src/routes/checkout.routes.js:3`, `src/routes/assets.routes.js:2`, `src/routes/shorts.routes.js:2`                                                                                                                                               | Default + Gated   | `requireAuth` uses contract `fail(...)` and sets `req.user` (`src/middleware/requireAuth.js:5-19`). Duplicate `src/middleware/auth.middleware.js` was removed in C10 after import-proof showed no runtime consumers (`src/web/public/scripts`). Policy: all new/active routes must use `src/middleware/requireAuth.js`; do not introduce parallel auth middleware modules.                |
| Plan guards (`planGuards`)                          | `src/middleware/planGuards.js`                                        | _Removed in C11_                                                  | `src/routes/story.routes.js:4`                                                                                                                                                                                                                                                    | Default-Reachable | `planGuards.js` remains the only imported plan-guard module on active routes. Retired AI image routes were removed in Phase 2, so there is no parallel guard path to preserve.                                                                                                                                                                                                            |
| Validation (`validate.middleware`, schema location) | `src/middleware/validate.middleware.js` + `src/schemas/*.schema.js`   | _Removed in C12_ duplicate file; inline route `safeParse` remains | `src/routes/checkout.routes.js:2-13`, `src/routes/assets.routes.js:2-9`                                                                                                                                                                                                            | Default + Gated   | Middleware contract mapping is centralized (`src/middleware/validate.middleware.js:13-27`). Duplicate `src/validation/schema.js` was removed in C12 after import-proof confirmed no runtime route imports. Inline `safeParse` still exists in active routers (`src/routes/story.routes.js:69`, `src/routes/caption.preview.routes.js:118,312`) and remains a separate consolidation item. |
| Idempotency                                         | `src/middleware/idempotency.firestore.js`                             | _Removed in C12_ in-memory duplicate                              | `src/routes/story.routes.js:5`, `src/routes/story.routes.js:942`                                                                                                                                                                                                                  | Default-Reachable | Firestore middleware handles replay/pending semantics (`src/middleware/idempotency.firestore.js:94-288`) and finalize reservation/refund flow (`src/middleware/idempotency.firestore.js:295-427`). Duplicate `src/middleware/idempotency.js` was removed in C12 after import-proof confirmed no runtime route imports.                                                                   |
| Response helpers + error middleware                 | `src/http/respond.js` + `src/middleware/error.middleware.js`          | Manual `res.json` envelopes in legacy/mixed files                 | `src/middleware/requireAuth.js:3`, `src/middleware/validate.middleware.js:2`, `src/middleware/planGuards.js:4`, `src/middleware/idempotency.firestore.js:2`, `src/routes/story.routes.js:29`, `src/routes/caption.preview.routes.js:15`, `src/controllers/assets.controller.js:6` | Default + Gated   | Envelope contract defined in helper (`src/http/respond.js:3-4,14-35`) and used by global error handler (`src/middleware/error.middleware.js:15-49`). Contract doc: `docs/API_CONTRACT.md:41-43`. Drift examples still exist (`src/controllers/health.controller.js:9-117`, `src/routes/user.routes.js:18-33`).                                                                                   |
| RequestId / logging / CORS                          | Request ID: `src/middleware/reqId.js`; request context: `src/observability/request-context.js`; logging: `src/observability/logger.js`; CORS: `src/app.js` corsOptions | _No parallel request-context store or logger wrapper_             | `app.use(reqId)` / `app.use(requestContextMiddleware)` at `src/app.js:45-46`; CORS options and mount at `src/app.js:91-108`                                                                                                                                                     | Global            | Request ID is assigned early and emitted as response header (`src/middleware/reqId.js:4-8`). Async request context is seeded immediately after request ID assignment in `src/app.js:45-46`. Structured logs must flow through `src/observability/logger.js`, which writes redacted JSON to stdout only. Do not introduce competing logger/context wrappers.                             |

## 3) Guardrail Rules

1. Use dist-first caller evidence when `web/dist` exists. Treat dist entrypoints/assets as canonical for runtime caller proof before `public/` (for example, `web/dist/api.mjs`).
2. Apply API path mapping truth: `apiFetch("/x")` targets `/api/x`; root fallback is only GET `/health` (`web/dist/api.mjs:12-15`, `web/dist/api.mjs:175-185`).
3. Avoid introducing NEW dual mounts on both `/` and `/api`; existing compatibility aliases remain until a dedicated consolidation pass (`src/app.js:211-223`, `src/app.js:241-243`, `src/app.js:247-248`, `src/app.js:279-280`).
4. Do not add new competing `GET "/"` handlers without precedence review; ordered mounts can shadow intended handlers (`src/app.js:211`, `src/app.js:212`, `src/app.js:214`, `src/app.js:237`).
5. Classify route status with explicit code-backed evidence: mounted backend path, real caller, and current ownership (`Default-Reachable`, `Debug-Gated`, `Caller-Backed`, and `Active=Default-Reachable && Caller-Backed`).
6. Do not create phantom callers: unreferenced bundle strings or stale docs are not caller evidence.
7. Response envelope for JSON APIs must be `{success,data,requestId}` or `{success:false,error,detail,fields?,requestId}` (`src/http/respond.js:3-4`, `src/http/respond.js:15-16`, `src/http/respond.js:30-33`, `docs/API_CONTRACT.md:41-43`).
8. Prefer `respond.ok/fail` for JSON endpoints; manual `res.json` is limited to deliberate legacy exceptions or non-JSON/file/raw/head/redirect responses (`src/http/respond.js:14-35`, `src/routes/story.routes.js:972-975`, `src/routes/story.routes.js:983-984`, `src/app.js:195-205`).
9. Validation policy: inline `safeParse` is allowed only for quarantined legacy routers; active/default routes must use `validate.middleware.js` + `src/schemas/*.schema.js` (`src/middleware/validate.middleware.js:13-27`, `src/routes/checkout.routes.js:2-13`, `src/routes/assets.routes.js:2-9`).
10. Plan-guard policy: use `planGuards.*` only. Do not introduce parallel plan-guard middleware modules; route imports should remain on `planGuards.js` (`src/routes/story.routes.js:4`, `src/middleware/planGuards.js:1-301`).
11. Auth policy: all new/active routes use `src/middleware/requireAuth.js`; duplicate `auth.middleware.js` was removed in C10 and must not be reintroduced (`src/middleware/requireAuth.js:5-19`, grep proof in Section 2).
12. Observability policy: request-scoped backend logs must use `src/observability/logger.js` and inherit context from `src/observability/request-context.js`; do not log raw auth headers, cookies, API keys/secrets, raw provider payloads, full public/storage URLs, or similarly sensitive raw text blobs.

## 4) Standard Middleware Order

For secured, mutating JSON endpoints, use this order:

`reqId -> requestContext -> cors -> requireAuth -> plan guards (planGuards.* if applicable) -> idempotency (if applicable) -> validate -> controller`

Evidence:

- Global `reqId`, request context, and CORS before route mounts (`src/app.js`, `src/observability/request-context.js`).
- Example with idempotency + validate: story finalize (`src/routes/story.routes.js:940-975`).
- Example with plan guards: story script cap + credits checks (`src/routes/story.routes.js:218-233`, `src/routes/story.routes.js:557-576`).
- Example without plan guard/idempotency: checkout routes (`src/routes/checkout.routes.js:12-13`).

## 5) Response Contract Rules

Required JSON envelopes:

- Success: `{ success: true, data, requestId }` (`src/http/respond.js:16`, `docs/API_CONTRACT.md:41`).
- Failure: `{ success: false, error, detail, fields?, requestId }` (`src/http/respond.js:30-33`, `docs/API_CONTRACT.md:42`).

Rules:

- `requestId` must propagate from request middleware (`src/middleware/reqId.js:4-8`, `docs/API_CONTRACT.md:58`).
- New JSON API handlers should emit via `ok/fail` (`src/http/respond.js:14-35`).
- Avoid legacy keys (`ok`, `reason`, `code`, `message`, `issues`) in new/changed JSON response payloads (`docs/API_CONTRACT.md:46-52`, `scripts/check-responses-changed.mjs:6`, `scripts/check-responses-changed.mjs:297-302`).

## 6) Adding/Changing Routes Checklist

1. Mounting:

- Choose one canonical API mount path; do not introduce new dual mounts unless explicitly required for compatibility and documented (`src/app.js:211-223`, `src/app.js:247-248`).

2. Middleware chain:

- Apply chain in standard order: `reqId -> requestContext -> cors -> requireAuth -> plan guards (planGuards.* if applicable) -> idempotency (if applicable) -> validate -> controller` (Section 4 evidence).

3. Validation:

- For active/default routes, define schema in `src/schemas/*.schema.js` and apply `validate(...)` (`src/routes/checkout.routes.js:2-13`, `src/routes/assets.routes.js:2-9`).

4. Response contract:

- Use envelope helpers (`ok/fail`) for JSON responses (`src/http/respond.js:14-35`), include requestId via middleware (`src/middleware/reqId.js:4-8`).

5. Observability:

- Use `src/observability/logger.js` for request-scoped backend logs on active paths.
- Let request context come from `src/observability/request-context.js`; do not create route-local parallel stores unless a future phase explicitly requires it.
- Keep redaction centralized in the canonical logger path.

6. Route truth docs:

- Verify actual code in both repos before changing docs.
- Update mobile caller-truth in the mobile repo's `docs/MOBILE_USED_SURFACES.md` when live mobile usage changes.
- Update backend-owned truth in `docs/MOBILE_BACKEND_CONTRACT.md`, `docs/MOBILE_HARDENING_PLAN.md`, `docs/LEGACY_WEB_SURFACES.md`, and `docs/API_CONTRACT.md` when server contract, hardening status, or legacy classification changes.
- Keep `docs/DOCS_INDEX.md` aligned with the current ownership split and canonical set.
7. CI hygiene:

- Keep changed-file contract gate clean (`.github/workflows/ci.yml:41-45`, `scripts/check-responses-changed.mjs:275-283`).
- Use full scan (`node scripts/check-responses.js`) when broad response refactors are in scope (`scripts/check-responses.js:77-88`).

## 7) CI + Scripts Enforcement Summary

Enforced in CI:

- `npm run format:check` (`.github/workflows/ci.yml:35-36`).
- `npm run test:security` (`.github/workflows/ci.yml:38-39`).
- `npm run check:responses:changed` (`.github/workflows/ci.yml:41-45`).

Observed/manual baseline (not CI-blocking by default):

- `node scripts/check-responses.js` scans repo-wide response-shape drift (`scripts/check-responses.js:77-88`).

Notes:

- CI gate is ratcheting for changed files; existing legacy drift can remain outside touched files until dedicated cleanup passes (`scripts/check-responses-changed.mjs:275-283`, `scripts/check-responses.js:79-88`).
