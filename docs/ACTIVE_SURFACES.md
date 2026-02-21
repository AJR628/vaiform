# Active Surfaces (Visual SSOT + API Prune)

Audit date: 2026-02-21

## Runtime model

- Frontend is served by Netlify from `web/dist`.
- Frontend source files live in `web/public`.
- Netlify redirect/proxy SSOT is `netlify.toml` (no `_redirects` files under `web/`).
- Backend serves API + required static assets only.

## Netlify bridge surfaces

- `/api/*` -> backend `/api/:splat` (proxy in `netlify.toml`).
- `/stripe/webhook` -> backend `/stripe/webhook`.

## Backend default reachable surfaces (`VAIFORM_DEBUG=0`)

- Health:
  - `GET /health`
  - `HEAD /health`
  - `GET /api/health`
  - `HEAD /api/health`
- Webhook:
  - `GET /stripe/webhook`
  - `POST /stripe/webhook`
- Core API mounts:
  - `/api/generate`, `/api/job/:jobId`
  - `/api/credits`
  - `/api/whoami`
  - `/api/enhance`
  - `/api/checkout/start`, `/api/checkout/session`, `/api/checkout/subscription`, `/api/checkout/portal`
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
  - `GET /` (root API JSON)
  - `GET /api/` (accidental root collisions from router `/` mounts)
  - root aliases: `/credits`, `/whoami`, `/generate`, `/enhance`, `/limits/*`
  - old checkout aliases: `/checkout/*`, `/api/start`, `/api/session`, `/api/subscription`, `/api/portal`
  - `/creative` HTML route
  - frontend static serving from backend `web/dist` or root `public`
  - `/cdn` proxy route
  - inline no-op `POST /api/user/setup` alias in `src/app.js`
- Debug-only (`VAIFORM_DEBUG=1`):
  - `/diag/*`
  - `/api/diag/headers`

## Caller-backed notes

- Article explainer pipeline remains caller-backed via `web/public/creative.html` -> `web/public/js/pages/creative/creative.article.mjs`.
- Caption preview remains caller-backed via `web/public/js/caption-preview.js`.
- Checkout, credits, shorts, and limits callers remain in `web/public/js/*`.
