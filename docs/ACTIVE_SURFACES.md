# Active Surfaces (Visual SSOT + API Prune)

Audit date: 2026-02-28

## Runtime model

- Detailed file:line audit is in `docs/TRUTH_FREEZE_AUDIT_2026-02-28.md`.
- Frontend is served by Netlify from `web/dist`.
- Frontend source files live in `web/public`.
- Netlify redirect/proxy SSOT is `netlify.toml` (no `_redirects` files under `web/`).
- Backend serves API + required static assets only.

## Frontend entry surfaces

- Core beta entry pages:
  - `/creative` -> `/creative.html`
  - `/my-shorts.html`
  - `/pricing.html`
  - `/buy-credits.html`
  - `/login.html`
- Legacy image pages still exposed:
  - `/image-creator.html`
  - `/my-images.html`
  - `/retry.html`
- Static/support pages:
  - `/` and `/index.html`
  - `/legal.html`
  - `/success.html`

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
  - `/api/enhance` (feature retired)
  - old checkout aliases: `/checkout/*`, `/api/start`, `/api/session`, `/api/subscription`, `/api/portal`
  - `/creative` HTML route
  - frontend static serving from backend `web/dist` or root `public`
  - `/cdn` proxy route
- Debug-only (`VAIFORM_DEBUG=1`):
  - `/diag/*`
  - `/api/diag/headers`
  - `/api/diag/caption-smoke`

## Caller-backed notes

- Article explainer pipeline remains caller-backed via `web/public/creative.html` -> `web/public/js/pages/creative/creative.article.mjs`.
- Caption preview remains caller-backed via `web/public/js/caption-preview.js`.
- Shorts library remains caller-backed via `web/public/my-shorts.html` -> `web/public/js/my-shorts.js`.
- Checkout start remains caller-backed via `web/public/pricing.html` -> `web/public/js/pricing.js`.
- Checkout session/subscription/portal remain caller-backed via `web/public/buy-credits.html` -> `web/public/js/buy-credits.js`.
- User bootstrap remains caller-backed via `web/public/js/firebaseClient.js` -> `/api/users/ensure`.
- Legacy image generation surfaces remain caller-backed today via `web/public/image-creator.html`, `web/public/my-images.html`, and `web/public/retry.html`.
- `/api/whoami`, `/api/limits/usage`, and `/api/user/*` are mounted but have no current user-facing web caller in `web/public`.
