# Route Truth Table (Post A/B/C)

Audit date: 2026-02-20

## Status definitions

- Default-Reachable: reachable with `VAIFORM_DEBUG=0`
- Debug-Gated: reachable only with `VAIFORM_DEBUG=1`
- Removed: intentionally deleted surface

## Default-Reachable routes

| Method   | Path                    | Notes                          |
| -------- | ----------------------- | ------------------------------ |
| GET      | `/health`               | Inline health endpoint         |
| HEAD     | `/health`               | Inline liveness                |
| GET      | `/`                     | API root JSON (`routes.index`) |
| GET      | `/stripe/webhook`       | Webhook alive check            |
| POST     | `/stripe/webhook`       | Stripe webhook handler         |
| GET      | `/credits`              | Root alias                     |
| GET      | `/api/credits`          | Canonical frontend target      |
| POST     | `/generate`             | Root alias                     |
| POST     | `/api/generate`         | Canonical frontend target      |
| GET      | `/job/:jobId`           | Root alias                     |
| GET      | `/api/job/:jobId`       | Canonical frontend target      |
| POST     | `/enhance`              | Root alias                     |
| POST     | `/api/enhance`          | Canonical frontend target      |
| POST     | `/checkout/start`       | Root checkout alias            |
| POST     | `/api/start`            | API checkout alias             |
| POST     | `/api/session`          | Checkout session               |
| POST     | `/api/subscription`     | Subscription checkout          |
| POST     | `/api/portal`           | Billing portal                 |
| GET      | `/api/shorts/mine`      | My shorts list                 |
| GET      | `/api/shorts/:jobId`    | Short detail                   |
| POST     | `/api/assets/options`   | Asset options                  |
| POST     | `/api/assets/ai-images` | Disabled with canonical 410    |
| GET      | `/api/limits/usage`     | Usage limits                   |
| GET      | `/limits/usage`         | Root alias                     |
| POST     | `/api/story/*`          | Story pipeline routes          |
| POST     | `/api/caption/preview`  | Caption preview                |
| GET/POST | `/api/user/*`           | User profile/setup routes      |
| POST     | `/api/users/ensure`     | Ensure user doc                |
| GET      | `/assets/*`             | Backend static asset serving   |
| GET      | `/assets/fonts/*`       | Font serving for Netlify proxy |

## Debug-Gated routes

| Method | Path                      | Notes                               |
| ------ | ------------------------- | ----------------------------------- |
| \*     | `/diag/*`                 | Mounted only with `VAIFORM_DEBUG=1` |
| GET    | `/api/diag/headers`       | Mounted only with `VAIFORM_DEBUG=1` |
| GET    | `/api/diag/caption-smoke` | Caption preview debug smoke         |

## Removed routes (A/B/C)

| Method | Path                                                 | Removed in                      |
| ------ | ---------------------------------------------------- | ------------------------------- |
| GET    | `/creative`                                          | C (backend API-only cleanup)    |
| GET    | `/cdn`                                               | C (no active callers)           |
| POST   | `/api/user/setup` inline no-op alias in `src/app.js` | C (router-backed route remains) |

## Key mount truth

- Backend no longer serves frontend static from `web/dist` or root `public`.
- Frontend is served by Netlify; backend serves API + required assets only.
