# Cohesion Guardrails

## 1) Purpose + Definitions

This document is the SSOT policy for ownership, anti-duplication, and route/middleware cohesion in this repo. It is docs-only governance and does not itself change runtime behavior.

Definitions used here:

- `Canonical (SSOT)`: module/path that new and active code must use.
- `Deprecated/Duplicate`: parallel surface kept only for legacy compatibility until consolidation.
- `Default-Reachable`: reachable with default flags (`VAIFORM_DEBUG=0`) (`env.example:3`).
- `Debug-Gated`: only reachable when `VAIFORM_DEBUG=1` (`src/app.js:216`, `src/app.js:225-227`, `src/routes/caption.preview.routes.js:1219-1224`).
- `Caller-Backed`: called by default-served entrypoints/assets, not by unreferenced strings (`docs/ACTIVE_SURFACES.md:29-41`).

## 2) SSOT Ownership Table

| Category                                            | Canonical (SSOT)                                                      | Deprecated / Duplicate                                            | Key import/call sites (current)                                                                                                                                                                                                                                                   | Scope             | Notes / Evidence                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth (`requireAuth`, auth helpers)                  | `src/middleware/requireAuth.js`                                       | _Removed in C10_                                                  | `src/routes/generate.routes.js:2`, `src/routes/story.routes.js:3`, `src/routes/checkout.routes.js:3`, `src/routes/assets.routes.js:2`                                                                                                                                             | Default + Gated   | `requireAuth` uses contract `fail(...)` and sets `req.user` (`src/middleware/requireAuth.js:5-19`). Duplicate `src/middleware/auth.middleware.js` was removed in C10 after import-proof showed no runtime consumers (`src/web/public/scripts`). Policy: all new/active routes must use `src/middleware/requireAuth.js`; do not introduce parallel auth middleware modules.                |
| Plan guards (`planGuards`)                          | `src/middleware/planGuards.js`                                        | _Removed in C11_                                                  | `src/routes/story.routes.js:4`, `src/routes/shorts.routes.js:3`                                                                                                                                                                                                                   | Default-Reachable | `planGuards.js` is the only imported plan-guard module in routes. `/api/assets/ai-images` is hard-disabled with canonical `410 FEATURE_DISABLED` and does not use a plan guard (`src/routes/assets.routes.js:12-20`).                                                                                                                                                                     |
| Validation (`validate.middleware`, schema location) | `src/middleware/validate.middleware.js` + `src/schemas/*.schema.js`   | _Removed in C12_ duplicate file; inline route `safeParse` remains | `src/routes/generate.routes.js:4-5,11`, `src/routes/checkout.routes.js:4-5,20,23`, `src/routes/assets.routes.js:3,5,10,12`                                                                                                                                                        | Default + Gated   | Middleware contract mapping is centralized (`src/middleware/validate.middleware.js:13-27`). Duplicate `src/validation/schema.js` was removed in C12 after import-proof confirmed no runtime route imports. Inline `safeParse` still exists in active routers (`src/routes/story.routes.js:69`, `src/routes/caption.preview.routes.js:118,312`) and remains a separate consolidation item. |
| Idempotency                                         | `src/middleware/idempotency.firestore.js`                             | _Removed in C12_ in-memory duplicate                              | `src/routes/generate.routes.js:3,11`, `src/routes/story.routes.js:5,678`                                                                                                                                                                                                          | Default-Reachable | Firestore middleware handles replay/pending semantics (`src/middleware/idempotency.firestore.js:185-248`) and finalize reservation/refund flow (`src/middleware/idempotency.firestore.js:28-183`). Duplicate `src/middleware/idempotency.js` was removed in C12 after import-proof confirmed no runtime route imports.                                                                    |
| Response helpers + error middleware                 | `src/http/respond.js` + `src/middleware/error.middleware.js`          | Manual `res.json` envelopes in legacy/mixed files                 | `src/middleware/requireAuth.js:3`, `src/middleware/validate.middleware.js:2`, `src/middleware/planGuards.js:4`, `src/middleware/idempotency.firestore.js:2`, `src/routes/story.routes.js:29`, `src/routes/caption.preview.routes.js:15`, `src/controllers/assets.controller.js:6` | Default + Gated   | Envelope contract defined in helper (`src/http/respond.js:3-4,14-35`) and used by global error handler (`src/middleware/error.middleware.js:15-49`). Contract doc: `docs/API_CONTRACT.md:41-43`. Drift examples still exist (`src/handlers/credits.get.js:11-27`, `src/routes/user.routes.js:18-33`).                                                                                     |
| RequestId / logging / CORS                          | Request ID: `src/middleware/reqId.js`; CORS: `src/app.js` corsOptions | _No duplicate logger wrapper_                                     | `app.use(reqId)` at `src/app.js:49`; CORS mounted at `src/app.js:111` and `src/app.js:114`                                                                                                                                                                                        | Global            | Request ID is assigned early and emitted as response header (`src/middleware/reqId.js:4-8`). Error fallback checks multiple request-id fields (`src/middleware/error.middleware.js:37`). CORS SSOT is app-level `corsOptions` (`src/app.js:94-114`). Unused duplicate logger wrapper `src/utils/logger.js` was removed in C12 after import-proof confirmed no runtime consumers.          |

## 3) Guardrail Rules

1. Use dist-first caller evidence when `web/dist` exists. Treat dist entrypoints/assets as canonical for runtime caller proof before `public/` (`src/app.js:341-347`, `src/app.js:366`, `docs/ACTIVE_SURFACES.md:17-20`, `docs/ACTIVE_SURFACES.md:29-41`).
2. Apply API path mapping truth: `apiFetch("/x")` targets `/api/x`; root fallback is only GET `/credits|/whoami|/health` (`web/dist/api.mjs:7-9`, `web/dist/api.mjs:152-163`).
3. Avoid introducing NEW dual mounts on both `/` and `/api`; existing compatibility aliases remain until a dedicated consolidation pass (`src/app.js:211-223`, `src/app.js:241-243`, `src/app.js:247-248`, `src/app.js:279-280`).
4. Do not add new competing `GET "/"` handlers without precedence review; ordered mounts can shadow intended handlers (`src/app.js:211`, `src/app.js:212`, `src/app.js:214`, `src/app.js:237`; `ROUTE_TRUTH_TABLE.md:22-24`).
5. Classify route status with explicit evidence: `Default-Reachable`, `Debug-Gated`, `Caller-Backed`, and `Active=Default-Reachable && Caller-Backed` (`ROUTE_TRUTH_TABLE.md:8-13`, `docs/ACTIVE_SURFACES.md:7-10`).
6. Do not create phantom callers: unreferenced bundle strings are not caller evidence (`docs/ACTIVE_SURFACES.md:39-41`).
7. Response envelope for JSON APIs must be `{success,data,requestId}` or `{success:false,error,detail,fields?,requestId}` (`src/http/respond.js:3-4`, `src/http/respond.js:15-16`, `src/http/respond.js:30-33`, `docs/API_CONTRACT.md:41-43`).
8. Prefer `respond.ok/fail` for JSON endpoints; manual `res.json` is limited to deliberate legacy exceptions or non-JSON/file/raw/head/redirect responses (`src/http/respond.js:14-35`, `src/routes/creative.routes.js:11-13`, `src/app.js:175-177`).
9. Validation policy: inline `safeParse` is allowed only for quarantined legacy routers; active/default routes must use `validate.middleware.js` + `src/schemas/*.schema.js` (`src/middleware/validate.middleware.js:13-27`, `src/routes/generate.routes.js:4-5,11`, `src/routes/checkout.routes.js:4-5,20,23`).
10. Plan-guard policy: use `planGuards.*` only. Do not introduce parallel plan-guard middleware modules; route imports should remain on `planGuards.js` (`src/routes/story.routes.js:4`, `src/routes/shorts.routes.js:3`, `src/middleware/planGuards.js:1-301`).
11. Auth policy: all new/active routes use `src/middleware/requireAuth.js`; duplicate `auth.middleware.js` was removed in C10 and must not be reintroduced (`src/middleware/requireAuth.js:5-19`, grep proof in Section 2).

## 4) Standard Middleware Order

For secured, mutating JSON endpoints, use this order:

`reqId -> cors -> requireAuth -> plan guards (planGuards.* if applicable) -> idempotency (if applicable) -> validate -> controller`

Evidence:

- Global `reqId` and CORS before route mounts (`src/app.js:49`, `src/app.js:111`, `src/app.js:210`).
- Example with idempotency + validate: generate (`src/routes/generate.routes.js:11`).
- Example with plan guards: story script cap + credits checks (`src/routes/story.routes.js:105`, `src/routes/story.routes.js:738`).
- Example without plan guard/idempotency: checkout session (`src/routes/checkout.routes.js:20-28`).

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

- Apply chain in standard order: `reqId -> cors -> requireAuth -> plan guards (planGuards.* if applicable) -> idempotency (if applicable) -> validate -> controller` (Section 4 evidence).

3. Validation:

- For active/default routes, define schema in `src/schemas/*.schema.js` and apply `validate(...)` (`src/routes/generate.routes.js:4-5,11`, `src/routes/checkout.routes.js:4-5,20,23`).

4. Response contract:

- Use envelope helpers (`ok/fail`) for JSON responses (`src/http/respond.js:14-35`), include requestId via middleware (`src/middleware/reqId.js:4-8`).

5. Route truth docs:

- Update `ROUTE_TRUTH_TABLE.md` with mount path, chain, gating, caller evidence, and envelope status (`ROUTE_TRUTH_TABLE.md:15-16`).
- Update `docs/ACTIVE_SURFACES.md` for entrypoint caller-backed status and active/inactive classification (`docs/ACTIVE_SURFACES.md:7-10`).

6. CI hygiene:

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
