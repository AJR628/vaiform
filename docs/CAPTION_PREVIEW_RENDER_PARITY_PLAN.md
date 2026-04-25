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

Status: Not started

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

- Pending.

Files changed:

- Pending.

Tests run:

- Pending.

Discoveries:

- Pending.

Rollback notes:

- Revert helper extraction only. Because Phase 1A should not change runtime behavior or persisted preview artifacts, rollback should not require contract or mobile changes.

## Phase 1B - Backend Captioned Preview Artifact

Status: Not started

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

- Pending.

Files changed:

- Pending.

Tests run:

- Pending.

Discoveries:

- Pending.

Rollback notes:

- Restore `base-preview-v1`.
- Restore the old base preview render body.
- If `captioned-preview-v1` artifacts exist, they should become stale after rollback because renderer version no longer matches.

## Phase 1C - Preview Fingerprint, Style Invalidation, Observability

Status: Not started

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

- Pending.

Files changed:

- Pending.

Tests run:

- Pending.

Discoveries:

- Pending.

Rollback notes:

- Remove fingerprint/style invalidation additions.
- Keep Phase 1B captioned preview if otherwise healthy, or roll Phase 1B back separately.

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

| Phase    | Status      | Date | Files changed | Tests run | Manual verification | Notes/follow-ups |
| -------- | ----------- | ---- | ------------- | --------- | ------------------- | ---------------- |
| Phase 1A | Not started | -    | -             | -         | -                   | -                |
| Phase 1B | Not started | -    | -             | -         | -                   | -                |
| Phase 1C | Not started | -    | -             | -         | -                   | -                |
| Phase 1D | Not started | -    | -             | -         | -                   | -                |
| Phase 1E | Not started | -    | -             | -         | -                   | -                |

## Phase Completion Checklist

Before marking any phase complete:

- Evidence was re-audited from current code.
- Files changed are listed in this document.
- Tests run are listed with pass/fail outcome.
- Manual verification, if applicable, is recorded.
- Discoveries and follow-ups are captured.
- Rollback notes are still accurate after the actual implementation.
- Canonical docs were not updated ahead of runtime truth.
