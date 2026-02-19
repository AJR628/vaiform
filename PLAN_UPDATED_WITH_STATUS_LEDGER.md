# Vaiform Cohesion Hardening Plan (Living SSOT)

> This file is the **single living plan** for repo cohesion.  
> It is intentionally "broad but detailed" so we don't drift while hardening + adding features.

**North Star:** make the repo easy to understand, secure by default, and stable enough for 100s -> 1000s of users.

**Canonical API Contract (must not drift):**

- Success: `{ success: true, data, requestId }`
- Failure: `{ success: false, error, detail, fields?, requestId }`
- `fields` must be `{ "<path>": "<single string message>" }` (no arrays, no zod raw objects)

**Flags posture (secure-by-default):**

- `ENABLE_LEGACY_ROUTES=0` (default) -> legacy/orphan mounts are unreachable
- `VAIFORM_DEBUG=0` (default) -> diag endpoints are unreachable

**As-of:** 2026-02-19

---

## Status Ledger (what's set vs what's left)

### DONE Completed / Locked In

- **Docs hygiene:** historical audits/plans archived under `docs/_archive/**/2026-02-16/`, with `docs/_archive/INDEX.md`.
- **Legacy caption contract:** `docs/caption-meta-contract.md` is a stub linking to the archived legacy contract + pointing to the V3 contract doc.
- **Prettier stability:** `.prettierignore` excludes archives + build output so CI isn't blocked by old artifacts.
- **Truth-docs front door:** `README.md` links only to SSOT docs.
- **C1** Baseline truth snapshot (docs) - in place and aligned to repo reality.
- **C2** Cohesion guardrails spec - SSOT ownership + anti-duplication rules exist.
- **C3** CI changed-files contract gate - blocks _new_ drift without forcing full-repo cleanup.
- **C4** Story spine contract pass - Zod validation `fields` normalized to `{path: string}` in `src/routes/story.routes.js`.
- **C5** Assets contract pass - disabled AI images route + controller now use canonical disabled behavior and contain no legacy response payload keys.
- **C6** Post-spine truth refresh - `ACTIVE_SURFACES`, `VAIFORM_REPO_COHESION_AUDIT`, and `ROUTE_TRUTH_TABLE` reconciled with current runtime truth.
- **C8** Active contract pass A - canonical envelopes now applied to checkout, limits, user routes, and credits controller scope.
- **C9** Active contract pass B - canonical envelopes now applied to generate controller, shorts controller, and stripe webhook scope.
- **Green-path caller hardening:** `/creative` is canonical caller surface; static ordering fixed to `dist -> public -> SPA fallback`.
- **Lint posture hardening:** `lint` scoped to green-path server surfaces; `lint:full` retained for broader cleanup.

### IN PROGRESS In Progress / Partial (implemented but not fully conforming)

- **No active partials in C4-C9.** Next active work starts at C10.

### NOT STARTED Not Started (still planned work)

- **C10-C12** SSOT consolidation (auth/plan guards/validation/idempotency duplicate removal)
- **C13-C15** Canonical `/api` router + remove duplicate mounts + credits dedupe
- **C16-C17** Launch posture verification + final cohesion publication

### Current Priority (next few commits)

1. **Begin C10-C12 SSOT dedupe** (auth/plan guards/validation/idempotency)
2. **Begin C13-C15 mount topology consolidation** (canonical `/api` router + duplicate mount cleanup + credits dedupe)
3. **Begin C16-C17 launch posture verification + final cohesion publication**

---

## Public API / Interface Changes (contract + invariants)

1. Canonical success: `{ success: true, data, requestId }`.
2. Canonical failure: `{ success: false, error, detail, fields?, requestId }`.
3. `/api/assets/ai-images` (while disabled): canonical `410 FEATURE_DISABLED` **including requestId**.
4. Story finalize idempotency guarantee: replay response shape matches fresh success shape **exactly** (only `requestId` value may differ).

---

## Commit-by-Commit Plan (with status)

> **Rule:** One commit = one cohesion goal. Avoid mixing "format the world" with behavior changes unless the goal is formatting.

### C0 - Repo Hygiene (Docs archive + Prettierignore) _(pre-plan but now SSOT)_

**Status:** DONE  
**Scope:** `docs/_archive/**`, stub `docs/caption-meta-contract.md`, `.prettierignore`, `docs/_archive/INDEX.md`  
**Gate:** `npm run format:check` passes without touching archives

---

### C1 - Baseline Truth Snapshot (Docs Only) _(legacy ref: 0.1)_

**Status:** DONE

1. Scope: `VAIFORM_REPO_COHESION_AUDIT.md`, `ROUTE_TRUTH_TABLE.md`, `docs/ACTIVE_SURFACES.md`.
2. Update as-of reality for mounts, gating, CI coverage, and response drift.
3. Out of scope: runtime code.
4. Gate: every claim directly matches current code.

---

### C2 - Cohesion Guardrails Spec (Docs Only) _(legacy ref: 0.2)_

**Status:** DONE

1. Scope: `docs/COHESION_GUARDRAILS.md`.
2. SSOT ownership table (canonical vs deprecated) for auth, plan guards, idempotency, validation, routing, response helpers.
3. Include anti-duplication policy + middleware order.
4. Gate: decision-complete ownership map.

---

### C3 - CI Contract Gate (Changed Files Only) _(legacy ref: 1.1)_

**Status:** DONE

1. Scope: `.github/workflows/ci.yml`, `scripts/check-responses-changed.mjs` and wiring.
2. Required-now CI checks:
   - `npm run format:check`
   - `npm run test:security`
   - `npm run check:responses:changed`
3. Scan only changed `src/**/*.js` and `src/**/*.mjs` files in PR diff.
4. Disallowed response keys: `ok`, `reason`, `code`, `message`, `issues`.
5. Gate: CI blocks new drift in touched files without blocking on legacy debt.
6. Ratchet note: next required gate = active-surface; final = full repo-wide.

---

### C4 - Story Spine Contract Pass (Routes + Required Middleware) _(legacy ref: 2.4c)_

**Status:** DONE

1. Scope: `src/routes/story.routes.js`, `src/middleware/idempotency.firestore.js`, `src/middleware/planGuards.js` (envelope/output only).
2. Objective: all `/api/story/*` reachable responses use canonical envelope + `requestId`.
3. Preserve status codes and business logic.
4. Parity invariant:
   - Fresh finalize success and idempotency replay success must have identical JSON shape/keys (`success`, `data`, `shortId`, `requestId`), except `requestId` value.
5. Completed: Zod safeParse failures are normalized to `fields: {path: string}`.
6. Out of scope: mount topology, entitlements, SSOT refactors.
7. Gate: touched-file contract scan clean; 401/400/200 story responses contract-compliant.

---

### C5 - Assets Contract Pass _(legacy ref: 2.4d)_

**Status:** DONE

1. Scope: `src/routes/assets.routes.js`, `src/controllers/assets.controller.js`.
2. `/api/assets/options`: canonical envelopes only.
3. `/api/assets/ai-images` while disabled:
   - Keep `requireAuth`.
   - Remove `planGuard('pro')` and request validation from this disabled route.
   - Return canonical `410 FEATURE_DISABLED` **with requestId** directly (or via `fail`).
4. Completed cleanup:
   - Deleted unreachable legacy response blocks in `src/controllers/assets.controller.js` tied to disabled AI generation.
5. Out of scope: re-enabling AI image generation.
6. Gate: assets files contain no legacy response payload shapes.

---

### C6 - Post-Spine Truth Refresh (Docs Only) _(legacy ref: 2.4e)_

**Status:** DONE

1. Scope: `docs/ACTIVE_SURFACES.md`, `VAIFORM_REPO_COHESION_AUDIT.md`, `ROUTE_TRUTH_TABLE.md`.
2. Completed: captured post-story/assets contract status and caller-backed `/creative` truth.
3. Gate achieved: docs match code 1:1 for current active-surface and route-truth baseline.

---

### C7 — App Entry Contract Cleanup _(legacy ref: 1.2)_

**Status:** DONE

1. Scope: src/app.js, src/handlers/credits.get.js.
2. Completed in src/app.js: canonicalized /health, debug /diag/echo, and GET /generate guard envelopes.
3. Completed in src/handlers/credits.get.js: canonicalized success/failure envelopes with preserved status semantics.
4. Gate achieved: touched-file contract scan clean; behavior unchanged.
5. Scope note: /api/health parity remains a continuation item if src/routes/health.routes.js stays untouched.

---

### C8 — Active Contract Pass A _(legacy ref: 1.3)_

**Status:** DONE

1. Scope: `src/controllers/credits.controller.js`, `src/controllers/checkout.controller.js`, `src/controllers/limits.controller.js`, `src/routes/user.routes.js`.
2. Completed: canonical envelope migration only (`ok/fail`) with status-code preservation and no route/auth/business logic changes.
3. Gate achieved: touched-file contract scans clean for all four C8 scope files.

---

### C9 - Active Contract Pass B _(legacy ref: 1.4)_

**Status:** DONE

1. Scope: `src/controllers/generate.controller.js`, `src/controllers/shorts.controller.js`, `src/routes/stripe.webhook.js`.
2. Completed: canonical envelope migration only (`ok/fail`) with status-code preservation and no route/auth/business logic changes.
3. Gate achieved: touched-file contract scans clean for all three C9 scope files.

---

### C10 - Auth SSOT Consolidation _(legacy ref: 2.1)_

**Status:** NOT STARTED

1. Scope: `src/middleware/requireAuth.js`, `src/middleware/auth.middleware.js`, related imports.
2. Keep one canonical auth module; gate or delete the duplicate after import proof.
3. Gate: no active imports depend on deprecated duplicate.

---

### C11 - Plan Guard SSOT Consolidation _(legacy ref: 2.2)_

**Status:** NOT STARTED

1. Scope: `src/middleware/planGuard.js`, `src/middleware/planGuards.js`, import sites.
2. Remove semantic duplication; stop mixing APIs in the same route file.
3. Gate: single canonical plan guard implementation.

---

### C12 - Validation/Idempotency Dead Code Cleanup _(legacy ref: 2.3)_

**Status:** NOT STARTED

1. Scope: `src/validation/schema.js`, `src/middleware/idempotency.js`, references.
2. Remove orphaned duplicates after import proof.
3. Gate: zero remaining imports of removed files.

---

### C13 - Canonical API Router Introduction _(legacy ref: 3.1)_

**Status:** NOT STARTED

1. Scope: `src/routes/api.router.js` (new), `src/app.js`.
2. Introduce single canonical `/api` aggregation surface.
3. Gate: all active endpoints reachable via canonical API path.

---

### C14 - Remove Duplicate Root API Mounts _(legacy ref: 3.2)_

**Status:** NOT STARTED

1. Scope: `src/app.js`.
2. Remove duplicate `/` + `/api` registrations for API surfaces.
3. Gate: no ambiguous duplicate API handler chains.

---

### C15 - Credits De-duplication _(legacy ref: 3.3)_

**Status:** NOT STARTED

1. Scope: `src/app.js`, `src/routes/credits.routes.js`, `src/handlers/credits.get.js`.
2. Eliminate direct-handler + router duplication.
3. Gate: one canonical credits chain per endpoint.

---

### C16 - Launch Surface Lock Verification _(legacy ref: 4.1)_

**Status:** NOT STARTED

1. Scope: `src/app.js`, `env.example`, `docs/ACTIVE_SURFACES.md`.
2. Verify default launch posture (`ENABLE_LEGACY_ROUTES=0`, `VAIFORM_DEBUG=0`).
3. Gate: intended active surface only under defaults.

---

### C17 - Final Cohesion Publication _(legacy ref: 4.2)_

**Status:** NOT STARTED

1. Scope: `VAIFORM_REPO_COHESION_AUDIT.md`, `ROUTE_TRUTH_TABLE.md`, `docs/API_CONTRACT.md`.
2. Publish final true state and residual backlog.
3. Include CI ratchet stage achieved.

---

## SSOT Dedupe Constraint (Explicit)

For `C10`-`C12`: **no behavioral changes**.  
Allowed: import rewiring, canonical module selection, dead duplicate removal, envelope normalization where already required.  
Not allowed: changing guard conditions, entitlements, or route behavior.

---

## Test Cases and Scenarios (must remain true)

1. Story endpoint 401 unauth returns canonical failure + `requestId`.
2. Story validation failure returns canonical `VALIDATION_FAILED` + `fields` + `requestId`.
3. Story success returns canonical success + `requestId`.
4. Story finalize replay vs fresh success response keys are identical.
5. Assets options returns canonical responses.
6. Disabled ai-images always returns canonical `410 FEATURE_DISABLED` + `requestId`.
7. CI fails when changed `src` files introduce disallowed response keys.
8. Default launch flags keep legacy routes unavailable while active routes remain functional.
9. Post-topology phase: no duplicate API mount ambiguity.

---

## Assumptions and Defaults

1. Launch scope stays Active-only.
2. Caption preview remains active (ungated by legacy flag).
3. CI ratchet starts with changed-files-only by design.
4. Active-surface and full repo-wide contract checks are phased in later.
5. This plan introduces no code changes by itself.
