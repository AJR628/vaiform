# MOBILE_USED_SURFACES

Generated from source on 2026-03-07.

Scope: exact current mobile repo behavior only. This file describes what the app actually calls
today, what it sends, what it reads back, and which spec-sheet endpoints are still unwired. It
does not describe intended behavior unless the repo already implements it.

## Mobile-First Scope Freeze

This document is the source of truth for mobile launch scope. Use it before
`docs/MOBILE_SPEC_PACK.md` when deciding what to harden in the backend.

### Canonical Backend Path Notes

- The backend mount in this repo is `GET /api/credits`, not root `GET /credits`
  (`src/app.js:216`, `src/routes/credits.routes.js:11`). Older mobile audit notes used
  helper-relative notation. Mobile hardening docs and tests must treat `/api/credits` as the
  canonical server path.
- The shorts detail route is mounted as `GET /api/shorts/:jobId`
  (`src/routes/shorts.routes.js:8-9`). Current mobile navigation and wrappers use the name
  `shortId`, but in current runtime they refer to the same identifier.
- `POST /api/story/finalize` requires `X-Idempotency-Key`
  (`src/middleware/idempotency.firestore.js:33-52`). Mobile launch docs must preserve that
  requirement explicitly.

### Launch Scope Snapshot

#### MOBILE_CORE_NOW

- `POST /api/users/ensure`
- `GET /api/credits`
- `POST /api/story/start`
- `POST /api/story/generate`
- `GET /api/story/:sessionId`
- `POST /api/story/plan`
- `POST /api/story/search`
- `POST /api/story/update-beat-text`
- `POST /api/story/delete-beat`
- `POST /api/story/search-shot`
- `POST /api/story/update-shot`
- `POST /api/caption/preview`
- `POST /api/story/update-caption-style`
- `POST /api/story/finalize`
- `GET /api/shorts/mine`
- `GET /api/shorts/:jobId`

#### MOBILE_CORE_SOON

- `POST /api/story/insert-beat`

#### Not Mobile-First For Launch

- Legacy web/manual/editor: `POST /api/assets/options`, `POST /api/story/manual`,
  `POST /api/story/create-manual-session`, `POST /api/story/update-video-cuts`,
  `POST /api/story/update-caption-meta`, checkout routes, Stripe webhook
  (`docs/ACTIVE_SURFACES.md:78-85`, `web/public/js/pages/creative/creative.article.mjs`,
  `web/public/js/buy-credits.js`, `web/public/js/pricing.js`).
- Remove-later candidates with no current mobile caller and no current user-facing web caller:
  `POST /api/user/setup`, `GET /api/user/me`, `GET /api/whoami`, `GET /api/limits/usage`,
  `POST /api/story/update-script`, `POST /api/story/timeline`, `POST /api/story/captions`,
  `POST /api/story/render` (`docs/TRUTH_FREEZE_AUDIT_2026-02-28.md:41-43`,
  `docs/ACTIVE_SURFACES.md:79`, `ROUTE_TRUTH_TABLE.md:22`, `ROUTE_TRUTH_TABLE.md:30`,
  `ROUTE_TRUTH_TABLE.md:33`).

## Ground Rules

- Authenticated API traffic is centralized in `client/api/client.ts`. Current live calls use `Authorization: Bearer <Firebase ID token>`, `Content-Type: application/json`, and `x-client: mobile` (`client/api/client.ts:125-174`, `client/api/client.ts:179-235`).
- The app-wide React Query client exists, but no screen currently issues requests through `client/lib/query-client.ts`; the live surface is the hand-written API client plus a few direct media URL probes (`client/App.tsx:34-47`, `client/lib/query-client.ts`).
- `ShortDetailScreen` also probes returned media URLs with `HEAD` and fallback `Range` requests. Those hit the asset URL returned by shorts endpoints, not a Vaiform API route (`client/screens/ShortDetailScreen.tsx:397-425`).

## Shared / Context-Mediated Surfaces

### Auth bootstrap (`AuthContext`)

| Endpoint | Trigger | Payload sent | Response fields read now | Evidence |
|---|---|---|---|---|
| `POST /api/users/ensure` | Firebase auth state change after sign-in; runs once per UID | No body | On success, stores the whole `UserProfile` object in context. Downstream UI currently reads `userProfile.credits`; other returned fields are stored but not screen-read in this audit. Error path reads `ok`, `code`, `message`. | `client/contexts/AuthContext.tsx:58-85`, `client/api/client.ts:460-475`, `client/api/client.ts:250-257` |
| `GET /api/credits` | `refreshCredits()` helper used from `SettingsScreen` and after successful render in `StoryEditorScreen` | No body | Reads `data.credits` only and merges it into `userProfile`. Error path reads `ok`, `code`, `message`. | `client/contexts/AuthContext.tsx:87-103`, `client/api/client.ts:477-485`, `client/api/client.ts:259-263` |

## Screen-by-Screen Backend Usage

### `HomeScreen`

| Endpoint | Trigger | Payload sent | Response fields read now | Evidence |
|---|---|---|---|---|
| `POST /api/story/start` | `runCreateFlow()` after input validation and optional "replace current project" confirmation | `{ input: trimmedInput, inputType }`; current UI only ever sends `inputType: "link"` or `"idea"` | Reads `data.id` as `sessionId`. Error path reads `ok`, `code`, `message`. The returned session payload is otherwise ignored here. | `client/screens/HomeScreen.tsx:79-107`, `client/api/client.ts:524-537` |
| `POST /api/story/generate` | Immediately after successful `/api/story/start` | `{ sessionId }` | Reads only `ok`, `code`, `message` for control flow. Returned session data is ignored here. | `client/screens/HomeScreen.tsx:109-127`, `client/api/client.ts:539-552` |

### `ScriptScreen`

| Endpoint | Trigger | Payload sent | Response fields read now | Evidence |
|---|---|---|---|---|
| `GET /api/story/:sessionId` | Initial load | No body | Unwraps `data`, then reads `story.sentences` with fallbacks to `sentences` / `beats` via `extractBeats()`. Also reads `shots` only as a presence/length check to decide whether to show the "Generate Storyboard" CTA. Error path reads `ok`, `success`, `message`. | `client/screens/ScriptScreen.tsx:64-84`, `client/lib/storySession.ts:14-19`, `client/lib/storySession.ts:25-52`, `client/screens/ScriptScreen.tsx:88-96`, `client/api/client.ts:580-590` |
| `POST /api/story/plan` | "Generate Storyboard" CTA, step 1 | `{ sessionId }` | Reads only `ok` and `message`. Returned session data is ignored. | `client/screens/ScriptScreen.tsx:126-159`, `client/api/client.ts:554-565` |
| `POST /api/story/search` | "Generate Storyboard" CTA, step 2, after successful `/plan` | `{ sessionId }` | Reads only `ok` and `message`. Returned session data is ignored. | `client/screens/ScriptScreen.tsx:141-159`, `client/api/client.ts:567-578` |
| `POST /api/story/update-beat-text` | Saving an edited beat | `{ sessionId, sentenceIndex, text: cleaned }` | Unwraps returned session and stores it; the screen then re-reads beats from `story.sentences` / fallback paths. Error path reads `ok`, `success`, `message`. | `client/screens/ScriptScreen.tsx:162-209`, `client/lib/storySession.ts:25-52`, `client/api/client.ts:592-605` |
| `POST /api/story/delete-beat` | Delete confirmation on a beat | `{ sessionId, sentenceIndex }` | Reads only `ok`, `success`, `message`; immediately refetches `GET /api/story/:sessionId` for fresh SSOT data. | `client/screens/ScriptScreen.tsx:222-235`, `client/api/client.ts:607-622` |

### `StoryEditorScreen`

| Endpoint | Trigger | Payload sent | Response fields read now | Evidence |
|---|---|---|---|---|
| `GET /api/story/:sessionId` | Initial load and focus refresh after clip replacement or beat deletion | No body | Unwraps `data`, then reads beats from `story.sentences` / fallback paths, reads `shots` to render deck cards and clip search entry state, reads `overlayCaption.placement` to seed caption placement, reads `shot.selectedClip.thumbUrl` for thumbnails, and reads `shot.searchQuery` when opening clip search. Error path reads `ok`, `success`, `message`. | `client/screens/StoryEditorScreen.tsx:367-449`, `client/screens/StoryEditorScreen.tsx:457-516`, `client/screens/StoryEditorScreen.tsx:704-712`, `client/screens/StoryEditorScreen.tsx:175-186`, `client/screens/StoryEditorScreen.tsx:222-276`, `client/api/client.ts:580-590` |
| `POST /api/caption/preview` | Selected beat preview and one-time beat prefetch via `useCaptionPreview` | Current caller sends `{ ssotVersion: 3, mode: "raster", measure: "server", text, frameW: 1080, frameH: 1920, placement, yPct }`. `style` is supported by the hook/client but is not populated by current `StoryEditorScreen` callsites. | Reads `data.meta.rasterUrl`, `rasterW`, `rasterH`, `xPx_png` when present, `yPx_png`, and `frameW` when present via the meta bag. These drive overlay sizing/position on the deck cards. | `client/screens/StoryEditorScreen.tsx:507-533`, `client/hooks/useCaptionPreview.ts:59-120`, `client/api/client.ts:342-454`, `client/screens/StoryEditorScreen.tsx:175-186`, `client/screens/StoryEditorScreen.tsx:229-273` |
| `POST /api/story/update-beat-text` | Saving the currently selected beat from the inline editor | `{ sessionId, sentenceIndex, text: draft }` | Reads only `ok`, `success`, `message`; on success it updates local `beatTexts` and does not consume returned session data. | `client/screens/StoryEditorScreen.tsx:679-701`, `client/api/client.ts:592-605` |
| `POST /api/story/delete-beat` | Delete confirmation from the beat actions modal | `{ sessionId, sentenceIndex: deletedIndex }` | Reads only `ok`, `success`, `message`; immediately refetches `GET /api/story/:sessionId`, then rebuilds local beat text state from the refetched session. | `client/screens/StoryEditorScreen.tsx:715-749`, `client/api/client.ts:607-622` |
| `POST /api/story/update-caption-style` | User taps Top / Center / Bottom placement control | `{ sessionId, overlayCaption: { placement, yPct } }` | Reads only `ok`, `success`, `message`. The returned `overlayCaption` is not consumed; the screen relies on local optimistic state and fallback refs. | `client/screens/StoryEditorScreen.tsx:765-820`, `client/api/client.ts:655-670` |
| `POST /api/story/finalize` | Render confirmation in the storyboard header | `{ sessionId }` | Reads `ok`, `retryAfter`, `code`, `status`, `message`, and `shortId`. It does not read `data`. On success it refreshes credits and cross-navigates to `LibraryTab -> ShortDetail` with `{ shortId }`. | `client/screens/StoryEditorScreen.tsx:834-927`, `client/api/client.ts:672-760` |
| `GET /api/credits` | Indirect, after successful finalize, via `refreshCredits()` | No body | Reads `data.credits` through `AuthContext.refreshCredits()`. | `client/screens/StoryEditorScreen.tsx:875-880`, `client/contexts/AuthContext.tsx:87-103`, `client/api/client.ts:477-485` |

### `ClipSearchModal`

| Endpoint | Trigger | Payload sent | Response fields read now | Evidence |
|---|---|---|---|---|
| `POST /api/story/search-shot` | Search submit and initial auto-search from `initialQuery` | `{ sessionId, sentenceIndex, query, page: 1 }` | Unwraps response, then reads `shot.candidates`, `page`, and `hasMore`. Candidate cards read `id`, `thumbUrl`, `provider`, and `duration`. `hasMore` is stored in state but current UI does not render a "load more" control. | `client/screens/ClipSearchModal.tsx:49-80`, `client/screens/ClipSearchModal.tsx:107-145`, `client/api/client.ts:624-638` |
| `POST /api/story/update-shot` | User taps a candidate clip | `{ sessionId, sentenceIndex, clipId }` | Reads only `ok`, `success`, `message`; on success it simply closes the modal. Returned session data is ignored. | `client/screens/ClipSearchModal.tsx:83-104`, `client/api/client.ts:640-653` |

### `LibraryScreen`

| Endpoint | Trigger | Payload sent | Response fields read now | Evidence |
|---|---|---|---|---|
| `GET /api/shorts/mine?limit=24[&cursor=...]` | Initial load and explicit "Load More" press | No body; query string is `limit=24` and optional `cursor=<nextCursor>` | Reads `data.items`, `data.nextCursor`, `data.hasMore`. For each short card, reads `id`, `status`, `videoUrl`, `thumbUrl`, `coverImageUrl`, `quoteText`, `durationSec`, and `createdAt`. Only items with `status === "ready"` and `videoUrl` navigate through to detail. | `client/screens/LibraryScreen.tsx:80-118`, `client/screens/LibraryScreen.tsx:120-142`, `client/screens/LibraryScreen.tsx:168-245`, `client/api/client.ts:487-504`, `client/api/client.ts:265-289` |

### `ShortDetailScreen`

| Endpoint | Trigger | Payload sent | Response fields read now | Evidence |
|---|---|---|---|---|
| `GET /api/shorts/:id` | When route params contain `shortId` and not `short`; also manual retry; also auto-retry when detail lacks `videoUrl` | No body | On success, stores `ShortDetail`, then adapts it into a `ShortItem`-like object by reading `id`, `videoUrl`, `coverImageUrl`, `durationSec`, `usedQuote.text`, `usedTemplate`, and `createdAt`. `usedQuote.author` and `credits.before/after/cost` are defined in the client type but unused in the screen. Error path reads `ok`, `status`, `code`, `message`. | `client/screens/ShortDetailScreen.tsx:143-333`, `client/screens/ShortDetailScreen.tsx:335-380`, `client/screens/ShortDetailScreen.tsx:513-529`, `client/api/client.ts:291-307`, `client/api/client.ts:506-518` |
| `GET /api/shorts/mine?limit=50` | Fallback during post-render eventual consistency: every other 404 attempt while waiting for `/api/shorts/:id` to become available | No body; query string is `limit=50` | Reads `data.items`, then filters by `item.id === shortId && item.status === "ready" && item.videoUrl`. If found, swaps route params to `{ short }` and stops using `/api/shorts/:id`. | `client/screens/ShortDetailScreen.tsx:212-276`, `client/api/client.ts:487-504` |

Current `ShortDetailScreen` UI reads these fields from the resolved `short` object, whether it came from `LibraryScreen` or from the adapted detail response: `videoUrl`, `thumbUrl`, `coverImageUrl`, `quoteText`, `id`, `durationSec`, `template`, `mode`, `status`, and `createdAt` (`client/screens/ShortDetailScreen.tsx:382-425`, `client/screens/ShortDetailScreen.tsx:612-727`).

### `SettingsScreen`

| Endpoint | Trigger | Payload sent | Response fields read now | Evidence |
|---|---|---|---|---|
| `GET /api/credits` | "Refresh credits" button, via `refreshCredits()` | No body | Reads `data.credits` through `AuthContext`, then renders `userProfile?.credits` in the settings card. | `client/screens/SettingsScreen.tsx:42-58`, `client/screens/SettingsScreen.tsx:121-145`, `client/contexts/AuthContext.tsx:87-103`, `client/api/client.ts:477-485` |

## Live Endpoints Missing From `vaiform-mobile-spec-sheet`

These endpoints are live in the repo but are not listed in the spec sheet's canonical endpoint inventory.

| Endpoint | Current usage | Evidence |
|---|---|---|
| `POST /api/caption/preview` | Used by `StoryEditorScreen` through `useCaptionPreview` for server-measured caption raster previews and deck overlay placement. | `client/hooks/useCaptionPreview.ts:59-120`, `client/api/client.ts:342-454`, `client/screens/StoryEditorScreen.tsx:507-533` |
| `POST /api/story/update-caption-style` | Used by `StoryEditorScreen` to persist `overlayCaption.placement` and `yPct`. | `client/screens/StoryEditorScreen.tsx:765-820`, `client/api/client.ts:655-670` |

## Spec Endpoints Currently Unwired

These routes are present in `vaiform-mobile-spec-sheet` but have no current screen/context callsite in this repo.

| Spec endpoint | Current repo state | Evidence |
|---|---|---|
| `GET /api/user/me` | No wrapper in `client/api/client.ts`; no import/callsite in `client/`. | `vaiform-mobile-spec-sheet:112`, `vaiform-mobile-spec-sheet:243` |
| `POST /api/story/update-script` | No wrapper; no callsite. Current editing uses `POST /api/story/update-beat-text` instead. | `vaiform-mobile-spec-sheet:125` |
| `POST /api/story/insert-beat` | No wrapper; no callsite. | `vaiform-mobile-spec-sheet:127`, `vaiform-mobile-spec-sheet:770` |
| `GET /api/voice/voices` | No wrapper; no callsite. | `vaiform-mobile-spec-sheet:143`, `vaiform-mobile-spec-sheet:1072` |
| `POST /api/voice/preview` | No wrapper; no callsite. | `vaiform-mobile-spec-sheet:144`, `vaiform-mobile-spec-sheet:1126` |
| `POST /api/tts/preview` | No wrapper; no callsite. | `vaiform-mobile-spec-sheet:145`, `vaiform-mobile-spec-sheet:1186` |
| `GET /health` | Wrapper exists as `healthCheck()`, but there is no current caller. | `vaiform-mobile-spec-sheet:149`, `client/api/client.ts:237-239` |

## Screens With No Vaiform API Traffic

- `LoginScreen` has no direct Vaiform API call. It only invokes Firebase auth helpers from `AuthContext`; the first Vaiform API hit happens later in `AuthContext` via `POST /api/users/ensure` (`client/screens/LoginScreen.tsx`, `client/contexts/AuthContext.tsx:58-85`).
- `ProfileScreen` has no Vaiform API traffic (`client/screens/ProfileScreen.tsx`).
- `ModalScreen` has no Vaiform API traffic (`client/screens/ModalScreen.tsx`).

## Notes On Naming Mismatch In Shorts Detail

- The spec sheet names the detail route as `GET /api/shorts/:jobId` (`vaiform-mobile-spec-sheet:137`, `vaiform-mobile-spec-sheet:1024`).
- The current mobile client wrapper is `getShortDetail(id)` and calls `GET /api/shorts/${id}` (`client/api/client.ts:506-518`).
- Current screen code treats `short.id`, `shortId`, and the spec's `jobId` as the same identifier for navigation and fetch purposes (`client/screens/LibraryScreen.tsx:140-141`, `client/screens/StoryEditorScreen.tsx:887-891`, `client/screens/ShortDetailScreen.tsx:92-95`, `client/screens/ShortDetailScreen.tsx:233-248`).

## Launch-Critical Failure And Recovery Notes

- `POST /api/story/finalize` is the only current mobile route with mandatory idempotency. Missing
  `X-Idempotency-Key` returns `400 MISSING_IDEMPOTENCY_KEY`; concurrent replay returns
  `409 IDEMPOTENT_IN_PROGRESS`; insufficient credits returns `402 INSUFFICIENT_CREDITS`; render
  admission-control failure returns `503 SERVER_BUSY`; transport-level failures should recover by
  re-checking `GET /api/story/:sessionId` (`src/middleware/idempotency.firestore.js:33-84`,
  `src/routes/story.routes.js:819-855`).
- `POST /api/caption/preview` is already auth-required, body-limited to `200kb`, and rate-limited
  to `20/min` (`src/app.js:118-126`, `src/routes/caption.preview.routes.js:91-113`).
- `GET /api/shorts/:jobId` is currently important for mobile launch, but mobile already carries a
  fallback to `GET /api/shorts/mine` during eventual consistency or detail-route misses
  (`client/screens/ShortDetailScreen.tsx:212-276`). Backend hardening should remove the need for
  that fallback before launch.
- `POST /api/story/search`, `POST /api/story/search-shot`, and `POST /api/story/finalize` are
  mobile-core-now and still need focused route-level admission control beyond the existing script
  cap and render semaphore (`src/routes/story.routes.js:148`, `src/routes/story.routes.js:477`,
  `src/routes/story.routes.js:498`, `src/routes/story.routes.js:595`, `src/routes/story.routes.js:819`,
  `src/utils/render.semaphore.js:1-22`).
