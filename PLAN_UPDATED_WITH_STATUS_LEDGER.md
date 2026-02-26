# Vaiform Cohesion Hardening Plan (Living SSOT)

> This file is the **single living plan** for repo cohesion.  
> It is intentionally "broad but detailed" so we don't drift while hardening + adding features.

**North Star:** make the repo easy to understand, secure by default, and stable enough for 100s -> 1000s of users.

**Canonical API Contract (must not drift):**

- Success: `{ success: true, data, requestId }`
- Failure: `{ success: false, error, detail, fields?, requestId }`
- `fields` must be `{ "<path>": "<single string message>" }` (no arrays, no zod raw objects)

**Flags posture (secure-by-default):**

- `VAIFORM_DEBUG=0` (default) -> diag endpoints are unreachable

**As-of:** 2026-02-22

**Posture:** Web frontend SSOT moved to `web/` (Netlify build/publish); backend is API-first.

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
- **C10** Auth SSOT consolidation - removed unused `src/middleware/auth.middleware.js`; `src/middleware/requireAuth.js` is now the single auth middleware SSOT.
- **C11** Plan guard SSOT consolidation - removed unused legacy plan-guard duplicate; route plan-guard imports remain on `src/middleware/planGuards.js`.
- **C12** Validation/Idempotency dead code cleanup - removed unreferenced duplicate modules (`src/validation/schema.js`, `src/middleware/idempotency.js`) plus dead utility/service files (`src/utils/logger.js`, `src/utils/async.js`, `src/utils/audio.mix.js`, `src/services/moderation.service.js`) after import-proof.
- **Legacy route removal pass (Phase 2):** removed legacy/unmounted route modules and mount wiring (`uploads`, `voice`, `tts`, `caption.render`, `studio`, `quotes`, `preview`) plus now-unreachable support modules.
- **API-first posture:** Netlify builds/serves `web/`; backend no longer serves SPA/creative (API-first only).
- **Netlify redirect/proxy SSOT lock:** no `_redirects` under `web/`; CI guard enforces.
- **Web build determinism:** copy-only build; cleans `web/dist` before copy; `web/dist` is build output (untracked).
- **API surface prune:** root aliases removed; canonical `/api/*` surfaces; explicit `/api/health`; eliminated `/api/` collision.
- **Contract completion:** `/api/whoami` and `/api/users/ensure` now emit canonical `ok/fail` envelopes with `requestId`.
- **Enhance retirement:** `/api/enhance` removed end-to-end (feature retired; backend route + frontend caller/UI deleted).
- **CI ratchet:** full `check:responses` now runs in CI (push/PR) in addition to changed-files checks.
- **Lint posture hardening:** `lint` scoped to green-path server surfaces; `lint:full` retained for broader cleanup.
- **C18** Tailwind CDN removal + CSS pinning: `cdn.tailwindcss.com` removed from all HTML; `tailwindcss@3` CLI generates deterministic `dist/tailwind.css` at build time; CI verifies web build on every push/PR.

### NOT STARTED Not Started (still planned work)

_(all cohesion items complete)_

### Current Priority (next few commits)

_(all planned cohesion items complete)_

---

## Public API / Interface Changes (contract + invariants)

1. Canonical success: `{ success: true, data, requestId }`.
2. Canonical failure: `{ success: false, error, detail, fields?, requestId }`.
3. `/api/assets/ai-images` (while disabled): canonical `410 FEATURE_DISABLED` **including requestId**.
4. Story finalize idempotency guarantee: replay response shape matches fresh success shape **exactly** (only `requestId` value may differ).

5. Health endpoints include `/health` and `/api/health` (GET/HEAD).
6. Canonical checkout endpoints: `/api/checkout/start|session|subscription|portal`.
7. Canonical path surfaces for identity/credits: `/api/credits` and `/api/whoami`.
8. Root aliases removed: `/credits`, `/whoami`, `/generate`, `/enhance`, `/limits/*`, `/checkout/*`.
9. `/api/enhance` removed (feature retired).

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
2. C3 introduced these baseline CI checks:
   - `npm run format:check`
   - `npm run test:security`
   - `npm run check:responses:changed`
   - (Later commits added: `npm run check:netlify-redirects` and `npm run check:root-api-callers`.)
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
   - Remove legacy Pro plan guard and request validation from this disabled route.
   - Return canonical `410 FEATURE_DISABLED` **with requestId** directly (or via `fail`).
4. Completed cleanup:
   - Deleted unreachable legacy response blocks in `src/controllers/assets.controller.js` tied to disabled AI generation.
5. Out of scope: re-enabling AI image generation.
6. Gate: assets files contain no legacy response payload shapes.

---

### C6 - Post-Spine Truth Refresh (Docs Only) _(legacy ref: 2.4e)_

**Status:** DONE

1. Scope: `docs/ACTIVE_SURFACES.md`, `VAIFORM_REPO_COHESION_AUDIT.md`, `ROUTE_TRUTH_TABLE.md`.
2. Completed: captured post-story/assets contract status and active-surface truth (later superseded by API-first + Netlify `web/` migration).
3. Gate achieved: docs match code 1:1 for current active-surface and route-truth baseline.

---

### C7 - App Entry Contract Cleanup _(legacy ref: 1.2)_

**Status:** DONE

1. Scope (historical): `src/app.js`, `src/handlers/credits.get.js`.
2. Completed in `src/app.js` (historical): canonicalized `/health` and debug `/diag/echo` envelopes.
3. Completed in `src/handlers/credits.get.js` (historical): canonicalized credits handler envelopes (later removed in C15).
4. Gate achieved: touched-file contract scan clean; behavior unchanged.
5. Superseded note: later topology cleanup made `/api/health` explicit inline, removed `src/routes/health.routes.js`, removed root `/generate` guards, and removed the direct credits handler in favor of a single canonical `/api/credits` router chain.

---

### C8 - Active Contract Pass A _(legacy ref: 1.3)_

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

**Status:** DONE

1. Scope completed: unused duplicate `src/middleware/auth.middleware.js` removed after import-proof; canonical auth middleware remains `src/middleware/requireAuth.js`.
2. Duplicate Firebase Admin init path removed with deleted file; auth initialization SSOT remains `src/config/firebase.js`.
3. Gate achieved: no runtime imports/requires of `auth.middleware` in `src/`, `web/`, `public/`, or `scripts/`; route imports continue to use `../middleware/requireAuth.js`.

---

### C11 - Plan Guard SSOT Consolidation _(legacy ref: 2.2)_

**Status:** DONE

1. Scope completed: removed unused legacy plan-guard duplicate; canonical middleware remains `src/middleware/planGuards.js`.
2. Retargeted offline endpoint-structure check to validate `planGuards.js` exports instead of deleted legacy middleware.
3. Gate achieved: no runtime imports of the removed duplicate module; route plan-guard imports remain on `../middleware/planGuards.js`.

---

### C12 - Validation/Idempotency Dead Code Cleanup _(legacy ref: 2.3)_

**Status:** DONE

1. Scope completed: removed unreferenced duplicate modules `src/validation/schema.js` and `src/middleware/idempotency.js` after import-proof.
2. Additional dead-file cleanup completed in the same no-behavior-change pass: `src/utils/logger.js`, `src/utils/async.js`, `src/utils/audio.mix.js`, `src/services/moderation.service.js`.
3. Gate achieved: zero runtime imports of removed modules in `src/`, `web/`, `public/`, `scripts/`, and `server.js`; SSOT docs updated to reflect post-delete truth.

---

### C13 - Canonical API Router Introduction _(legacy ref: 3.1)_

**Status:** DONE

1. Scope completed: `src/app.js` (mount topology + inline health parity), `src/routes/index.js` (route export cleanup), `web/public/**` (caller migrations), CI guards.
2. Implemented canonical `/api/*` surfaces via explicit mounts in `src/app.js`; `src/routes/api.router.js` was intentionally **not** introduced.
3. Added explicit `/api/health` (GET/HEAD) alongside `/health` to support Netlify `/api/*` proxy checks.
4. Gate achieved: active endpoints are reachable via canonical `/api` paths without hidden `/api/` collision surfaces.

---

### C14 - Remove Duplicate Root API Mounts _(legacy ref: 3.2)_

**Status:** DONE

1. Scope completed: `src/app.js`.
2. Removed duplicate root aliases and ambiguous duplicate mount chains for API surfaces.
3. Eliminated hidden root/API collision surfaces: removed root `/` exposure, removed `/api/` collision sources, and removed root `/generate` guard leftovers.
4. Gate achieved: root exposure is limited to the explicit keep-list (`/health`, `/api/health`, `/stripe/webhook`, `/assets/*`); all feature routes live under `/api/*`.

---

### C15 - Credits De-duplication _(legacy ref: 3.3)_

**Status:** DONE

1. Scope completed: `src/app.js`, `src/routes/credits.routes.js`, `src/controllers/credits.controller.js`.
2. Eliminated direct-handler + router duplication by removing `src/handlers/credits.get.js` and wiring a single canonical `/api/credits` router chain.
3. Gate achieved: one canonical credits path per endpoint; no duplicate handler registration remains.

---

### C16 - Launch Surface Lock Verification _(legacy ref: 4.1)_

**Status:** DONE

1. Scope completed: `src/app.js`, `src/routes/index.js`, `env.example`, `docs/ACTIVE_SURFACES.md`, `ROUTE_TRUTH_TABLE.md`, `VAIFORM_REPO_COHESION_AUDIT.md`.
2. Completed: removed `ENABLE_LEGACY_ROUTES` mount wiring and deleted legacy/unmounted route modules (`uploads`, `voice`, `tts`, `caption.render`, `studio`, `quotes`, `preview`) plus zero-ref support modules exposed by that removal.
3. Gate achieved: intended active surface remains under defaults; removed legacy paths are no longer mounted.
4. Posture note: subsequent work moved web SSOT to `web/` (Netlify build) and pruned backend root aliases; `ROUTE_TRUTH_TABLE.md` + `docs/ACTIVE_SURFACES.md` were updated, while `VAIFORM_REPO_COHESION_AUDIT.md` is queued for C17 publication refresh.

---

### C17 - Final Cohesion Publication _(legacy ref: 4.2)_

**Status:** DONE

1. Scope completed: `src/routes/whoami.routes.js`, `src/routes/users.routes.js`, enhance surface cleanup (`src/app.js`, `src/routes/index.js`, deleted enhance route/controller/service/schema), `scripts/smoke.mjs`, CI workflow + truth docs.
2. Completed: canonical envelope migration for `/api/whoami` and `/api/users/ensure` via `respond.ok/fail`.
3. Completed: removed `/api/enhance` surface end-to-end (backend + frontend caller/UI), plus docs statement that the feature is retired.
4. Completed: CI ratchet now runs full `npm run check:responses` on push/PR, while keeping changed-files checks.
5. Publication hygiene: deterministic Prettier fix command is `npx prettier --write PLAN_UPDATED_WITH_STATUS_LEDGER.md`.

---

### C18 - Remove Tailwind CDN + Pin CSS Build _(new)_

**Status:** DONE

1. Scope: `web/public/*.html`, `web/tailwind.config.js`, `web/src/tailwind.css`, `web/package.json`, `.github/workflows/ci.yml`.
2. Removed `cdn.tailwindcss.com` usage from all 10 HTML files; replaced with `<link rel="stylesheet" href="/tailwind.css" />`.
3. Added `tailwindcss@^3.4.19` as a dev dependency in `web/package.json`.
4. Created `web/tailwind.config.js` (`darkMode: 'class'`, content scans `./public/**/*.html` and `./public/**/*.js`).
5. Created `web/src/tailwind.css` (Tailwind base/components/utilities directives).
6. Updated web build script to run Tailwind CLI (`--minify`) after the copy step, outputting to `dist/tailwind.css`.
7. Added CI step to install web deps and run the web build on every push/PR.
8. Gate achieved: no references to `cdn.tailwindcss.com` remain in `web/public/**`; Netlify build produces a deterministic, locally-generated CSS file.

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
