# Vaiform Repo Cohesion Audit (Post A/B/C)

Audit date: 2026-02-20

## Executive summary

| Category                 | Current truth                                             |
| ------------------------ | --------------------------------------------------------- |
| Frontend build root      | `web`                                                     |
| Frontend source-of-truth | `web/public`                                              |
| Frontend publish output  | `web/dist`                                                |
| Netlify build command    | `npm ci --no-audit --no-fund && npm run build`            |
| Backend posture          | API-only                                                  |
| Backend frontend serving | Removed (`web/dist` + root `public` removed)              |
| Netlify API proxy        | `/api/* -> backend /api/:splat`                           |
| Font proxy               | `/assets/fonts/* -> backend /assets/fonts/:splat`         |
| Removed backend surfaces | `/creative`, `/cdn`, inline `/api/user/setup` no-op alias |

## Architecture truth

- Netlify serves frontend pages from `web/dist`.
- Backend serves APIs, webhook, health, and required static assets (`/assets/*`, especially fonts).
- Redirect/proxy SSOT is `netlify.toml`.
- Root `public/` directory was migrated to `web/public/` and removed.

## Security and cohesion impact

- Eliminated dual frontend serving paths in backend.
- Removed unused `/cdn` proxy surface.
- Removed shadowing-prone inline no-op alias route in app entry.
- Reduced deployment instability by switching from destructive install to deterministic `npm ci`.

## Remaining intentional deferment

- Toolchain simplification (removing Vite/React scaffolding) is deferred as a separate architecture decision and not part of A/B/C.

## Verification baseline used

- `npm run lint`
- `npm run test:security`
- `npm run check:responses`
- `node scripts/check-responses-changed.mjs --files ...`
- `node scripts/check-format-changed.mjs --files ...`
- `npm --prefix web run build`
- Dist artifact hash parity check for deployed frontend file set
