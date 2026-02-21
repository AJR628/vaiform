# Vaiform Cohesion Hardening Plan (Living SSOT)

As-of: 2026-02-20

## Current status ledger

### Completed

- A: Netlify hardening + redirect SSOT cleanup
  - Netlify build command switched to deterministic install (`npm ci`).
  - Canonical `/api/* -> backend /api/:splat` proxy mapping set.
  - Conflicting redirect definitions removed from copied `_redirects` source.
- B: Frontend source migration
  - Frontend source moved from root `public/` to `web/public/`.
  - `web/scripts/copy-public.mjs` now copies from `web/public` to `web/dist`.
  - Equivalence gate passed: deployed artifact hash set matched pre/post migration.
- C: Backend API-only cleanup
  - Removed backend static hosting of `web/dist` and root `public`.
  - Removed backend `/creative` route.
  - Removed backend `/cdn` route and module.
  - Removed inline no-op `/api/user/setup` alias in `src/app.js`.
  - Ensured `GET /` is a stable API-root JSON response by mounting `routes.index` before `healthRoutes`.
  - Root `public/` directory removed.

### Deferred (explicit)

- D (optional): remove Vite/React/Next scaffolding and simplify web toolchain.
  - This is a separate architecture decision and requires its own parity gate.

## Canonical architecture now

- Frontend runtime: Netlify serves `web/dist`.
- Frontend source: `web/public`.
- Backend runtime: API + health + webhook + assets/fonts.
- Redirect/proxy source-of-truth: `netlify.toml`.

## Contract invariants

- Success envelope: `{ success: true, data, requestId }`
- Failure envelope: `{ success: false, error, detail, fields?, requestId }`

## Next suggested work (outside A/B/C)

1. Evaluate and decide whether to keep Vite build assets/tooling.
2. If simplifying toolchain, perform in isolated phase with fresh dist parity checks.
3. Continue active-surface contract ratchet on changed files in CI.
