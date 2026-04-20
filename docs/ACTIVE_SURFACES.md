# Active Surfaces (Visual SSOT + API Prune)

> Evidence Notice (2026-03-13)
> This file is retained as caller-backed web/runtime evidence.
> It is not the primary docs front door for mobile/backend contract work.
> Start at docs/DOCS_INDEX.md.

Audit date: 2026-03-13

## Runtime model

- Detailed file:line audit is in `docs/TRUTH_FREEZE_AUDIT_2026-02-28.md`.
- Frontend is served by Netlify from `web/dist`.
- Frontend source files live in `web/public`.
- Netlify redirect/proxy SSOT is `netlify.toml` (no `_redirects` files under `web/`).
- Frontend browser API ingress is same-origin relative `/api/*` via the Netlify proxy.
- Direct backend origins are not allowed in `web/public/**` and are guarded by `npm run check:hardcoded-backend-origins`.
- Backend serves API + required static assets, plus the internal finalize dashboard when explicitly enabled.

## Frontend entry surfaces

- Core beta entry pages:
  - `/creative` -> `/creative.html`
  - `/my-shorts.html`
  - `/pricing.html`
  - `/login.html`
- Static/support pages:
  - `/` and `/index.html`
  - `/legal.html`
  - `/success.html`

## Netlify bridge surfaces

- `/api/*` -> backend `/api/:splat` (proxy in `netlify.toml`).
- `/stripe/webhook` -> backend `/stripe/webhook`.

## Backend default reachable surfaces (`VAIFORM_DEBUG=0`)

- Health:
  - `GET /health`
  - `HEAD /health`
  - `GET /api/health`
  - `HEAD /api/health`
- Webhook:
  - `GET /stripe/webhook`
  - `POST /stripe/webhook` (Stripe checkout completion, renewal entitlement/usage sync, and plan-subscription deletion handling)
- Core API mounts:
  - `/api/usage`
  - `/api/whoami`
  - `/api/checkout/start`, `/api/checkout/portal`
  - `/api/shorts/mine`, `/api/shorts/:jobId`
  - `/api/assets/options`
  - `/api/limits/usage`
  - `/api/story/*`
  - `/api/story/sync`
  - `/api/caption/preview`
  - `/api/user/*`, `/api/users/ensure`
- Backend static (required only):
  - `/assets/*` (including `/assets/fonts/*`)
- Internal backend-served page (only when `FINALIZE_DASHBOARD_ENABLED=1`):
  - `GET /admin/finalize`
- Internal backend-served data (only when `FINALIZE_DASHBOARD_ENABLED=1` and founder auth/allowlist pass):
  - `GET /api/admin/finalize/data`

## Removed/non-active surfaces

- Removed from backend:
  - `GET /` (root API JSON)
  - `GET /api/` (accidental root collisions from router `/` mounts)
  - root aliases: `/credits`, `/whoami`, `/generate`, `/enhance`, `/limits/*`
  - `/api/enhance` (feature retired)
  - `/api/generate`, `/api/job/:jobId`
  - `/api/assets/ai-images`
  - `/api/credits` (removed in Phase 5)
  - `/api/checkout/session`, `/api/checkout/subscription` (removed in Phase 5)
  - old checkout aliases: `/checkout/*`, `/api/start`, `/api/session`, `/api/subscription`, `/api/portal`
  - `/creative` HTML route
  - `/image-creator.html`, `/my-images.html`, `/retry.html`
  - frontend static serving from backend `web/dist` or root `public`
  - `/cdn` proxy route
- Debug-only (`VAIFORM_DEBUG=1`):
  - `/diag/*`
  - `/api/diag/headers`
  - `/api/diag/caption-smoke`

## Finalize Dashboard V1

- Page route stays outside `/diag/*`: `/admin/finalize`
- Data route stays under `/api/*`: `/api/admin/finalize/data`
- The page shell may load when enabled.
- The data route is internal-only and requires:
  - Firebase auth
  - verified email
  - founder allowlist via `FINALIZE_DASHBOARD_ALLOWED_EMAILS`
- Top health banner is derived from shared live truth plus `docs/artifacts/finalize-phase6/phase6-threshold-summary.json`
- Local process metrics/events are displayed only in a clearly labeled secondary panel

## Caller-backed notes

- Creative story pipeline remains caller-backed via `web/public/creative.html` -> `web/public/js/pages/creative/creative.article.mjs`.
- The creative storyboard step now auto-runs `/api/story/sync` after `plan -> search` and lands in a compact preview-first editing surface: preview hero, transport row, filmstrip timeline, selected-clip inspector, and collapsed secondary controls, all still backed by synced narration timing plus backend-owned aligned-preview contract fields.
- The mobile large storyboard preview now uses backend-owned `draftPreviewV1` plus `captionOverlayV1`: backend generates one base preview MP4 without burned captions, and mobile renders live captions over that single artifact. `playbackTimelineV1` is retained only as compatibility timing metadata, not as the active mobile playback engine.
- Mobile storyboard speech flow now caller-backs `POST /api/story/sync` via `client/screens/StoryEditorScreen.tsx` and `client/screens/story-editor/useStoryVoiceSync.ts`.
- The current creative web caller uses `/api/story/start`, `/api/story/generate`, `/api/story/plan`, `/api/story/search`, `/api/story/sync`, `/api/assets/options`, `/api/story/update-shot`, `/api/story/search-shot`, `/api/story/update-video-cuts`, `/api/story/create-manual-session`, `/api/story/finalize`, and `GET /api/story/:sessionId`. Mobile additionally caller-backs `POST /api/story/preview` for Step 3 base preview artifact generation.
- No current web caller in `web/public/**` hits `/api/story/render`; finalize is the caller-backed render path, and `/api/story/render` is disabled by default unless `ENABLE_STORY_RENDER_ROUTE=1`.
- Caption preview remains caller-backed via `web/public/js/caption-preview.js` and `web/public/js/caption-live.js`.
- Shorts library remains caller-backed via `web/public/my-shorts.html` -> `web/public/js/my-shorts.js`.
- Checkout start remains caller-backed via `web/public/pricing.html` -> `web/public/js/pricing.js`.
- Checkout portal remains caller-backed via `web/public/js/pricing.js`.
- `/buy-credits.html` is redirect-only to `/pricing.html`; it is no longer a live commerce page.
- Stripe webhook remains externally caller-backed via Netlify proxy and is required for checkout and monthly entitlement/usage updates.
- User bootstrap remains caller-backed via `web/public/js/firebaseClient.js` -> `/api/users/ensure`.
- `/api/whoami`, `/api/limits/usage`, and `/api/user/*` are mounted but have no current user-facing web caller in `web/public`.
