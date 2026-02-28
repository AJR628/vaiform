# Route Truth Table (Visual SSOT + API Prune)

Audit date: 2026-02-28

## Status definitions

- Default-Reachable: reachable with `VAIFORM_DEBUG=0`
- Debug-Gated: reachable only with `VAIFORM_DEBUG=1`
- Removed: intentionally deleted surface

## Default-Reachable routes

| Method   | Path                         | Notes                                                        |
| -------- | ---------------------------- | ------------------------------------------------------------ |
| GET      | `/health`                    | Inline health endpoint                                       |
| HEAD     | `/health`                    | Inline liveness                                              |
| GET      | `/api/health`                | Netlify-proxy health endpoint                                |
| HEAD     | `/api/health`                | Netlify-proxy liveness                                       |
| GET      | `/stripe/webhook`            | Webhook alive check                                          |
| POST     | `/stripe/webhook`            | Stripe webhook handler                                       |
| GET      | `/api/credits`               | My Shorts caller-backed; legacy image callers still exist    |
| GET      | `/api/whoami`                | Mounted; console/helper caller only                          |
| POST     | `/api/generate`              | Legacy image entry only (`image-creator.html`, `retry.html`) |
| GET      | `/api/job/:jobId`            | Legacy image gallery polling only                            |
| POST     | `/api/checkout/start`        | Pricing page checkout start                                  |
| POST     | `/api/checkout/session`      | Buy credits page checkout session                            |
| POST     | `/api/checkout/subscription` | Buy credits page subscription checkout                       |
| POST     | `/api/checkout/portal`       | Buy credits page billing portal                              |
| GET      | `/api/shorts/mine`           | My shorts list                                               |
| GET      | `/api/shorts/:jobId`         | Short detail                                                 |
| POST     | `/api/assets/options`        | Article draft clip search                                    |
| POST     | `/api/assets/ai-images`      | Disabled with canonical 410                                  |
| GET      | `/api/limits/usage`          | Mounted; no current web caller found                         |
| POST     | `/api/story/*`               | Article pipeline via `creative.article.mjs`                  |
| POST     | `/api/caption/preview`       | Caption preview (auth-required)                              |
| GET/POST | `/api/user/*`                | Mounted; no current web caller found                         |
| POST     | `/api/users/ensure`          | Firebase login bootstrap                                     |
| GET      | `/assets/*`                  | Backend static asset serving                                 |
| GET      | `/assets/fonts/*`            | Backend serves font assets (Netlify does not proxy fonts)    |

## Debug-Gated routes

| Method | Path                      | Notes                               |
| ------ | ------------------------- | ----------------------------------- |
| \*     | `/diag/*`                 | Mounted only with `VAIFORM_DEBUG=1` |
| GET    | `/api/diag/headers`       | Mounted only with `VAIFORM_DEBUG=1` |
| GET    | `/api/diag/caption-smoke` | Caption preview debug smoke         |

## Removed routes (A/B/C)

| Method | Path                | Removed in                   |
| ------ | ------------------- | ---------------------------- |
| GET    | `/`                 | Visual SSOT + API prune      |
| GET    | `/api/`             | Visual SSOT + API prune      |
| GET    | `/credits`          | Visual SSOT + API prune      |
| GET    | `/whoami`           | Visual SSOT + API prune      |
| POST   | `/generate`         | Visual SSOT + API prune      |
| POST   | `/enhance`          | Visual SSOT + API prune      |
| POST   | `/api/enhance`      | C17 (feature retired)        |
| GET    | `/limits/usage`     | Visual SSOT + API prune      |
| POST   | `/checkout/start`   | Visual SSOT + API prune      |
| POST   | `/api/start`        | Visual SSOT + API prune      |
| POST   | `/api/session`      | Visual SSOT + API prune      |
| POST   | `/api/subscription` | Visual SSOT + API prune      |
| POST   | `/api/portal`       | Visual SSOT + API prune      |
| GET    | `/creative`         | C (backend API-only cleanup) |
| GET    | `/cdn`              | C (no active callers)        |

## Key mount truth

- Backend no longer serves frontend static from `web/dist` or root `public`.
- Frontend is served by Netlify; backend serves API + required assets only.
- Checkout is canonicalized under `/api/checkout/*`.
- Current `/api/user/setup` is router-backed under `/api/user`; only an older inline alias is gone.
