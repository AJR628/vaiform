# Route Truth Table (Visual SSOT + API Prune)

Audit date: 2026-02-21

## Status definitions

- Default-Reachable: reachable with `VAIFORM_DEBUG=0`
- Debug-Gated: reachable only with `VAIFORM_DEBUG=1`
- Removed: intentionally deleted surface

## Default-Reachable routes

| Method   | Path                         | Notes                           |
| -------- | ---------------------------- | ------------------------------- |
| GET      | `/health`                    | Inline health endpoint          |
| HEAD     | `/health`                    | Inline liveness                 |
| GET      | `/api/health`                | Netlify-proxy health endpoint   |
| HEAD     | `/api/health`                | Netlify-proxy liveness          |
| GET      | `/stripe/webhook`            | Webhook alive check             |
| POST     | `/stripe/webhook`            | Stripe webhook handler          |
| GET      | `/api/credits`               | Canonical frontend target       |
| GET      | `/api/whoami`                | Canonical auth info endpoint    |
| POST     | `/api/generate`              | Canonical frontend target       |
| GET      | `/api/job/:jobId`            | Canonical frontend target       |
| POST     | `/api/checkout/start`        | Canonical checkout start        |
| POST     | `/api/checkout/session`      | Canonical checkout session      |
| POST     | `/api/checkout/subscription` | Canonical subscription checkout |
| POST     | `/api/checkout/portal`       | Canonical billing portal        |
| GET      | `/api/shorts/mine`           | My shorts list                  |
| GET      | `/api/shorts/:jobId`         | Short detail                    |
| POST     | `/api/assets/options`        | Asset options                   |
| POST     | `/api/assets/ai-images`      | Disabled with canonical 410     |
| GET      | `/api/limits/usage`          | Usage limits                    |
| POST     | `/api/story/*`               | Story pipeline routes           |
| POST     | `/api/caption/preview`       | Caption preview                 |
| GET/POST | `/api/user/*`                | User profile/setup routes       |
| POST     | `/api/users/ensure`          | Ensure user doc                 |
| GET      | `/assets/*`                  | Backend static asset serving    |
| GET      | `/assets/fonts/*`            | Font serving for Netlify proxy  |

## Debug-Gated routes

| Method | Path                      | Notes                               |
| ------ | ------------------------- | ----------------------------------- |
| \*     | `/diag/*`                 | Mounted only with `VAIFORM_DEBUG=1` |
| GET    | `/api/diag/headers`       | Mounted only with `VAIFORM_DEBUG=1` |
| GET    | `/api/diag/caption-smoke` | Caption preview debug smoke         |

## Removed routes (A/B/C)

| Method | Path                                                 | Removed in                      |
| ------ | ---------------------------------------------------- | ------------------------------- |
| GET    | `/`                                                  | Visual SSOT + API prune         |
| GET    | `/api/`                                              | Visual SSOT + API prune         |
| GET    | `/credits`                                           | Visual SSOT + API prune         |
| GET    | `/whoami`                                            | Visual SSOT + API prune         |
| POST   | `/generate`                                          | Visual SSOT + API prune         |
| POST   | `/enhance`                                           | Visual SSOT + API prune         |
| POST   | `/api/enhance`                                       | C17 (feature retired)           |
| GET    | `/limits/usage`                                      | Visual SSOT + API prune         |
| POST   | `/checkout/start`                                    | Visual SSOT + API prune         |
| POST   | `/api/start`                                         | Visual SSOT + API prune         |
| POST   | `/api/session`                                       | Visual SSOT + API prune         |
| POST   | `/api/subscription`                                  | Visual SSOT + API prune         |
| POST   | `/api/portal`                                        | Visual SSOT + API prune         |
| GET    | `/creative`                                          | C (backend API-only cleanup)    |
| GET    | `/cdn`                                               | C (no active callers)           |
| POST   | `/api/user/setup` inline no-op alias in `src/app.js` | C (router-backed route remains) |

## Key mount truth

- Backend no longer serves frontend static from `web/dist` or root `public`.
- Frontend is served by Netlify; backend serves API + required assets only.
- Checkout is canonicalized under `/api/checkout/*`.
