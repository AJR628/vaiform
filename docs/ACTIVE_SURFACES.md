# Active Surfaces (C1 Dist-Aware Truth Snapshot)

**Audit date**: 2026-02-16  
**Branch**: `feat/voice-ssot-tts`

Definitions used here:

- `Default-Reachable`: reachable with `ENABLE_LEGACY_ROUTES=0` and `VAIFORM_DEBUG=0`.
- `Caller-Backed`: called by default-runtime entrypoints and the JS they load.
- `Active`: `Default-Reachable && Caller-Backed`.

Callsite path mapping rule:

- `apiFetch("/x") => /api/x` because `API_ROOT` already ends with `/api` (`web/dist/api.mjs:7`, `web/dist/api.mjs:9`, `web/dist/api.mjs:152`).
- Fallback to root path applies only for GET `/credits|/whoami|/health` (`web/dist/api.mjs:156-163`).

## 1) Dist-First Runtime Rules

- Dist static + SPA fallback are registered before `public` static (`src/app.js:343-347`, `src/app.js:366`).
- `web/dist` exists in this repo, so dist-first behavior is active.
- Rule: **When `web/dist` exists, treat `web/dist` as the canonical source for served static assets and entrypoint call evidence. `public/` is served only via explicit routes (for example `/creative`) or when a file is missing from dist.**
- Explicit `/creative` route still serves `public/creative.html` (`src/app.js:289`, `src/routes/creative.routes.js:11-13`).

Default flags:

- `ENABLE_LEGACY_ROUTES=0`: `env.example:3`
- `VAIFORM_DEBUG=0`: `env.example:7`

## 2) Default Entrypoints (Caller Scope)

Entrypoints proven by dist nav/redirect behavior:

- `/` (`web/dist/index.html`) redirects/links to `/creative.html` (`web/dist/index.html:40`, `web/dist/index.html:142`).
- Header links: `/creative.html`, `/image-creator.html`, `/my-shorts.html`, `/my-images.html`, `/pricing.html`, `/buy-credits.html` (`web/dist/components/header.js:13-17`, `web/dist/components/header.js:26`).

Loaded script examples from entrypoint HTML:

- `creative.html` loads `./frontend.js`, `./auth-bridge.js`, `./js/firebaseClient.js`, `/js/credits-ui.js` (`web/dist/creative.html:24-34`).
- `buy-credits.html` loads `/js/buy-credits.js`, `/auth-bridge.js`, `/js/config.js`, `/js/credits-ui.js` (`web/dist/buy-credits.html:195-201`).
- `pricing.html` loads `js/pricing.js` and `./api.mjs` bridge setup (`web/dist/pricing.html:171-197`).
- `my-images.html` loads `./js/my-images.js` (`web/dist/my-images.html:152-155`).
- `my-shorts.html` loads `./js/my-shorts.js` (`web/dist/my-shorts.html:198`).

Important exclusion rule:

- Do not treat `web/dist/assets/*.js` as caller evidence unless referenced by a served entrypoint HTML.
- Example: `web/dist/assets/index-DmIxHPfx.js` contains API strings but is not referenced by the entrypoint HTML set above, so it is excluded from Caller-Backed classification.

## 3) Active (Default-Reachable + Caller-Backed)

Confirmed caller-backed default surfaces include:

- `/api/credits` via dist pages (`web/dist/js/my-images.js:132`, `web/dist/js/my-shorts.js:131`, `web/dist/creative.html:1183`) with `apiFetch("/credits") -> /api/credits` (`web/dist/api.mjs:152`).
- `/api/generate` via creative/frontend (`web/dist/frontend.js:490`, `web/dist/creative.html:2120`) with `apiFetch("/generate") -> /api/generate` (`web/dist/api.mjs:152`).
- `/api/job/:jobId` via my-images (`web/dist/js/my-images.js:357`) with `apiFetch("/job/:jobId") -> /api/job/:jobId` (`web/dist/api.mjs:152`).
- `/checkout/start` via pricing (`web/dist/js/pricing.js:138`; mounted at `src/routes/checkout.routes.js:16`).
- `/api/session`, `/api/subscription`, `/api/portal` via buy credits (`web/dist/js/buy-credits.js:40`, `web/dist/js/buy-credits.js:52`, `web/dist/js/buy-credits.js:123`; mounted via `src/app.js:248`, `src/routes/checkout.routes.js:20-26`).
- `/api/shorts/mine`, `/api/shorts/:jobId` via my-shorts (`web/dist/js/my-shorts.js:35`, `web/dist/js/my-shorts.js:172`).
- `/api/assets/options` via creative (`web/dist/creative.html:1266`).
- `/api/assets/ai-images` via creative (`web/dist/creative.html:2229`) (handler still responds `410` by design: `src/routes/assets.routes.js:12-17`).
- `/api/caption/preview` via dynamic import path (`web/dist/creative.html:1043`, `web/dist/js/caption-preview.js:82`).
- `/api/enhance` via frontend (`web/dist/frontend.js:272`) with `apiFetch("/enhance") -> /api/enhance` (`web/dist/api.mjs:152`).
- `/cdn` via creative image proxying (`web/dist/creative.html:2253`; mounted `src/app.js:257`).

## 4) Default-Reachable but Not Caller-Backed (Attack Surface)

Reachable under defaults, but no proven dist-entrypoint caller:

- `/api/limits/usage`, `/limits/usage` (`src/app.js:279-280`, `src/routes/limits.routes.js:7`).
- `/credits`, `/enhance`, `/generate`, `/job/:jobId` are root aliases not default caller-backed from dist `apiFetch` flows; `/credits` root use is conditional fallback only (`web/dist/api.mjs:156-163`).
- `/creative` route itself (dist nav points to `/creative.html`, not `/creative`) (`web/dist/components/header.js:13`).
- `/api/user/me` and `/api/user/setup` router route (`src/routes/user.routes.js:12-67`) (inline alias remains shadowed by router order: `src/app.js:321`, `src/app.js:330-333`).
- `/api/users/ensure` (`src/routes/users.routes.js:14-100`) (dist `firebaseClient` writes Firestore directly: `web/dist/js/firebaseClient.js:23-53`).
- `/api/story/*` (`src/app.js:303`) has no proven dist-entrypoint caller in current snapshot.

## 5) Caller-Backed but Not Default-Reachable (Broken Under Defaults)

None currently proven from default dist entrypoint callers.

C3 changes that removed prior broken caller attempts:

- Checkout callers now resolve to mounted aliases:
  - `apiFetch("/session")` -> `/api/session`
  - `apiFetch("/subscription")` -> `/api/subscription`
  - `apiFetch("/portal")` -> `/api/portal`
  - evidence: `web/dist/js/buy-credits.js:40`, `web/dist/js/buy-credits.js:52`, `web/dist/js/buy-credits.js:123`, `src/app.js:248`.
- Upscale callsites were removed/gated from default dist callers (`web/dist/js/my-images.js:205-213`, `web/dist/frontend.js:525-528`).
- Creative legacy/unmounted call paths (quotes/voice/uploads/register/shorts/create) are now UI-gated and hard-guarded in default dist runtime (`web/dist/creative.html:906-935`, `web/dist/creative.html:1201-1203`, `web/dist/creative.html:2025-2026`, `web/dist/creative.html:2077-2083`, `web/dist/creative.html:2269-2276`).

## 6) Legacy-Gated and Debug-Gated

Legacy-gated (only with `ENABLE_LEGACY_ROUTES=1`):

- `/api/uploads/*` (`src/app.js:259-262`)
- `/api/voice/*` and `/voice/*` (`src/app.js:283-287`)
- `/api/tts/preview` (`src/app.js:298-301`)
- `/api/caption/render` (`src/app.js:314-317`)

Debug-gated (only with `VAIFORM_DEBUG=1`):

- `/diag/*` (`src/app.js:216`)
- `/api/diag/headers` (`src/app.js:225-227`)
- optional route-table logging gate (`src/app.js:369`)

## 7) Shadowing and Alias Truth (Kept from Prior C1)

- Ordered root mounts shadow practical `GET /` winners (`src/app.js:211`, `src/app.js:212`, `src/app.js:214`, `src/app.js:237`).
- Whoami route truth: `/whoami` and `/api/whoami` are not mounted standalone API paths; root mounts are shadowed in practice.
- Checkout alias truth: `/api/checkout/*` is absent; mounted alias via `/api` is `/api/start|session|subscription|portal` (`src/routes/checkout.routes.js:16-26`, `src/app.js:247-248`).
- Inline `POST /api/user/setup` no-op is shadowed by earlier `/api/user` router mount (`src/app.js:321`, `src/app.js:330-333`).

## 8) CI Truth (Surface Governance)

Enforced in CI:

- `npm run format:check`
- `npm run test:security`
- `npm run check:responses:changed`
- evidence: `.github/workflows/ci.yml:35-45`
