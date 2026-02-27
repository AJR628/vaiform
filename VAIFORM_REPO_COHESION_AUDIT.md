# Vaiform Repo Cohesion Audit (Post A/B/C)

Audit date: 2026-02-22

## Executive summary

| Category                 | Current truth                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Frontend build root      | `web`                                                                                                                  |
| Frontend source-of-truth | `web/public`                                                                                                           |
| Frontend publish output  | `web/dist`                                                                                                             |
| Netlify build command    | `npm ci --no-audit --no-fund && npm run build`                                                                         |
| Backend posture          | API-only                                                                                                               |
| Backend frontend serving | Removed (`web/dist` + root `public` removed)                                                                           |
| Netlify API proxy        | `/api/* -> backend /api/:splat`                                                                                        |
| Font serving             | Backend serves `/assets/*` directly (including `/assets/fonts/*`); Netlify proxies only `/api/*` and `/stripe/webhook` |
| Removed backend surfaces | `/creative`, `/cdn`, `/api/enhance` (feature retired), inline `/api/user/setup` no-op alias                            |

## Architecture truth

- Netlify serves frontend pages from `web/dist`.
- Backend serves APIs, webhook, health, and required static assets (`/assets/*`, especially fonts).
- Redirect/proxy SSOT is `netlify.toml`.
- Root `public/` directory was migrated to `web/public/` and removed.

## Security and cohesion impact

- Eliminated dual frontend serving paths in backend.
- Removed unused `/cdn` proxy surface.
- Removed shadowing-prone inline no-op alias route in app entry.
- Removed `/api/enhance` route surface and shipped frontend enhance caller/UI.
- Reduced deployment instability by switching from destructive install to deterministic `npm ci`.
- Closed remaining default-reachable envelope partials on `/api/whoami` and `/api/users/ensure`.
- Removed `cdn.tailwindcss.com` CDN dependency; Tailwind CSS is now built locally via CLI (`tailwindcss@3`) and output to `web/dist/tailwind.css` at build time.
- CI now verifies `.mjs`-sourced Tailwind selectors are present in built CSS (`.h-\[420px\]` and `.dark\:bg-yellow-900\/20`) to catch content-glob drift.

## Remaining intentional deferment

- Toolchain simplification completed: web build is copy-only, and the Vite/React toolchain is removed from the active deployment pipeline.

## Verification baseline used

- `npm run lint`
- `npm run test:security`
- `npm run check:responses`
- `node scripts/check-responses-changed.mjs --files ...`
- `node scripts/check-format-changed.mjs --files ...`
- `npm --prefix web run build`
- Dist artifact hash parity check for deployed frontend file set
