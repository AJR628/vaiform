# SCRIPT_CONTROL_PREIMPLEMENTATION_AUDIT

- Status: CANONICAL
- Owner repo: backend
- Source of truth for: pre-code freeze on script-quality control ownership, current contracts, and the first safe implementation slice
- Canonical counterpart/source: mobile repo `docs/DOCS_INDEX.md`, mobile repo `docs/MOBILE_USED_SURFACES.md`, backend repo `docs/MOBILE_BACKEND_CONTRACT.md`, backend repo `docs/MOBILE_HARDENING_PLAN.md`, backend repo `docs/LEGACY_WEB_SURFACES.md`
- Last verified against: both repos on 2026-03-24

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

- `ScriptScreen` treats the partial beat-save response as local session state and re-runs beat extraction against that partial payload.
  - save path: mobile `client/screens/ScriptScreen.tsx:182-209`
  - local unwrap/extract helper fallback to top-level `sentences`: mobile `client/lib/storySession.ts:14-19`, mobile `client/lib/storySession.ts:25-52`
- `StoryEditor` does not trust the partial response as session SSOT; it treats the call as success/failure only and then refetches `GET /api/story/:sessionId`.
  - save path: mobile `client/screens/story-editor/useStoryEditorSession.ts:160-176`
- The mobile transport wrapper currently types `storyUpdateBeatText(...)` as `NormalizedResponse<StorySession>` even though the live backend route returns only `{ sentences, shots }`.
  - typed wrapper: mobile `client/api/client.ts:675-684`
  - backend return: `src/routes/story.routes.js:840-856`, `src/services/story.service.js:1157-1160`
- Result: the backend contract is currently consistent, but the two mobile screens normalize it differently.

### Visual-intent separation and current mutation risk

- Visual planning currently exists as separate backend-owned fields.
  - visual plan output includes `visualDescription` and `searchQuery`: `src/services/story.llm.service.js:674-799`
  - clip search for the whole storyboard uses planned `shot.searchQuery`: `src/services/story.service.js:878-890`
- Current single-shot clip replacement also uses `shot.searchQuery` as the initial query.
  - mobile `client/screens/StoryEditorScreen.tsx:243-250`
  - backend single-shot fallback order is `query?.trim() || shot.searchQuery || sentence text`: `src/services/story.service.js:931-949`
- Current beat text edits therefore mutate later visual search intent by overwriting `shot.searchQuery`.
  - mutation site: `src/services/story.service.js:1141-1145`
- I did not find current beat-edit code mutating `visualDescription`.
  - checked current service implementation: `src/services/story.service.js:1126-1161`

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

## Unresolved Truths

- `styleKey` is proven end-to-end in transport typing, backend validation, session storage, and prompt wiring, but current mobile UI does not send it.
  - proven at mobile `client/api/client.ts:607-617`, mobile `client/screens/HomeScreen.tsx:84-88`, `src/routes/story.routes.js:188-218`, `src/services/story.service.js:486-565`, `src/services/story.llm.service.js:223-227`, `src/services/story.llm.service.js:320-323`
- Only three `styleKey` values are currently accepted by backend schema: `default`, `hype`, `cozy`.
  - `src/routes/story.routes.js:188-192`
- A whole-script edit route still exists alongside per-beat editing, but current mobile usage is only per-beat.
  - mounted route: `src/routes/story.routes.js:270-301`
  - mobile caller truth: mobile `docs/MOBILE_USED_SURFACES.md:105-106`
- The mobile transport type for `update-beat-text` is currently wider than the backend's live partial payload.
  - mobile `client/api/client.ts:675-684`
  - backend `src/routes/story.routes.js:840-856`, `src/services/story.service.js:1157-1160`
- This pass did not prove any current need to widen script control beyond the existing `styleKey` hook and beat-save contract normalization.

## Decision Freeze

### A. Is `styleKey` the sanctioned v1 script-lens hook?

- Decision:
  - Freeze `styleKey` as the sanctioned v1 pre-generation lens hook.
- Current proven state:
  - Exists in mobile transport typing, backend request schema, session storage, generation service, and prompt construction, but current Home UI does not send it.
  - Evidence: mobile `client/api/client.ts:607-617`, mobile `client/screens/HomeScreen.tsx:84-88`, `src/routes/story.routes.js:188-218`, `src/services/story.service.js:486-565`, `src/services/story.llm.service.js:223-227`, `src/services/story.llm.service.js:320-323`
- Options:
  - Reuse `styleKey`
  - Add a new script-lens field
  - Remove `styleKey` and defer lens control entirely
- Recommended v1 choice:
  - Reuse `styleKey` with the current backend-accepted enum.
- Why this is the minimal-diff, non-overlapping path:
  - It already exists across transport, backend validation, persistence, and prompt wiring. Reusing it avoids adding a second overlapping control field before we have even normalized current contracts.

### B. Is `update-beat-text` a partial-response contract that clients should normalize around?

- Decision:
  - Freeze `update-beat-text` as a partial-response contract in v1.
- Current proven state:
  - Backend returns `{ sentences, shots }` in `data`, not a full session.
  - Evidence: `src/routes/story.routes.js:840-856`, `src/services/story.service.js:1157-1160`, `src/http/respond.js:14-17`
- Options:
  - Normalize clients around the existing partial contract
  - Widen the backend response to a full session
  - Keep split client behavior
- Recommended v1 choice:
  - Normalize clients around the existing partial contract and document it as frozen.
- Why this is the minimal-diff, non-overlapping path:
  - The backend already has a stable route shape. Changing both backend contract and client behavior at once would widen scope and create avoidable drift with current docs.

### C. Should `ScriptScreen` and `StoryEditor` both refetch session SSOT after beat-save?

- Decision:
  - Yes. Freeze beat-save client behavior around refetch-after-save SSOT for both screens.
- Current proven state:
  - `ScriptScreen` locally adopts the partial response as screen state, while `StoryEditor` refetches session SSOT after save.
  - Evidence: mobile `client/screens/ScriptScreen.tsx:182-209`, mobile `client/lib/storySession.ts:25-52`, mobile `client/screens/story-editor/useStoryEditorSession.ts:160-176`
- Options:
  - Keep the current split behavior
  - Standardize on partial-response local patching
  - Standardize on refetch-after-save SSOT
- Recommended v1 choice:
  - Standardize on refetch-after-save SSOT.
- Why this is the minimal-diff, non-overlapping path:
  - One screen already does this today. It avoids duplicating session-reconstruction logic around a partial response and keeps additive session-owned fields authoritative from `GET /api/story/:sessionId`.

### D. Should beat text edits stop mutating `shot.searchQuery` in v1?

- Decision:
  - Yes. Freeze v1 policy so narration edits do not overwrite stored visual search intent.
- Current proven state:
  - Beat saves currently overwrite `shot.searchQuery`, and clip replacement reuses `shot.searchQuery` as the next search seed.
  - Evidence: `src/services/story.service.js:1141-1145`, `src/services/story.service.js:931-949`, mobile `client/screens/StoryEditorScreen.tsx:243-250`
- Options:
  - Keep overwriting `shot.searchQuery`
  - Stop mutating `shot.searchQuery` in beat-save v1
  - Introduce a new visual-intent field immediately
- Recommended v1 choice:
  - Stop mutating `shot.searchQuery` in v1 beat-save behavior.
- Why this is the minimal-diff, non-overlapping path:
  - The repo already distinguishes narration text from visual planning fields. Preserving the existing visual intent is smaller and safer than introducing a second visual-intent model in the same pass.

### E. Should beat-remix work be deferred until after contract normalization + lens hookup?

- Decision:
  - Yes. Defer beat-remix work until after contract normalization and `styleKey` hookup are complete.
- Current proven state:
  - No current story-specific remix endpoint or mobile remix caller was proven in the current repos.
  - Evidence: `src/routes/story.routes.js:204-301`, `src/routes/story.routes.js:572-871`, mobile `client/api/client.ts:603-754`, mobile `client/components/story-editor/BeatActionsModal.tsx:42-80`
- Options:
  - Start remix now
  - Defer remix until after contract normalization + lens hookup
- Recommended v1 choice:
  - Defer remix.
- Why this is the minimal-diff, non-overlapping path:
  - Starting remix now would introduce a new overlapping script-control surface before the current owner, contract, and visual-intent policy are normalized.

## Decisions Required Before Coding

- Accept or reject `styleKey` as the sanctioned v1 script-lens hook.
- Accept or reject refetch-after-save SSOT as the common mobile beat-save policy.
- Accept or reject the v1 rule that beat narration edits must not overwrite `shot.searchQuery`.
- Keep `update-script` out of scope for the first slice; do not reintroduce it as an active caller path.
- Keep beat-remix explicitly out of scope for the first slice.

## Recommended V1 Non-Goals

- No new route or route family
- No new prompt field beyond existing `styleKey`
- No beat-remix endpoint
- No beat-remix UI
- No prompt/model tuning in the first slice
- No attempt to retire `update-script` in the same pass as beat-save normalization

## Safest First Implementation Slice

Freeze order for the first runtime pass:

1. Normalize beat-save behavior around session SSOT.
   - Align `ScriptScreen` with the existing `StoryEditor` refetch-after-save pattern.
   - Do not widen `update-beat-text` into a full-session response in this slice.
2. Preserve visual intent during beat-save.
   - Stop beat-save from overwriting `shot.searchQuery`.
   - Keep current visual planning fields otherwise unchanged.
3. Reuse `styleKey` as the v1 script-lens hook.
   - Freeze the existing enum and wire only the current path that already exists end-to-end.
4. Only after the above is stable, add Home lens UI in a separate follow-up slice.

Why this order is safest:

- It works with the current backend owner `/api/story`.
- It resolves the existing client contract split before adding new UI.
- It avoids introducing overlapping script-control fields or remix surfaces.
- It preserves current visual planning data instead of letting narration edits silently rewrite later clip-search intent.

## Acceptance Gates Before Implementation

The following must be true before coding starts:

- [x] `/api/story` ownership is proven and documented.
  - Evidence: `src/app.js:244-246`, `src/routes/index.js:8-18`, `src/routes/story.routes.js:204-871`
- [x] `styleKey` ownership is proven and frozen for decision.
  - Evidence: mobile `client/api/client.ts:607-617`, `src/routes/story.routes.js:188-218`, `src/services/story.service.js:486-565`, `src/services/story.llm.service.js:223-227`, `src/services/story.llm.service.js:320-323`
- [x] `update-beat-text` response contract is proven and frozen for decision.
  - Evidence: `src/routes/story.routes.js:840-856`, `src/services/story.service.js:1157-1160`
- [x] Client save behavior split is proven and frozen for normalization.
  - Evidence: mobile `client/screens/ScriptScreen.tsx:182-209`, mobile `client/screens/story-editor/useStoryEditorSession.ts:160-176`
- [x] Narration-versus-visual-intent mutation policy is proven and frozen for decision.
  - Evidence: `src/services/story.service.js:931-949`, `src/services/story.service.js:1141-1145`, mobile `client/screens/StoryEditorScreen.tsx:243-250`
- [x] No current story-remix owner has been proven, so remix overlap is explicitly deferred.
  - Evidence: `src/routes/story.routes.js:204-301`, `src/routes/story.routes.js:572-871`, mobile `client/api/client.ts:603-754`

Implementation should not start until these freeze decisions are accepted as the current plan of record.
