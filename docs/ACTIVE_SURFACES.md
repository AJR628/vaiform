# Active Surface Map

**Purpose**: Identify which backend routes are called by the UI, which are legacy/orphan (attack surface with no frontend), and which should be production vs gated.

**Audit date**: 2025-02-12  
**Branch**: feat/voice-ssot-tts

---

## 1. Frontend Usage Summary

### 1.1 /creative.html (Article flow — PRIMARY production UI)

**Loaded script**: `creative.article.mjs` only (line 724 of creative.html)

**apiFetch base**: `/api` (via api.mjs; path is prefixed with API_ROOT which ends with /api)

| Endpoint | Method | Call site | Module |
|----------|--------|-----------|--------|
| `/story/start` | POST | creative.article.mjs:1047 | inline |
| `/story/generate` | POST | creative.article.mjs:1064 | inline |
| `/story/update-script` | POST | creative.article.mjs:1320 | inline |
| `/story/plan` | POST | creative.article.mjs:1337, 1442 | inline |
| `/story/search` | POST | creative.article.mjs:1347, 1452 | inline |
| `/story/manual` | POST | creative.article.mjs:1423 | inline |
| `/story/update-video-cuts` | POST | creative.article.mjs:1845, 1873 | inline |
| `/story/insert-beat` | POST | creative.article.mjs:2369 | inline |
| `/story/delete-beat` | POST | creative.article.mjs:2411 | inline |
| `/story/update-beat-text` | POST | creative.article.mjs:799, 2602 | inline |
| `/story/update-shot` | POST | creative.article.mjs:3167 | inline |
| `/story/search-shot` | POST | creative.article.mjs:3283 | inline |
| `/story/update-caption-style` | POST | creative.article.mjs:1227 | inline |
| `/story/create-manual-session` | POST | creative.article.mjs:3658 | inline |
| `/story/finalize` | POST | creative.article.mjs:3729 | inline |
| `/story/{sessionId}` | GET | creative.article.mjs:3792 | inline |
| `/assets/options` | POST | creative.article.mjs:3370 | inline |
| `/caption/preview` | POST | caption-preview.js:598, 1056 (dynamic import) | creative.article imports caption-preview |
| `/story/update-caption-meta` | POST | caption-preview.js:104 | creative.article imports caption-preview |

**Not called by Article flow**: `/quotes/*`, `/assets/ai-images`, `/tts/preview`, `/voice/*`, `/shorts/create`, `/generate`, `/uploads/*`, `/enhance`

---

### 1.2 Web SPA (web/src)

**Router** (main.tsx): `/` → redirect to `/studio`; `/studio` → StudioPage; `/shorts/:jobId` → ShortDetailsPage  
**Note**: CreativePage exists but is **not in router** — unreachable.

| Endpoint | Method | Call site | Used by |
|----------|--------|-----------|---------|
| `/api/limits/usage` | GET | api.ts:61 | CreativePage (unreachable) |
| `/api/quotes/generate-quote` | POST | api.ts:64 | CreativePage (unreachable) |
| `/api/quotes/remix` | POST | api.ts:67 | CreativePage (unreachable) |
| `/api/assets/options` | POST | api.ts:70 | CreativePage (unreachable) |
| `/api/assets/ai-images` | POST | api.ts:73 | CreativePage (unreachable) |
| `/api/studio/start` | POST | api.ts:82 | StudioPage |
| `/api/studio/quote` | POST | api.ts:85 | StudioPage |
| `/api/studio/image` | POST | api.ts:88 | StudioPage |
| `/api/studio/video` | POST | api.ts:91 | StudioPage |
| `/api/studio/choose` | POST | api.ts:94 | StudioPage |
| `/api/studio/finalize` | POST | api.ts:102 | StudioPage |
| `/api/studio/events/{id}` | GET (SSE) | StudioPage:169 | StudioPage |
| `/api/studio/remix` | POST | api.ts:77 | (defined, usage unclear) |
| `/api/studio/{renderId}/remixes` | GET | api.ts:80 | (defined, usage unclear) |
| `/api/shorts/{jobId}` | GET | api.ts:105 | ShortDetailsPage |
| `/diag/tts_state` | GET | api.ts (diagTtsState) | TokenDrawer, AppShell |

**Critical**: Studio routes (`/api/studio/*`) are **commented out** in app.js — web SPA StudioPage would 404. Diag is only mounted when `NODE_ENV !== "production"`.

---

### 1.3 Other public/* HTML pages

| Page | Script | API calls |
|------|--------|-----------|
| **my-shorts.html** | my-shorts.js | `/credits`, `/shorts/{id}` |
| **my-images.html** | my-images.js | `/credits`, `/generate`, `/generate/upscale`, `/job/{jobId}` |
| **buy-credits.html** | buy-credits.js | `/checkout/session`, `/checkout/subscription`, `/checkout/portal` |
| **pricing.html** | pricing.js | `/checkout/start` |
| **frontend.js** (image-creator.html) | frontend.js | `/credits`, `/enhance`, `/generate`, `/generate/upscale` |
| **firebaseClient.js** | (all pages) | `/users/ensure` |
| **retry.html** | inline | `/generate` (POST) |

---

### 1.4 Legacy code (NOT loaded by creative.html)

**creative.legacy-quotes.mjs** — NOT loaded. Would call:
- `/caption/preview`, `/caption/render`, `/credits`, `/story/*`, `/quotes/generate-quote`, `/quotes/remix`, `/quotes/save`
- `/assets/options`, `/assets/ai-images`
- `/voice/voices`, `/tts/preview`
- `/shorts/create`, `/generate`
- `/uploads/register`

**caption-live.js** — Only imported by creative.legacy-quotes.mjs. Calls `/caption/preview`.

---

## 2. Backend Mount Map

### 2.1 app.js mount summary

| Router / Handler | Mount path(s) | Full paths | Condition |
|------------------|---------------|------------|-----------|
| stripeWebhook | `/stripe/webhook` | POST/GET /stripe/webhook | always |
| health (inline) | — | GET/HEAD /health, POST /diag/echo | always |
| healthRoutes | `/`, `/api` | /health, /healthz, /version, /health/register, /api/* | always |
| whoamiRoutes | `/`, `/api` | /whoami, /api/whoami | always |
| creditsRoutes | `/`, `/api` | /credits, /api/credits | always |
| getCreditsHandler | `/credits`, `/api/credits` | GET /credits, GET /api/credits | always |
| diagRoutes | `/diag` | /diag, /diag/echo, /diag/tts, /diag/tts_state, /diag/store, etc. | **NODE_ENV !== "production"** |
| generateRoutes | `/`, `/api` | /generate, /api/generate, /job/:jobId, /api/job/:jobId | always |
| diagHeadersRoutes | `/api` | /api/diag/headers | **VAIFORM_DEBUG=1** |
| routes.index | `/` | GET / | always |
| routes.enhance | `/`, `/enhance`, `/api` | /enhance, POST /, /api/enhance | always |
| routes.checkout | `/checkout`, `/api` | /checkout/*, /api/checkout/* | always |
| routes.shorts | `/api/shorts` | /api/shorts/mine, /api/shorts/:jobId | always |
| cdnRoutes | `/cdn` | /cdn | always |
| routes.uploads | `/api` | /api/uploads/image, /api/uploads/register | always |
| routes.assets | `/api/assets` | /api/assets/options, /api/assets/ai-images | always |
| routes.limits | `/api/limits`, `/limits` | /api/limits/usage, /limits/usage | always |
| routes.voice | `/api/voice`, `/voice` | /api/voice/voices, /api/voice/preview, etc. | always |
| routes.creative | `/creative` | GET /creative (serves HTML) | always |
| routes.tts | `/api/tts` | /api/tts/preview | always |
| routes.story | `/api/story` | /api/story/* (20+ endpoints) | always |
| captionPreviewRoutes | `/api` | /api/caption/preview, /api/diag/caption-smoke | always |
| captionRenderRoutes | `/api` | /api/caption/render | always |
| userRoutes | `/api/user` | /api/user/setup, /api/user/me | always |
| usersRoutes | `/api/users` | /api/users/ensure | always |
| /api/user/setup (inline) | — | POST /api/user/setup (no-op) | always |

### 2.2 NOT mounted (commented out in app.js)

| Router | Would mount | Status |
|--------|-------------|--------|
| routes.studio | /api/studio | **Commented out** |
| routes.quotes | /api/quotes, /quotes | **Commented out** |
| routes.preview | /api/preview | **Commented out** |

---

## 3. Router-by-Router Active Surface Table

For each router group: mount path(s), endpoints, called by UI?, production?, recommendation.

---

### 3.1 Health & diagnostics

| Mount | Endpoints | Called by UI? | Production? | Recommendation |
|-------|-----------|---------------|-------------|----------------|
| /health (inline) | GET/HEAD /health | Y (healthchecks, retry.html fallback) | Y | **Active** |
| POST /diag/echo | POST /diag/echo | N (debug only) | N | **Legacy** — gate behind VAIFORM_DEBUG |
| healthRoutes | /health, /healthz, /version, /health/register | Y (healthz, version) | Y | **Active** |
| diagRoutes | /diag, /diag/tts, /diag/tts_state, /diag/store, etc. | Y (TokenDrawer, AppShell → /diag/tts_state) | **N** (only in NODE_ENV!==production) | **Legacy** — diag/tts_state used by web SPA; in prod 404 |
| diagHeadersRoutes | /api/diag/headers | N | N (VAIFORM_DEBUG only) | **Legacy** — gate |
| captionPreviewRoutes | /api/diag/caption-smoke | N (dev smoke) | N | **Legacy** — gate behind VAIFORM_DEBUG |

---

### 3.2 Auth & session

| Mount | Endpoints | Called by UI? | Production? | Recommendation |
|-------|-----------|---------------|-------------|----------------|
| whoamiRoutes | /whoami, /api/whoami | Y (vaiform_diag.whoami, api.mjs) | Y | **Active** |
| userRoutes | /api/user/setup, /api/user/me | Y (firebaseClient, user/me) | Y | **Active** |
| usersRoutes | /api/users/ensure | Y (firebaseClient.js) | Y | **Active** |
| /api/user/setup (inline) | POST /api/user/setup | Legacy no-op | Y | **Active** (no-op acceptable) |

---

### 3.3 Credits & payments

| Mount | Endpoints | Called by UI? | Production? | Recommendation |
|-------|-----------|---------------|-------------|----------------|
| creditsRoutes + getCreditsHandler | GET /credits, /api/credits | Y (my-shorts, my-images, buy-credits, frontend, creative credits-ui) | Y | **Active** |
| checkoutRoutes | /checkout/*, /api/checkout/* | Y (buy-credits, pricing) | Y | **Active** |
| stripeWebhook | POST /stripe/webhook | Y (Stripe) | Y | **Active** |

---

### 3.4 Story (Article flow core)

| Mount | Endpoints | Called by UI? | Production? | Recommendation |
|-------|-----------|---------------|-------------|----------------|
| routes.story | /api/story/* (start, generate, plan, search, update-*, insert-beat, delete-beat, finalize, etc.) | Y (creative.article.mjs) | Y | **Active** |

---

### 3.5 Caption preview & render

| Mount | Endpoints | Called by UI? | Production? | Recommendation |
|-------|-----------|---------------|-------------|----------------|
| captionPreviewRoutes | POST /api/caption/preview | Y (creative.article via caption-preview.js) | Y | **Active** |
| captionRenderRoutes | POST /api/caption/render | N (legacy flow only; Article uses server burn) | Y | **Legacy** — gate or document as internal |
| captionPreviewRoutes | GET /api/diag/caption-smoke | N | N | **Legacy** — gate |

---

### 3.6 TTS & voice

| Mount | Endpoints | Called by UI? | Production? | Recommendation |
|-------|-----------|---------------|-------------|----------------|
| routes.tts | POST /api/tts/preview | N (Article does not call; legacy-quotes does) | Y | **Legacy** — Article uses server-side TTS in finalize; tts/preview is legacy flow |
| routes.voice | GET /api/voice/voices, POST /api/voice/preview | N (Article does not call; legacy-quotes does) | Y | **Legacy** — gate behind ENABLE_LEGACY_ROUTES |

---

### 3.7 Assets

| Mount | Endpoints | Called by UI? | Production? | Recommendation |
|-------|-----------|---------------|-------------|----------------|
| routes.assets | POST /api/assets/options | Y (creative.article.mjs) | Y | **Active** |
| routes.assets | POST /api/assets/ai-images | N (Article does not call; legacy-quotes, CreativePage do; CreativePage unreachable) | Y | **Legacy** — returns 410 disabled; gate |

---

### 3.8 Generate & enhance (image creator)

| Mount | Endpoints | Called by UI? | Production? | Recommendation |
|-------|-----------|---------------|-------------|----------------|
| generateRoutes | POST /generate, /api/generate, GET /job/:jobId | Y (my-images, frontend, retry) | Y | **Active** |
| routes.enhance | POST /enhance, /api/enhance | Y (frontend.js) | Y | **Active** |

---

### 3.9 Shorts & uploads

| Mount | Endpoints | Called by UI? | Production? | Recommendation |
|-------|-----------|---------------|-------------|----------------|
| routes.shorts | GET /api/shorts/mine, GET /api/shorts/:jobId | Y (my-shorts.js, web ShortDetailsPage) | Y | **Active** |
| routes.uploads | POST /api/uploads/image, /api/uploads/register | N (Article does not; legacy-quotes does) | Y | **Legacy** — gate behind ENABLE_LEGACY_ROUTES |

---

### 3.10 Limits

| Mount | Endpoints | Called by UI? | Production? | Recommendation |
|-------|-----------|---------------|-------------|----------------|
| routes.limits | GET /api/limits/usage, /limits/usage | Y (web CreativePage — but CreativePage unreachable) | Y | **Active** (potential future use) |

---

### 3.11 Studio (unmounted)

| Mount | Endpoints | Called by UI? | Production? | Recommendation |
|-------|-----------|---------------|-------------|----------------|
| routes.studio | /api/studio/* | Y (web StudioPage) — **but NOT MOUNTED** | **N** | **Legacy** — re-mount behind ENABLE_LEGACY_ROUTES if web Studio is needed |

---

### 3.12 Quotes (unmounted)

| Mount | Endpoints | Called by UI? | Production? | Recommendation |
|-------|-----------|---------------|-------------|----------------|
| routes.quotes | /api/quotes/* | Y (legacy-quotes, CreativePage) — **but NOT MOUNTED** | **N** | **Legacy** — gate; Article uses /story/generate for script, not /quotes |

---

### 3.13 Preview (unmounted)

| Mount | Endpoints | Called by UI? | Production? | Recommendation |
|-------|-----------|---------------|-------------|----------------|
| routes.preview | /api/preview/caption | N (replaced by /api/caption/preview) | N | **Remove** — dead |

---

### 3.14 CDN & creative page

| Mount | Endpoints | Called by UI? | Production? | Recommendation |
|-------|-----------|---------------|-------------|----------------|
| cdnRoutes | GET /cdn | Y (asset URLs may use CDN proxy) | Y | **Active** |
| routes.creative | GET /creative | Y (serves creative.html) | Y | **Active** |

---

## 4. Orphan / Legacy Attack Surface (mounted, no current UI caller)

| Router | Endpoints | Risk |
|--------|-----------|------|
| routes.voice | /api/voice/voices, /api/voice/preview | Low — requires auth |
| routes.tts | /api/tts/preview | Medium — TTS cost if abused |
| routes.uploads | /api/uploads/* | Medium — storage cost |
| routes.assets (ai-images) | POST /api/assets/ai-images | Low — returns 410 |
| captionRenderRoutes | POST /api/caption/render | Medium — canvas CPU |
| diag (when mounted) | /diag/* | High if exposed in prod — dev only |

---

## 5. Minimal Commit Plan

### Commit 1: Add ENABLE_LEGACY_ROUTES and gate legacy mounts (default OFF)

**Goal**: Reduce attack surface; legacy flows opt-in.

**Gated behind `ENABLE_LEGACY_ROUTES=1`**:
- routes.voice (already mounted) — wrap mount in `if (process.env.ENABLE_LEGACY_ROUTES === '1')`
- routes.tts (already mounted) — wrap mount
- routes.uploads (already mounted) — wrap mount
- routes.assets ai-images handler — already 410; optionally skip gate
- captionRenderRoutes — wrap mount
- routes.studio — uncomment and wrap: `if (process.env.ENABLE_LEGACY_ROUTES === '1') app.use('/api/studio', ...)`
- routes.quotes — uncomment and wrap: `if (process.env.ENABLE_LEGACY_ROUTES === '1') app.use('/api/quotes', ...)`

**Gated behind VAIFORM_DEBUG=1** (existing or add):
- POST /diag/echo
- diagRoutes
- diagHeadersRoutes
- GET /api/diag/caption-smoke

**Doc**: See `env.example` and "Route gating" below.

**Implemented (Commit 1):** voice, tts, uploads, captionRenderRoutes gated behind `ENABLE_LEGACY_ROUTES=1`. Studio and quotes left commented (maximal minimal-diff); can be added in a later legacy-enablement commit. Diag (POST /diag/echo, /diag router) gated behind `VAIFORM_DEBUG=1`.

#### Route gating / Environment flags

| Variable | Default | When set to `1` |
|----------|---------|------------------|
| `ENABLE_LEGACY_ROUTES` | `0` | Mounts voice, tts, uploads, caption/render. Studio and quotes stay commented unless uncommented in a later commit. |
| `VAIFORM_DEBUG` | unset / `0` | Mounts POST /diag/echo, /diag router, /api/diag/headers; GET /api/diag/caption-smoke responds (handler-level). **Dev tooling** that uses /diag (e.g. web SPA TokenDrawer/AppShell calling `/diag/tts_state`) requires `VAIFORM_DEBUG=1`. |

With defaults: Article flow (/api/story/*, /api/caption/preview, /api/assets/options) and all other active routes work; legacy and diag endpoints return 404.

---

### Commit 2+: Proceed with success/data hardening only on Active routes

**Active routes** (hardening priority):
1. routes.story
2. captionPreviewRoutes (POST /api/caption/preview only)
3. routes.assets (POST /api/assets/options only)
4. creditsRoutes, getCreditsHandler
5. checkoutRoutes
6. generateRoutes
7. routes.enhance
8. routes.shorts
9. usersRoutes, userRoutes, whoamiRoutes
10. healthRoutes
11. stripeWebhook (Stripe signature; special handling)
12. cdnRoutes, routes.creative

**Defer** until legacy decision: voice, tts, uploads, caption/render, studio, quotes.

---

## 6. Evidence Quick Reference

| UI entry | Loads | API prefixes called |
|----------|-------|---------------------|
| /creative.html | creative.article.mjs | /story/*, /caption/preview, /assets/options |
| /creative.html | caption-preview.js (dynamic) | /caption/preview, /story/update-caption-meta |
| /my-shorts.html | my-shorts.js | /credits, /shorts/* |
| /my-images.html | my-images.js | /credits, /generate, /generate/upscale, /job/* |
| /buy-credits.html | buy-credits.js | /checkout/* |
| /pricing.html | pricing.js | /checkout/start |
| /image-creator.html | frontend.js | /credits, /enhance, /generate, /generate/upscale |
| firebaseClient.js | (all) | /users/ensure |
| web SPA /studio | StudioPage | /api/studio/* (404 — not mounted) |
| web SPA /shorts/:id | ShortDetailsPage | /api/shorts/* |
| web SPA | TokenDrawer, AppShell | /diag/tts_state (404 in prod) |

---

*End of Active Surface Map. Use with VAIFORM_REPO_COHESION_AUDIT.md for cohesion and hardening planning.*
