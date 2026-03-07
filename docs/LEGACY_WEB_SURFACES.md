# LEGACY_WEB_SURFACES

Audit date: 2026-03-07

Purpose: document the backend surfaces that still exist for the old web/manual/editor flows so they
 do not silently regain first-class scope while mobile production is the product priority.

## Interpretation Rules

- `LEGACY_WEB` means the route still has a current non-mobile caller, but it is not part of the
  mobile-first launch contract.
- `REMOVE_LATER` means the route is mounted but has no current mobile caller and no current
  user-facing web caller in `web/public/**`.
- Legacy does not mean unimportant. It means "do not spend launch hardening time here unless the
  risk crosses into mobile auth, billing, security, or shared render stability."

## LEGACY_WEB: Manual / Editor / Web-Only Surfaces

| Route | Current caller evidence | Why it is not mobile-core | Touch only if... |
| --- | --- | --- | --- |
| `POST /api/assets/options` | `web/public/js/pages/creative/creative.article.mjs:3484` | Draft/manual asset picker for the old creative web editor. No current mobile caller. | It introduces a shared security or outbound-fetch risk that affects mobile-core story flows. |
| `POST /api/story/manual` | `web/public/js/pages/creative/creative.article.mjs:1487` | Manual script entry for creative web. Mobile does not use manual script mode now. | Mobile adopts manual script mode or this route affects shared render stability. |
| `POST /api/story/create-manual-session` | `web/public/js/pages/creative/creative.article.mjs:3930` | Manual-first render session creation for web-only flow. | Shared render security or storage bugs spill into mobile finalize. |
| `POST /api/story/update-video-cuts` | `web/public/js/pages/creative/creative.article.mjs:1922`, `web/public/js/pages/creative/creative.article.mjs:1950` | Beat-space cut editing for the web editor only. | It breaks shared render behavior for mobile-finalized sessions. |
| `POST /api/story/update-caption-meta` | `web/public/js/caption-preview.js:108` | Web caption-preview persistence flow. Mobile uses server-measured preview and placement persistence instead. | It causes shared caption-render regressions on mobile finalize. |

## LEGACY_WEB: Billing Surfaces

These are not mobile API routes, but they still matter if mobile users buy credits through the web.

| Route | Current caller evidence | Why it is not mobile-core | Touch only if... |
| --- | --- | --- | --- |
| `POST /api/checkout/start` | `web/public/js/pricing.js:114` | Pricing-page checkout start for web. Mobile does not call it directly. | Billing correctness blocks mobile users from purchasing credits at all. |
| `POST /api/checkout/session` | `web/public/js/buy-credits.js:67` | Buy-credits one-time pack checkout. Web-only caller. | Credit purchase flow is broken for mobile users using deep-link billing. |
| `POST /api/checkout/subscription` | `web/public/js/buy-credits.js:84` | Buy-credits subscription checkout. Web-only caller. | Subscription billing blocks mobile users from acquiring credits/plans. |
| `POST /api/checkout/portal` | `web/public/js/buy-credits.js:167` | Web billing portal launcher. | Mobile support/billing management depends on it. |
| `POST /stripe/webhook` | External Stripe delivery to `src/routes/stripe.webhook.js` | External billing callback, not a mobile API route. | Billing correctness or entitlement updates fail for mobile users. |

## REMOVE_LATER: Mounted But Not Caller-Backed

| Route | Evidence of no current caller | Why remove later | Retirement condition |
| --- | --- | --- | --- |
| `POST /api/story/update-script` | No mobile call in `docs/MOBILE_USED_SURFACES.md`; no current `web/public` caller in repo search | Superseded by per-beat editing via `update-beat-text`. | Remove after freeze unless a real caller is reintroduced. |
| `POST /api/story/timeline` | No mobile or user-facing web caller found | Internal phase route, not a product surface. | Remove after freeze. |
| `POST /api/story/captions` | No mobile or user-facing web caller found | Internal phase route, not a product surface. | Remove after freeze. |
| `POST /api/story/render` | `docs/ACTIVE_SURFACES.md:79` says no current web caller; mobile also does not use it | Competes with finalize and bypasses finalize idempotency path. | Default-disable first, then remove. |
| `POST /api/user/setup` | `docs/TRUTH_FREEZE_AUDIT_2026-02-28.md:41` | No current mobile caller, no current user-facing web caller. | Remove after freeze. |
| `GET /api/user/me` | `docs/MOBILE_USED_SURFACES.md` marks it unwired; `docs/TRUTH_FREEZE_AUDIT_2026-02-28.md:41` | Stale profile surface that is mounted but not used. | Remove after freeze unless mobile adopts it explicitly. |
| `GET /api/whoami` | `docs/TRUTH_FREEZE_AUDIT_2026-02-28.md:42` | Console/helper-only route. | Remove after freeze. |
| `GET /api/limits/usage` | `docs/TRUTH_FREEZE_AUDIT_2026-02-28.md:43` | Mounted with no current user-facing caller. | Remove after freeze. |

## Shared Routes That Are Not Legacy

The following routes also have web callers, but they remain `MOBILE_CORE_NOW` because the mobile app
uses them directly today:

- `POST /api/users/ensure`
- `GET /api/credits`
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

Those shared routes stay in the mobile-first hardening queue even though the old web studio still
touches some of them.


