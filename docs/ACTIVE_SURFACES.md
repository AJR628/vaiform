# Active Surfaces (C1 Baseline Truth Snapshot)

**Audit date**: 2026-02-15  
**Branch**: `feat/voice-ssot-tts`

Definitions used here:
- `Default-Reachable`: reachable with `ENABLE_LEGACY_ROUTES=0` and `VAIFORM_DEBUG=0`.
- `Caller-Backed`: called by files actually served/loaded in runtime.
- `Active`: `Default-Reachable && Caller-Backed`.

Callsite path mapping rule:
- `apiFetch("/x") => /api/x` because `API_ROOT` already ends with `/api` (`public/api.mjs:7`, `public/api.mjs:9`, `public/api.mjs:154`).
- Fallback to root path applies only for GET `/credits|/whoami|/health` (`public/api.mjs:160-164`).

## 1) Primary Runtime Entrypoints

| Entrypoint | Served by | What it loads | Evidence |
|---|---|---|---|
| `/creative` | `src/routes/creative.routes.js` | `public/creative.html` | `src/routes/creative.routes.js:11-13`, `src/app.js:289` |
| `/creative.html` (static) | `express.static("public")` | same HTML shell (when not preempted) | `src/app.js:366`, `public/creative.html` |
| SPA fallback (`/`, non-api/assets) | `web/dist/index.html` when dist exists | built web app | `src/app.js:341-347` |

Default flags:
- `ENABLE_LEGACY_ROUTES=0`: `env.example:3`
- `VAIFORM_DEBUG=0`: `env.example:7`

## 2) Default-Reachable + Caller-Backed (Active)

### 2.1 `public/creative.html` -> Article flow

Loaded module and callsites:
- `public/creative.html` loads `/js/pages/creative/creative.article.mjs`: `public/creative.html:724`
- `creative.article.mjs` calls story endpoints and assets/options:
  - `/story/start`, `/story/generate`, `/story/update-script`, `/story/plan`, `/story/search`, `/story/manual`, `/story/update-video-cuts`, `/story/insert-beat`, `/story/delete-beat`, `/story/update-beat-text`, `/story/update-shot`, `/story/search-shot`, `/story/create-manual-session`, `/story/finalize`, `/story/{sessionId}`
  - `/assets/options`
  - evidence: `public/js/pages/creative/creative.article.mjs:1047-3792`
- caption preview module used by article:
  - `/caption/preview`, `/story/update-caption-meta`
  - evidence: `public/js/caption-preview.js:104`, `public/js/caption-preview.js:598`, `public/js/caption-preview.js:1057`

### 2.2 Shared auth/profile bootstrapping

- `/users/ensure` called on auth events.
- evidence: `public/js/firebaseClient.js:29`

### 2.3 Additional served public pages with active callers

- `/credits`, `/checkout/start`, `/generate`, `/job/:jobId`, `/api/shorts/:jobId`
- evidence examples:
  - `public/js/my-images.js:136`, `public/js/my-images.js:223`, `public/js/my-images.js:388`
  - `public/js/pricing.js:109`
  - `public/js/my-shorts.js:173`

## 3) Default-Reachable but Not Caller-Backed (Attack Surface)

These are reachable with defaults but have no proven default caller in served primary flows:

- `/api/assets/ai-images` (currently hard-disabled 410): `src/routes/assets.routes.js:12-17`
- `/api/limits/usage` and `/limits/usage`: `src/app.js:279-280`, `src/routes/limits.routes.js:7`
- `/cdn` (mounted, no concrete default caller proof in current active pages): `src/app.js:257`, `src/routes/cdn.routes.js:21`
- `/api/user/me` and `/api/user/setup` router endpoint (mounted, no default caller evidence): `src/routes/user.routes.js:12-67`

## 4) Legacy-Gated (Only with `ENABLE_LEGACY_ROUTES=1`)

Mounted only under legacy flag:
- `/api/uploads/*`: `src/app.js:259-262`, routes `src/routes/uploads.routes.js:42-90`
- `/api/voice/*` and `/voice/*`: `src/app.js:283-287`, routes `src/routes/voice.routes.js:7-8`
- `/api/tts/preview`: `src/app.js:298-301`, route `src/routes/tts.routes.js:24`
- `/api/caption/render`: `src/app.js:314-317`, route `src/routes/caption.render.routes.js:26`

Legacy caller examples (not default-loaded):
- `public/js/pages/creative/creative.legacy-quotes.mjs` references `/api/caption/render`, `/tts/preview`, `/voice/voices`, `/uploads/register`.
- evidence: `public/js/pages/creative/creative.legacy-quotes.mjs:1308`, `public/js/pages/creative/creative.legacy-quotes.mjs:3088`, `public/js/pages/creative/creative.legacy-quotes.mjs:2995`, `public/js/pages/creative/creative.legacy-quotes.mjs:8960`

## 5) Debug-Gated (Only with `VAIFORM_DEBUG=1`)

- `/diag/*` routes: `src/app.js:216`, `src/routes/diag.routes.js:10-108`
- `/api/diag/headers`: `src/app.js:225-227`
- `/diag/echo`: `src/app.js:178-185`
- `/api/diag/caption-smoke` route exists but has in-route debug gate: `src/routes/caption.preview.routes.js:1219-1224`

## 6) Commented/Unmounted/Dead

Not mounted in current runtime:
- `/api/studio/*`: `src/app.js:264-267`
- `/api/quotes/*` and `/quotes/*`: `src/app.js:269-273`
- `/api/preview/*`: `src/app.js:294-297`

Yet source callers exist:
- `web/src/lib/api.ts` references `/api/studio/*`, `/api/quotes/*`: `web/src/lib/api.ts:64-105`

## 7) Served vs Source-Only Caller Rule

- Caller evidence counts only when file is served by runtime entrypoints.
- `web/src/**` callsites are present but not served directly; runtime serves `web/dist` (`src/app.js:341-347`).

## 8) Present But Broken Caller Attempts

- `apiFetch("/checkout/session")` in `public/js/buy-credits.js:40` resolves to `POST /api/checkout/session` -> observed runtime result: `404`.
- `apiFetch("/checkout/subscription")` in `public/js/buy-credits.js:52` resolves to `POST /api/checkout/subscription` -> observed runtime result: `404`.
- `apiFetch("/checkout/portal")` in `public/js/buy-credits.js:123` resolves to `POST /api/checkout/portal` -> observed runtime result: `404`.
- `apiFetch("/generate/upscale")` in `public/js/my-images.js:223` resolves to `POST /api/generate/upscale` -> observed runtime result: `404`.
- `window.vaiform_diag.whoami()` in `public/api.mjs:208` calls `/api/whoami` (observed `404`), then fallback `GET /whoami` returns HTML (`public/api.mjs:160-164`), so it is not valid whoami caller evidence.

## 9) Dist/Public Precedence

- With `web/dist` present, `express.static(distDir)` and SPA fallback are registered before `express.static("public")` (`src/app.js:343-347`, `src/app.js:366`).
- Practical effect: many HTML requests are served from `web/dist` first; public HTML is not guaranteed to win.

## 10) Non-JSON Surfaces

Envelope contract applies only to JSON APIs.

Non-JSON active surfaces include:
- `/creative` -> HTML file: `src/routes/creative.routes.js:12`
- SPA fallback routes serving `web/dist/index.html`: `src/app.js:344-345`
- static asset/file routes via static middleware: `src/app.js:192`, `src/app.js:343`, `src/app.js:366`

## 11) CI Truth (Surface Governance)

Enforced in CI:
- `npm run format:check`
- `npm run test:security`
- `npm run check:responses:changed`
- evidence: `.github/workflows/ci.yml:35-45`

Observed baseline (manual, not CI-blocking):
- `node scripts/check-responses.js` for full-repo drift inventory.
