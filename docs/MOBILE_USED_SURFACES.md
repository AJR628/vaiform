# MOBILE_USED_SURFACES

Cross-repo verification date: 2026-03-07.

Scope: exact current mobile repo behavior verified against the mounted backend. This file is about what the mobile app actually calls now, what it sends, what it reads, and where the current code already depends on fallbacks or config assumptions.

## Mobile-First Scope Freeze

Use this file before older spec docs when deciding what to harden for launch.

## Verified Route Buckets

### MOBILE_CORE_NOW

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

### MOBILE_CORE_SOON

- `POST /api/story/insert-beat`

### Not Mobile-First For Launch

- `LEGACY_WEB`: `POST /api/assets/options`, `POST /api/story/manual`, `POST /api/story/create-manual-session`, `POST /api/story/update-video-cuts`, `POST /api/story/update-caption-meta`, checkout routes, Stripe webhook.
- `REMOVE_LATER`: `POST /api/user/setup`, `GET /api/user/me`, `GET /api/whoami`, `GET /api/limits/usage`, `POST /api/story/update-script`, `POST /api/story/timeline`, `POST /api/story/captions`, `POST /api/story/render`.

## Cross-Repo Truth Notes

- Mobile auth requests are built in `client/api/client.ts` and include `Authorization: Bearer <Firebase ID token>`, `Content-Type: application/json`, and `x-client: mobile` when auth is available (`client/api/client.ts:124-177`, `client/api/client.ts:184-235`). Backend auth is enforced by `requireAuth` on all mobile-core routes (`src/middleware/requireAuth.js:5-19`, `src/routes/story.routes.js:32-33`).
- The backend mount for credits is `GET /api/credits` (`src/app.js:215-217`, `src/routes/credits.routes.js:7-11`), but the current mobile wrapper calls `"/credits"` relative to `EXPO_PUBLIC_API_BASE_URL` (`client/api/client.ts:478-484`). Repo code does not pin whether the runtime base URL already includes `/api`, so this is a verified path/config dependency, not a proven clean contract.
- The backend requires `X-Idempotency-Key` on `POST /api/story/finalize` (`src/middleware/idempotency.firestore.js:33-37`), but the current mobile finalize client does not set that header anywhere in repo code (`client/api/client.ts:679-703`). This is a launch-critical mismatch.
- The shorts detail backend route is mounted as `GET /api/shorts/:jobId` (`src/routes/shorts.routes.js:7-9`), but the current detail payload returns `jobId` while the mobile detail type and adapter expect `id` (`src/controllers/shorts.controller.js:123-134`, `src/controllers/shorts.controller.js:160-171`, `client/api/client.ts:291-307`, `client/screens/ShortDetailScreen.tsx:357-379`).

## Shared / Context-Mediated Surfaces

### Auth Bootstrap (`AuthContext`)

| Mobile caller | Backend mount | Trigger | Payload sent | Response fields mobile reads now | Verified notes |
| --- | --- | --- | --- | --- | --- |
| `POST /api/users/ensure` | `POST /api/users/ensure` | Firebase auth state change after sign-in; once per UID | No body | Stores the returned profile in context. Current screens only read `userProfile.credits`. Error path reads `ok`, `code`, `message`. | Backend existing-user response omits `plan`; mobile patches missing `plan` to `"free"` in the client wrapper (`src/routes/users.routes.js:51-59`, `src/routes/users.routes.js:80-87`, `client/api/client.ts:463-475`). |
| `GET /credits` | `GET /api/credits` | `refreshCredits()` from `SettingsScreen` and after successful finalize | No body | Reads `data.credits` only and merges it into `userProfile`. | This only aligns at runtime if `EXPO_PUBLIC_API_BASE_URL` already includes `/api`, or if another proxy path exists outside repo code. That config/proxy is not proven here (`client/contexts/AuthContext.tsx:87-103`, `client/api/client.ts:478-484`, `src/app.js:215-217`). |

## Screen-by-Screen Backend Usage

### `HomeScreen`

| Mobile caller | Backend mount | Trigger | Payload sent | Response fields mobile reads now | Verified notes |
| --- | --- | --- | --- | --- | --- |
| `POST /api/story/start` | `POST /api/story/start` | `runCreateFlow()` after local validation | `{ input: trimmedInput, inputType }`; current UI only sends `"link"` or `"idea"` | Reads `data.id` as `sessionId`. Error path reads `ok`, `code`, `message`. | Returned session payload is otherwise ignored here (`client/screens/HomeScreen.tsx:79-107`, `client/api/client.ts:524-537`, `src/routes/story.routes.js:118-145`). |
| `POST /api/story/generate` | `POST /api/story/generate` | Immediately after successful `/api/story/start` | `{ sessionId }` | Reads `ok`, `code`, `message` for control flow only. | Backend also accepts optional `input` and `inputType`, but current mobile caller does not send them (`client/screens/HomeScreen.tsx:109-127`, `client/api/client.ts:539-552`, `src/routes/story.routes.js:147-172`). |

### `ScriptScreen`

| Mobile caller | Backend mount | Trigger | Payload sent | Response fields mobile reads now | Verified notes |
| --- | --- | --- | --- | --- | --- |
| `GET /api/story/:sessionId` | `GET /api/story/:sessionId` | Initial load | No body | Unwraps `data`, then reads `story.sentences` with fallbacks to `sentences` and `beats`; also checks `shots` presence/length to decide whether to show the storyboard CTA. | Backend returns the full session envelope; mobile helper `extractBeats()` is intentionally defensive (`client/screens/ScriptScreen.tsx:64-96`, `client/lib/storySession.ts:14-19`, `client/lib/storySession.ts:25-52`, `src/routes/story.routes.js:1002-1024`). |
| `POST /api/story/plan` | `POST /api/story/plan` | "Generate Storyboard" CTA, step 1 | `{ sessionId }` | Reads only `ok` and `message`. | Returned session is ignored (`client/screens/ScriptScreen.tsx:126-159`, `client/api/client.ts:557-565`, `src/routes/story.routes.js:476-495`). |
| `POST /api/story/search` | `POST /api/story/search` | "Generate Storyboard" CTA, step 2 | `{ sessionId }` | Reads only `ok` and `message`. | Returned session is ignored (`client/screens/ScriptScreen.tsx:141-159`, `client/api/client.ts:570-578`, `src/routes/story.routes.js:497-516`). |
| `POST /api/story/update-beat-text` | `POST /api/story/update-beat-text` | Saving an edited beat | `{ sessionId, sentenceIndex, text: cleaned }` | Stores the returned payload, then re-reads beats through `extractBeats()`. | Backend returns partial `{ sentences, shots }`, not a full session; this works only because `extractBeats()` falls back to top-level `sentences` (`client/screens/ScriptScreen.tsx:162-209`, `client/lib/storySession.ts:25-49`, `src/routes/story.routes.js:698-715`, `src/services/story.service.js:670-700`). |
| `POST /api/story/delete-beat` | `POST /api/story/delete-beat` | Delete confirmation | `{ sessionId, sentenceIndex }` | Reads only `ok`, `success`, `message`; then refetches `GET /api/story/:sessionId`. | Mobile already treats the mutation response as non-SSOT (`client/screens/ScriptScreen.tsx:222-235`, `client/api/client.ts:610-621`, `src/routes/story.routes.js:664-689`). |

### `StoryEditorScreen`

| Mobile caller | Backend mount | Trigger | Payload sent | Response fields mobile reads now | Verified notes |
| --- | --- | --- | --- | --- | --- |
| `GET /api/story/:sessionId` | `GET /api/story/:sessionId` | Initial load and focus refresh after clip replacement or beat deletion | No body | Reads beats from `story.sentences` via helper fallbacks, reads `shots`, reads `overlayCaption.placement`, reads `shot.selectedClip.thumbUrl`, and reads `shot.searchQuery` when opening clip search. | This screen does not currently read `finalVideo` from the session object (`client/screens/StoryEditorScreen.tsx:367-449`, `client/screens/StoryEditorScreen.tsx:457-516`, `client/screens/StoryEditorScreen.tsx:704-712`, `client/api/client.ts:583-590`, `src/routes/story.routes.js:1002-1024`). |
| `POST /api/caption/preview` | `POST /api/caption/preview` | Selected-beat preview and beat prefetch via `useCaptionPreview` | `{ ssotVersion: 3, mode: "raster", measure: "server", text, frameW: 1080, frameH: 1920, placement, yPct }`; current screen does not pass `style` | Reads `data.meta.rasterUrl`, `rasterW`, `rasterH`, `yPx_png`, and `frameW`; deck rendering checks `xPx_png` if present and otherwise centers the overlay. | The current server-measured backend path returns `xExpr_png`, not `xPx_png`, so mobile is currently using its centering fallback rather than a server X coordinate (`client/hooks/useCaptionPreview.ts:95-120`, `client/screens/StoryEditorScreen.tsx:175-186`, `client/screens/StoryEditorScreen.tsx:229-245`, `src/routes/caption.preview.routes.js:262-310`). |
| `POST /api/story/update-beat-text` | `POST /api/story/update-beat-text` | Saving the currently selected beat | `{ sessionId, sentenceIndex, text: draft }` | Reads only `ok`, `success`, `message`; on success it updates local state and ignores the returned payload. | Backend still returns partial `{ sentences, shots }`, but this screen does not consume it (`client/screens/StoryEditorScreen.tsx:679-701`, `client/api/client.ts:595-605`, `src/routes/story.routes.js:707-714`). |
| `POST /api/story/delete-beat` | `POST /api/story/delete-beat` | Delete confirmation from beat actions modal | `{ sessionId, sentenceIndex: deletedIndex }` | Reads only `ok`, `success`, `message`; then refetches `GET /api/story/:sessionId` and rebuilds local state from that. | Mobile again treats the mutation response as non-SSOT (`client/screens/StoryEditorScreen.tsx:715-749`, `client/api/client.ts:610-621`, `src/routes/story.routes.js:664-689`). |
| `POST /api/story/update-caption-style` | `POST /api/story/update-caption-style` | User taps Top / Center / Bottom placement | `{ sessionId, overlayCaption: { placement, yPct } }` | Reads only `ok`, `success`, `message`; it does not consume returned `overlayCaption`. | Current mobile usage is placement-only even though backend accepts a larger style subset (`client/screens/StoryEditorScreen.tsx:765-820`, `client/api/client.ts:658-669`, `src/routes/story.routes.js:207-283`). |
| `POST /api/story/finalize` | `POST /api/story/finalize` | Render confirmation | `{ sessionId }` | Reads `ok`, `retryAfter`, `code`, `status`, `message`, and `shortId`. It does not read `data`. | Backend requires `X-Idempotency-Key`, but the current mobile caller does not send it. On success, mobile refreshes credits and navigates with `{ shortId }` to library detail (`client/screens/StoryEditorScreen.tsx:834-911`, `client/api/client.ts:676-760`, `src/middleware/idempotency.firestore.js:33-37`, `src/routes/story.routes.js:818-856`). |
| `GET /credits` | `GET /api/credits` | Indirect, after successful finalize, through `refreshCredits()` | No body | Reads `data.credits` through `AuthContext`. | Same path/config caveat as Settings applies (`client/screens/StoryEditorScreen.tsx:875-880`, `client/contexts/AuthContext.tsx:87-103`, `client/api/client.ts:478-484`). |

### `ClipSearchModal`

| Mobile caller | Backend mount | Trigger | Payload sent | Response fields mobile reads now | Verified notes |
| --- | --- | --- | --- | --- | --- |
| `POST /api/story/search-shot` | `POST /api/story/search-shot` | Search submit and initial auto-search from `initialQuery` | `{ sessionId, sentenceIndex, query, page: 1 }` | Reads `shot.candidates`, `page`, and `hasMore`. Candidate cards read `id`, `thumbUrl`, `provider`, and `duration`. | Backend returns exactly `{ shot, page, hasMore }`. `hasMore` is stored but current UI does not render pagination (`client/screens/ClipSearchModal.tsx:49-80`, `client/screens/ClipSearchModal.tsx:117-165`, `src/routes/story.routes.js:594-633`, `src/services/story.service.js:468-523`). |
| `POST /api/story/update-shot` | `POST /api/story/update-shot` | User taps a candidate clip | `{ sessionId, sentenceIndex, clipId }` | Reads only `ok`, `success`, `message`; on success it closes the modal. | Backend returns `{ shots }`, but the screen ignores it (`client/screens/ClipSearchModal.tsx:83-104`, `client/api/client.ts:643-652`, `src/routes/story.routes.js:518-545`, `src/services/story.service.js:528-550`). |

### `LibraryScreen`

| Mobile caller | Backend mount | Trigger | Payload sent | Response fields mobile reads now | Verified notes |
| --- | --- | --- | --- | --- | --- |
| `GET /api/shorts/mine?limit=24[&cursor=...]` | `GET /api/shorts/mine` | Initial load and explicit "Load More" | No body; query string carries `limit` and optional `cursor` | Reads `data.items`, `data.nextCursor`, and `data.hasMore`. Each card reads `id`, `status`, `videoUrl`, `thumbUrl`, `coverImageUrl`, `quoteText`, `durationSec`, and `createdAt`. | Only items with `status === "ready"` and `videoUrl` are allowed into detail (`client/screens/LibraryScreen.tsx:80-142`, `client/screens/LibraryScreen.tsx:168-245`, `client/api/client.ts:492-504`, `src/controllers/shorts.controller.js:5-90`). |

### `ShortDetailScreen`

| Mobile caller | Backend mount | Trigger | Payload sent | Response fields mobile reads now | Verified notes |
| --- | --- | --- | --- | --- | --- |
| `GET /api/shorts/:id` | `GET /api/shorts/:jobId` | Post-render navigation when params contain `shortId` and not `short`; also manual retry and auto-retry | No body | Mobile success path expects `id`, `videoUrl`, `coverImageUrl`, `durationSec`, `usedQuote.text`, `usedTemplate`, and `createdAt`. Error path reads `ok`, `status`, `code`, `message`. | Backend currently returns `jobId`, not `id`, and also probes `short.mp4` / `cover.jpg` / `meta.json` while story finalize writes `story.mp4` / `thumb.jpg`. This makes the direct detail path structurally mismatched even before fallback logic runs (`client/screens/ShortDetailScreen.tsx:143-333`, `client/screens/ShortDetailScreen.tsx:357-379`, `client/api/client.ts:291-307`, `src/controllers/shorts.controller.js:104-171`, `src/services/story.service.js:1921-1945`). |
| `GET /api/shorts/mine?limit=50` | `GET /api/shorts/mine` | Fallback during post-render 404 retries | No body; query string is `limit=50` | Reads `data.items`, then filters for `item.id === shortId && item.status === "ready" && item.videoUrl`. | When fallback finds a ready list item, the screen swaps route params to `{ short }` and stops depending on the detail route (`client/screens/ShortDetailScreen.tsx:212-276`, `client/api/client.ts:492-504`). |

Current `ShortDetailScreen` UI reads these fields from the resolved `short` object: `videoUrl`, `thumbUrl`, `coverImageUrl`, `quoteText`, `id`, `durationSec`, `template`, `mode`, `status`, and `createdAt` (`client/screens/ShortDetailScreen.tsx:382-425`, `client/screens/ShortDetailScreen.tsx:612-727`). That shape is naturally satisfied by list items, not by the current direct detail payload.

### `SettingsScreen`

| Mobile caller | Backend mount | Trigger | Payload sent | Response fields mobile reads now | Verified notes |
| --- | --- | --- | --- | --- | --- |
| `GET /credits` | `GET /api/credits` | "Refresh credits" button through `refreshCredits()` | No body | Reads `data.credits` through `AuthContext`, then renders `userProfile?.credits`. | Same path/config caveat as the shared auth surface applies (`client/screens/SettingsScreen.tsx:42-58`, `client/screens/SettingsScreen.tsx:121-145`, `client/contexts/AuthContext.tsx:87-103`, `client/api/client.ts:478-484`, `src/app.js:215-217`). |

## Live Endpoints Missing From `vaiform-mobile-spec-sheet`

These endpoints are live in code and currently used by mobile, but they are not part of the older spec sheet's canonical endpoint inventory.

- `POST /api/caption/preview` (`client/hooks/useCaptionPreview.ts:95-120`, `client/api/client.ts:426-454`)
- `POST /api/story/update-caption-style` (`client/screens/StoryEditorScreen.tsx:765-820`, `client/api/client.ts:658-669`)

## Spec Endpoints Currently Unwired In Mobile

These appear in the older spec materials but have no current screen/context caller in the mobile repo.

- `GET /api/user/me`
- `POST /api/story/update-script`
- `POST /api/story/insert-beat`
- `GET /api/voice/voices`
- `POST /api/voice/preview`
- `POST /api/tts/preview`
- `GET /health` (wrapper exists as `healthCheck()`, but no current caller)

## Launch-Critical Failure And Recovery Notes

- `POST /api/story/finalize` is the only current mobile route whose backend contract requires an idempotency header. Backend behavior is clear; current mobile compliance is not. This mismatch must be resolved before launch (`src/middleware/idempotency.firestore.js:33-84`, `client/api/client.ts:679-703`).
- `POST /api/caption/preview` is already auth-required, parser-limited to `200kb`, and rate-limited to `20/min` (`src/app.js:118-126`, `src/routes/caption.preview.routes.js:91-113`).
- `GET /api/shorts/:jobId` is currently not a clean SSOT route for post-render mobile navigation. The screen already carries a list-route fallback because detail can 404 and, even when it resolves, the payload shape and storage filenames drift from current story outputs (`client/screens/ShortDetailScreen.tsx:203-303`, `src/controllers/shorts.controller.js:104-171`, `src/services/story.service.js:1921-1945`).
- `POST /api/story/search`, `POST /api/story/search-shot`, `POST /api/story/update-shot`, `POST /api/story/delete-beat`, and `POST /api/story/update-beat-text` are live mobile routes whose service-level domain failures still collapse into generic 500s today (`src/routes/story.routes.js:497-725`, `src/services/story.service.js:427-550`, `src/services/story.service.js:628-700`).
