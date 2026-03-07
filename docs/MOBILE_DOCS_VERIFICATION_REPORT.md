# MOBILE_DOCS_VERIFICATION_REPORT

Cross-repo verification date: 2026-03-07.

Purpose: verify the mobile-first truth docs against actual code in both repos:

- Mobile frontend: `C:\Users\ajrhe\OneDrive\Desktop\vaiform-mobile-ed4c17b4253fd8138e52349f5468ac1cc794cbe1`
- Backend: `C:\Users\ajrhe\OneDrive\Desktop\vaiform-1`

Verified docs in this pass:

- `docs/MOBILE_USED_SURFACES.md`
- `docs/MOBILE_BACKEND_CONTRACT.md`
- `docs/MOBILE_HARDENING_PLAN.md`
- `docs/LEGACY_WEB_SURFACES.md`

## Verification Method

For each important mobile endpoint/flow, this pass traced:

- mobile screen/hook/context/client
- backend route
- backend controller/service/middleware
- persistence/output
- mobile response reader

Primary focus was `MOBILE_CORE_NOW`:

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

## Doc Claims That Were Proven True

- `VERIFIED`: Mobile auth bootstrap is driven by `AuthContext` calling `ensureUser()` after Firebase sign-in, and current screens only rely on the returned credits field.
  - Mobile evidence: `client/contexts/AuthContext.tsx:63-76`
  - Backend evidence: `src/routes/users.routes.js:15-92`

- `VERIFIED`: `HomeScreen` uses `POST /api/story/start` then `POST /api/story/generate`, and only reads `data.id` from the start response.
  - Mobile evidence: `client/screens/HomeScreen.tsx:79-127`, `client/api/client.ts:524-552`
  - Backend evidence: `src/routes/story.routes.js:118-172`, `src/services/story.service.js:88-156`

- `VERIFIED`: `ScriptScreen` and `StoryEditorScreen` both use `GET /api/story/:sessionId` as the canonical session truth path.
  - Mobile evidence: `client/screens/ScriptScreen.tsx:64-84`, `client/screens/StoryEditorScreen.tsx:367-449`
  - Backend evidence: `src/routes/story.routes.js:1002-1024`, `src/services/story.service.js:118-120`

- `VERIFIED`: `ClipSearchModal` uses `POST /api/story/search-shot` to read `{ shot, page, hasMore }` and `POST /api/story/update-shot` only for success/failure control flow.
  - Mobile evidence: `client/screens/ClipSearchModal.tsx:49-104`
  - Backend evidence: `src/routes/story.routes.js:518-545`, `src/routes/story.routes.js:594-633`, `src/services/story.service.js:468-550`

- `VERIFIED`: Caption preview is a live mobile route and the current mobile screen sends the server-measured raster request shape.
  - Mobile evidence: `client/hooks/useCaptionPreview.ts:95-120`, `client/api/client.ts:394-454`
  - Backend evidence: `src/routes/caption.preview.routes.js:70-87`, `src/routes/caption.preview.routes.js:131-313`

- `VERIFIED`: Library list is backed by `GET /api/shorts/mine`, and card rendering depends on `id`, `status`, `videoUrl`, `thumbUrl` or `coverImageUrl`, `quoteText`, `durationSec`, and `createdAt`.
  - Mobile evidence: `client/screens/LibraryScreen.tsx:80-142`, `client/screens/LibraryScreen.tsx:168-245`
  - Backend evidence: `src/controllers/shorts.controller.js:12-46`

## Doc Claims That Needed Correction

- `CORRECTED`: The docs previously treated `GET /api/credits` as the proven current mobile caller path.
  - What code proved instead: the backend mount is `/api/credits`, but the current mobile wrapper calls `"/credits"` relative to `EXPO_PUBLIC_API_BASE_URL`.
  - Mobile evidence: `client/api/client.ts:478-484`
  - Backend evidence: `src/app.js:215-217`, `src/routes/credits.routes.js:7-11`
  - Doc update made: the docs now distinguish mobile caller path from mounted backend path and mark this as a config/proxy dependency instead of a settled contract.

- `CORRECTED`: The docs previously treated finalize idempotency as if mobile was already satisfying it.
  - What code proved instead: backend requires `X-Idempotency-Key`, but the current mobile finalize client does not set it anywhere.
  - Mobile evidence: `client/api/client.ts:679-703`
  - Backend evidence: `src/middleware/idempotency.firestore.js:33-37`, `src/routes/story.routes.js:818-856`
  - Doc update made: the docs now explicitly mark this as a launch-critical mismatch, not just a backend rule.

- `CORRECTED`: The docs previously described `POST /api/story/update-beat-text` too loosely as if it returned a full session.
  - What code proved instead: backend returns partial `{ sentences, shots }`; `ScriptScreen` only survives because `extractBeats()` falls back to top-level `sentences`.
  - Mobile evidence: `client/screens/ScriptScreen.tsx:184-195`, `client/lib/storySession.ts:25-49`
  - Backend evidence: `src/routes/story.routes.js:707-714`, `src/services/story.service.js:670-700`
  - Doc update made: the docs now call out the partial payload explicitly.

- `CORRECTED`: The docs previously implied `GET /api/story/:sessionId` was currently used to read `finalVideo` in mobile flows.
  - What code proved instead: current `StoryEditorScreen` reads beats, shots, `overlayCaption.placement`, selected clip thumbs, and `searchQuery`; it does not currently read `finalVideo` from that screen.
  - Mobile evidence: `client/screens/StoryEditorScreen.tsx:367-449`, `client/screens/StoryEditorScreen.tsx:457-516`, `client/screens/StoryEditorScreen.tsx:704-712`
  - Backend evidence: `src/routes/story.routes.js:1002-1024`
  - Doc update made: the contract doc now reflects only the fields the current mobile screen actually reads.

- `CORRECTED`: The docs previously under-described the shorts detail mismatch.
  - What code proved instead: backend detail returns `jobId`, not `id`, while the mobile detail type and adapter expect `id`.
  - Mobile evidence: `client/api/client.ts:291-307`, `client/screens/ShortDetailScreen.tsx:357-379`
  - Backend evidence: `src/controllers/shorts.controller.js:123-134`, `src/controllers/shorts.controller.js:160-171`
  - Doc update made: the docs now mark this as a concrete payload mismatch, not just a naming quirk.

- `CORRECTED`: The docs previously mentioned shorts detail fallback, but did not state the full storage-name drift precisely enough.
  - What code proved instead: shorts detail probes `short.mp4`, `cover.jpg`, and `meta.json`, but story finalize writes `story.mp4` and `thumb.jpg`.
  - Mobile evidence: `client/screens/ShortDetailScreen.tsx:203-303`
  - Backend evidence: `src/controllers/shorts.controller.js:104-158`, `src/services/story.service.js:1921-1945`
  - Doc update made: the docs now call this out as direct route drift on the current mobile launch path.

- `CORRECTED`: The docs previously implied caption preview might directly use a server-returned X coordinate in the current mobile path.
  - What code proved instead: the deck card checks `xPx_png`, but the server-measured backend response currently returns `xExpr_png`; mobile falls back to centered overlay math.
  - Mobile evidence: `client/screens/StoryEditorScreen.tsx:181-185`, `client/hooks/useCaptionPreview.ts:95-120`
  - Backend evidence: `src/routes/caption.preview.routes.js:262-310`
  - Doc update made: the docs now describe the current centered fallback accurately.

## Open Mismatches That Need Code Changes Later

- `NEEDS FOLLOW-UP`: Finalize idempotency header mismatch.
  - Route classification: `MOBILE_CORE_NOW`
  - Mobile caller(s): `client/screens/StoryEditorScreen.tsx:834-911`, `client/api/client.ts:679-703`
  - Backend handler(s): `src/middleware/idempotency.firestore.js:33-37`, `src/routes/story.routes.js:818-856`
  - Contract mismatch or risk: backend requires `X-Idempotency-Key`; mobile does not send it.
  - Why it matters to mobile launch: can hard-fail current mobile render requests.
  - Minimal fix: send a stable per-render idempotency key from mobile.
  - Docs already updated: yes

- `NEEDS FOLLOW-UP`: Credits path mismatch.
  - Route classification: `MOBILE_CORE_NOW`
  - Mobile caller(s): `client/api/client.ts:478-484`
  - Backend handler(s): `src/app.js:215-217`, `src/routes/credits.routes.js:7-11`
  - Contract mismatch or risk: current mobile path is `"/credits"`; mounted backend path is `/api/credits`.
  - Why it matters to mobile launch: route correctness currently depends on unverified env or proxy behavior.
  - Minimal fix: align path usage or explicitly pin base URL convention.
  - Docs already updated: yes

- `NEEDS FOLLOW-UP`: Shorts detail identifier mismatch.
  - Route classification: `MOBILE_CORE_NOW`
  - Mobile caller(s): `client/screens/ShortDetailScreen.tsx:357-379`
  - Backend handler(s): `src/controllers/shorts.controller.js:123-134`, `src/controllers/shorts.controller.js:160-171`
  - Contract mismatch or risk: backend returns `jobId`; mobile expects `id`.
  - Why it matters to mobile launch: direct detail responses are not shape-compatible with the current mobile adapter.
  - Minimal fix: return `id` in detail payload, or adapt mobile to `jobId` deliberately.
  - Docs already updated: yes

- `NEEDS FOLLOW-UP`: Shorts detail storage-name drift.
  - Route classification: `MOBILE_CORE_NOW`
  - Mobile caller(s): `client/screens/ShortDetailScreen.tsx:203-303`
  - Backend handler(s): `src/controllers/shorts.controller.js:104-158`, `src/services/story.service.js:1921-1945`
  - Contract mismatch or risk: detail probes old filenames; finalize writes new filenames.
  - Why it matters to mobile launch: forces retry/fallback behavior for post-render detail.
  - Minimal fix: make detail resolve the actual current story artifact names.
  - Docs already updated: yes

- `NEEDS FOLLOW-UP`: Mobile editor mutations still collapse service-level domain errors into generic 500s.
  - Route classification: `MOBILE_CORE_NOW`
  - Mobile caller(s): `client/screens/ScriptScreen.tsx:162-235`, `client/screens/ClipSearchModal.tsx:49-104`, `client/screens/StoryEditorScreen.tsx:679-820`
  - Backend handler(s): `src/routes/story.routes.js:497-725`, `src/services/story.service.js:427-550`, `src/services/story.service.js:628-700`
  - Contract mismatch or risk: mobile cannot distinguish bad session state from real server faults.
  - Why it matters to mobile launch: retry/recovery semantics stay ambiguous.
  - Minimal fix: map known service errors to stable 400/404 responses.
  - Docs already updated: yes

## Remaining Uncertainties

- `NEEDS FOLLOW-UP`: Whether the current mobile runtime base URL already includes `/api`.
  - Repo evidence: no `.env` or `.env.local` file in the mobile repo root during this pass; only the code-level `EXPO_PUBLIC_API_BASE_URL` reference is present (`client/api/client.ts:5-7`).
  - Impact: docs can prove code-level path construction, but not the actual deployed env value from repo state alone.

## Docs Updated In This Pass

- `docs/MOBILE_USED_SURFACES.md`
  - corrected caller-vs-mount path truth for credits
  - corrected finalize idempotency truth
  - corrected update-beat-text partial payload description
  - corrected shorts detail payload/storage caveats
  - corrected caption preview X-coordinate caveat

- `docs/MOBILE_BACKEND_CONTRACT.md`
  - added explicit open contract mismatch section
  - corrected current mobile read-fields per route
  - corrected finalize request rules and credits path truth
  - corrected shorts detail contract details

- `docs/MOBILE_HARDENING_PLAN.md`
  - reordered Phase 0 around the proven launch blockers from code
  - replaced the incorrect “normalize to `/api/credits`” claim with a real path-resolution task
  - added finalize idempotency mismatch as the top blocker

- `docs/LEGACY_WEB_SURFACES.md`
  - re-verified current legacy-web caller evidence
  - tightened the wording around `REMOVE_LATER` to match the actual repo search outcome from this pass
