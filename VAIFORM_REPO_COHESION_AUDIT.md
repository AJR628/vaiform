# Vaiform Repo Cohesion Audit & Plan

**Purpose**: Reference document for production hardening. Use this report to add guardrails, validation, and safeguards with certainty—no guesswork.

**Scope**: Full audit against the [Vaiform Repo Cohesion Charter](#charter-ref) (as provided). No code changes; assessment and actionable plan only.

**Audit date**: 2025-02-12  
**Branch**: feat/voice-ssot-tts

**Companion doc**: [docs/ACTIVE_SURFACES.md](docs/ACTIVE_SURFACES.md) — frontend call sites, backend mounts, Active vs Legacy classification.

---

## Executive Summary

| Category | Status | Count / Notes |
|----------|--------|---------------|
| Auth SSOT collision | ❌ Confirmed | 2 implementations (`requireAuth.js`, `auth.middleware.js`) |
| Plan guard collision | ❌ Confirmed | 2 modules (`planGuard.js`, `planGuards.js`) |
| Idempotency variants | ❌ Confirmed | 3 (`idempotency.js`, `idempotency.firestore.js` default + `idempotencyFinalize`) |
| Validation / schema split | ⚠️ Partial | `src/schemas/*` + `src/validation/schema.js` (duplicate schemas) |
| Response envelope drift | ❌ Confirmed | `success`/`data`, `ok`/`reason`, `code`/`message` mixed |
| Route mount ambiguity | ❌ Confirmed | Many routes at both `/` and `/api` prefixes |
| Guard ordering | ⚠️ Inconsistent | Varies by route; no single pipeline |
| CI enforcement | ❌ Weak | `check-responses` and `smoke` exist but **not run in CI** |
| Frontend entrypoints | ✅ Aligned | `/creative` loads Article-only; legacy opt-in |
| Active vs Legacy routes | ❌ Unbounded | Studio/quotes unmounted; voice/tts/uploads mounted but no Article caller; see ACTIVE_SURFACES |

---

## 0. Active Surface Map (Summary)

*Full details in [docs/ACTIVE_SURFACES.md](docs/ACTIVE_SURFACES.md).*

### Primary production UI: /creative.html (Article flow)

- **Loaded**: `creative.article.mjs` + `caption-preview.js` (dynamic).
- **APIs called**: `/api/story/*`, `/api/caption/preview`, `/api/assets/options` (no quotes, no tts/preview, no voice, no shorts/create, no generate, no uploads).

### Legacy / orphan (mounted, no Article caller)

- **voice**, **tts**, **uploads**, **caption/render** — mounted; only `creative.legacy-quotes.mjs` (not loaded) would call them.
- **Studio, quotes** — **not mounted**; web SPA StudioPage would 404.

### Minimal commit ordering

1. **Commit 1**: Add `ENABLE_LEGACY_ROUTES` flag; gate voice, tts, uploads, caption/render, studio, quotes (default OFF).
2. **Commit 2+**: Apply success/data hardening **only on Active routes** (story, caption/preview, assets/options, credits, checkout, generate, enhance, shorts, users, health).

---

## 1. Middleware SSOT Collisions (Charter §1)

### 1.1 Auth

| File | Export(s) | Response Shape | Used By |
|------|-----------|----------------|---------|
| `src/middleware/requireAuth.js` | `requireAuth` (default) | `{ success, error, code, message }` | **All protected routes** (story, caption, tts, uploads, credits, checkout, shorts, users, user, voice, limits, generate, enhance, whoami, assets, quotes) |
| `src/middleware/auth.middleware.js` | `requireAuth`, `optionalAuth`, `requireVerifiedEmail`, `assertUserScoped` | `{ success, error, detail }` | **None** (unused) |

**Finding**: `auth.middleware.js` is never imported. `requireAuth.js` is the de facto SSOT. Response shapes differ (`code`/`message` vs `detail`).

### 1.2 Plan / Credit Guards

| File | Exports | Response Shape | Used By |
|------|---------|----------------|---------|
| `src/middleware/planGuard.js` | `planGuard(requiredPlan)` | `{ ok, reason }` / `{ ok, reason, detail }` | `assets.routes.js` (ai-images) |
| `src/middleware/planGuards.js` | `requireMember`, `enforceFreeDailyShortLimit`, `enforceFreeLifetimeShortLimit`, `blockAIQuotesForFree`, `enforceWatermarkFlag`, `enforceCreditsForRender`, `enforceScriptDailyCap`, `requireAuthOptional` | `{ ok, reason, detail }` or `{ success, error, message }` | story, studio, shorts, quotes (and commented-out usage) |

**Finding**: Overlap in concept (plan/membership/credits). Different response shapes (`ok`/`reason` vs `success`/`error`/`message`). `planGuard.js` uses `ok`; `planGuards.js` mixes both.

### 1.3 Idempotency

| File / Export | Purpose | Storage | Used By |
|---------------|---------|---------|---------|
| `src/middleware/idempotency.js` (default) | Generic in-memory idempotency | Map | **None** (unused) |
| `src/middleware/idempotency.firestore.js` (default `idempotencyFirestore`) | Generic Firestore idempotency | Firestore | `generate.routes.js` |
| `src/middleware/idempotency.firestore.js` (`idempotencyFinalize`) | Credit-reserve + Firestore for story finalize | Firestore | `story.routes.js` `/finalize` |

**Finding**: Two storage backends; route-specific logic (`idempotencyFinalize`) vs generic (`idempotencyFirestore`). Generate uses Firestore; story finalize uses specialized variant. In-memory version is dead code.

### 1.4 Validation / Schemas

| Location | Contents | Used By |
|----------|----------|---------|
| `src/schemas/` | `caption`, `checkout`, `enhance`, `generate`, `health`, `quotes`, `tts` | Routes via `validate(schema)` |
| `src/validation/schema.js` | `enhanceSchema`, `generateSchema` | **Not imported** (orphaned) |

**Finding**: `src/validation/schema.js` duplicates schemas from `src/schemas/`. Orphaned. `validate.middleware.js` uses `code`/`message`/`details`; charter standard is `error`/`detail`/`fields`.

---

## 2. Response Envelope Drift (Charter §2, §A)

### Target (Charter Decision)

- Success: `{ success: true, data, requestId }`
- Failure: `{ success: false, error, detail, fields?, requestId }`

### Actual Shapes in Codebase

| Shape | Example | Locations |
|-------|---------|-----------|
| `success`/`data` | `{ success: true, data: {...} }` | story, generate, shorts (most), health, credits, enhance |
| `ok`/`reason` | `{ ok: false, reason: "..." }` | planGuard, planGuards, limits, assets, quotes, checkout (some), caption.preview (many) |
| `ok`/`data` | `{ ok: true, data: {...} }` | quotes.controller |
| `code`/`message` | `{ code: "NO_AUTH", message: "..." }` | credits.get handler, requireAuth (some), validate.middleware |
| `success`/`error`/`message` | `{ success: false, error: "...", message: "..." }` | shorts, story (some) |
| `url` only | `{ url: session.url }` | checkout.controller (success) |
| `ok`/`service`/`time` | `{ ok: true, service, time }` | `/health` inline |

### Files with `ok`/`reason` / `code` / `message` (Charter-Disallowed)

- `src/app.js`: `/health`, `/diag/echo`, 405 handler (`code`, `message`)
- `src/middleware/planGuard.js`: all responses
- `src/middleware/planGuards.js`: mixed
- `src/controllers/limits.controller.js`: `ok`/`reason`
- `src/controllers/assets.controller.js`: `ok`/`reason`
- `src/controllers/quotes.controller.js`: `ok`/`reason`/`data`
- `src/controllers/checkout.controller.js`: `ok`/`reason` (portal/subscription paths)
- `src/routes/caption.preview.routes.js`: many `ok`/`reason`
- `src/handlers/credits.get.js`: `code`/`message`
- `src/middleware/validate.middleware.js`: `code`/`message`/`details`

### `check-responses.js` Behavior

- Flags: `ok:`, `code:`, `issues:` in any response; `message:` in 4xx/5xx
- **Not run in CI** (`.github/workflows/ci.yml` does not invoke it)

---

## 3. Routing / Mount Ambiguity (Charter §3)

### Duplicate Mounts

Routes are mounted at multiple prefixes. Examples:

| Route Group | Mounts | Paths |
|-------------|--------|-------|
| Health | `/`, `/api` | `/health`, `/api/health`, `/healthz`, `/version` |
| Whoami | `/`, `/api` | `/whoami`, `/api/whoami` |
| Credits | `/`, `/api` + direct `app.get` | `/credits`, `/api/credits` (twice: router + handler) |
| Generate | `/`, `/api` | `/generate`, `/api/generate` |
| Enhance | `/`, `/enhance`, `/api` | `/enhance`, `/api/enhance` |
| Checkout | `/checkout`, `/api` | `/checkout/*`, `/api/checkout/*` |
| Limits | `/api`, `/limits` | `/api/limits/usage`, `/limits/usage` |
| Voice | `/api`, `/voice` | `/api/voice/*`, `/voice/*` |

### Single Mounts (Aligned)

- `/api/shorts/*`, `/api/story/*`, `/api/caption/*`, `/api/tts/*`, `/api/user/*`, `/api/users/*`, `/api/uploads/*`, `/api/assets/*`, `/creative`, `/stripe/webhook`, `/cdn`  
- **Not mounted**: `/api/studio/*`, `/api/quotes/*`, `/api/preview/*` (commented out)

### Risk

- Hardening `/api/*` can leave `/credits`, `/generate`, `/enhance`, `/limits`, `/voice` with a different guard stack
- `/credits` has both router and direct `getCreditsHandler`—potential for inconsistent behavior

---

## 4. Guard Ordering (Charter §4)

### Target Pipeline (Charter §B)

1. reqId  
2. auth (if protected)  
3. plan/credits guard (if required)  
4. validation  
5. idempotency (if charges/starts job)  
6. concurrency slot (if heavy)  
7. controller  

### Actual Order by Route

| Route | Order | Notes |
|-------|-------|-------|
| POST `/generate` | Auth → Idempotency → Validate → Controller | Idempotency before validation (charter suggests validate first) |
| POST `/api/story/finalize` | Auth → IdempotencyFinalize → Controller | Idempotency includes validation of `sessionId`; no explicit Zod |
| POST `/api/story/generate` | Auth → enforceScriptDailyCap → Validate | Plan guard before validation |
| POST `/api/assets/ai-images` | Auth → planGuard → Validate | Correct |
| POST `/api/caption/preview` | requireAuth → RateLimit → express.json → Handler | Auth first |
| POST `/api/tts/preview` | requireAuth → RateLimit → json → Handler | Auth first |

**Finding**: Order is not uniform. Idempotency sometimes runs before validation. No single declarative pipeline.

---

## 5. Scripts / Tooling (Charter §5)

| Script | Purpose | In CI? | Runnable? |
|--------|---------|--------|-----------|
| `check-responses.js` | Flag `ok`/`code`/`issues`/`message` in responses | ❌ No | ✅ Yes (`npm run check:responses`) |
| `smoke.mjs` | Smoke tests (health, credits, enhance, generate) | ❌ No | ✅ Yes (requires BACKEND_URL, TOKEN) |
| `check-privilege-escalation.mjs` | Security audit | ❌ No | ✅ Yes (`npm run test:security`) |
| `test-caption-preview-contract.mjs` | Caption preview contract | ❌ No | ✅ Yes |
| `test-*.mjs` (others) | Various | ❌ No | Varies |

### CI (.github/workflows/ci.yml)

- Runs: `npm ci`, `npm audit --audit-level=high`, `npm run format:check`
- Does **not** run: `check:responses`, `smoke`, `test:security`, or any contract tests

---

## 6. Frontend Entrypoints (Charter §6)

- `/creative.html` loads `/js/pages/creative/creative.article.mjs` only.
- `creative.legacy-quotes.mjs` exists but is **not** loaded by default (opt-in / legacy).
- Web SPA: `web/dist` served for non-API routes; entry via `web/src/main.tsx`.

**Finding**: Aligned with charter policy. Default entrypoints load only what the page needs.

---

## 7. Canonical Files vs Gaps

### Present

- `reqId.js` — single source for request ID
- `error.middleware.js` — central error handler; uses `success`/`error`/`detail`/`requestId`; handles Zod
- `validate.middleware.js` — single validation helper (but response shape non-standard)

### Missing (Charter §C, §D)

- No `src/http/respond.js` — no `respond.ok`/`respond.fail` helpers
- No `AppError` or `src/http/errors.js` — controllers/middleware throw generic `Error` or `res.json` directly
- Controllers call `res.json(...)` directly — no wrapper enforcing success/data

---

## 8. Route Truth Table Accuracy

`ROUTE_TRUTH_TABLE.md` documents routes and security. Some entries are stale:

- `/api/caption/preview` and `/api/caption/render`: Documented as PUBLIC; **actual code** uses `requireAuth`.
- `/api/tts/preview`: Documented as PUBLIC; **actual code** uses `requireAuth`.

Recommend refreshing ROUTE_TRUTH_TABLE after any cohesion changes.

---

## 9. Actionable Plan (Charter-Aligned)

### Minimal Commit Order (from ACTIVE_SURFACES)

| Commit | Scope | Purpose |
|--------|-------|---------|
| **1** | `ENABLE_LEGACY_ROUTES` flag | Gate voice, tts, uploads, caption/render, studio, quotes (default OFF); reduce attack surface |
| **2+** | success/data hardening | Apply only to **Active** mounted routes (story, caption/preview, assets/options, credits, checkout, generate, enhance, shorts, users, health) |

**Active routes** (hardening priority): story, caption/preview, assets/options, credits, checkout, generate, enhance, shorts, users, user, whoami, health, stripe webhook, cdn, creative.

**Defer** until legacy decision: voice, tts, uploads, caption/render, studio, quotes.

---

### Phase 0 — No-Code Prep

1. Adopt this audit and [docs/ACTIVE_SURFACES.md](docs/ACTIVE_SURFACES.md) as references.  
2. Add a Repo Rule: "No new second versions" — new middleware/helpers must be shims or replacements with old removed in same commit.  
3. Document the target API contract and guard stack in `docs/API_CONTRACT.md`.

### Phase 1 — Commit 1: ENABLE_LEGACY_ROUTES

1. Add `ENABLE_LEGACY_ROUTES` env var (default `0`).  
2. Gate mounts: voice, tts, uploads, caption/render; uncomment and gate studio, quotes.  
3. Gate diag routes behind `VAIFORM_DEBUG=1` (or keep NODE_ENV check).  
4. Document in README / env.example.

### Phase 2 — Response & Request ID (Low Risk, Active routes only)

1. Introduce `src/http/respond.js` with `respond.ok(res, data)` and `respond.fail(res, error, detail, fields)` — both attach `requestId` from `req.id`.  
2. Ensure `reqId` runs first (already true).  
3. Add helpers; migrate Active route responses incrementally.

### Phase 3 — Middleware Response Conversion (Active routes)

1. Convert auth responses: pick `requireAuth.js` as SSOT; standardize on `{ success, error, detail, requestId }`; deprecate `auth.middleware.js`.  
2. Convert plan/credit guards: pick `planGuards.js` as SSOT; standardize to `success`/`error`/`detail`; merge or shim `planGuard.js`.  
3. Convert validate.middleware: use `detail` + `fields` (not `message`/`details`).  
4. Apply to Active routes only; defer Legacy.

### Phase 4 — SSOT Consolidation

1. Auth: Make `requireAuth.js` canonical; `auth.middleware.js` → re-export shim or remove.  
2. Plan guards: Merge `planGuard.js` into `planGuards.js` or thin wrapper.  
3. Idempotency: Keep `idempotency.firestore.js`; remove or archive `idempotency.js`.  
4. Schemas: Delete `src/validation/schema.js`; ensure all use `src/schemas/`.

### Phase 5 — Single /api Mount

1. Add `src/routes/api.router.js`; mount all sub-routers under `/api` only.  
2. Remove duplicate mounts at `/`, `/enhance`, `/checkout`, `/limits`, `/voice`.  
3. Keep `/health` and `/stripe/webhook` as exceptions.  
4. Resolve `/credits` duplication.

### Phase 6 — Controller Discipline

1. Rule: Controllers return data or throw; no direct `res.json` for JSON.  
2. Introduce `AppError`; central error middleware formats via respond.fail.  
3. Migrate Active controllers incrementally.

### Phase 7 — CI Enforcement

1. Add `npm run check:responses` to CI.  
2. Add `npm run smoke` (or lightweight subset) with env stubs if possible.  
3. Add `npm run test:security` to CI.

### Phase 8 — Legacy Routes (optional)

1. If `ENABLE_LEGACY_ROUTES=1` is used: migrate voice, tts, uploads, studio, quotes to success/data.  
2. Or remove legacy mounts and related frontend code permanently.

---

## 10. Quick Drift Check (Charter)

| Question | Current Answer |
|----------|----------------|
| What's the SSOT file for auth? | Unclear — `requireAuth.js` used, `auth.middleware.js` unused |
| What's the SSOT for plan/credits? | Unclear — `planGuard.js` and `planGuards.js` overlap |
| Is each route mounted only once? | No — many at both `/` and `/api` |
| Does each route return success/data? | No — mixed shapes |
| Does each route follow the standard guard stack? | No — order varies |
| Will CI catch drift? | No — check-responses and smoke not in CI |
| Which routes are Active vs Legacy? | See [docs/ACTIVE_SURFACES.md](docs/ACTIVE_SURFACES.md) — Article flow = story, caption/preview, assets/options; studio/quotes unmounted; voice/tts/uploads orphan |

---

## 11. Files Reference

### Middleware

| Path | Role |
|------|------|
| `src/middleware/reqId.js` | Attach request ID |
| `src/middleware/requireAuth.js` | Auth (used) |
| `src/middleware/auth.middleware.js` | Auth (unused) |
| `src/middleware/planGuard.js` | Plan check (assets) |
| `src/middleware/planGuards.js` | Plan/credits/limits |
| `src/middleware/idempotency.js` | In-memory idempotency (unused) |
| `src/middleware/idempotency.firestore.js` | Firestore idempotency |
| `src/middleware/validate.middleware.js` | Zod validation |
| `src/middleware/error.middleware.js` | Central error handler |

### Schemas

| Path | Role |
|------|------|
| `src/schemas/*.js` | Canonical Zod schemas |
| `src/validation/schema.js` | Orphaned duplicates |

### Routing

| Path | Role |
|------|------|
| `src/app.js` | Main app; mounts routes at `/` and `/api` |
| `src/routes/index.js` | Route bundle (index, health, credits, etc.) |

### Docs

| Path | Role |
|------|------|
| `docs/ACTIVE_SURFACES.md` | Active Surface Map — frontend call sites, backend mounts, Active vs Legacy |

---

## Charter Ref

Target system (from Vaiform Repo Cohesion Charter):

- **Response**: `success`/`data` or `success`/`error`/`detail`/`fields`/`requestId`  
- **Guard stack**: reqId → auth → plan → validate → idempotency → concurrency → controller  
- **Mount**: Single `/api` surface  
- **SSOT**: One canonical file per concern; shims or replacement only  
- **CI**: Enforce contract, reject drift  

---

*End of audit. Use this document as the reference for cohesion and hardening work.*
