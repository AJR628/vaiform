# SCRIPT_CONTROL_PREIMPLEMENTATION_AUDIT

- Status: CANONICAL
- Owner repo: backend
- Source of truth for: pre-code freeze on script-quality control ownership, current contracts, and the first safe implementation slice
- Canonical counterpart/source: mobile repo `docs/DOCS_INDEX.md`, mobile repo `docs/MOBILE_USED_SURFACES.md`, backend repo `docs/MOBILE_BACKEND_CONTRACT.md`, backend repo `docs/MOBILE_HARDENING_PLAN.md`, backend repo `docs/LEGACY_WEB_SURFACES.md`
- Last verified against: both repos on 2026-03-25

## Purpose

This document freezes repo-proven truth before any script-quality runtime work starts.

It is intentionally conservative:

- no runtime code changes
- no new route family
- no new model field
- no beat-remix implementation
- no UI work in this pass

## Proven Current Truth

### Canonical backend owner

- The current mounted backend owner for story creation, generation, and beat editing is `/api/story`, not `/api/studio`.
  - Backend mount: `src/app.js:244-246`
  - Router export: `src/routes/index.js:8-18`
  - Story router auth gate: `src/routes/story.routes.js:35-36`
- Current backend handlers:
  - `POST /api/story/start`: `src/routes/story.routes.js:204-231`
  - `POST /api/story/generate`: `src/routes/story.routes.js:233-268`
  - `POST /api/story/update-beat-text`: `src/routes/story.routes.js:833-871`
- I checked the current backend route inventory and mount file for `/api/studio` and found no mounted `/api/studio` authoring surface in the live app path.
  - Checked: `src/app.js:217-267`, `src/routes/index.js:1-19`

### Canonical mobile callers

- The Home/create flow calls `/api/story/start` and then `/api/story/generate`.
  - Screen flow: mobile `client/screens/HomeScreen.tsx:79-127`
  - Transport wrappers: mobile `client/api/client.ts:607-632`
- `ScriptScreen` is the current script-phase caller.
  - Session load: mobile `client/screens/ScriptScreen.tsx:64-84`
  - Storyboard build transition: mobile `client/screens/ScriptScreen.tsx:126-159`
  - Beat save: mobile `client/screens/ScriptScreen.tsx:162-209`
  - Beat delete: mobile `client/screens/ScriptScreen.tsx:222-235`
- `StoryEditorScreen` is the current beat-action owner for storyboard state.
  - Screen composition: mobile `client/screens/StoryEditorScreen.tsx:72-110`
  - Replace-clip action passes `shot.searchQuery` into clip search: mobile `client/screens/StoryEditorScreen.tsx:241-250`
  - Session load/save/delete owner: mobile `client/screens/story-editor/useStoryEditorSession.ts:36-78`, mobile `client/screens/story-editor/useStoryEditorSession.ts:131-231`
  - Clip search modal callers: mobile `client/screens/ClipSearchModal.tsx:49-104`
  - Beat actions UI currently exposes Replace Clip and Delete Beat only: mobile `client/components/story-editor/BeatActionsModal.tsx:42-80`
- The active mobile transport owner is the hand-written API client.
  - Normalized request path, auth, and headers: mobile `client/api/client.ts:223-289`
  - Current authenticated requests send `Authorization: Bearer <Firebase ID token>`, `Content-Type: application/json`, and `x-client: mobile`: mobile `client/api/client.ts:231-241`

### `styleKey` existence and current wiring

- `styleKey` exists in mobile transport typing for `storyStart(...)`.
  - mobile `client/api/client.ts:607-617`
- The current Home UI does not send `styleKey`; it sends only `{ input, inputType }`.
  - mobile `client/screens/HomeScreen.tsx:84-88`
- The backend input contract for `POST /api/story/start` accepts `styleKey` and constrains it to `default | hype | cozy`.
  - `src/routes/story.routes.js:188-192`
  - `src/routes/story.routes.js:204-218`
- Session creation stores `styleKey` in session state.
  - `src/services/story.service.js:486-511`
- Story generation reads `session.styleKey` and passes it into the generation service.
  - `src/services/story.service.js:524-565`
- Prompt construction uses that style selection when building the script-generation prompt.
  - style lookup: `src/services/story.llm.service.js:223-227`
  - prompt injection: `src/services/story.llm.service.js:320-323`

### Exact current `update-beat-text` contract

- Current request shape:
  - mobile transport: `{ sessionId, sentenceIndex, text }` in mobile `client/api/client.ts:675-684`
  - backend schema: `src/routes/story.routes.js:834-838`
- Current route behavior:
  - route calls service and returns only `{ sentences, shots }`: `src/routes/story.routes.js:840-856`
  - standard success envelope remains `{ success: true, data, requestId }`: `src/http/respond.js:14-17`
- Current service mutation behavior:
  - updates `session.story.sentences[sentenceIndex]`: `src/services/story.service.js:1131-1139`
  - updates `shot.searchQuery = text` when a shot exists: `src/services/story.service.js:1141-1145`
  - does not mutate `selectedClip` or `candidates`: `src/services/story.service.js:1141-1145`
  - does not touch `visualDescription`: checked current implementation at `src/services/story.service.js:1126-1161`
- Current response shape is partial, not full-session:
  - service return: `src/services/story.service.js:1157-1160`
  - route return: `src/routes/story.routes.js:849-856`

### Current client handling of `update-beat-text`

- `ScriptScreen` now treats beat-save as success/failure only, keeps the edited sentence text visible locally, and then refetches `GET /api/story/:sessionId` for session SSOT.
  - save path: mobile `client/screens/ScriptScreen.tsx:174-236`
- `StoryEditor` treats beat-save as success/failure only and then refetches `GET /api/story/:sessionId`.
  - save path: mobile `client/screens/story-editor/useStoryEditorSession.ts:160-176`
- The mobile transport wrapper now types `storyUpdateBeatText(...)` to the live partial payload `{ sentences, shots }` instead of `StorySession`.
  - typed wrapper: mobile `client/api/client.ts:672-689`
  - backend return: `src/routes/story.routes.js:840-856`, `src/services/story.service.js:1157-1160`
- Result: both mobile screens now converge on refetch-after-save session SSOT without widening the backend contract.

### Visual-intent separation and current mutation state

- Visual planning currently exists as separate backend-owned fields.
  - visual plan output includes `visualDescription` and `searchQuery`: `src/services/story.llm.service.js:674-799`
  - clip search for the whole storyboard uses planned `shot.searchQuery`: `src/services/story.service.js:878-890`
- Current single-shot clip replacement also uses `shot.searchQuery` as the initial query.
  - mobile `client/screens/StoryEditorScreen.tsx:243-250`
  - backend single-shot fallback order is `query?.trim() || shot.searchQuery || sentence text`: `src/services/story.service.js:931-949`
- Current beat text edits no longer mutate later visual search intent; beat-save preserves `shot.searchQuery` while still updating narration text.
  - checked current service implementation: `src/services/story.service.js:1126-1157`
- I did not find current beat-edit code mutating `visualDescription`, `selectedClip`, or `candidates`.
  - checked current service implementation: `src/services/story.service.js:1126-1157`

### Remix / rewrite surface check

- I did not find a mounted story-specific remix endpoint or current mobile remix caller in the current repos.
  - Current story routes checked: `src/routes/story.routes.js:204-301`, `src/routes/story.routes.js:572-871`, `src/routes/story.routes.js:1038-1183`
  - Current mobile callsites checked: mobile `client/screens/HomeScreen.tsx`, mobile `client/screens/ScriptScreen.tsx`, mobile `client/screens/StoryEditorScreen.tsx`, mobile `client/screens/story-editor/useStoryEditorSession.ts`, mobile `client/screens/ClipSearchModal.tsx`, mobile `client/api/client.ts:603-754`
- Mounted but currently unwired story-edit surfaces do exist:
  - whole-script update route: `src/routes/story.routes.js:270-301`
  - insert-beat route: `src/routes/story.routes.js:773-800`
- Search hits for `remix` / `rewrite` in the current backend were either:
  - unrelated quote-plan limits/schema surfaces, not story authoring: `src/controllers/limits.controller.js:44`, `src/schemas/quotes.schema.js:11-40`
  - internal LLM self-rewrite wording inside script generation, not a product route: `src/services/story.llm.service.js:469-557`
- Current mobile UI does not expose story remix; the beat actions modal exposes Replace Clip and Delete Beat only.
  - mobile `client/components/story-editor/BeatActionsModal.tsx:42-80`

### Relevant SSOT docs for these surfaces

- Backend docs ownership front door: `docs/DOCS_INDEX.md:9-44`
- Backend contract truth for mobile-used routes: `docs/MOBILE_BACKEND_CONTRACT.md:66-188`
- Backend hardening ledger: `docs/MOBILE_HARDENING_PLAN.md:79-120`
- Backend legacy-surface classification for unused overlaps like `update-script`: `docs/LEGACY_WEB_SURFACES.md:33-45`
- Mobile docs ownership front door: mobile `docs/DOCS_INDEX.md:17-29`, mobile `docs/DOCS_INDEX.md:52-67`
- Mobile caller truth: mobile `docs/MOBILE_USED_SURFACES.md:13-18`, mobile `docs/MOBILE_USED_SURFACES.md:32-59`

## Frozen V1 Policy

### A. `styleKey` is the sanctioned v1 script-lens hook

- Frozen policy:
  - Reuse the existing `styleKey` field for v1 pre-generation script-lens control.
- Repo proof:
  - `styleKey` already exists in mobile transport typing, backend request validation, session storage, generation service wiring, and prompt construction, and Home now conditionally sends it on `storyStart(...)` when a user explicitly selects a lens.
  - Evidence: mobile `client/api/client.ts:607-618`, mobile `client/screens/HomeScreen.tsx:89-123`, `src/routes/story.routes.js:188-218`, `src/services/story.service.js:486-552`, `src/services/story.llm.service.js:223-227`, `src/services/story.llm.service.js:320-323`
- Phase 1 implication:
  - Do not add a second lens field or parallel script-style control path.
  - Keep the current backend enum `default | hype | cozy` for v1.

### B. `update-beat-text` remains a partial-response contract

- Frozen policy:
  - Keep `POST /api/story/update-beat-text` as a partial-response route that returns `{ sentences, shots }` inside the standard success envelope.
- Repo proof:
  - Live route and service already return only `{ sentences, shots }`, not a full session.
  - Evidence: `src/routes/story.routes.js:840-856`, `src/services/story.service.js:1157-1160`, `src/http/respond.js:14-17`
- Phase 1 implication:
  - Normalize clients around the existing contract.
  - Do not widen this route into a full-session response in Phase 1.

### C. Both screens refetch session SSOT after beat-save

- Frozen policy:
  - `ScriptScreen` and `StoryEditor` must both converge on refetch-after-save session SSOT.
- Repo proof:
  - `ScriptScreen` and `StoryEditor` both now treat beat-save as success/failure only and refetch `GET /api/story/:sessionId` after save.
  - Evidence: mobile `client/screens/ScriptScreen.tsx:174-236`, mobile `client/screens/story-editor/useStoryEditorSession.ts:160-176`, mobile `client/api/client.ts:672-689`
- Phase 1 implication:
  - Remove split client normalization logic instead of broadening backend response shape.
  - Treat the current mobile transport typing drift as a bug to narrow, not as proof that the backend should expand.

### D. Beat-save must stop mutating `shot.searchQuery`

- Frozen policy:
  - Beat narration edits must not overwrite stored visual search intent in v1.
- Repo proof:
  - Visual planning is already modeled with separate `visualDescription` and `searchQuery` fields; clip replacement seeds from `shot.searchQuery`; beat-save now preserves `shot.searchQuery` while updating narration text.
  - Evidence: `src/services/story.llm.service.js:674-799`, `src/services/story.service.js:931-949`, `src/services/story.service.js:1126-1157`, mobile `client/screens/StoryEditorScreen.tsx:241-250`
- Phase 1 implication:
  - Preserve current visual-planning fields during beat-save.
  - Do not introduce a new visual-intent field in this pass.

### E. `update-script` is legacy/non-owner for Phase 1

- Frozen policy:
  - `POST /api/story/update-script` remains a mounted legacy overlap and is not the owner of new script-control or rewrite work in Phase 1.
- Repo proof:
  - The route is mounted in backend, but current mobile caller truth shows no wrapper and no callsite for it; mobile editing uses `update-beat-text` instead.
  - Evidence: `src/routes/story.routes.js:270-301`, mobile `docs/MOBILE_USED_SURFACES.md:105-106`, mobile `client/api/client.ts:675-684`
- Phase 1 implication:
  - Do not expand `update-script` or route new work through it during contract normalization, visual-intent preservation, or `styleKey` hookup.

### F. Remix remains deferred until after normalization + lens hookup

- Frozen policy:
  - Beat-remix and rewrite-variant work stay out of scope until contract normalization, visual-intent preservation, and `styleKey` lens hookup are complete.
- Repo proof:
  - No current story-specific remix endpoint or mobile remix caller was proven in the current repos, and the current beat action UI exposes only Replace Clip and Delete Beat.
  - Evidence: `src/routes/story.routes.js:204-301`, `src/routes/story.routes.js:572-871`, mobile `client/api/client.ts:603-754`, mobile `client/components/story-editor/BeatActionsModal.tsx:42-80`
- Phase 1 implication:
  - Do not add remix routes, remix UI, or remix-specific contract work in the first runtime passes.

## Remaining Unresolved Items

- No repo-truth ambiguity remains for Pass 1A, Pass 1B, or Pass 2.
- Future expansion of the `styleKey` enum beyond `default | hype | cozy` is a later product choice, not a blocker for the first implementation passes.
  - Evidence: `src/routes/story.routes.js:188-192`
- Retirement strategy for the legacy mounted `update-script` route is still a later cleanup question, not a Phase 1 blocker.
  - Evidence: `src/routes/story.routes.js:270-301`, mobile `docs/MOBILE_USED_SURFACES.md:105-106`

## Recommended V1 Non-Goals

- No new route or route family
- No new prompt field beyond existing `styleKey`
- No beat-remix endpoint
- No beat-remix UI
- No prompt/model tuning in the first slice
- No attempt to retire `update-script` in the same pass as beat-save normalization

## Phased Implementation Plan

### Pass 1A: Contract normalization only

- Status:
  - Landed on 2026-03-25.

- Purpose:
  - Normalize beat-save behavior around the already-frozen partial `update-beat-text` contract and session SSOT reload.
- Likely files / surfaces:
  - mobile `client/screens/ScriptScreen.tsx`
  - mobile `client/api/client.ts`
  - mobile `client/lib/storySession.ts`
  - mobile `docs/MOBILE_USED_SURFACES.md`
  - backend `docs/MOBILE_BACKEND_CONTRACT.md`
- Explicitly out of scope:
  - backend route shape changes
  - `styleKey` UI
  - visual-intent mutation change
  - remix work
- Acceptance criteria:
  - `ScriptScreen` no longer treats the partial beat-save payload as full session state.
  - `ScriptScreen` and `StoryEditor` both refetch `GET /api/story/:sessionId` after successful beat-save.
  - mobile typing for `storyUpdateBeatText(...)` matches the live backend partial payload instead of `StorySession`.
  - one user save action results in at most one `POST /api/story/update-beat-text` and one follow-up `GET /api/story/:sessionId`.
  - the edited sentence remains visible after save and does not briefly revert to stale text while the SSOT refetch is in flight.
- Regression risks / guardrails:
  - Do not widen `update-beat-text` to a full-session response.
  - Do not duplicate session reconstruction logic in a second screen path.
  - Preserve existing authenticated transport headers and normalized envelope handling.

### Pass 1B: Visual-intent preservation only

- Status:
  - Landed on 2026-03-25.

- Purpose:
  - Stop beat-save from silently mutating later clip-search intent by preserving `shot.searchQuery`.
- Likely files / surfaces:
  - backend `src/services/story.service.js`
  - backend `docs/MOBILE_BACKEND_CONTRACT.md`
  - backend `docs/MOBILE_HARDENING_PLAN.md`
  - mobile `docs/MOBILE_USED_SURFACES.md` if consumer notes need a refresh
- Explicitly out of scope:
  - new visual-intent fields
  - Home lens UI
  - remix work
  - changes to `visualDescription`
- Acceptance criteria:
  - beat-save updates narration text only
  - beat-save no longer overwrites `shot.searchQuery`
  - clip replacement continues to seed from the preserved shot query unless a user provides a new query through the existing clip-search flow
- Regression risks / guardrails:
  - Do not mutate `selectedClip`, `candidates`, or `visualDescription`.
  - Do not change clip-search route ownership or fallback order in the same pass unless required by tests or verification.

### Pass 2: Home lens UI using existing `styleKey`

- Status:
  - Landed on 2026-03-25.

- Purpose:
  - Expose the already-wired `styleKey` control in Home/create flow without introducing a new backend field.
- Likely files / surfaces:
  - mobile `client/screens/HomeScreen.tsx`
  - mobile `client/api/client.ts`
  - mobile `docs/MOBILE_USED_SURFACES.md`
  - backend `docs/MOBILE_BACKEND_CONTRACT.md`
- Explicitly out of scope:
  - prompt/model changes beyond existing `styleKey`
  - new route or route family
  - remix UI or remix endpoints
- Acceptance criteria:
  - Home omits `styleKey` when no lens is explicitly selected, and backend generation still follows the current default path.
  - Home sends the existing `styleKey` field on `storyStart(...)` when a user explicitly selects a lens.
  - sent values remain within backend-accepted enum `default | hype | cozy`
  - generation continues to use stored `session.styleKey`
  - `storyGenerate(...)` continues to send only `{ sessionId }`
- Regression risks / guardrails:
  - Do not create a second style-control field.
  - Do not bypass session storage by sending a separate generate-time lens field.

### Later: Remix work, not now

- Purpose:
  - Only after Pass 1A, Pass 1B, and Pass 2 are stable, re-evaluate whether remix has a proven owner and non-overlapping contract surface.
- Explicitly out of scope now:
  - remix endpoints
  - remix UI
  - new rewrite owner selection
- Guardrail:
  - Do not start remix until current owner, contract, and visual-intent policy remain stable after the earlier passes.

## Acceptance Gates Before Implementation

The following must be true before coding starts:

- [x] `/api/story` ownership is proven and documented.
  - Evidence: `src/app.js:244-246`, `src/routes/index.js:8-18`, `src/routes/story.routes.js:204-871`
- [x] `styleKey` ownership is proven and frozen as v1 policy.
  - Evidence: mobile `client/api/client.ts:607-617`, `src/routes/story.routes.js:188-218`, `src/services/story.service.js:486-565`, `src/services/story.llm.service.js:223-227`, `src/services/story.llm.service.js:320-323`
- [x] `update-beat-text` response contract is proven and frozen as v1 policy.
  - Evidence: `src/routes/story.routes.js:840-856`, `src/services/story.service.js:1157-1160`
- [x] Client save behavior split is proven and frozen for normalization.
  - Evidence: mobile `client/screens/ScriptScreen.tsx:182-209`, mobile `client/screens/story-editor/useStoryEditorSession.ts:160-176`
- [x] Narration-versus-visual-intent mutation policy is proven and frozen as v1 policy.
  - Evidence: `src/services/story.service.js:931-949`, `src/services/story.service.js:1141-1145`, mobile `client/screens/StoryEditorScreen.tsx:243-250`
- [x] `update-script` is treated as legacy/non-owner for Phase 1.
  - Evidence: `src/routes/story.routes.js:270-301`, mobile `docs/MOBILE_USED_SURFACES.md:105-106`
- [x] No current story-remix owner has been proven, so remix overlap is explicitly deferred.
  - Evidence: `src/routes/story.routes.js:204-301`, `src/routes/story.routes.js:572-871`, mobile `client/api/client.ts:603-754`

Implementation should not start until these freeze decisions are accepted as the current plan of record.
