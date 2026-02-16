# Route Truth Table (C1 Baseline, Code-Evidenced)

**Audit date**: 2026-02-16  
**Branch**: `feat/voice-ssot-tts`  

Rules used in this table:
- **Envelope status applies only to JSON responses**.
- **Active = Default-Reachable AND Caller-Backed**.
- **Caller-Backed = called from files actually served by default runtime entrypoints (dist-first mode when `web/dist` exists)**.

Columns:
- `Gating`: `Default-Reachable`, `Legacy-Gated`, `Debug-Gated`, `Commented/Unmounted`, `Shadowed`.
- `Response`: `json`, `html`, `file`, `redirect`, `raw`, `empty`.

| Method | Path | Mounted in | Middleware chain (ordered) | Handler | Auth | Response | Gating | Default-Reachable | Caller-Backed | Active | Envelope status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| GET | `/health` | `src/app.js:170` | `reqId -> cors -> inline` | inline health | public | json | Default-Reachable | yes | yes (ops/health) | yes | Drift (`ok`) | `src/app.js:170-174` |
| HEAD | `/health` | `src/app.js:175` | `reqId -> cors -> inline` | inline head | public | empty | Default-Reachable | yes | yes (ops/health) | yes | n/a (non-json) | `src/app.js:175-177` |
| GET | `/stripe/webhook` | `/stripe/webhook` | `reqId -> cors -> stripe router` | alive check | public | json | Default-Reachable | yes | no | no | Drift (`ok`) | `src/app.js:120`, `src/routes/stripe.webhook.js:144-145` |
| POST | `/stripe/webhook` | `/stripe/webhook` | `reqId -> cors -> express.raw -> webhook` | webhook handler | public (signed) | raw/json | Default-Reachable | yes | yes (Stripe) | yes | Drift (`ok` on error path) | `src/routes/stripe.webhook.js:12`, `src/routes/stripe.webhook.js:66` |
| GET | `/` | `/` healthRoutes | `reqId -> cors -> healthRoutes` | health root | public | json | Default-Reachable | yes | yes (browser root) | yes | Drift (`message`) | `src/app.js:211`, `src/routes/health.routes.js:10-19` |
| GET | `/` | `/` whoamiRoutes | `reqId -> cors -> requireAuth` | whoami root | required | json | Shadowed (winner: `healthRoutes`) | no (practically) | no | no | Drift (no requestId) | `src/app.js:211-212`, `src/routes/whoami.routes.js:10-17` |
| GET | `/` | `/` creditsRoutes | `reqId -> cors -> requireAuth` | credits root | required | json | Shadowed | no (practically) | no | no | Drift (manual json) | `src/app.js:214`, `src/routes/credits.routes.js:11` |
| GET | `/` | `/` routes.index | `reqId -> cors -> index router` | API root | public | json | Shadowed | no (practically) | no | no | Drift (`message`) | `src/app.js:237`, `src/routes/index.js:24` |
| GET | `/api` | `/api` healthRoutes | `reqId -> cors -> healthRoutes` | health root | public | json | Default-Reachable | yes | no | no | Drift (`message`) | `src/app.js:219`, `src/routes/health.routes.js:10-19` |
| GET | `/api` | `/api` whoamiRoutes | `reqId -> cors -> requireAuth` | whoami root | required | json | Shadowed (winner: `healthRoutes`) | no (practically) | no | no | Drift (no requestId) | `src/app.js:219-220`, `src/routes/whoami.routes.js:10-17` |
| GET | `/credits` | direct app route | `reqId -> cors -> getCreditsHandler` | credits handler | required (manual token check) | json | Default-Reachable | yes | yes (`web/dist/js/my-images.js`, `web/dist/js/my-shorts.js`, `web/dist/creative.html`) | yes | Drift (`code/message`) | `src/app.js:215`, `src/handlers/credits.get.js:11-27`, `web/dist/js/my-images.js:132`, `web/dist/js/my-shorts.js:131`, `web/dist/creative.html:1148` |
| GET | `/api/credits` | direct app route | `reqId -> cors -> getCreditsHandler` | credits handler | required (manual token check) | json | Default-Reachable | yes | yes (served clients) | yes | Drift (`code/message`) | `src/app.js:222`, `src/handlers/credits.get.js:11-27` |
| POST | `/generate` | `/` generateRoutes | `reqId -> cors -> requireAuth -> idempotency -> validate` | generate | required | json | Default-Reachable | yes | yes (`web/dist/frontend.js`, `web/dist/creative.html`) | yes | Drift (`message` in controller) | `src/routes/generate.routes.js:11`, `web/dist/frontend.js:490`, `web/dist/creative.html:2443` |
| POST | `/api/generate` | `/api` generateRoutes | `reqId -> cors -> requireAuth -> idempotency -> validate` | generate | required | json | Default-Reachable | yes | yes (served clients) | yes | Drift (`message` in controller) | `src/app.js:223`, `src/routes/generate.routes.js:11` |
| GET | `/job/:jobId` | `/` generateRoutes | `reqId -> cors -> requireAuth` | job status | required | json | Default-Reachable | yes | yes (`web/dist/js/my-images.js`) | yes | Drift (`message` in controller) | `src/routes/generate.routes.js:12`, `web/dist/js/my-images.js:378` |
| GET | `/api/job/:jobId` | `/api` generateRoutes | `reqId -> cors -> requireAuth` | job status | required | json | Default-Reachable | yes | yes (served clients) | yes | Drift (`message` in controller) | `src/app.js:223`, `src/routes/generate.routes.js:12` |
| GET | `/generate` | direct app guard | `reqId -> cors -> inline` | 405 guard | public | json | Default-Reachable | yes | yes (browser misuse) | yes | Drift (`code/message`) | `src/app.js:229-232` |
| POST | `/enhance` | `/` and `/enhance` | `reqId -> cors -> requireAuth -> validate` | enhance | required | json | Default-Reachable | yes | yes (`web/dist/frontend.js`) | yes | Mixed/manual (not `ok/fail`) | `src/app.js:241-243`, `src/routes/enhance.routes.js:28-31`, `web/dist/frontend.js:272` |
| POST | `/api/enhance` | `/api` | `reqId -> cors -> requireAuth -> validate` | enhance | required | json | Default-Reachable | yes | no proven default caller | no | Mixed/manual (not `ok/fail`) | `src/app.js:243`, `src/routes/enhance.routes.js:28` |
| POST | `/checkout/start` | `/checkout` | `reqId -> cors -> requireAuth` | startPlanCheckout | required | json | Default-Reachable | yes | yes (`web/dist/js/pricing.js`) | yes | Drift (`ok/reason`) | `src/app.js:247`, `src/routes/checkout.routes.js:16`, `web/dist/js/pricing.js:138` |
| POST | `/api/start` | `/api` | `reqId -> cors -> requireAuth` | startPlanCheckout | required | json | Default-Reachable | yes | no proven default caller | no | Drift (`ok/reason`) | `src/app.js:248`, `src/routes/checkout.routes.js:16` |
| POST | `/checkout/session` | `/checkout` | `reqId -> cors -> requireAuth -> validate` | createCheckoutSession | required | json | Default-Reachable | yes | no proven default caller (entrypoint caller targets `/api/checkout/session`) | no | Drift (`ok/reason`) | `src/routes/checkout.routes.js:20`, `web/dist/js/buy-credits.js:40`, `web/dist/api.mjs:152` |
| POST | `/api/session` | `/api` | `reqId -> cors -> requireAuth -> validate` | createCheckoutSession | required | json | Default-Reachable | yes | no proven default caller | no | Drift (`ok/reason`) | `src/app.js:248`, `src/routes/checkout.routes.js:20` |
| POST | `/checkout/subscription` | `/checkout` | `reqId -> cors -> requireAuth -> validate` | createSubscriptionSession | required | json | Default-Reachable | yes | no proven default caller (entrypoint caller targets `/api/checkout/subscription`) | no | Drift (`ok/reason`) | `src/routes/checkout.routes.js:23`, `web/dist/js/buy-credits.js:52`, `web/dist/api.mjs:152` |
| POST | `/api/subscription` | `/api` | `reqId -> cors -> requireAuth -> validate` | createSubscriptionSession | required | json | Default-Reachable | yes | no proven default caller | no | Drift (`ok/reason`) | `src/app.js:248`, `src/routes/checkout.routes.js:23` |
| POST | `/checkout/portal` | `/checkout` | `reqId -> cors -> requireAuth` | createBillingPortalSession | required | json | Default-Reachable | yes | no proven default caller (entrypoint caller targets `/api/checkout/portal`) | no | Drift (`ok/reason`) | `src/routes/checkout.routes.js:26`, `web/dist/js/buy-credits.js:123`, `web/dist/api.mjs:152` |
| POST | `/api/portal` | `/api` | `reqId -> cors -> requireAuth` | createBillingPortalSession | required | json | Default-Reachable | yes | no proven default caller | no | Drift (`ok/reason`) | `src/app.js:248`, `src/routes/checkout.routes.js:26` |
| GET | `/api/shorts/mine` | `/api/shorts` | `reqId -> cors -> requireAuth` | getMyShorts | required | json | Default-Reachable | yes | yes (`web/dist/js/my-shorts.js`) | yes | Drift (`message`) | `src/routes/shorts.routes.js:12`, `web/dist/js/my-shorts.js:35` |
| GET | `/api/shorts/:jobId` | `/api/shorts` | `reqId -> cors -> requireAuth` | getShortById | required | json | Default-Reachable | yes | yes (`web/dist/js/my-shorts.js`) | yes | Drift (`message`) | `src/routes/shorts.routes.js:13`, `web/dist/js/my-shorts.js:172` |
| GET | `/cdn` | `/cdn` | `reqId -> cors -> cdnRateLimit` | CDN proxy | public | file/json | Default-Reachable | yes | yes (`web/dist/creative.html`) | yes | Mixed/manual | `src/app.js:257`, `src/routes/cdn.routes.js:21`, `web/dist/creative.html:2576` |
| POST | `/api/assets/options` | `/api/assets` | `reqId -> cors -> requireAuth -> validate` | getAssetsOptions | required | json | Default-Reachable | yes | yes (`web/dist/creative.html`) | yes | Canonical (`ok/fail`) | `src/routes/assets.routes.js:10`, `src/controllers/assets.controller.js:17-89`, `web/dist/creative.html:1273` |
| POST | `/api/assets/ai-images` | `/api/assets` | `reqId -> cors -> requireAuth -> planGuard -> validate` | inline 410 | required | json | Default-Reachable | yes | yes (`web/dist/creative.html`) | yes | Drift (missing requestId, legacy chain still present) | `src/routes/assets.routes.js:12-17`, `web/dist/creative.html:2552` |
| GET | `/api/limits/usage` | `/api/limits` | `reqId -> cors -> requireAuth` | getUsageLimits | required | json | Default-Reachable | yes | no default caller | no | Drift (`ok/reason`) | `src/app.js:279`, `src/routes/limits.routes.js:7`, `src/controllers/limits.controller.js:7-64` |
| GET | `/limits/usage` | `/limits` | `reqId -> cors -> requireAuth` | getUsageLimits | required | json | Default-Reachable | yes | no default caller | no | Drift (`ok/reason`) | `src/app.js:280`, `src/routes/limits.routes.js:7` |
| GET | `/creative` | `/creative` | `reqId -> cors -> creative router` | send creative HTML | public | file | Default-Reachable | yes | no (dist entrypoints link to `/creative.html`, not `/creative`) | no | n/a (non-json) | `src/app.js:289`, `src/routes/creative.routes.js:11-13`, `web/dist/components/header.js:13` |
| POST | `/api/story/*` | `/api/story` | `reqId -> cors -> requireAuth -> route-specific guards` | story handlers | required | json | Default-Reachable | yes | no proven dist-entrypoint caller | no | Canonical (C4 pass; manual finalize/busy exceptions) | `src/app.js:303`, `src/routes/story.routes.js:32`, `src/routes/story.routes.js:67-845` |
| POST | `/api/caption/preview` | `/api` | `reqId -> cors -> requireAuth -> previewRateLimit -> json(200kb)` | caption preview | required | json | Default-Reachable | yes | yes (`web/dist/creative.html` -> dynamic import `web/dist/js/caption-preview.js`) | yes | Canonical (`ok/fail`) | `src/app.js:308-310`, `src/routes/caption.preview.routes.js:101`, `web/dist/creative.html:1043`, `web/dist/js/caption-preview.js:82` |
| GET | `/api/diag/caption-smoke` | `/api` | gate middleware then `requireAuth` | smoke route | required | json | Debug-Gated | no | no | no | Canonical on success path | `src/routes/caption.preview.routes.js:1219-1245` |
| POST | `/api/user/setup` | `/api/user` + inline alias | `reqId -> cors -> requireAuth` (router wins) | userRoutes setup | required | json | Default-Reachable (inline alias is Shadowed/Unreachable) | yes | no clear default caller | no | Drift (`ok/reason` in router) | `src/app.js:321`, `src/routes/user.routes.js:12-29`, `src/app.js:330-333` |
| GET | `/api/user/me` | `/api/user` | `reqId -> cors -> requireAuth` | fetch user profile | required | json | Default-Reachable | yes | no clear default caller | no | Drift (`ok/reason`) | `src/routes/user.routes.js:40-67` |
| POST | `/api/users/ensure` | `/api/users` | `reqId -> cors -> requireAuth` | ensure user doc | required | json | Default-Reachable | yes | no proven dist-entrypoint caller | no | Mixed/manual (no requestId) | `src/app.js:326`, `src/routes/users.routes.js:14-100`, `web/dist/js/firebaseClient.js:23-53` |
| POST | `/api/uploads/image` | `/api` uploads router | `reqId -> cors -> requireAuth -> uploadRateLimit -> multer` | upload image | required | json | Legacy-Gated | no | legacy caller only | no | Drift (`message`) | `src/app.js:259-262`, `src/routes/uploads.routes.js:42-71` |
| POST | `/api/uploads/register` | `/api` uploads router | `reqId -> cors -> requireAuth -> uploadRateLimit` | register upload URL | required | json | Legacy-Gated | no | legacy caller only | no | Drift (`message`) | `src/app.js:259-262`, `src/routes/uploads.routes.js:78-90` |
| GET | `/api/voice/voices` | `/api/voice` | `reqId -> cors -> requireAuth` | getVoices | required | json | Legacy-Gated | no | legacy caller only | no | Drift (`message`) | `src/app.js:283-287`, `src/routes/voice.routes.js:7` |
| POST | `/api/voice/preview` | `/api/voice` | `reqId -> cors -> requireAuth` | previewVoice | required | json | Legacy-Gated | no | legacy caller only | no | Drift (`message`) | `src/app.js:283-287`, `src/routes/voice.routes.js:8` |
| POST | `/api/tts/preview` | `/api/tts` | `reqId -> cors -> requireAuth -> ttsPreviewRateLimit -> json(200kb)` | ttsPreview | required | json | Legacy-Gated | no | legacy caller only | no | Mixed/manual | `src/app.js:298-301`, `src/routes/tts.routes.js:24` |
| POST | `/api/caption/render` | `/api` | `reqId -> cors -> requireAuth -> renderRateLimit -> json(200kb)` | caption render | required | json | Legacy-Gated | no | legacy caller only | no | Drift (manual + flatten detail object) | `src/app.js:314-317`, `src/routes/caption.render.routes.js:26-109` |
| GET | `/diag/*` | `/diag` | `reqId -> cors -> diagRoutes` | diagnostic routes | public | json | Debug-Gated | no | no | no | Drift (`ok`) | `src/app.js:216`, `src/routes/diag.routes.js:10-108` |
| GET | `/api/diag/headers` | `/api` | `reqId -> cors -> diagHeadersRoutes` | headers diag | public | json | Debug-Gated | no | no | no | Mixed/manual | `src/app.js:225-227` |
| Any | `/api/studio/*` | commented | n/a | studio routes | n/a | json/SSE | Commented/Unmounted | no | no proven dist-entrypoint caller (unreferenced bundle strings excluded) | no | n/a | `src/app.js:264-267` |
| Any | `/api/quotes/*` | commented | n/a | quotes routes | n/a | json | Commented/Unmounted | no | yes (`web/dist/creative.html`) | no | n/a | `src/app.js:269-273`, `web/dist/creative.html:1182`, `web/dist/creative.html:2376`, `web/dist/creative.html:2673` |
| Any | `/api/preview/*` | commented | n/a | preview routes | n/a | json | Commented/Unmounted | no | no default caller | no | n/a | `src/app.js:294-297` |

## CI Truth (Enforced vs Observed)

- **Enforced in CI**:
  - `npm run format:check` (`.github/workflows/ci.yml:35-36`)
  - `npm run test:security` (`.github/workflows/ci.yml:38-39`)
  - `npm run check:responses:changed` (`.github/workflows/ci.yml:41-45`)
- **Observed baseline (not CI-blocking)**:
  - `node scripts/check-responses.js` for repo-wide drift baseline.

## Broken Caller Attempts (Caller-Backed but NOT Default-Reachable)

- `POST /api/checkout/session` attempted by `apiFetch("/checkout/session")` in `web/dist/js/buy-credits.js:40` (maps to `/api/*` via `web/dist/api.mjs:152`) while mounted route is `/checkout/session` or `/api/session` (`src/app.js:247-248`, `src/routes/checkout.routes.js:20`).
- `POST /api/checkout/subscription` attempted by `apiFetch("/checkout/subscription")` in `web/dist/js/buy-credits.js:52` (same alias mismatch; mounted `/checkout/subscription` or `/api/subscription`).
- `POST /api/checkout/portal` attempted by `apiFetch("/checkout/portal")` in `web/dist/js/buy-credits.js:123` (same alias mismatch; mounted `/checkout/portal` or `/api/portal`).
- `POST /api/generate/upscale` attempted by `apiFetch("/generate/upscale")` in `web/dist/js/my-images.js:213`; no mounted route in `src/routes/generate.routes.js:11-12`.
- `POST /api/quotes/generate-quote` attempted by `apiFetch("/quotes/generate-quote")` in `web/dist/creative.html:1182`; quotes router is commented/unmounted (`src/app.js:269-273`).
- `POST /api/quotes/remix` attempted by `apiFetch("/quotes/remix")` in `web/dist/creative.html:2376`; quotes router unmounted (`src/app.js:269-273`).
- `POST /api/quotes/save` attempted by `apiFetch("/quotes/save")` in `web/dist/creative.html:2673` and `web/dist/creative.html:2782`; quotes router unmounted (`src/app.js:269-273`).
- `POST /api/voice/voices` and `POST /api/voice/preview` attempted by `web/dist/creative.html:2045` and `web/dist/creative.html:2105`; voice routes are legacy-gated (`src/app.js:283-287`, default `env.example:3` is `0`).
- `POST /api/uploads/register` attempted by `web/dist/creative.html:2600`; uploads routes are legacy-gated (`src/app.js:259-262`, default `env.example:3` is `0`).
- `POST /api/shorts/create` attempted by `web/dist/creative.html:2333`; endpoint is commented/unmounted in router (`src/routes/shorts.routes.js:9`).

## Notes on Precedence

- Ordered root mounts create practical shadowing on `GET /`:
  - `healthRoutes` mounted before `whoamiRoutes`, `creditsRoutes`, and `routes.index` (`src/app.js:211`, `src/app.js:212`, `src/app.js:214`, `src/app.js:237`).
- Credits has dual implementation on same paths:
  - router mount + direct `app.get` (`src/app.js:214-215`, `src/app.js:221-222`).

