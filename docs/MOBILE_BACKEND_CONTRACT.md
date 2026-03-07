# MOBILE_BACKEND_CONTRACT

Audit date: 2026-03-07

Purpose: canonical backend contract for mobile production. If a route is not
`MOBILE_CORE_NOW` or `MOBILE_CORE_SOON` here, it is not first-class for mobile launch.

## Source Order

1. `docs/MOBILE_USED_SURFACES.md`
2. Mounted runtime in `src/app.js`
3. Route/controller/service code under `src/routes`, `src/controllers`, and `src/services`
4. `docs/ACTIVE_SURFACES.md`, `ROUTE_TRUTH_TABLE.md`, and
   `docs/TRUTH_FREEZE_AUDIT_2026-02-28.md` for legacy containment
5. `docs/MOBILE_SPEC_PACK.md` only as historical context

## Canonical Request Rules

- Authenticated mobile requests use `Authorization: Bearer <Firebase ID token>`
  (`src/middleware/requireAuth.js:5-19`).
- JSON writes use `Content-Type: application/json`.
- Mobile callers identify themselves with `x-client: mobile`; caption preview uses that header to
  select server-measured mobile behavior when `measure` is omitted
  (`src/routes/caption.preview.routes.js:131-145`).
- `POST /api/story/finalize` requires `X-Idempotency-Key`
  (`src/middleware/idempotency.firestore.js:33-52`).

## Canonical Response Rules

- Standard success envelope: `{ success: true, data, requestId }`
  (`src/http/respond.js:14-17`).
- Standard failure envelope: `{ success: false, error, detail, requestId, fields? }`
  (`src/http/respond.js:28-34`).
- Current mobile launch exception: `POST /api/story/finalize` also returns top-level `shortId`
  because current mobile navigation depends on it (`src/routes/story.routes.js:36-41`,
  `src/routes/story.routes.js:840-841`, `docs/MOBILE_USED_SURFACES.md`).

## MOBILE_CORE_NOW Contract

### Auth Bootstrap And Credits

- `POST /api/users/ensure`
  - Mobile sends now: no body.
  - Mobile reads now: stores the returned profile and screen-reads `credits`.
  - Auth: required.
  - Failure modes: `AUTH_REQUIRED`, `INVALID_REQUEST`, `ENSURE_FAILED`
    (`src/routes/users.routes.js:15-92`).
  - Contract note: new-user and existing-user responses are not fully symmetric; existing-user
    responses omit `plan` today (`src/routes/users.routes.js:51-59`, `src/routes/users.routes.js:80-87`).

- `GET /api/credits`
  - Mobile sends now: no body.
  - Mobile reads now: `data.credits` only.
  - Auth: required.
  - Failure modes: `AUTH_REQUIRED`, `CREDITS_ERROR`
    (`src/routes/credits.routes.js:11`, `src/controllers/credits.controller.js:5-17`).

### Story Creation And Session Truth

- `POST /api/story/start`
  - Mobile sends now: `{ input, inputType }`.
  - Mobile reads now: `data.id`.
  - Auth: required through router-level `requireAuth`.
  - Failure modes: `INVALID_INPUT`, `STORY_START_FAILED`
    (`src/routes/story.routes.js:118-145`).

- `POST /api/story/generate`
  - Mobile sends now: `{ sessionId }`.
  - Mobile reads now: success/failure control flow only.
  - Auth: required.
  - Guardrails: `enforceScriptDailyCap(300)` (`src/routes/story.routes.js:148`).
  - Failure modes: `INVALID_INPUT`, `SCRIPT_LIMIT_REACHED`, outbound-link validation/timeouts,
    `STORY_GENERATE_FAILED` (`src/routes/story.routes.js:147-172`).

- `GET /api/story/:sessionId`
  - Mobile sends now: no body.
  - Mobile reads now: `story.sentences`, `shots`, `overlayCaption.placement`, selected clip
    thumb/searchQuery, and later `finalVideo`.
  - Auth: required.
  - Failure modes: `INVALID_INPUT`, `NOT_FOUND`, `STORY_GET_FAILED`
    (`src/routes/story.routes.js:1002-1024`).
  - Recovery role: this is the canonical status-check path after finalize retries or transport loss.

- `POST /api/story/plan`
  - Mobile sends now: `{ sessionId }`.
  - Mobile reads now: success/failure only.
  - Auth: required.
  - Guardrails: `enforceScriptDailyCap(300)` (`src/routes/story.routes.js:477`).
  - Failure modes: `INVALID_INPUT`, `STORY_PLAN_FAILED`
    (`src/routes/story.routes.js:476-495`).

- `POST /api/story/search`
  - Mobile sends now: `{ sessionId }`.
  - Mobile reads now: success/failure only.
  - Auth: required.
  - Failure modes today: `INVALID_INPUT`, otherwise generic `STORY_SEARCH_FAILED`
    (`src/routes/story.routes.js:497-516`).
  - Contract risk: service-level `SESSION_NOT_FOUND` and `PLAN_REQUIRED` collapse into 500 today
    (`src/services/story.service.js:427-462`).

### Story Editing And Caption Preview

- `POST /api/story/update-beat-text`
  - Mobile sends now: `{ sessionId, sentenceIndex, text }`.
  - Mobile reads now: success/failure only in `StoryEditorScreen`; `ScriptScreen` also accepts the
    returned data and re-reads beats from session shape.
  - Auth: required.
  - Failure modes today: `INVALID_INPUT`, otherwise generic `STORY_UPDATE_BEAT_TEXT_FAILED`
    (`src/routes/story.routes.js:691-725`).
  - Contract risk: `updateBeatText()` dereferences session state before a session-null check and
    collapses domain errors into 500 (`src/services/story.service.js:670-700`).

- `POST /api/story/delete-beat`
  - Mobile sends now: `{ sessionId, sentenceIndex }`.
  - Mobile reads now: success/failure only, then refetches session.
  - Auth: required.
  - Failure modes today: `INVALID_INPUT`, otherwise generic `STORY_DELETE_BEAT_FAILED`
    (`src/routes/story.routes.js:664-689`).
  - Contract risk: service-level `SESSION_NOT_FOUND`, `STORY_REQUIRED`, `SHOTS_REQUIRED`, and
    `INVALID_SENTENCE_INDEX` collapse into 500 (`src/services/story.service.js:628-665`).

- `POST /api/story/search-shot`
  - Mobile sends now: `{ sessionId, sentenceIndex, query, page }`.
  - Mobile reads now: `data.shot`, `data.page`, `data.hasMore`.
  - Auth: required.
  - Failure modes today: `INVALID_INPUT`, otherwise generic `STORY_SEARCH_SHOT_FAILED`
    (`src/routes/story.routes.js:594-633`).
  - Contract risk: service-level `SESSION_NOT_FOUND`, `SHOTS_REQUIRED`, `SHOT_NOT_FOUND`, and
    `NO_SEARCH_QUERY_AVAILABLE` collapse into 500 (`src/services/story.service.js:468-523`).

- `POST /api/story/update-shot`
  - Mobile sends now: `{ sessionId, sentenceIndex, clipId }`.
  - Mobile reads now: success/failure only.
  - Auth: required.
  - Failure modes today: `INVALID_INPUT`, otherwise generic `STORY_UPDATE_SHOT_FAILED`
    (`src/routes/story.routes.js:518-545`).
  - Contract risk: service-level `SESSION_NOT_FOUND`, `SHOTS_REQUIRED`, `SHOT_NOT_FOUND`,
    `NO_CANDIDATES_AVAILABLE`, and `CLIP_NOT_FOUND_IN_CANDIDATES` collapse into 500
    (`src/services/story.service.js:528-550`).

- `POST /api/caption/preview`
  - Mobile sends now: `{ ssotVersion: 3, mode: "raster", measure: "server", text, placement, yPct, frameW, frameH }`.
  - Mobile reads now: `data.meta.rasterUrl`, `rasterW`, `rasterH`, optional `xPx_png`, `yPx_png`.
  - Auth: required.
  - Guardrails: `20/min` rate limit and `200kb` parser cap
    (`src/routes/caption.preview.routes.js:91-113`, `src/app.js:118-126`).
  - Failure modes: `AUTH_REQUIRED`, `RATE_LIMIT_EXCEEDED`, `V3_RASTER_REQUIRED`,
    `VALIDATION_FAILED`, `EMPTY_TEXT`.

- `POST /api/story/update-caption-style`
  - Mobile sends now: `{ sessionId, overlayCaption: { placement, yPct } }`.
  - Mobile reads now: success/failure only.
  - Auth: required.
  - Failure modes: `INVALID_INPUT`, `SESSION_NOT_FOUND`, `STORY_UPDATE_CAPTION_STYLE_FAILED`
    (`src/routes/story.routes.js:207-283`).

### Render, Recovery, And Shorts Library

- `POST /api/story/finalize`
  - Mobile sends now: `{ sessionId }` plus `X-Idempotency-Key`.
  - Mobile reads now: `shortId`, and on failures `retryAfter`, `error/code`, and `detail/message`.
  - Auth: required.
  - Guardrails: Firestore-backed idempotency and credit reservation, `withRenderSlot()` semaphore
    of 3 concurrent renders, synchronous HTTP render path
    (`src/middleware/idempotency.firestore.js:12-208`, `src/utils/render.semaphore.js:1-22`,
    `server.js:32-39`).
  - Failure modes: `MISSING_IDEMPOTENCY_KEY`, `INVALID_INPUT`, `INSUFFICIENT_CREDITS`,
    `IDEMPOTENT_IN_PROGRESS`, `SERVER_BUSY`, `STORY_FINALIZE_FAILED`
    (`src/routes/story.routes.js:818-856`).

- `GET /api/shorts/mine`
  - Mobile sends now: `limit` and optional `cursor`.
  - Mobile reads now: `data.items`, `data.nextCursor`, `data.hasMore`.
  - Auth: required.
  - Failure modes: `UNAUTHENTICATED`, `FETCH_FAILED`
    (`src/controllers/shorts.controller.js:5-90`).
  - Stability note: repo includes the required Firestore composite index
    (`firestore.indexes.json:1-11`), but the controller still has a fallback path that disables
    pagination if the index is missing (`src/controllers/shorts.controller.js:47-85`).

- `GET /api/shorts/:jobId`
  - Mobile sends now: no body.
  - Mobile reads now: `jobId/id`, `videoUrl`, `coverImageUrl`, `durationSec`, `usedQuote`,
    `usedTemplate`, `createdAt`.
  - Auth: required.
  - Failure modes: `INVALID_INPUT`, `NOT_FOUND`, `GET_SHORT_FAILED`
    (`src/controllers/shorts.controller.js:93-175`).
  - Contract risk: story finalize writes `story.mp4` and `thumb.jpg`, but detail fallback probing
    still looks for `short.mp4`, `cover.jpg`, and `meta.json`
    (`src/services/story.service.js:1921-1945`, `src/controllers/shorts.controller.js:104-168`).

## MOBILE_CORE_SOON Contract

- `POST /api/story/insert-beat`
  - Reason: directly adjacent to the live mobile beat editor, but unwired today.
  - Auth: required.
  - Failure modes today: `INVALID_INPUT`, otherwise generic `STORY_INSERT_BEAT_FAILED`
    (`src/routes/story.routes.js:635-662`).
  - Promotion rule: harden only when the mobile caller lands; do not pre-harden voice/TTS or
    profile routes in anticipation.

## Route Classification Table

Product API routes only. Infrastructure surfaces such as `/health`, `/assets/*`, and debug routes
are intentionally excluded from this table.

| Route | Classification | Current caller evidence | Handling policy |
| --- | --- | --- | --- |
| `POST /api/users/ensure` | `MOBILE_CORE_NOW` | Mobile auth bootstrap; also web Firebase bootstrap (`src/routes/users.routes.js:15-92`, `web/public/js/firebaseClient.js:32`) | Harden and document now. |
| `GET /api/credits` | `MOBILE_CORE_NOW` | Mobile credits refresh and shorts/settings surfaces (`src/routes/credits.routes.js:11`, `web/public/js/my-shorts.js:154`) | Harden and document now. |
| `POST /api/story/start` | `MOBILE_CORE_NOW` | Mobile home create flow; shared with creative web (`src/routes/story.routes.js:119-145`, `web/public/js/pages/creative/creative.article.mjs:1091`) | Harden now because it is the mobile create entrypoint. |
| `POST /api/story/generate` | `MOBILE_CORE_NOW` | Mobile create flow; shared with creative web (`src/routes/story.routes.js:148-172`, `web/public/js/pages/creative/creative.article.mjs:1108`) | Harden now. |
| `GET /api/story/:sessionId` | `MOBILE_CORE_NOW` | Mobile script/editor/finalize recovery; shared with creative web (`src/routes/story.routes.js:1002-1024`, `docs/MOBILE_USED_SURFACES.md`) | Harden now; this is recovery truth after finalize. |
| `POST /api/story/plan` | `MOBILE_CORE_NOW` | Mobile storyboard step; shared with creative web (`src/routes/story.routes.js:476-495`, `web/public/js/pages/creative/creative.article.mjs:1394`) | Harden now. |
| `POST /api/story/search` | `MOBILE_CORE_NOW` | Mobile storyboard step; shared with creative web (`src/routes/story.routes.js:497-516`, `web/public/js/pages/creative/creative.article.mjs:1404`) | Harden now. |
| `POST /api/story/update-beat-text` | `MOBILE_CORE_NOW` | Mobile script/editor beat edit; shared with creative web (`src/routes/story.routes.js:691-725`, `web/public/js/pages/creative/creative.article.mjs:838`) | Harden now. |
| `POST /api/story/delete-beat` | `MOBILE_CORE_NOW` | Mobile script/editor delete; shared with creative web (`src/routes/story.routes.js:664-689`, `web/public/js/pages/creative/creative.article.mjs:2500`) | Harden now. |
| `POST /api/story/search-shot` | `MOBILE_CORE_NOW` | Mobile clip picker; shared with creative web (`src/routes/story.routes.js:594-633`, `web/public/js/pages/creative/creative.article.mjs:3394`) | Harden now. |
| `POST /api/story/update-shot` | `MOBILE_CORE_NOW` | Mobile clip replacement; shared with creative web (`src/routes/story.routes.js:518-545`, `web/public/js/pages/creative/creative.article.mjs:3272`) | Harden now. |
| `POST /api/caption/preview` | `MOBILE_CORE_NOW` | Mobile beat-card caption preview; shared with creative web caption preview (`src/routes/caption.preview.routes.js:109-113`, `web/public/js/caption-preview.js:636`) | Harden now; already rate-limited. |
| `POST /api/story/update-caption-style` | `MOBILE_CORE_NOW` | Mobile caption placement persistence; shared with creative web (`src/routes/story.routes.js:207-283`, `web/public/js/pages/creative/creative.article.mjs:1272`) | Harden now. |
| `POST /api/story/finalize` | `MOBILE_CORE_NOW` | Mobile render action; shared with creative web (`src/routes/story.routes.js:818-856`, `web/public/js/pages/creative/creative.article.mjs:4004`) | Harden now; highest-value write surface. |
| `GET /api/shorts/mine` | `MOBILE_CORE_NOW` | Mobile library list; shared with web my-shorts (`src/routes/shorts.routes.js:8`, `web/public/js/my-shorts.js:48`) | Harden now. |
| `GET /api/shorts/:jobId` | `MOBILE_CORE_NOW` | Mobile short detail; shared with web my-shorts (`src/routes/shorts.routes.js:9`, `web/public/js/my-shorts.js:200`) | Harden now. |
| `POST /api/story/insert-beat` | `MOBILE_CORE_SOON` | No current mobile caller; current creative web caller only (`src/routes/story.routes.js:635-662`, `web/public/js/pages/creative/creative.article.mjs:2456`) | Do not harden until mobile adopts it. |
| `POST /api/assets/options` | `LEGACY_WEB` | Creative draft/manual asset picker only (`src/routes/assets.routes.js:9`, `web/public/js/pages/creative/creative.article.mjs:3484`) | Ignore unless shared security risk crosses into mobile. |
| `POST /api/story/manual` | `LEGACY_WEB` | Creative manual script path only (`src/routes/story.routes.js:858-888`, `web/public/js/pages/creative/creative.article.mjs:1487`) | Ignore for mobile launch. |
| `POST /api/story/create-manual-session` | `LEGACY_WEB` | Creative manual-first render path only (`src/routes/story.routes.js:890-1000`, `web/public/js/pages/creative/creative.article.mjs:3930`) | Ignore for mobile launch. |
| `POST /api/story/update-video-cuts` | `LEGACY_WEB` | Creative web editor only (`src/routes/story.routes.js:563-592`, `web/public/js/pages/creative/creative.article.mjs:1922`) | Ignore for mobile launch. |
| `POST /api/story/update-caption-meta` | `LEGACY_WEB` | Creative caption preview persistence only (`src/routes/story.routes.js:285-474`, `web/public/js/caption-preview.js:108`) | Ignore unless it breaks shared render stability. |
| `POST /api/checkout/start` | `LEGACY_WEB` | Pricing page only (`src/routes/checkout.routes.js:16`, `web/public/js/pricing.js:114`) | Touch only for direct billing risk to mobile launch. |
| `POST /api/checkout/session` | `LEGACY_WEB` | Buy-credits page only (`src/routes/checkout.routes.js:20`, `web/public/js/buy-credits.js:67`) | Touch only for direct billing risk to mobile launch. |
| `POST /api/checkout/subscription` | `LEGACY_WEB` | Buy-credits page only (`src/routes/checkout.routes.js:23-28`, `web/public/js/buy-credits.js:84`) | Touch only for direct billing risk to mobile launch. |
| `POST /api/checkout/portal` | `LEGACY_WEB` | Buy-credits page only (`src/routes/checkout.routes.js:31`, `web/public/js/buy-credits.js:167`) | Touch only for direct billing risk to mobile launch. |
| `POST /stripe/webhook` | `LEGACY_WEB` | External Stripe caller; no mobile API caller (`src/app.js:115`, `src/routes/stripe.webhook.js`) | Keep because billing still matters to mobile, but do not expand scope beyond correctness. |
| `POST /api/story/update-script` | `REMOVE_LATER` | No current mobile caller; no current web/public caller (`src/routes/story.routes.js:174-205`, `docs/MOBILE_USED_SURFACES.md`, `docs/ACTIVE_SURFACES.md`) | Retire after freeze. |
| `POST /api/story/timeline` | `REMOVE_LATER` | No current mobile caller; no current web/public caller (`src/routes/story.routes.js:727-746`) | Retire after freeze. |
| `POST /api/story/captions` | `REMOVE_LATER` | No current mobile caller; no current web/public caller (`src/routes/story.routes.js:748-773`) | Retire after freeze. |
| `POST /api/story/render` | `REMOVE_LATER` | No current mobile caller; no current web/public caller (`src/routes/story.routes.js:775-816`, `docs/ACTIVE_SURFACES.md:79`) | Default-disable now; remove later. |
| `POST /api/user/setup` | `REMOVE_LATER` | No current mobile caller; no current web/public caller (`src/routes/user.routes.js:13-29`, `docs/TRUTH_FREEZE_AUDIT_2026-02-28.md:41`) | Retire after freeze. |
| `GET /api/user/me` | `REMOVE_LATER` | No current mobile caller; no current web/public caller (`src/routes/user.routes.js:34-56`, `docs/MOBILE_USED_SURFACES.md:96`) | Retire after freeze. |
| `GET /api/whoami` | `REMOVE_LATER` | Console/helper only (`src/routes/whoami.routes.js:11-16`, `docs/TRUTH_FREEZE_AUDIT_2026-02-28.md:42`) | Retire after freeze. |
| `GET /api/limits/usage` | `REMOVE_LATER` | No current user-facing caller (`src/routes/limits.routes.js:7`, `docs/TRUTH_FREEZE_AUDIT_2026-02-28.md:43`) | Retire after freeze. |
