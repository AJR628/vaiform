# Caption Preview/Render Parity Plan

- Status: Planned
- Owner repo: backend
- Source of truth for: phase execution tracker for caption preview/render parity
- Canonical contract docs:
  - backend `docs/API_CONTRACT.md`
  - backend `docs/MOBILE_BACKEND_CONTRACT.md`
  - backend `docs/MOBILE_HARDENING_PLAN.md`
  - mobile `docs/MOBILE_USED_SURFACES.md`
  - mobile `docs/DOCS_INDEX.md`

This document is a phase-scoped implementation tracker, not permanent API contract truth. After implementation is complete and canonical docs are updated to match landed runtime behavior, archive or demote this plan.

Line evidence below was re-audited against the local backend and mobile main checkouts on 2026-04-25.

## Goal

Make native mobile Preview show the same backend-rendered caption/karaoke visuals as final render while preserving:

- existing `POST /api/story/preview` entrypoint
- existing async preview attempt queue/runner
- existing `GET /api/story/:sessionId` polling/readback
- existing mobile `draftPreviewV1.artifact.url` playback contract
- billing/admission semantics
- voice sync semantics
- final render settlement semantics

Product rule: native mobile Preview must not approximate final captions with React Native text. Final-looking preview captions should come from a backend-generated preview artifact rendered through the same caption/karaoke visual truth as final render.

## Current-State Summary

- Backend preview currently uses `base-preview-v1`: `src/services/story.service.js:105-107`.
- Backend preview currently produces an audio-included base MP4: `renderStoryDraftPreview()` trims clips and concatenates video-only segments at `src/services/story.service.js:2751-2782`, downloads preview narration at `src/services/story.service.js:2783-2787`, muxes video/audio at `src/services/story.service.js:2788-2794`, and uploads `previews/{previewId}/base.mp4` at `src/services/story.service.js:2810-2827`.
- Backend preview currently does not burn captions/karaoke: the audited preview path above only trims, concatenates, muxes, and uploads; the caption/karaoke calls are absent from `src/services/story.service.js:2711-2834`.
- Final render currently uses backend caption/karaoke generation: `buildStoredRenderBeat()` compiles caption SSOT at `src/services/story.service.js:3074-3105`, loads stored beat timing/audio at `src/services/story.service.js:3150-3164`, and calls `buildKaraokeASSFromTimestamps()` at `src/services/story.service.js:3173-3182`.
- Final render burns caption/karaoke visuals through `renderVideoQuoteOverlay()`: `renderStory()` consumes `buildStoredRenderBeat()` output at `src/services/story.service.js:4239-4243` and passes `assPath`, `ttsPath`, and caption data into `renderVideoQuoteOverlay()` at `src/services/story.service.js:4309-4326` and `src/services/story.service.js:4361-4378`.
- Mobile currently overlays React Native caption text in `StoryboardPreviewStage.tsx`: local caption style/placement is calculated at `client/components/story-editor/StoryboardPreviewStage.tsx:83-131`, backend preview video is rendered at `client/components/story-editor/StoryboardPreviewStage.tsx:151-160`, and RN caption text is overlaid at `client/components/story-editor/StoryboardPreviewStage.tsx:162-169`.
- `captionOverlayV1` is metadata/timeline/style projection, not exact WYSIWYG visual truth: backend projection exposes `frame`, `placement`, `style`, and `segments` at `src/services/story.service.js:377-409`; mobile type contains style plus segment text/timing fields only at `client/types/story.ts:119-135`.

## Non-Goals

- no caption presets
- no new customization UI
- no sample previews
- no preview-to-final artifact promotion
- no preview billing/admission/finalize semantic changes
- no voice sync semantic changes
- no broad final render refactor
- no legacy cleanup
- no React Native text as exact WYSIWYG renderer

## Guardrails Before Every Phase

- Audit first.
- Cite repo evidence.
- Make no assumptions.
- Keep the diff minimal.
- Do not broaden phase scope.
- Run tests before docs completion.
- Docs must describe actual landed behavior, not intent.
- Update implementation notes immediately after each phase.
- Bring summary/diff back for sanity check before the next phase.

## Compute/Billing Position For This Plan

- Voice sync and final render remain the only billed operations in this plan.
- Captioned preview remains included for now.
- Preview must be explicit, queued, idempotent, cached/fingerprint-aware, and observable.
- Do not automatically regenerate preview on style changes.
- Data from preview observability will inform future pricing/limits.
- Do not change user-facing billing copy in this plan.

## Phase 1A - Backend Caption/Karaoke Render-Input Helper Only

Status: Completed

Runtime behavior change: none expected.

Goal: extract the smallest helper for final render's existing caption/karaoke input preparation.

Must not change:

- `renderStoryDraftPreview()`
- `DRAFT_PREVIEW_RENDERER_VERSION`
- `POST /api/story/preview`
- `GET /api/story/:sessionId`
- mobile code
- public docs claiming captioned preview exists

Helper requirements:

- no new render engine
- no duplicate caption pipeline
- no duplicate SSOT compile/wrapping/ASS/timestamp scaling/style logic
- final render behavior must remain equivalent

Likely files:

- `src/services/story.service.js`
- `test/contracts/story-preview.contract.test.js` or a new focused backend contract test

Tests to run:

- `npm run test:contracts`
- Any new focused helper contract test added for this phase

Implementation notes:

- Added private `buildStoredRenderBeatCaptionInput()` helper in `src/services/story.service.js`.
- `buildStoredRenderBeat()` now delegates only caption/karaoke input preparation to the helper.
- Preserved `buildStoredRenderBeat()` return shape: `ttsPath`, `assPath`, `durationSec`, `caption`, `meta`, `sentenceText`, `overlayCaption`.
- Left `renderStoryDraftPreview()`, `DRAFT_PREVIEW_RENDERER_VERSION`, preview routes, mobile code, billing/finalize, and voice-sync semantics unchanged.
- Helper remains private; no service exports were added.

Files changed:

- `src/services/story.service.js`
- `docs/CAPTION_PREVIEW_RENDER_PARITY_PLAN.md`

Tests run:

- `npm run test:contracts` - pass
- `node --test --test-concurrency=1 test/contracts/story-preview.contract.test.js` - pass
- `npm run check:format:changed -- --files src/services/story.service.js,docs/CAPTION_PREVIEW_RENDER_PARITY_PLAN.md` - pass
- `npm run check:responses:changed -- --files src/services/story.service.js,docs/CAPTION_PREVIEW_RENDER_PARITY_PLAN.md` - pass

Discoveries:

- No low-churn direct helper test target exists without exporting private internals or invoking heavy render/storage/FFmpeg paths.
- Phase 1B must separately resolve how captioned preview will supply per-beat timing/audio inputs, because current preview uses combined preview narration while final render uses per-beat stored narration audio/timing.

Rollback notes:

- Revert the private helper extraction and restore the previous inline body in `buildStoredRenderBeat()`.
- No persisted preview artifacts, mobile code, public contract docs, billing, finalize, or voice-sync rollback should be required.

## Phase 1B - Backend Captioned Preview Artifact

Status: Completed

Goal: change preview artifact behind `draftPreviewV1.artifact.url` from base MP4 to backend-captioned preview MP4.

Requirements:

- Preserve route/queue/idempotency/polling response shape.
- Keep FFmpeg work in preview runner/service path, never request handler.
- Bump renderer version from `base-preview-v1` to `captioned-preview-v1`.
- Old base previews should project stale through renderer mismatch.
- Do not make billing changes.

Must preserve:

- `POST /api/story/preview` entrypoint.
- Existing story-preview attempt queue and runner.
- `GET /api/story/:sessionId` polling/readback.
- Mobile read of `draftPreviewV1.artifact.url`.

Likely files:

- `src/services/story.service.js`
- `src/services/story-preview.runner.js` only if tiny logging metadata is needed
- `test/contracts/story-preview.contract.test.js`
- `test/contracts/phase4a.contract.test.js`

Tests to run:

- `npm run test:contracts`
- Focused tests proving old `base-preview-v1` ready artifacts project as stale.
- Focused tests proving sanitized `draftPreviewV1.artifact.url` response shape remains stable.

Implementation notes:

- Bumped draft preview renderer from `base-preview-v1` to `captioned-preview-v1`.
- `renderStoryDraftPreview()` now renders captioned per-beat preview segments using stored per-beat narration audio/timing and `buildStoredRenderBeatCaptionInput()`.
- Preview generation no longer downloads or muxes the combined private preview narration file.
- Preview segments still come from existing `buildStoryPreviewReadiness()` planning; Phase 1B did not change clip selection, beat ordering, segment ordering, or `videoCutsV1`/classic readiness semantics except for missing per-beat artifact blocking.
- Preserved `POST /api/story/preview`, preview attempt queue/runner, idempotency, `GET /api/story/:sessionId`, `draftPreviewV1.artifact.url`, mobile code, billing/finalize, and voice-sync semantics.
- Old `base-preview-v1` ready artifacts project as stale through renderer-version mismatch.
- Missing per-beat stored narration/timing/caption inputs block preview generation safely with `VOICE_SYNC_ARTIFACT_MISSING` and `missingBeatIndices`.
- Phase 1B verifies backend artifact correctness only; full mobile visual parity is not complete until Phase 1D disables the React Native overlay.
- Runtime stabilization added after Replit/native preview failure: `renderVideoQuoteOverlay()` received a trimmed preview segment with no readable video stream.
- Root cause was proven with a synthetic repro: `trimClipToSegment()` could return success while producing a tiny no-video MP4 when requested `inSec` was at or beyond source duration.
- Stabilization implemented readable-video probing, source/output trim validation, out-of-range trim clamping to a real end-of-source slice, and safe preview trim failure context mapped to `DRAFT_PREVIEW_SEGMENT_VIDEO_MISSING`.
- Runtime timing mismatch observed after no-video stabilization: backend captioned preview rendered successfully, but karaoke timing lagged or clipped relative to voice while Final Render stayed aligned.
- Root cause was preview duration wiring: Preview used readiness `segment.durSec` for trim, `renderVideoQuoteOverlay()` duration, and concat metadata while ASS/audio used stored per-beat narration timing; Final Render used stored beat duration from narration/timing.
- Timing stabilization bumped draft preview renderer from `captioned-preview-v1` to `captioned-preview-v1.1`, so old base previews and old captioned previews project stale through renderer-version mismatch.
- Preview now resolves per-beat render duration through the same private helper used by Final Render and uses that duration for visual trim, `renderVideoQuoteOverlay()`, rendered segment metadata, and preview artifact duration.
- Added safe per-segment duration diagnostic logging for `sessionId`, `attemptId`, `previewId`, `segmentIndex`, `beatIndex`/`sentenceIndex`, readiness segment duration, resolved render duration, narration duration, timing duration, caption span, and duration source.
- Manual Replit/native verification completed by AJ after timing stabilization: synced native preview successfully played backend-burned karaoke captions, karaoke timing lined up correctly with voice, and final render appeared to match preview overall. Full mobile visual parity remains incomplete until Phase 1D removes the React Native overlay.

Files changed:

- `src/services/story.service.js`
- `src/utils/media.duration.js`
- `src/utils/ffmpeg.timeline.js`
- `test/contracts/ffmpeg-timeline.contract.test.js`
- `test/contracts/story-preview.contract.test.js`
- `test/contracts/phase4a.contract.test.js`
- `docs/CAPTION_PREVIEW_RENDER_PARITY_PLAN.md`

Tests run:

- `npm run test:contracts` - pass
- `node --test --test-concurrency=1 test/contracts/ffmpeg-timeline.contract.test.js` - pass
- `node --test --test-concurrency=1 test/contracts/story-preview.contract.test.js` - pass
- `npm run check:format:changed -- --files src/utils/media.duration.js,src/utils/ffmpeg.timeline.js,src/services/story.service.js,test/contracts/ffmpeg-timeline.contract.test.js,docs/CAPTION_PREVIEW_RENDER_PARITY_PLAN.md` - pass
- `npm run check:responses:changed -- --files src/utils/media.duration.js,src/utils/ffmpeg.timeline.js,src/services/story.service.js,test/contracts/ffmpeg-timeline.contract.test.js,docs/CAPTION_PREVIEW_RENDER_PARITY_PLAN.md` - pass
- Timing stabilization checks: `npm run test:contracts` - pass; `node --test --test-concurrency=1 test/contracts/story-preview.contract.test.js` - pass; `node --test --test-concurrency=1 test/contracts/ffmpeg-timeline.contract.test.js` - pass; `npm run check:format:changed -- --files src/services/story.service.js,test/contracts/story-preview.contract.test.js,test/contracts/phase4a.contract.test.js,docs/CAPTION_PREVIEW_RENDER_PARITY_PLAN.md` - pass; `npm run check:responses:changed -- --files src/services/story.service.js,test/contracts/story-preview.contract.test.js,test/contracts/phase4a.contract.test.js,docs/CAPTION_PREVIEW_RENDER_PARITY_PLAN.md` - pass.

Discoveries:

- Phase 1B moved style/render-input dependencies into the private preview fingerprint for inputs now burned into pixels. Phase 1C can still add broader observability and any additional style invalidation coverage, but should account for the Phase 1B fingerprint baseline before adding duplicate logic.
- Combined `voiceSync.previewAudioUrl` remains available for compatibility/readback, but captioned preview artifact rendering now uses per-beat stored narration audio/timing.
- Native mobile may still draw the React Native preview caption overlay until Phase 1D, so visual parity should be judged against the backend `draftPreviewV1.artifact.url` MP4 directly after Phase 1B.
- The old base preview trim/concat path could also hit a no-video trimmed segment; Phase 1B exposed the issue earlier by feeding each trim directly into the overlay renderer.
- Phase 1B timing stabilization keeps preview clip selection and beat ordering from readiness planning, but duration truth now mirrors Final Render. Phase 1C should avoid duplicating this duration/fingerprint baseline.

Rollback notes:

- Restore `base-preview-v1`.
- Restore the old base preview render body.
- Restore the old preview fingerprint/readiness behavior if the new per-beat artifact gate must be backed out.
- Revert the readable-video probe helper, trim hardening, preview trim error-context mapping, and focused FFmpeg trim test if stabilization needs rollback.
- If `captioned-preview-v1` artifacts exist, they should become stale after rollback because renderer version no longer matches.
- To roll back timing stabilization only, restore Preview to using readiness `segment.durSec`, restore renderer version `captioned-preview-v1`, and revert the duration-helper refactor, duration diagnostics, tests, and tracker timing notes.

## Phase 1C - Preview Fingerprint, Style Invalidation, Observability

Status: Completed

Goal: make preview stale when final-affecting caption render inputs change.

Requirements:

- Include caption style/render-plan factors in preview fingerprint.
- On caption style changes, stale existing preview but do not auto-regenerate.
- Add preview compute observability/logging:
  - attempt id
  - session id
  - renderer version
  - output duration
  - segment count
  - wall-clock render ms
  - outcome
  - failure code
  - stale/cached/superseded status where available
- Do not make billing changes.

Likely files:

- `src/services/story.service.js`
- `src/routes/story.routes.js`
- `src/services/story-preview.runner.js`
- `test/contracts/story-preview.contract.test.js`
- `test/contracts/phase4a.contract.test.js`

Tests to run:

- `npm run test:contracts`
- Focused tests proving caption style/render-input changes stale preview.
- Focused tests proving same style does not stale preview if equality is easy to prove safely.
- Focused tests proving fingerprint changes when final-affecting caption inputs change.

Implementation notes:

- Extended the existing private preview fingerprint with effective caption render inputs and preview render constants.
- The effective render-input fingerprint uses `buildCaptionMetaForBeat()`, which is cheap and side-effect-free: it compiles caption SSOT in memory, reads in-memory beat caption meta, hashes text, and performs no FFmpeg, storage, temp file, network, ASS generation, or session mutation.
- Caption style and accepted caption-meta updates now stale existing draft previews with `CAPTION_RENDER_INPUT_CHANGED` without auto-rendering.
- Added safe structured preview request/render/runner observability with renderer version, preview id, segment count, output duration, render wall time, outcomes/failure codes, and fingerprint prefixes only.
- Left mobile code, React Native overlay, billing, voice sync generation, finalize, route contracts, attempt schema, renderer engine, canonical public docs, `src/utils/karaoke.ass.js`, and broad FFmpeg logging unchanged.

Files changed:

- `src/services/story.service.js`
- `src/routes/story.routes.js`
- `src/services/story-preview.runner.js`
- `test/contracts/story-preview.contract.test.js`
- `test/contracts/phase4a.contract.test.js`
- `docs/CAPTION_PREVIEW_RENDER_PARITY_PLAN.md`

Tests run:

- `node --test --test-concurrency=1 test/contracts/story-preview.contract.test.js` - pass
- `npm run test:contracts` - pass
- `node --test --test-concurrency=1 test/contracts/ffmpeg-timeline.contract.test.js` - pass
- `npm run check:format:changed -- --files src/services/story.service.js,src/routes/story.routes.js,src/services/story-preview.runner.js,test/contracts/story-preview.contract.test.js,test/contracts/phase4a.contract.test.js,docs/CAPTION_PREVIEW_RENDER_PARITY_PLAN.md` - pass
- `npm run check:responses:changed -- --files src/services/story.service.js,src/routes/story.routes.js,src/services/story-preview.runner.js,test/contracts/story-preview.contract.test.js,test/contracts/phase4a.contract.test.js,docs/CAPTION_PREVIEW_RENDER_PARITY_PLAN.md` - pass

Discoveries:

- Phase 1B duration/fingerprint baseline remains the source for per-beat render timing; Phase 1C adds caption render-shape invalidation without changing timing semantics.
- Broader FFmpeg filter graph/stdout cleanup remains outside Phase 1C.
- Manual verification for Phase 1C remains pending until AJ confirms stale/cache/log behavior in Replit/native.

Rollback notes:

- Remove fingerprint/style invalidation additions.
- Keep Phase 1B captioned preview if otherwise healthy, or roll Phase 1B back separately.
- Remove `CAPTION_RENDER_INPUT_CHANGED` invalidation calls.
- Remove added Phase 1C observability, tests, and tracker notes.

## Backend Preview Visual Timeline Parity Follow-up

Status: Completed

Goal: make backend preview visual topology follow Final Render when `videoCutsV1` is active.

Implementation notes:

- Bumped draft preview renderer from `captioned-preview-v1.1` to `captioned-preview-v1.2`, so old timing-stabilized preview artifacts project stale before reuse.
- Extracted the Final Render `videoCutsV1` timeline planning path into `buildStoryVideoCutsTimelinePlan()`.
- Final Render and backend preview now share the same resolved visual cut plan, segment duration mapping, total timeline duration, and beat slice windows for active `videoCutsV1`.
- `renderStoryDraftPreview()` now trims `videoCutsV1` visual pieces to their cut durations, concatenates them with `concatenateClipsVideoOnly()`, slices beat windows from the global visual timeline with `extractSegmentFromFile()`, and keeps the existing per-beat karaoke/audio/caption overlay path.
- Classic/no-`videoCutsV1` preview behavior remains unchanged.
- The private preview fingerprint now includes active visual timeline/cut inputs that affect burned preview pixels.
- Left mobile code, React Native overlay, billing, finalize/worker behavior, preview route contracts, preview queue/idempotency, storage content type, and final artifact contract unchanged.

Files changed:

- `src/services/story.service.js`
- `test/contracts/story-preview.contract.test.js`
- `test/contracts/phase4a.contract.test.js`
- `docs/CAPTION_PREVIEW_RENDER_PARITY_PLAN.md`

Tests run:

- `npm run test:contracts` - pass
- `node --test --test-concurrency=1 test/contracts/story-preview.contract.test.js` - pass
- `node --test --test-concurrency=1 test/contracts/ffmpeg-timeline.contract.test.js` - pass

Manual verification:

- Pending AJ verification with `ENABLE_VIDEO_CUTS_V1=1` on a story where visual cuts cross caption boundaries.
- Compare backend `draftPreviewV1.artifact.url` MP4 directly against Final Render for clip order, cut timing, caption timing, caption placement, and total duration. Ignore the React Native overlay until Phase 1D.

Rollback notes:

- Restore renderer version `captioned-preview-v1.1`.
- Revert preview `videoCutsV1` global-timeline rendering to the prior readiness-segment loop if the topology change must be backed out.
- Keep Phase 1D not started; do not remove the React Native overlay as part of rollback.

## Phase 1D - Mobile Disables React Native Visual Caption Overlay

Status: Not started

Only start after backend captioned preview is verified.

Goal: ready preview renders only backend `draftPreviewV1.artifact.url`.

Requirements:

- Remove or disable RN visual caption overlay in `StoryboardPreviewStage.tsx`.
- Keep blocked/generate-preview UI unchanged.
- Keep `captionOverlayV1` for metadata/timeline/compatibility.
- Do not remove legacy shell/deck code.
- Confirm production/beta build uses unified Preview path or record explicit release/config decision.

Likely files:

- mobile `client/components/story-editor/StoryboardPreviewStage.tsx`
- mobile `client/components/story-editor/StoryboardSurface.test.tsx`
- mobile `client/screens/story-editor/step3.test.ts` only if fixtures/wording need renderer semantics updated

Tests to run:

- mobile `npm run test:ci`
- mobile `npm run check:types`
- Focused test proving ready preview does not render `storyboard-preview-caption`.

Implementation notes:

- Pending.

Files changed:

- Pending.

Tests run:

- Pending.

Discoveries:

- Pending.

Rollback notes:

- Restore the RN overlay block in `StoryboardPreviewStage.tsx` if backend captioned preview is not reliable.

## Phase 1E - Canonical Docs Alignment And Final Verification

Status: Not started

Only update canonical docs after behavior lands and is verified.

Backend docs to update after backend behavior lands:

- `docs/API_CONTRACT.md`
- `docs/MOBILE_BACKEND_CONTRACT.md`
- `docs/MOBILE_HARDENING_PLAN.md`
- Check `docs/DOCS_INDEX.md` only if ownership/front-door wording changes.

Mobile docs to update after mobile behavior lands:

- mobile `docs/MOBILE_USED_SURFACES.md`
- Check mobile `docs/DOCS_INDEX.md` only if front-door wording changes.

Manual verification to record:

- sync voice
- generate preview
- confirm preview has audio and burned karaoke captions
- render final
- compare placement, font size/weight, wrapping, stroke/shadow, karaoke timing
- confirm stale preview behavior after caption style/render-input change

Completion/archival notes:

- Pending. Archive or demote this tracker after implementation completes and canonical docs match runtime truth.

Implementation notes:

- Pending.

Files changed:

- Pending.

Tests run:

- Pending.

Discoveries:

- Pending.

Rollback notes:

- Docs should only be finalized after runtime truth is verified.
- If runtime rollback happens, revert canonical docs to the last verified live behavior and keep this tracker marked incomplete or archived with outcome notes.

## Implementation Status Ledger

| Phase                     | Status      | Date       | Files changed                                                                                                                                                                                                                                                                               | Tests run                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Manual verification                                 | Notes/follow-ups                                                                                                                                                                                                                              |
| ------------------------- | ----------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1A                  | Completed   | 2026-04-25 | `src/services/story.service.js`, `docs/CAPTION_PREVIEW_RENDER_PARITY_PLAN.md`                                                                                                                                                                                                               | `npm run test:contracts`; `node --test --test-concurrency=1 test/contracts/story-preview.contract.test.js`; `npm run check:format:changed -- --files src/services/story.service.js,docs/CAPTION_PREVIEW_RENDER_PARITY_PLAN.md`; `npm run check:responses:changed -- --files src/services/story.service.js,docs/CAPTION_PREVIEW_RENDER_PARITY_PLAN.md`                                                                                                                                                                                                                                                                                                                                                                                                 | Not applicable                                      | Private helper extraction only; no runtime behavior change expected.                                                                                                                                                                          |
| Phase 1B                  | Completed   | 2026-04-25 | `src/services/story.service.js`, `src/utils/media.duration.js`, `src/utils/ffmpeg.timeline.js`, `test/contracts/ffmpeg-timeline.contract.test.js`, `test/contracts/story-preview.contract.test.js`, `test/contracts/phase4a.contract.test.js`, `docs/CAPTION_PREVIEW_RENDER_PARITY_PLAN.md` | `npm run test:contracts`; `node --test --test-concurrency=1 test/contracts/ffmpeg-timeline.contract.test.js`; `node --test --test-concurrency=1 test/contracts/story-preview.contract.test.js`; `npm run check:format:changed -- --files src/utils/media.duration.js,src/utils/ffmpeg.timeline.js,src/services/story.service.js,test/contracts/ffmpeg-timeline.contract.test.js,docs/CAPTION_PREVIEW_RENDER_PARITY_PLAN.md`; `npm run check:responses:changed -- --files src/utils/media.duration.js,src/utils/ffmpeg.timeline.js,src/services/story.service.js,test/contracts/ffmpeg-timeline.contract.test.js,docs/CAPTION_PREVIEW_RENDER_PARITY_PLAN.md`                                                                                           | AJ verified synced native/backend artifact manually | Captioned backend preview artifact landed; trim no-video stabilization added; timing stabilization bumped renderer to `captioned-preview-v1.1` and made preview duration truth mirror Final Render; RN overlay still expected until Phase 1D. |
| Phase 1C                  | Completed   | 2026-04-26 | `src/services/story.service.js`, `src/routes/story.routes.js`, `src/services/story-preview.runner.js`, `test/contracts/story-preview.contract.test.js`, `test/contracts/phase4a.contract.test.js`, `docs/CAPTION_PREVIEW_RENDER_PARITY_PLAN.md`                                             | `node --test --test-concurrency=1 test/contracts/story-preview.contract.test.js`; `npm run test:contracts`; `node --test --test-concurrency=1 test/contracts/ffmpeg-timeline.contract.test.js`; `npm run check:format:changed -- --files src/services/story.service.js,src/routes/story.routes.js,src/services/story-preview.runner.js,test/contracts/story-preview.contract.test.js,test/contracts/phase4a.contract.test.js,docs/CAPTION_PREVIEW_RENDER_PARITY_PLAN.md`; `npm run check:responses:changed -- --files src/services/story.service.js,src/routes/story.routes.js,src/services/story-preview.runner.js,test/contracts/story-preview.contract.test.js,test/contracts/phase4a.contract.test.js,docs/CAPTION_PREVIEW_RENDER_PARITY_PLAN.md` | Replit/native stale/cache/log verification pending  | Existing private preview fingerprint now includes effective caption render inputs; caption style/meta edits stale previews without auto-rendering; preview observability added.                                                               |
| Visual topology follow-up | Completed   | 2026-04-28 | `src/services/story.service.js`, `test/contracts/story-preview.contract.test.js`, `test/contracts/phase4a.contract.test.js`, `docs/CAPTION_PREVIEW_RENDER_PARITY_PLAN.md`                                                                                                                   | `npm run test:contracts`; `node --test --test-concurrency=1 test/contracts/story-preview.contract.test.js`; `node --test --test-concurrency=1 test/contracts/ffmpeg-timeline.contract.test.js`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Pending AJ verification                             | Renderer bumped to `captioned-preview-v1.2`; preview and Final Render now share `videoCutsV1` visual timeline planning while Phase 1D remains not started.                                                                                    |
| Phase 1D                  | Not started | -          | -                                                                                                                                                                                                                                                                                           | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | -                                                   | -                                                                                                                                                                                                                                             |
| Phase 1E                  | Not started | -          | -                                                                                                                                                                                                                                                                                           | -                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | -                                                   | -                                                                                                                                                                                                                                             |

## Phase Completion Checklist

Before marking any phase complete:

- Evidence was re-audited from current code.
- Files changed are listed in this document.
- Tests run are listed with pass/fail outcome.
- Manual verification, if applicable, is recorded.
- Discoveries and follow-ups are captured.
- Rollback notes are still accurate after the actual implementation.
- Canonical docs were not updated ahead of runtime truth.
