# Active Surfaces (Post A/B/C Snapshot)

Audit date: 2026-02-20

## Runtime model

- Frontend is served by Netlify from `web/dist`.
- Frontend source files live in `web/public`.
- Backend is API-only and does not serve SPA/HTML pages.

## Netlify bridge surfaces

- `/api/*` -> backend `/api/:splat` (proxy in `netlify.toml`).
- `/assets/fonts/*` -> backend `/assets/fonts/:splat`.
- `/stripe/webhook` -> backend `/stripe/webhook`.

## Backend default reachable surfaces (`VAIFORM_DEBUG=0`)

- Health:
  - `GET /health`
  - `HEAD /health`
  - `GET /` (API root JSON from `routes.index`)
- Webhook:
  - `GET /stripe/webhook`
  - `POST /stripe/webhook`
- Core API mounts:
  - `/api/generate`, `/api/job/:jobId`
  - `/api/credits`
  - `/api/enhance`
  - `/api/start`, `/api/session`, `/api/subscription`, `/api/portal`
  - `/api/shorts/mine`, `/api/shorts/:jobId`
  - `/api/assets/options`, `/api/assets/ai-images` (disabled 410)
  - `/api/limits/usage`
  - `/api/story/*`
  - `/api/caption/preview`
  - `/api/user/*`, `/api/users/ensure`
- Backend static (required only):
  - `/assets/*` (including `/assets/fonts/*`)

## Removed/non-active surfaces

- Removed from backend:
  - `/creative` HTML route
  - frontend static serving from `web/dist`
  - frontend static serving from root `public`
  - `/cdn` proxy route
  - inline no-op `POST /api/user/setup` alias in `src/app.js`
- Debug-only (`VAIFORM_DEBUG=1`):
  - `/diag/*`
  - `/api/diag/headers`

## Caller-backed notes

- Article explainer pipeline remains caller-backed via `web/public/creative.html` -> `web/public/js/pages/creative/creative.article.mjs`.
- Caption preview remains caller-backed via `web/public/js/caption-preview.js`.
- Checkout, credits, shorts, and limits callers remain in `web/public/js/*`.
