# videoCutsV1 Backend Implementation Summary

## Commit-sized implementation plan

- **Commit 1 — Route + persistence**
  - `src/routes/story.routes.js`: Add `UpdateVideoCutsSchema` (Zod), POST `/update-video-cuts` handler, import `updateVideoCuts`.
  - `src/services/story.service.js`: Add `boundariesToCutTimes()`, `updateVideoCuts()`, persist `session.videoCutsV1`, validate N, boundaries, leftBeat, pos, non-decreasing cut times (dummy durations). Export `updateVideoCuts` in default.

- **Commit 2 — ffmpeg.timeline helpers**
  - `src/utils/ffmpeg.timeline.js`: Add `getDurationMsFromMedia` import. Add `concatenateClipsVideoOnly()` (scale+pad, `concat=n=...:v=1:a=0[outv]`, map only `[outv]`). Add `trimClipToSegment()` (probe duration, takeDur/padDur, trim + scale+pad + tpad=stop_mode=clone when needed). Add `extractSegmentFromFile()` (ss + scale+pad, video only). Export new functions in default.

- **Commit 3 — renderStory v1 branch**
  - `src/services/story.service.js`: Import `concatenateClipsVideoOnly`, `trimClipToSegment`, `extractSegmentFromFile`. Add `computeVideoSegmentsFromCuts()`. In `renderStory()`: read `ENABLE_VIDEO_CUTS_V1`, require every beat to have `selectedClip.url` for v1; if not, fall back to current path. v1 path: TTS+ASS per beat by index `b`, build `beatsDurSec`, `cutTimes`, `computeVideoSegmentsFromCuts`, fetch + `trimClipToSegment` per segment, `concatenateClipsVideoOnly` → global timeline, then per beat `extractSegmentFromFile` + `renderVideoQuoteOverlay`, push to `renderedSegments`. Same `concatenateClips(renderedSegments)` and upload. Declare `segmentErrors` outside try for post-loop log.

---

## Files changed (minimal diff)

| File | Changes |
|------|--------|
| [src/routes/story.routes.js](src/routes/story.routes.js) | Import `updateVideoCuts`. Add `VideoCutsBoundarySchema`, `UpdateVideoCutsSchema`. Add POST `/update-video-cuts` (parse body, call `updateVideoCuts`, return `{ success: true, data: session }`; on error 404 for SESSION_NOT_FOUND else 400). |
| [src/services/story.service.js](src/services/story.service.js) | `boundariesToCutTimes()` (with empty-boundaries case). `updateVideoCuts()` load/validate/persist. `computeVideoSegmentsFromCuts()`. Import timeline helpers. In `renderStory()`: N, `enableVideoCutsV1`, `useVideoCutsV1` (guard: every beat has clip). v1 branch: per-beat TTS+ASS and `beatsDurSec`, cutTimes, segments, trim each segment, video-only concat, slice per beat, overlay each slice; else existing loop. `segmentErrors` declared at top of try. Default export includes `updateVideoCuts`. |
| [src/utils/ffmpeg.timeline.js](src/utils/ffmpeg.timeline.js) | Import `getDurationMsFromMedia`. `concatenateClipsVideoOnly()`, `trimClipToSegment()` (pad-not-clamp via tpad=stop_mode=clone), `extractSegmentFromFile()`. Default export extended. |

---

## FFmpeg edge cases and handling

- **Pad, do not clamp (segment deficit)**  
  In `trimClipToSegment`, source duration is probed with `getDurationMsFromMedia`. We compute `available = max(0, clipDurSec - inSec)`, `takeDur = min(durSec, available)`, `padDur = durSec - takeDur`. Filter: `trim=start=0:duration=takeDur`, then scale+pad, then if `padDur > 0` append `tpad=stop_mode=clone:stop_duration=padDur`. Output length is always `durSec`; we never clamp, so timeline and beat alignment are preserved.

- **No-audio inputs (global timeline)**  
  `concatenateClipsVideoOnly` uses only video: scale+pad per input, then `concat=n=...:v=1:a=0[outv]`, map `[outv]` only. No `[i:a]` or anullsrc. Raw stock clips without audio can be concatenated; overlay step adds TTS per beat to the rendered segments, which are then concatenated with `concatenateClips()` (with audio).

- **extractSegmentFromFile**  
  Uses `-ss startSec` before `-i` for accurate seek, `-t durSec`, and scale+pad. No audio mapping. Used only to slice from the pre-built global timeline (video-only), so no padding needed.

---

## No-regression checks (to run)

1. **Flag OFF**  
   `ENABLE_VIDEO_CUTS_V1` unset or false → finalize render matches current behavior (one clip per beat, same duration/caption).

2. **Flag ON, no videoCutsV1 or empty boundaries**  
   Same as current behavior (v1 path not used when `boundaries.length === 0` or missing).

3. **Flag ON, boundaries at edges**  
   Boundaries equivalent to beat edges (e.g. all pct 0 or 1 at boundaries) → same as current behavior.

4. **Flag ON, one mid-beat boundary**  
   e.g. boundary at beat 1, pct 0.5 → global timeline built, slice per beat, captions unchanged, render succeeds.

5. **Stock clip with no audio**  
   At least one segment from a clip that has no audio → global timeline build does not fail (video-only concat).

---

## Plan doc note (Phase 0)

The plan file `.cursor/plans/clip_boundary_video_cuts_271fa2c4.plan.md` (if present in your environment) still had one contradictory sentence in Section 2 “Proposed Design” (Video paragraph) describing “per beat assembles the overlapping segments into one stitched clip.” If that file is editable in your workspace, replace that sentence with the single-flow description: compute beatsDurSec → cutTimes → build global timeline (pad-not-clamp) → slice per beat → renderVideoQuoteOverlay. No code depends on that doc change.
