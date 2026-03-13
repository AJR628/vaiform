# LEGACY_WEB_SURFACES

Cross-repo verification date: 2026-03-13.

Purpose: document the backend surfaces that still exist for the old web/manual/editor flows so they do not silently regain first-class scope while mobile production is the product priority.

## Interpretation Rules

- `LEGACY_WEB` means the route still has a current non-mobile caller, but it is not part of the mobile-first launch contract.
- `REMOVE_LATER` means the route is mounted but has no current mobile caller and no current user-facing web caller in `web/public/**` based on this verification pass.
- Legacy does not mean unimportant. It means "do not spend mobile launch hardening time here unless the risk crosses into mobile auth, billing, credits, security, or shared render stability."

## LEGACY_WEB: Manual / Editor / Web-Only Surfaces

| Route | Verified current caller evidence | Why it is not mobile-core | Touch only if... |
| --- | --- | --- | --- |
| `POST /api/assets/options` | `web/public/js/pages/creative/creative.article.mjs:3483` | Draft/manual asset picker for the old creative web editor. No current mobile caller. | It introduces a shared security or outbound-fetch risk that affects mobile-core story flows. |
| `POST /api/story/manual` | `web/public/js/pages/creative/creative.article.mjs:1487` | Manual script entry for creative web. Mobile does not use manual script mode now. | Mobile adopts manual script mode or this route affects shared render stability. |
| `POST /api/story/create-manual-session` | `web/public/js/pages/creative/creative.article.mjs:3930` | Manual-first render session creation for web-only flow. | Shared render security or storage bugs spill into mobile finalize. |
| `POST /api/story/update-video-cuts` | `web/public/js/pages/creative/creative.article.mjs:1922`, `web/public/js/pages/creative/creative.article.mjs:1950` | Beat-space cut editing for the web editor only. | It breaks shared render behavior for mobile-finalized sessions. |
| `POST /api/story/update-caption-meta` | `web/public/js/caption-preview.js:108` | Web caption-preview persistence flow. Mobile uses server-measured preview and placement persistence instead. | It causes shared caption-render regressions on mobile finalize. |

## LEGACY_WEB: Billing Surfaces

These are not mobile API routes, but they still matter if users start or manage monthly render-time billing through the web.

| Route | Verified current caller evidence | Why it is not mobile-core | Touch only if... |
| --- | --- | --- | --- |
| `POST /api/checkout/start` | `web/public/js/pricing.js` | Pricing-page monthly plan checkout start for web. Mobile does not call it directly. | Billing correctness blocks subscription purchase from working at all. |
| `POST /api/checkout/portal` | `web/public/js/pricing.js` | Web billing portal launcher from pricing/account state. | Billing management breaks for existing subscribers. |
| `POST /stripe/webhook` | External Stripe delivery to `src/routes/stripe.webhook.js`; mounted in `src/app.js:111-116` | External billing callback, not a mobile API route. | Billing correctness or entitlement updates fail for mobile users. |

## REMOVE_LATER: Mounted But Not Caller-Backed

These routes are mounted in the backend but had no current mobile caller and no current user-facing `web/public/**` caller in this verification pass.

| Route | Verified repo state | Why remove later | Retirement condition |
| --- | --- | --- | --- |
| `POST /api/story/update-script` | Mounted at `src/routes/story.routes.js:174-205`; no current mobile caller in `client/`; no current `web/public` caller in repo search | Superseded by per-beat editing via `update-beat-text`. | Remove after freeze unless a real caller is reintroduced. |
| `POST /api/story/timeline` | Mounted at `src/routes/story.routes.js:727-746`; no current mobile or `web/public` caller found | Internal phase route, not a product surface. | Remove after freeze. |
| `POST /api/story/captions` | Mounted at `src/routes/story.routes.js:748-773`; no current mobile or `web/public` caller found | Internal phase route, not a product surface. | Remove after freeze. |
| `POST /api/story/render` | Mounted at `src/routes/story.routes.js:775-816`; no current mobile or `web/public` caller found | Competes with finalize and bypasses finalize idempotency path. | Default-disable first, then remove. |
| `POST /api/user/setup` | Mounted at `src/routes/user.routes.js:13-29`; no current mobile or `web/public` caller found | No current product caller. | Remove after freeze. |
| `GET /api/user/me` | Mounted at `src/routes/user.routes.js:34-56`; no current mobile or `web/public` caller found | Stale profile surface that is mounted but unused. | Remove after freeze unless mobile adopts it explicitly. |
| `GET /api/whoami` | Mounted at `src/routes/whoami.routes.js:11-16`; no current mobile or `web/public` caller found | Console/helper-only route. | Remove after freeze. |
| `GET /api/limits/usage` | Mounted at `src/routes/limits.routes.js:7`; no current mobile or `web/public` caller found | Mounted with no current user-facing caller. | Remove after freeze. |

## Shared Routes That Are Not Legacy

The following routes also have web callers, but they remain `MOBILE_CORE_NOW` because the mobile app uses them directly today:

- `POST /api/users/ensure`
- `GET /api/usage`
- `POST /api/story/start`
- `POST /api/story/generate`
- `POST /api/story/plan`
- `POST /api/story/search`
- `GET /api/story/:sessionId`
- `POST /api/story/update-beat-text`
- `POST /api/story/delete-beat`
- `POST /api/story/search-shot`
- `POST /api/story/update-shot`
- `POST /api/caption/preview`
- `POST /api/story/update-caption-style`
- `POST /api/story/finalize`
- `GET /api/shorts/mine`
- `GET /api/shorts/:jobId`

Those shared routes stay in the mobile-first hardening queue even though the old web studio or legacy web surfaces still touch some of them.

Removed in Phase 5:
- `GET /api/credits` is no longer mounted.
- `POST /api/checkout/session` is no longer mounted.
- `POST /api/checkout/subscription` is no longer mounted.
