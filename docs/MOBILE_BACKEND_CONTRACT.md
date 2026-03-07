# MOBILE_BACKEND_CONTRACT

Cross-repo verification date: 2026-03-07.

Purpose: canonical backend contract for mobile production, verified against both the mobile repo and the mounted backend. If a route is not `MOBILE_CORE_NOW` or `MOBILE_CORE_SOON` here, it is not first-class for mobile launch.

## Source Order

1. Actual current mobile repo usage
2. Actual mounted backend behavior
3. `docs/MOBILE_USED_SURFACES.md`
4. `docs/MOBILE_HARDENING_PLAN.md`
5. Older spec docs only as historical context

## Request Rules

- Authenticated mobile requests use `Authorization: Bearer <Firebase ID token>` when a token is available (`client/api/client.ts:138-145`, `client/api/client.ts:198-205`, `src/middleware/requireAuth.js:5-19`).
- JSON requests use `Content-Type: application/json`.
- Mobile callers send `x-client: mobile` (`client/api/client.ts:132-136`, `client/api/client.ts:192-196`). Caption preview uses that header as part of the mobile/server-measured path selection when `measure` is omitted (`src/routes/caption.preview.routes.js:131-145`).
- Backend finalize requires `X-Idempotency-Key` (`src/middleware/idempotency.firestore.js:33-37`). Current mobile code does not send it (`client/api/client.ts:679-703`).
- Mobile credits wrapper currently calls `"/credits"` (`client/api/client.ts:478-484`), while the backend mount is `GET /api/credits` (`src/app.js:215-217`, `src/routes/credits.routes.js:7-11`). Treat that as a verified path/config dependency until code or env is made explicit.

## Response Rules

- Standard backend success envelope: `{ success: true, data, requestId }` (`src/http/respond.js:14-17`).
- Standard backend failure envelope: `{ success: false, error, detail, requestId, fields? }` (`src/http/respond.js:28-34`).
- Mobile normalization layer converts success envelopes to `{ ok: true, data }` and failure envelopes to `{ ok: false, status, code, message }` (`client/api/client.ts:95-122`, `client/api/client.ts:184-235`).
- Finalize is the current launch exception: the backend returns top-level `shortId`, and the mobile client explicitly extracts it from the raw response (`src/routes/story.routes.js:35-41`, `src/routes/story.routes.js:840-841`, `client/api/client.ts:740-760`).

## Current Open Contract Mismatches

- `CORRECTED`: Mobile finalize does not currently satisfy backend idempotency requirements.
  - Mobile caller: `client/api/client.ts:679-703`
  - Backend handler/middleware: `src/middleware/idempotency.firestore.js:33-37`, `src/routes/story.routes.js:818-856`
  - Why it matters: backend can reject the current mobile request with `400 MISSING_IDEMPOTENCY_KEY` before render starts.

- `CORRECTED`: Mobile credits wrapper path is not proven to match mounted backend path.
  - Mobile caller: `client/api/client.ts:478-484`
  - Backend mount: `src/app.js:215-217`, `src/routes/credits.routes.js:7-11`
  - Why it matters: repo truth only lines up if runtime config already bakes `/api` into the mobile base URL.

- `CORRECTED`: Shorts detail payload shape does not match the mobile detail adapter.
  - Mobile reader: `client/api/client.ts:291-307`, `client/screens/ShortDetailScreen.tsx:357-379`
  - Backend payload: `src/controllers/shorts.controller.js:123-134`, `src/controllers/shorts.controller.js:160-171`
  - Why it matters: backend returns `jobId`; mobile expects `id`.

- `CORRECTED`: Shorts detail storage probing does not match story finalize outputs.
  - Mobile reader/fallback: `client/screens/ShortDetailScreen.tsx:203-303`
  - Backend detail probe: `src/controllers/shorts.controller.js:104-158`
  - Backend writer: `src/services/story.service.js:1921-1945`
  - Why it matters: backend detail still probes `short.mp4` and `cover.jpg`, while story finalize writes `story.mp4` and `thumb.jpg`.

## MOBILE_CORE_NOW Contract

### Auth Bootstrap And Credits

- `POST /api/users/ensure`
  - Mobile caller(s): `client/contexts/AuthContext.tsx:63-76`
  - Backend handler(s): `src/routes/users.routes.js:15-92`
  - Mobile sends: no body.
  - Backend returns: full success envelope with profile data.
  - Mobile reads: stores the returned profile; current screens only read `userProfile.credits`.
  - Contract caveat: existing-user backend response omits `plan`; mobile wrapper patches missing `plan` to `"free"` (`client/api/client.ts:469-472`).

- `GET /api/credits`
  - Mobile caller(s): `client/contexts/AuthContext.tsx:87-103`, `client/screens/SettingsScreen.tsx:42-58`, `client/screens/StoryEditorScreen.tsx:875-880`
  - Backend handler(s): `src/routes/credits.routes.js:7-11`, `src/controllers/credits.controller.js:5-17`
  - Mobile sends: no body; current wrapper path is `"/credits"`.
  - Backend returns: `{ success: true, data: { uid, email, credits }, requestId }`.
  - Mobile reads: `data.credits` only.
  - Contract caveat: mobile path and mounted backend path are not identical in repo code.

### Story Creation And Session Truth

- `POST /api/story/start`
  - Mobile caller(s): `client/screens/HomeScreen.tsx:79-107`
  - Backend handler(s): `src/routes/story.routes.js:118-145`, `src/services/story.service.js:88-113`
  - Mobile sends: `{ input, inputType }`.
  - Backend returns: full session in `data`.
  - Mobile reads: `data.id` only.

- `POST /api/story/generate`
  - Mobile caller(s): `client/screens/HomeScreen.tsx:109-127`
  - Backend handler(s): `src/routes/story.routes.js:147-172`, `src/services/story.service.js:125-156`
  - Mobile sends: `{ sessionId }`.
  - Backend returns: full session in `data`.
  - Mobile reads: success/failure only.
  - Guardrail: `enforceScriptDailyCap(300)` (`src/routes/story.routes.js:148`).

- `GET /api/story/:sessionId`
  - Mobile caller(s): `client/screens/ScriptScreen.tsx:64-84`, `client/screens/StoryEditorScreen.tsx:367-449`, `client/screens/StoryEditorScreen.tsx:432-449`
  - Backend handler(s): `src/routes/story.routes.js:1002-1024`, `src/services/story.service.js:118-120`
  - Mobile sends: no body.
  - Backend returns: full session in `data`.
  - Mobile reads: `story.sentences` with helper fallbacks, `shots`, `overlayCaption.placement`, `shot.selectedClip.thumbUrl`, and `shot.searchQuery`.
  - Recovery role: this is the verified status-check route after finalize retries or transport loss.

- `POST /api/story/plan`
  - Mobile caller(s): `client/screens/ScriptScreen.tsx:126-159`
  - Backend handler(s): `src/routes/story.routes.js:476-495`, `src/services/story.service.js:189-201`
  - Mobile sends: `{ sessionId }`.
  - Backend returns: full session in `data`.
  - Mobile reads: success/failure only.
  - Guardrail: `enforceScriptDailyCap(300)`.

- `POST /api/story/search`
  - Mobile caller(s): `client/screens/ScriptScreen.tsx:141-159`
  - Backend handler(s): `src/routes/story.routes.js:497-516`, `src/services/story.service.js:427-462`
  - Mobile sends: `{ sessionId }`.
  - Backend returns: full session in `data`.
  - Mobile reads: success/failure only.
  - Contract caveat: service-level `SESSION_NOT_FOUND` and `PLAN_REQUIRED` still collapse into generic 500s today.

### Story Editing And Caption Preview

- `POST /api/story/update-beat-text`
  - Mobile caller(s): `client/screens/ScriptScreen.tsx:162-209`, `client/screens/StoryEditorScreen.tsx:679-701`
  - Backend handler(s): `src/routes/story.routes.js:691-725`, `src/services/story.service.js:670-700`
  - Mobile sends: `{ sessionId, sentenceIndex, text }`.
  - Backend returns: partial `{ sentences, shots }` in `data`, not a full session.
  - Mobile reads:
    - `ScriptScreen`: re-runs `extractBeats()` against the partial payload.
    - `StoryEditorScreen`: ignores returned data and updates local state.
  - Contract caveat: service dereferences `session.story` before a session-null check, so some domain errors turn into 500s.

- `POST /api/story/delete-beat`
  - Mobile caller(s): `client/screens/ScriptScreen.tsx:222-235`, `client/screens/StoryEditorScreen.tsx:715-749`
  - Backend handler(s): `src/routes/story.routes.js:664-689`, `src/services/story.service.js:628-665`
  - Mobile sends: `{ sessionId, sentenceIndex }`.
  - Backend returns: partial `{ sentences, shots }` in `data`.
  - Mobile reads: success/failure only, then refetches `GET /api/story/:sessionId`.
  - Contract caveat: service-level `SESSION_NOT_FOUND`, `STORY_REQUIRED`, `SHOTS_REQUIRED`, and `INVALID_SENTENCE_INDEX` collapse into generic 500s today.

- `POST /api/story/search-shot`
  - Mobile caller(s): `client/screens/ClipSearchModal.tsx:49-80`
  - Backend handler(s): `src/routes/story.routes.js:594-633`, `src/services/story.service.js:468-523`, `src/services/story.service.js:286-421`
  - Mobile sends: `{ sessionId, sentenceIndex, query, page }`.
  - Backend returns: `{ shot, page, hasMore }` in `data`.
  - Mobile reads: `shot.candidates`, `page`, `hasMore`, and candidate `id`, `thumbUrl`, `provider`, `duration`.
  - Contract caveat: several domain errors still collapse into generic 500s today.

- `POST /api/story/update-shot`
  - Mobile caller(s): `client/screens/ClipSearchModal.tsx:83-104`
  - Backend handler(s): `src/routes/story.routes.js:518-545`, `src/services/story.service.js:528-550`
  - Mobile sends: `{ sessionId, sentenceIndex, clipId }`.
  - Backend returns: `{ shots }` in `data`.
  - Mobile reads: success/failure only.
  - Contract caveat: `SESSION_NOT_FOUND`, `SHOTS_REQUIRED`, `SHOT_NOT_FOUND`, `NO_CANDIDATES_AVAILABLE`, and `CLIP_NOT_FOUND_IN_CANDIDATES` still collapse into generic 500s today.

- `POST /api/caption/preview`
  - Mobile caller(s): `client/hooks/useCaptionPreview.ts:59-120`, `client/screens/StoryEditorScreen.tsx:507-516`
  - Backend handler(s): `src/routes/caption.preview.routes.js:109-313`
  - Mobile sends: `{ ssotVersion: 3, mode: "raster", measure: "server", text, placement, yPct, frameW, frameH }`; current screen does not send `style`.
  - Backend returns: `data.meta` including `rasterUrl`, `rasterW`, `rasterH`, `yPx_png`, `frameW`, `frameH`, and other compiler metadata.
  - Mobile reads: `meta.rasterUrl`, `rasterW`, `rasterH`, `yPx_png`, and uses fallback centering when `xPx_png` is absent.
  - Guardrails: auth-required, `20/min`, `200kb` body cap.

- `POST /api/story/update-caption-style`
  - Mobile caller(s): `client/screens/StoryEditorScreen.tsx:765-820`
  - Backend handler(s): `src/routes/story.routes.js:207-283`
  - Mobile sends: `{ sessionId, overlayCaption: { placement, yPct } }`.
  - Backend returns: `{ overlayCaption }` in `data`.
  - Mobile reads: success/failure only.

### Render, Recovery, And Shorts

- `POST /api/story/finalize`
  - Mobile caller(s): `client/screens/StoryEditorScreen.tsx:834-911`, `client/api/client.ts:676-760`
  - Backend handler(s): `src/routes/story.routes.js:818-856`, `src/middleware/idempotency.firestore.js:12-208`, `src/services/story.service.js:2060-2105`
  - Mobile sends now: `{ sessionId }`.
  - Backend requires now: `{ sessionId }` plus `X-Idempotency-Key`.
  - Backend returns on success: full session in `data` plus top-level `shortId`.
  - Mobile reads: `shortId`, and on failures `retryAfter`, `code/error`, `message/detail`, `status`.
  - Guardrails: Firestore-backed idempotency and credit reservation, `withRenderSlot()` semaphore, synchronous HTTP render path.
  - Contract caveat: current mobile client does not send the required idempotency header.

- `GET /api/shorts/mine`
  - Mobile caller(s): `client/screens/LibraryScreen.tsx:80-118`, `client/screens/ShortDetailScreen.tsx:227-248`
  - Backend handler(s): `src/routes/shorts.routes.js:7-9`, `src/controllers/shorts.controller.js:5-90`
  - Mobile sends: `limit` and optional `cursor`.
  - Backend returns: `{ items, nextCursor, hasMore }` in `data`.
  - Mobile reads: list items and pagination fields.
  - Stability note: controller has an index-missing fallback path that disables pagination semantics when the composite index is absent.

- `GET /api/shorts/:jobId`
  - Mobile caller(s): `client/screens/ShortDetailScreen.tsx:143-333`, `client/screens/ShortDetailScreen.tsx:513-529`
  - Backend handler(s): `src/routes/shorts.routes.js:7-9`, `src/controllers/shorts.controller.js:93-175`
  - Mobile sends: no body.
  - Backend returns today: payload keyed by `jobId`, not `id`.
  - Mobile reads: `id`, `videoUrl`, `coverImageUrl`, `durationSec`, `usedQuote.text`, `usedTemplate`, `createdAt`.
  - Contract caveats:
    - payload key mismatch: `jobId` vs `id`
    - storage-name drift: detail probes `short.mp4` and `cover.jpg`, while story finalize writes `story.mp4` and `thumb.jpg`
    - mobile already falls back to `GET /api/shorts/mine` during repeated 404s

## MOBILE_CORE_SOON Contract

- `POST /api/story/insert-beat`
  - Backend route exists: `src/routes/story.routes.js:635-662`
  - Backend service exists: `src/services/story.service.js:555-623`
  - Current mobile caller: none.
  - Promotion rule: only harden when a real mobile caller lands.

## Route Classification Table

| Route | Classification | Verified caller evidence | Handling policy |
| --- | --- | --- | --- |
| `POST /api/users/ensure` | `MOBILE_CORE_NOW` | Mobile auth bootstrap (`client/contexts/AuthContext.tsx:63-76`) | Harden and document now. |
| `GET /api/credits` | `MOBILE_CORE_NOW` | Mobile credits refresh depends on this backend route, even though the current wrapper path is `"/credits"` (`client/api/client.ts:478-484`, `client/contexts/AuthContext.tsx:87-103`) | Harden and document now; resolve path truth. |
| `POST /api/story/start` | `MOBILE_CORE_NOW` | Mobile home create flow (`client/screens/HomeScreen.tsx:79-107`) | Harden now. |
| `POST /api/story/generate` | `MOBILE_CORE_NOW` | Mobile create flow (`client/screens/HomeScreen.tsx:109-127`) | Harden now. |
| `GET /api/story/:sessionId` | `MOBILE_CORE_NOW` | Mobile script/editor recovery truth (`client/screens/ScriptScreen.tsx:64-84`, `client/screens/StoryEditorScreen.tsx:367-449`) | Harden now. |
| `POST /api/story/plan` | `MOBILE_CORE_NOW` | Mobile storyboard step (`client/screens/ScriptScreen.tsx:126-159`) | Harden now. |
| `POST /api/story/search` | `MOBILE_CORE_NOW` | Mobile storyboard step (`client/screens/ScriptScreen.tsx:141-159`) | Harden now. |
| `POST /api/story/update-beat-text` | `MOBILE_CORE_NOW` | Mobile script/editor beat editing (`client/screens/ScriptScreen.tsx:162-209`, `client/screens/StoryEditorScreen.tsx:679-701`) | Harden now. |
| `POST /api/story/delete-beat` | `MOBILE_CORE_NOW` | Mobile script/editor deletion (`client/screens/ScriptScreen.tsx:222-235`, `client/screens/StoryEditorScreen.tsx:715-749`) | Harden now. |
| `POST /api/story/search-shot` | `MOBILE_CORE_NOW` | Mobile clip picker (`client/screens/ClipSearchModal.tsx:49-80`) | Harden now. |
| `POST /api/story/update-shot` | `MOBILE_CORE_NOW` | Mobile clip replacement (`client/screens/ClipSearchModal.tsx:83-104`) | Harden now. |
| `POST /api/caption/preview` | `MOBILE_CORE_NOW` | Mobile beat-card preview (`client/hooks/useCaptionPreview.ts:59-120`) | Harden now. |
| `POST /api/story/update-caption-style` | `MOBILE_CORE_NOW` | Mobile caption placement persistence (`client/screens/StoryEditorScreen.tsx:765-820`) | Harden now. |
| `POST /api/story/finalize` | `MOBILE_CORE_NOW` | Mobile render action (`client/screens/StoryEditorScreen.tsx:834-911`) | Harden now; highest-risk contract surface. |
| `GET /api/shorts/mine` | `MOBILE_CORE_NOW` | Mobile library list and detail fallback (`client/screens/LibraryScreen.tsx:80-118`, `client/screens/ShortDetailScreen.tsx:227-248`) | Harden now. |
| `GET /api/shorts/:jobId` | `MOBILE_CORE_NOW` | Mobile post-render detail path (`client/screens/ShortDetailScreen.tsx:143-333`) | Harden now; contract drift is already visible. |
| `POST /api/story/insert-beat` | `MOBILE_CORE_SOON` | No current mobile caller | Do not harden until mobile adopts it. |
| `POST /api/assets/options` | `LEGACY_WEB` | Web creative editor only (`web/public/js/pages/creative/creative.article.mjs:3483`) | Ignore unless shared security risk crosses into mobile. |
| `POST /api/story/manual` | `LEGACY_WEB` | Web manual flow only (`web/public/js/pages/creative/creative.article.mjs:1487`) | Ignore for mobile launch. |
| `POST /api/story/create-manual-session` | `LEGACY_WEB` | Web manual-first render only (`web/public/js/pages/creative/creative.article.mjs:3930`) | Ignore for mobile launch. |
| `POST /api/story/update-video-cuts` | `LEGACY_WEB` | Web editor only (`web/public/js/pages/creative/creative.article.mjs:1922`, `web/public/js/pages/creative/creative.article.mjs:1950`) | Ignore for mobile launch. |
| `POST /api/story/update-caption-meta` | `LEGACY_WEB` | Web caption preview persistence only (`web/public/js/caption-preview.js:108`) | Ignore unless it breaks shared render stability. |
| `POST /api/checkout/start` | `LEGACY_WEB` | Web pricing page only (`web/public/js/pricing.js:114`) | Touch only for direct billing risk to mobile launch. |
| `POST /api/checkout/session` | `LEGACY_WEB` | Web buy-credits only (`web/public/js/buy-credits.js:67`) | Touch only for direct billing risk to mobile launch. |
| `POST /api/checkout/subscription` | `LEGACY_WEB` | Web buy-credits only (`web/public/js/buy-credits.js:84`) | Touch only for direct billing risk to mobile launch. |
| `POST /api/checkout/portal` | `LEGACY_WEB` | Web billing portal only (`web/public/js/buy-credits.js:167`) | Touch only for direct billing risk to mobile launch. |
| `POST /stripe/webhook` | `LEGACY_WEB` | External Stripe caller; no mobile API caller (`src/app.js:111-116`) | Keep correct, but do not broaden launch scope around it. |
| `POST /api/story/update-script` | `REMOVE_LATER` | No current mobile caller; no current `web/public` caller found in repo search | Retire after freeze. |
| `POST /api/story/timeline` | `REMOVE_LATER` | No current mobile caller; no current `web/public` caller found in repo search | Retire after freeze. |
| `POST /api/story/captions` | `REMOVE_LATER` | No current mobile caller; no current `web/public` caller found in repo search | Retire after freeze. |
| `POST /api/story/render` | `REMOVE_LATER` | No current mobile caller; no current `web/public` caller found in repo search | Default-disable now; remove later. |
| `POST /api/user/setup` | `REMOVE_LATER` | No current mobile caller; no current `web/public` caller found in repo search | Retire after freeze. |
| `GET /api/user/me` | `REMOVE_LATER` | No current mobile caller; no current `web/public` caller found in repo search | Retire after freeze unless mobile adopts it explicitly. |
| `GET /api/whoami` | `REMOVE_LATER` | No current mobile caller; no current `web/public` caller found in repo search | Retire after freeze. |
| `GET /api/limits/usage` | `REMOVE_LATER` | No current mobile caller; no current `web/public` caller found in repo search | Retire after freeze. |
