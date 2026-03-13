# Route Truth Table (Visual SSOT + API Prune)

> Evidence Notice (2026-03-13)
> This file is retained as route inventory and historical evidence.
> It is not the primary docs front door for mobile/backend contract work.
> Start at docs/DOCS_INDEX.md.

Audit date: 2026-03-13

## Status definitions

- Default-Reachable: reachable with `VAIFORM_DEBUG=0`
- Debug-Gated: reachable only with `VAIFORM_DEBUG=1`
- Removed: intentionally deleted surface

## Default-Reachable routes

| Method   | Path                         | Notes                                                                                                                                                                                                              |
| -------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET      | `/health`                    | Inline health endpoint                                                                                                                                                                                             |
| HEAD     | `/health`                    | Inline liveness                                                                                                                                                                                                    |
| GET      | `/api/health`                | Netlify-proxy health endpoint                                                                                                                                                                                      |
| HEAD     | `/api/health`                | Netlify-proxy liveness                                                                                                                                                                                             |
| GET      | `/stripe/webhook`            | Webhook alive check                                                                                                                                                                                                |
| POST     | `/stripe/webhook`            | Stripe webhook handler for checkout completion, renewals, and plan subscription deletion                                                                                                                           |
| GET      | `/api/usage`                 | Canonical billing/account-state surface                                                                                                                                                                            |
| GET      | `/api/whoami`                | Mounted; console/helper caller only                                                                                                                                                                                |
| POST     | `/api/checkout/start`        | Pricing page checkout start                                                                                                                                                                                        |
| POST     | `/api/checkout/portal`       | Pricing page billing portal                                                                                                                                                                                        |
| GET      | `/api/shorts/mine`           | My shorts list                                                                                                                                                                                                     |
| GET      | `/api/shorts/:jobId`         | Short detail                                                                                                                                                                                                       |
| POST     | `/api/assets/options`        | Article draft clip search                                                                                                                                                                                          |
| GET      | `/api/limits/usage`          | Mounted; no current web caller found                                                                                                                                                                               |
| GET/POST | `/api/story/*`               | Creative story flow via `creative.article.mjs`; caller-backed routes include `GET /api/story/:sessionId` plus POST draft/editor/finalize paths. `/api/story/render` remains mounted but has no current web caller. |
| POST     | `/api/caption/preview`       | Caption preview (auth-required)                                                                                                                                                                                    |
| GET/POST | `/api/user/*`                | Mounted; no current web caller found                                                                                                                                                                               |
| POST     | `/api/users/ensure`          | Firebase login bootstrap                                                                                                                                                                                           |
| GET      | `/assets/*`                  | Backend static asset serving                                                                                                                                                                                       |
| GET      | `/assets/fonts/*`            | Backend serves font assets (Netlify does not proxy fonts)                                                                                                                                                          |

## Debug-Gated routes

| Method | Path                      | Notes                               |
| ------ | ------------------------- | ----------------------------------- |
| \*     | `/diag/*`                 | Mounted only with `VAIFORM_DEBUG=1` |
| GET    | `/api/diag/headers`       | Mounted only with `VAIFORM_DEBUG=1` |
| GET    | `/api/diag/caption-smoke` | Caption preview debug smoke         |

## Removed routes (A/B/C)

| Method | Path                    | Removed in                   |
| ------ | ----------------------- | ---------------------------- |
| GET    | `/`                     | Visual SSOT + API prune      |
| GET    | `/api/`                 | Visual SSOT + API prune      |
| GET    | `/credits`              | Visual SSOT + API prune      |
| GET    | `/api/credits`          | Phase 5 credit cleanup       |
| POST   | `/api/checkout/session` | Phase 5 credit cleanup       |
| POST   | `/api/checkout/subscription` | Phase 5 credit cleanup  |
| GET    | `/whoami`               | Visual SSOT + API prune      |
| POST   | `/generate`             | Visual SSOT + API prune      |
| POST   | `/enhance`              | Visual SSOT + API prune      |
| POST   | `/api/enhance`          | C17 (feature retired)        |
| POST   | `/api/generate`         | Phase 2 image cluster prune  |
| GET    | `/api/job/:jobId`       | Phase 2 image cluster prune  |
| POST   | `/api/assets/ai-images` | Phase 2 image cluster prune  |
| GET    | `/limits/usage`         | Visual SSOT + API prune      |
| POST   | `/checkout/start`       | Visual SSOT + API prune      |
| POST   | `/api/start`            | Visual SSOT + API prune      |
| POST   | `/api/session`          | Visual SSOT + API prune      |
| POST   | `/api/subscription`     | Visual SSOT + API prune      |
| POST   | `/api/portal`           | Visual SSOT + API prune      |
| GET    | `/creative`             | C (backend API-only cleanup) |
| GET    | `/cdn`                  | C (no active callers)        |

## Key mount truth

- Backend no longer serves frontend static from `web/dist` or root `public`.
- Frontend is served by Netlify; backend serves API + required assets only.
- Checkout is canonicalized under `/api/checkout/*`.
- Current `/api/user/*` is router-backed under `/api/user`; only an older inline alias is gone.
- Current caller-backed render path is `/api/story/finalize` with `GET /api/story/:sessionId` polling; `/api/story/render` is mounted but not caller-backed in `web/public/**`.
