# Caption Pipeline Semantic Contract Report

**Date**: 2024  
**Purpose**: Audit semantic consistency of caption positioning fields (`yPct`, `yPx_png`, `rasterH`, `totalTextH`, `lines`) across the entire pipeline from DOM measurement → preview → render.

**Contract Reference**: `docs/caption-meta-contract.md` (defines intended contract, but is legacy - does not cover V3 raster mode)

---

## SECTION 1 — Pipeline Map

### Stage 1: Client Overlay Meta Computation (DOM → meta)

**File**: `public/js/caption-overlay.js`  
**Function**: `computeCaptionMetaFromElements()` (lines 1391-1558)  
**Inputs**:
- `stageEl`: DOM element (#stage container)
- `boxEl`: DOM element (.caption-box)
- `contentEl`: DOM element (.caption-box .content)
- `frameW`: 1080 (default)
- `frameH`: 1920 (default)

**Computation Flow**:
1. **Lines extraction** (line 1442): Calls `extractRenderedLines(contentEl)` → uses Range API to detect browser-rendered line breaks
2. **totalTextH** (line 1476): `Math.round(contentEl.getBoundingClientRect().height)` → actual DOM height (includes line-height effects)
3. **rasterH** (lines 1483-1489): Calls `window.CaptionGeom.computeRasterH({ totalTextH, padTop, padBottom, shadowBlur, shadowOffsetY })` → includes padding + shadow
4. **yPct** (line 1493): `(boxRect.top - stageRect.top) / stageHeight` → **TOP-anchored** (box top position)
5. **yPx_png** (line 1502): `Math.round(yPct * frameH)` → frame-space pixels, top-left of raster PNG
6. **yPxFirstLine** (line 1509): `yPx_png + rasterPadding` → first line baseline

**Outputs**: `overlayMeta` object with all fields (lines 1511-1557)

**Next Stage**: Used by `measureBeatCaptionGeometry()` or `emitCaptionState()` → passed to preview payload builder

---

### Stage 2: Beat Preview Measurement (Offscreen DOM)

**File**: `public/js/caption-overlay.js`  
**Function**: `measureBeatCaptionGeometry(text, style)` (lines 1699-1811)  
**Inputs**:
- `text`: Beat text string
- `style`: Session-level caption style object (includes `yPct`, `wPct`, `fontPx`, etc.)

**Computation Flow**:
1. Creates offscreen DOM container matching #stage structure (lines 1734-1784)
2. Sets box position with `transform: translateY(-50%)` (line 1755) → **CENTERS box visually**
3. Calls `computeCaptionMetaFromElements()` (line 1793) → reuses Stage 1 logic
4. **CRITICAL**: Box is positioned by CENTER (CSS transform), but `computeCaptionMetaFromElements()` computes `yPct` from TOP (line 1493)

**Outputs**: Same `overlayMeta` shape as Stage 1

**Next Stage**: Passed to `buildBeatPreviewPayload()`

---

### Stage 3: Client Preview Payload Builder (meta → POST body)

**File**: `public/js/caption-preview.js`  
**Function**: `buildBeatPreviewPayload(text, overlayMeta)` (lines 691-742)  
**Inputs**:
- `text`: Beat text
- `overlayMeta`: Output from Stage 1 or Stage 2

**Computation Flow**:
1. **Pass-through**: All fields copied verbatim from `overlayMeta` (lines 697-740)
2. **No transformation**: `yPct`, `yPx_png`, `rasterH`, `totalTextH`, `lines` passed as-is

**Outputs**: V3 raster payload object (ready for POST)

**Next Stage**: POST to `/api/caption/preview`

---

### Stage 4: Server Preview Endpoint (POST body → server wrap → returned meta)

**File**: `src/routes/caption.preview.routes.js`  
**Route Handler**: `router.post("/caption/preview")` (lines 65-1038)  
**Function**: `renderCaptionRaster()` (lines 1083-1546)

**Inputs**:
- Request body (parsed by `RasterSchema`, lines 11-61)
- Client-provided: `lines`, `rasterH`, `totalTextH`, `yPx_png`, `yPct`

**Computation Flow**:

**4a. Rewrap Detection** (lines 1182-1291):
- Checks if client lines overflow `maxLineWidth` (lines 1185-1204)
- Checks for mid-word splits (lines 1206-1228)
- If rewrap needed: calls `wrapLinesWithFont()` (line 1241)
- Recomputes `serverTotalTextH` (line 1251) and `serverRasterH` (lines 1260-1266)

**4b. yPx_png Computation** (line 1346):
- `const yPx = meta.yPxFirstLine - padding`
- Uses client-provided `yPxFirstLine` (computed from old `rasterH`)
- **CRITICAL**: When rewrap occurs, `yPx` is NOT recomputed from `yPct` + new `rasterH`

**4c. Response Building** (lines 237-327):
- `finalLines`: Server-wrapped if rewrap, else client lines (line 238)
- `finalRasterH`: Server-recomputed if rewrap, else client value (line 239)
- `finalTotalTextH`: Server-recomputed if rewrap, else client value (line 240)
- `finalYPx_png`: **ALWAYS client value** (line 242) → **STALE after rewrap**

**4d. ssotMeta Building** (lines 278-327):
- `rasterH: finalRasterH` (line 291) → final value
- `yPx_png: finalYPx_png` (line 294) → **stale value** (not recomputed)
- `lines: finalLines` (line 323) → final value
- `totalTextH: finalTotalTextH` (line 325) → final value
- **MISSING**: `yPct` is NOT included in `ssotMeta` (should be line 278-327)

**Outputs**: `ssotMeta` object in response `data.meta`

**Next Stage**: Client preview renderer or render pipeline

---

### Stage 5: Client Preview Renderer (returned meta → visual placement)

**File**: `public/js/caption-preview.js`  
**Function**: `applyPreviewResultToBeatCard(beatCardEl, result)` (lines 903-975)

**Inputs**:
- `result.meta`: Server response `ssotMeta` from Stage 4

**Computation Flow**:
1. **yPct derivation** (line 936):
   - `const yPct = Number.isFinite(meta.yPct) ? meta.yPct : ((meta.yPx_png + meta.rasterH / 2) / meta.frameH)`
   - **CRITICAL**: If `meta.yPct` missing, derives CENTER from `yPx_png` (top) + `rasterH/2`
   - This assumes `yPx_png` is TOP-anchored (correct), but derivation creates CENTER-anchored `yPct`

2. **CSS positioning** (lines 952-954):
   - `--y-pct`: Used in CSS `top: calc(var(--y-pct) * 100%)`
   - `transform: translateY(-50%)` (from CSS class) → **CENTERS element**
   - **CRITICAL**: CSS centers the element, so `yPct` must represent CENTER position, but server may have computed it from TOP

**Outputs**: Visual overlay on beat card

**Next Stage**: User sees preview

---

### Stage 6: Server Render Pipeline (meta → FFmpeg filter graph)

**File**: `src/utils/ffmpeg.video.js`  
**Function**: `renderVideoQuoteOverlay()` (lines 744-1781)  
**Function**: `buildVideoChain()` (lines 382-651)

**Inputs**:
- `overlayCaption`: Caption meta object (from session storage or preview response)

**Computation Flow**:

**6a. Raster Placement Building** (lines 1516-1535):
- `rasterPlacement.y`: `overlayCaption.yPx_png ?? overlayCaption.yPx ?? 24` (line 1523)
- Uses `yPx_png` directly as FFmpeg overlay Y coordinate

**6b. FFmpeg Overlay Filter** (line 515):
- `overlay=${xExpr}:${y}:format=auto`
- `y` is `rasterPlacement.y` (from `yPx_png`)
- **CRITICAL**: FFmpeg `overlay` filter interprets Y as **top-left of overlay image**

**Outputs**: FFmpeg filter graph string

**Next Stage**: FFmpeg execution → final video

---

## SECTION 2 — Semantic Dictionary

### yPct

**Canonical Meaning** (per contract): Vertical position percentage (0=top, 0.5=center, 1=bottom) representing the **anchor point** of the text block.

**Stage 1 (Client DOM → meta)**:
- **Location**: `public/js/caption-overlay.js:1493`
- **Computation**: `(boxRect.top - stageRect.top) / stageHeight`
- **Semantic**: **TOP-anchored** (box top position, not center)
- **Contract Violation**: Computed from TOP, but contract says it should represent anchor point (which could be center)

**Stage 2 (Beat Preview)**:
- **Location**: `public/js/caption-overlay.js:1755` (box positioning), `1493` (yPct computation)
- **Semantic**: Box is positioned by CENTER (`transform: translateY(-50%)`), but `yPct` computed from TOP
- **Contract Violation**: Visual positioning uses CENTER, but `yPct` represents TOP

**Stage 3 (Payload Builder)**:
- **Location**: `public/js/caption-preview.js:698`
- **Semantic**: Pass-through (no transformation)
- **Contract Compliance**: Preserves client meaning (TOP-anchored)

**Stage 4 (Server Preview)**:
- **Location**: `src/routes/caption.preview.routes.js:242, 294`
- **Semantic**: Server receives `yPct` but **does NOT include it in response `ssotMeta`** (missing from lines 278-327)
- **Contract Violation**: Server should return `yPct` in response for client to use

**Stage 5 (Client Preview Renderer)**:
- **Location**: `public/js/caption-preview.js:936`
- **Semantic**: Derives CENTER from `yPx_png` (top) + `rasterH/2` if `meta.yPct` missing
- **Contract Violation**: Assumes `yPx_png` is TOP, derives CENTER `yPct`, but server may have computed `yPct` from TOP

**Stage 6 (FFmpeg Render)**:
- **Location**: `src/utils/ffmpeg.video.js:1523`
- **Semantic**: Not used directly (uses `yPx_png` instead)
- **Contract Compliance**: N/A (not used in render)

**Summary**: `yPct` is **TOP-anchored** in computation, but **CENTER-anchored** in CSS positioning (Stage 5), creating semantic mismatch.

---

### yPx_png

**Canonical Meaning**: Absolute Y position in frame-space pixels (0-1920) representing the **top-left corner** of the raster PNG overlay.

**Stage 1 (Client DOM → meta)**:
- **Location**: `public/js/caption-overlay.js:1502`
- **Computation**: `Math.round(yPct * frameH)`
- **Semantic**: Frame-space pixels, **top-left of raster PNG**
- **Contract Compliance**: Correct (TOP-anchored, frame-space)

**Stage 2 (Beat Preview)**:
- **Location**: `public/js/caption-overlay.js:1502` (via `computeCaptionMetaFromElements`)
- **Semantic**: Same as Stage 1
- **Contract Compliance**: Correct

**Stage 3 (Payload Builder)**:
- **Location**: `public/js/caption-preview.js:728`
- **Semantic**: Pass-through
- **Contract Compliance**: Preserves meaning

**Stage 4 (Server Preview)**:
- **Location**: `src/routes/caption.preview.routes.js:1346, 242, 294`
- **Computation**: `const yPx = meta.yPxFirstLine - padding` (line 1346)
- **Semantic**: Uses client-provided `yPxFirstLine` (computed from old `rasterH`) minus padding
- **Contract Violation**: When rewrap occurs and `rasterH` changes, `yPx_png` is NOT recomputed from `yPct` + new `rasterH`. Server keeps stale value (line 242: `const finalYPx_png = yPx_png`)

**Stage 5 (Client Preview Renderer)**:
- **Location**: `public/js/caption-preview.js:936, 944`
- **Semantic**: Treated as TOP-anchored (correct), used to derive CENTER `yPct`
- **Contract Compliance**: Correct interpretation

**Stage 6 (FFmpeg Render)**:
- **Location**: `src/utils/ffmpeg.video.js:1523, 398, 515`
- **Semantic**: Used directly as FFmpeg overlay Y coordinate (top-left of overlay)
- **Contract Compliance**: Correct (FFmpeg `overlay` filter uses Y as top-left)

**Summary**: `yPx_png` is **correctly TOP-anchored** throughout, but **becomes stale after server rewrap** (Stage 4 violation).

---

### rasterH

**Canonical Meaning**: Height of the raster PNG in pixels, including text height + padding + shadow effects.

**Stage 1 (Client DOM → meta)**:
- **Location**: `public/js/caption-overlay.js:1483-1489`
- **Computation**: `window.CaptionGeom.computeRasterH({ totalTextH, padTop, padBottom, shadowBlur, shadowOffsetY })`
- **Semantic**: Includes `totalTextH` + padding + shadow
- **Contract Compliance**: Correct

**Stage 2 (Beat Preview)**:
- **Location**: `public/js/caption-overlay.js:1483-1489` (via `computeCaptionMetaFromElements`)
- **Semantic**: Same as Stage 1
- **Contract Compliance**: Correct

**Stage 3 (Payload Builder)**:
- **Location**: `public/js/caption-preview.js:725`
- **Semantic**: Pass-through
- **Contract Compliance**: Preserves meaning

**Stage 4 (Server Preview)**:
- **Location**: `src/routes/caption.preview.routes.js:1260-1266, 239, 291`
- **Computation**: If rewrap occurs, recomputes `serverRasterH` from new `serverTotalTextH` + padding + shadow (lines 1260-1266)
- **Semantic**: Final value after rewrap (if occurred)
- **Contract Compliance**: Correct (recomputed when lines change)

**Stage 5 (Client Preview Renderer)**:
- **Location**: `public/js/caption-preview.js:938`
- **Semantic**: Used to compute normalized ratio for CSS
- **Contract Compliance**: Correct (uses final value from server)

**Stage 6 (FFmpeg Render)**:
- **Location**: `src/utils/ffmpeg.video.js:1520, 395, 460`
- **Semantic**: Used for validation/parity checks, not directly in filter
- **Contract Compliance**: Correct

**Summary**: `rasterH` is **correctly recomputed** when lines change (Stage 4), but dependent `yPx_png` is not updated.

---

### totalTextH

**Canonical Meaning**: Height of text block in pixels, excluding padding but including line spacing. Formula: `lines.length * fontPx + (lines.length - 1) * lineSpacingPx`.

**Stage 1 (Client DOM → meta)**:
- **Location**: `public/js/caption-overlay.js:1476`
- **Computation**: `Math.round(contentEl.getBoundingClientRect().height)`
- **Semantic**: Actual DOM height (includes line-height effects, may differ from formula)
- **Contract Violation**: Uses DOM height, not formula. May include extra space from line-height.

**Stage 2 (Beat Preview)**:
- **Location**: `public/js/caption-overlay.js:1476` (via `computeCaptionMetaFromElements`)
- **Semantic**: Same as Stage 1
- **Contract Violation**: Same as Stage 1

**Stage 3 (Payload Builder)**:
- **Location**: `public/js/caption-preview.js:733`
- **Semantic**: Pass-through
- **Contract Compliance**: Preserves client value

**Stage 4 (Server Preview)**:
- **Location**: `src/routes/caption.preview.routes.js:1251, 240, 325`
- **Computation**: If rewrap occurs, recomputes `serverTotalTextH = serverWrappedLines.length * fontPx + (serverWrappedLines.length - 1) * lineSpacingPx` (line 1251)
- **Semantic**: Uses formula (correct)
- **Contract Compliance**: Correct (recomputed when lines change)

**Stage 5 (Client Preview Renderer)**:
- **Location**: Not used directly
- **Contract Compliance**: N/A

**Stage 6 (FFmpeg Render)**:
- **Location**: Not used directly
- **Contract Compliance**: N/A

**Summary**: `totalTextH` is **computed from DOM height** on client (may differ from formula), but **recomputed from formula** on server after rewrap.

---

### lines

**Canonical Meaning**: Array of strings representing wrapped text lines. Should be "authoritative wrapped lines" (server-wrapped) or "client-rendered lines" (browser truth) depending on context.

**Stage 1 (Client DOM → meta)**:
- **Location**: `public/js/caption-overlay.js:1442, 2084-2160`
- **Computation**: `extractRenderedLines(contentEl)` → uses Range API to detect browser-rendered line breaks
- **Semantic**: **Client-rendered lines** (browser truth, may include word-splits)
- **Contract Compliance**: Correct (browser truth)

**Stage 2 (Beat Preview)**:
- **Location**: `public/js/caption-overlay.js:1442` (via `computeCaptionMetaFromElements`)
- **Semantic**: Same as Stage 1
- **Contract Compliance**: Correct

**Stage 3 (Payload Builder)**:
- **Location**: `public/js/caption-preview.js:732`
- **Semantic**: Pass-through
- **Contract Compliance**: Preserves client lines

**Stage 4 (Server Preview)**:
- **Location**: `src/routes/caption.preview.routes.js:1182-1291, 238, 323`
- **Computation**: If overflow detected, server rewraps using `wrapLinesWithFont()` (line 1241)
- **Semantic**: **Authoritative wrapped lines** (server-wrapped if rewrap occurred, else client lines)
- **Contract Compliance**: Correct (server is authoritative)

**Stage 5 (Client Preview Renderer)**:
- **Location**: Not used directly
- **Contract Compliance**: N/A

**Stage 6 (FFmpeg Render)**:
- **Location**: Used for ASS subtitle generation (karaoke), not for positioning
- **Contract Compliance**: N/A

**Summary**: `lines` are **client-rendered** initially, but **server-wrapped** if overflow detected. Server is authoritative.

---

## SECTION 3 — Mismatch Hunt (Contract Violations)

### Mismatch 1: yPct Anchor Inconsistency (TOP vs CENTER)

**Where it happens**:
- **Client computation**: `public/js/caption-overlay.js:1493` (TOP-anchored)
- **Client CSS positioning**: `public/js/caption-preview.js:936` + CSS `transform: translateY(-50%)` (CENTER-anchored)
- **Beat preview box positioning**: `public/js/caption-overlay.js:1755` (`transform: translateY(-50%)` centers box, but `yPct` computed from TOP)

**Why it is a semantic mismatch**:
Client computes `yPct` from box TOP position (`boxRect.top`), but CSS positions the element by CENTER (`translateY(-50%)`). When text grows and `rasterH` increases, the box top moves up (if `yPct` is constant), but the center should stay fixed. This creates drift: as text length increases, the preview moves upward because `yPct` represents TOP but CSS centers the element.

**What user-visible symptom it can cause**:
- **Upward drift**: Caption preview moves up as text length increases
- **Negative yPx_png**: Eventually `yPx_png` becomes negative, causing 400 INVALID_INPUT errors
- **Misalignment**: Preview position doesn't match final render position

---

### Mismatch 2: Stale yPx_png After Rewrap

**Where it happens**:
- **Server rewrap**: `src/routes/caption.preview.routes.js:1248-1291` (recomputes `serverRasterH` and `serverTotalTextH`)
- **Server response**: `src/routes/caption.preview.routes.js:242` (`const finalYPx_png = yPx_png` - keeps old value)
- **Server ssotMeta**: `src/routes/caption.preview.routes.js:294` (`yPx_png: finalYPx_png` - stale value)

**Why it is a semantic mismatch**:
When server rewraps lines and `rasterH` changes, `yPx_png` should be recomputed from `yPct` (center anchor) + new `rasterH`, but server keeps the old client value. This violates SSOT: the response meta should reflect the actual geometry used to draw the PNG, not the stale client geometry.

**What user-visible symptom it can cause**:
- **Upward drift**: As text grows and server rewraps, `rasterH` increases but `yPx_png` stays fixed, causing preview to drift up
- **400 errors**: Eventually `yPx_png` becomes negative (top of PNG above frame top)
- **Parity mismatch**: Preview position doesn't match final render (which uses stale `yPx_png`)

---

### Mismatch 3: Missing yPct in Server Response

**Where it happens**:
- **Server response building**: `src/routes/caption.preview.routes.js:278-327` (`ssotMeta` object)
- **Missing field**: `yPct` is NOT included in `ssotMeta` (should be added around line 278-327)

**Why it is a semantic mismatch**:
Server receives `yPct` in request but doesn't return it in response. Client preview renderer (Stage 5) tries to use `meta.yPct` but falls back to deriving it from `yPx_png` + `rasterH/2`. This creates inconsistency: if server rewraps and `rasterH` changes, the derived `yPct` will be wrong because `yPx_png` is stale.

**What user-visible symptom it can cause**:
- **Inconsistent positioning**: Client derives `yPct` from stale `yPx_png`, causing misalignment
- **Debugging difficulty**: Cannot verify if server used the same `yPct` as client

---

### Mismatch 4: PARITY_CHECKLIST Logs Stale Values

**Where it happens**:
- **Server logging**: `src/routes/caption.preview.routes.js:364-381` (`[PARITY_CHECKLIST]` log)
- **Stale values**: Logs `data.rasterH` and `data.yPx_png` (old client values) instead of `ssotMeta.rasterH` and `ssotMeta.yPx_png` (final server values)

**Why it is a semantic mismatch**:
`PARITY_CHECKLIST` is meant to verify parity between preview and render, but it logs stale client values instead of final server values. After rewrap, `ssotMeta.rasterH` is different from `data.rasterH`, but the log shows the old value, making debugging impossible.

**What user-visible symptom it can cause**:
- **False parity reports**: Logs show old values, making it appear that preview matches render when it doesn't
- **Debugging confusion**: Cannot verify actual values used in response

---

### Mismatch 5: totalTextH Computation Inconsistency (DOM vs Formula)

**Where it happens**:
- **Client computation**: `public/js/caption-overlay.js:1476` (uses DOM height)
- **Server recomputation**: `src/routes/caption.preview.routes.js:1251` (uses formula)

**Why it is a semantic mismatch**:
Client computes `totalTextH` from actual DOM height (may include extra space from line-height), but server recomputes from formula (`lines.length * fontPx + (lines.length - 1) * lineSpacingPx`). If DOM height differs from formula (due to line-height effects), client and server will have different `totalTextH` values, causing `rasterH` mismatch.

**What user-visible symptom it can cause**:
- **rasterH mismatch**: Client and server compute different `rasterH` values, causing preview size mismatch
- **Parity failure**: Preview PNG size doesn't match render PNG size

---

## SECTION 4 — Anchor Consistency Proof

### Question 1: Does the client compute yPct from the same anchor that the box is visually positioned with?

**Answer**: **NO**

**Evidence**:
- **Box positioning**: `public/js/caption-overlay.js:1755` sets `transform: translateY(-50%)` → **CENTERS box visually**
- **yPct computation**: `public/js/caption-overlay.js:1493` computes `(boxRect.top - stageRect.top) / stageHeight` → **TOP-anchored**

**Conclusion**: Box is positioned by CENTER, but `yPct` is computed from TOP. This is a semantic mismatch.

---

### Question 2: Does the server treat yPct consistently with the client meaning?

**Answer**: **PARTIALLY**

**Evidence**:
- **Server receives**: `yPct` in request body (line 205)
- **Server uses**: Not used directly (server uses `yPx_png` for positioning)
- **Server returns**: **NOT included in response `ssotMeta`** (missing from lines 278-327)

**Conclusion**: Server doesn't use `yPct` for positioning, but should return it in response for client consistency.

---

### Question 3: Does the server ever change rasterH/lines and keep yPx_png unchanged?

**Answer**: **YES**

**Evidence**:
- **Location**: `src/routes/caption.preview.routes.js:238-242`
- **Code**: 
  ```javascript
  const finalRasterH = rasterResult.rewrapped ? rasterResult.serverRasterH : rasterH;
  const finalYPx_png = yPx_png;  // ❌ Always keeps old value
  ```
- **When**: When `rasterResult.rewrapped === true`, `finalRasterH` changes but `finalYPx_png` stays unchanged

**Conclusion**: Server changes `rasterH` after rewrap but keeps `yPx_png` unchanged. This violates SSOT: `yPx_png` should be recomputed from `yPct` + new `rasterH`.

---

### Question 4: Does the client preview renderer apply any additional centering offsets on top of yPx_png?

**Answer**: **YES**

**Evidence**:
- **Location**: `public/js/caption-preview.js:936, 952-954`
- **Code**:
  ```javascript
  const yPct = Number.isFinite(meta.yPct) ? meta.yPct : ((meta.yPx_png + meta.rasterH / 2) / meta.frameH);
  overlayImg.style.setProperty('--y-pct', yPct);
  // CSS: top: calc(var(--y-pct) * 100%); transform: translateY(-50%);
  ```
- **Behavior**: If `meta.yPct` missing, derives CENTER from `yPx_png` (top) + `rasterH/2`, then CSS centers the element with `translateY(-50%)`

**Conclusion**: Client applies centering transform (`translateY(-50%)`), which assumes `yPct` represents CENTER. But if `yPct` is missing and derived from stale `yPx_png`, the centering will be wrong.

---

### Question 5: Does FFmpeg placement use yPx_png as top-left of overlay?

**Answer**: **YES**

**Evidence**:
- **Location**: `src/utils/ffmpeg.video.js:1523, 398, 515`
- **Code**:
  ```javascript
  y: overlayCaption.yPx_png ?? overlayCaption.yPx ?? 24
  const overlayExpr = `[vmain][ovr]overlay=${xExpr}:${y}:format=auto[vout]`;
  ```
- **FFmpeg semantics**: `overlay=x:y` uses Y as **top-left** of overlay image

**Conclusion**: FFmpeg correctly interprets `yPx_png` as top-left of overlay. This is correct, but if `yPx_png` is stale (after rewrap), the overlay will be positioned incorrectly.

---

## SECTION 5 — Single Truth Checklist (SSOT Compliance)

### Server-Owned Fields (per `caption.preview.routes.js`)

**Fields server claims to own** (from response `ssotMeta`, lines 278-327):
- `rasterH`: ✅ Server recomputes if rewrap occurs (line 291)
- `totalTextH`: ✅ Server recomputes if rewrap occurs (line 325)
- `lines`: ✅ Server wraps if overflow detected (line 323)
- `rasterUrl`: ✅ Server generates PNG (line 289)
- `rasterHash`: ✅ Server computes hash (line 297)
- `previewFontString`: ✅ Server uses exact font (line 298)
- `yPx_png`: ❌ **NOT recomputed after rewrap** (line 294 uses stale value)

**Missing from response**:
- `yPct`: ❌ **NOT included in `ssotMeta`** (should be added)

---

### Client Compliance

**1. Does client send fields correctly?**

**Answer**: **YES** (with caveats)

- **Location**: `public/js/caption-preview.js:691-742` (`buildBeatPreviewPayload`)
- **Behavior**: Client sends all required fields including `lines`, `rasterH`, `totalTextH`, `yPx_png`, `yPct`
- **Caveat**: Client `lines` may be word-split (one word per line), causing server rewrap

---

**2. Does client re-derive fields after response?**

**Answer**: **YES** (violation)

- **Location**: `public/js/caption-preview.js:936`
- **Behavior**: If `meta.yPct` missing, client derives it from `yPx_png` + `rasterH/2`
- **Violation**: Client should NOT re-derive. Server should provide `yPct` in response.

---

**3. Does client use server meta values for rendering placement?**

**Answer**: **PARTIALLY**

- **Location**: `public/js/caption-preview.js:936-954`
- **Behavior**: 
  - Uses `meta.rasterH` for CSS ratio ✅
  - Uses `meta.rasterW` for CSS ratio ✅
  - Derives `yPct` from `meta.yPx_png` if missing ❌ (should use server-provided `yPct`)
  - Uses derived `yPct` for CSS positioning ✅ (but may be wrong if `yPx_png` is stale)

---

## SECTION 6 — Minimal Experiment Plan (Instrumentation Only)

### Experiment 1: Client-Side yPct Anchor Verification

**Purpose**: Verify that `yPct` computation matches box visual positioning anchor.

**Location**: `public/js/caption-overlay.js:1493` (after `yPct` computation)

**Log Statement**:
```javascript
console.log('[SEMANTIC:CLIENT:yPct-anchor]', {
  yPct: yPct,
  boxTop: boxRect.top - stageRect.top,
  boxCenter: (boxRect.top + boxRect.height / 2) - stageRect.top,
  boxHeight: boxRect.height,
  stageHeight: stageHeight,
  computedFromTop: (boxRect.top - stageRect.top) / stageHeight,
  computedFromCenter: ((boxRect.top + boxRect.height / 2) - stageRect.top) / stageHeight,
  cssTransform: getComputedStyle(boxEl).transform,  // Should show translateY(-50%)
  visualAnchor: 'CENTER'  // Box is centered via CSS
});
```

**Expected Result**: 
- `yPct` should equal `computedFromCenter` (if CENTER-anchored) or `computedFromTop` (if TOP-anchored)
- If `cssTransform` shows `translateY(-50%)`, then `yPct` should be CENTER-anchored

---

### Experiment 2: Server-Side Rewrap + yPx_png Recompute Check

**Purpose**: Verify that `yPx_png` is recomputed from `yPct` + `finalRasterH` when rewrap occurs.

**Location**: `src/routes/caption.preview.routes.js:242` (after `finalYPx_png` assignment)

**Log Statement**:
```javascript
if (rasterResult.rewrapped) {
  const yPct = data.yPct ?? 0.5;
  const expectedYPx_png = Math.round(yPct * data.frameH - finalRasterH / 2);
  const clampedYPx_png = Math.max(0, Math.min(expectedYPx_png, data.frameH - finalRasterH));
  
  console.log('[SEMANTIC:SERVER:rewrap-yPx]', {
    rewrapped: true,
    oldRasterH: rasterH,
    newRasterH: finalRasterH,
    oldYPx_png: yPx_png,
    finalYPx_png: finalYPx_png,
    yPct: yPct,
    expectedYPx_png: expectedYPx_png,
    clampedYPx_png: clampedYPx_png,
    shouldRecompute: finalYPx_png !== clampedYPx_png,
    mismatch: Math.abs(finalYPx_png - clampedYPx_png)
  });
}
```

**Expected Result**:
- If `shouldRecompute === true`, then `yPx_png` is stale and should be recomputed
- `mismatch` shows how far off the stale value is

---

### Experiment 3: FFmpeg Overlay Y Coordinate Verification

**Purpose**: Verify that FFmpeg uses `yPx_png` as top-left of overlay (not center).

**Location**: `src/utils/ffmpeg.video.js:515` (after `overlayExpr` construction)

**Log Statement**:
```javascript
console.log('[SEMANTIC:FFMPEG:overlay-y]', {
  yPx_png: placement.y,
  rasterH: placement.rasterH,
  frameH: height || 1920,
  overlayExpr: overlayExpr,
  yInterpretation: 'top-left',  // FFmpeg overlay uses Y as top-left
  yCenter: placement.y + placement.rasterH / 2,
  yPctFromTop: placement.y / (height || 1920),
  yPctFromCenter: (placement.y + placement.rasterH / 2) / (height || 1920)
});
```

**Expected Result**:
- `yInterpretation` confirms FFmpeg uses Y as top-left
- `yPctFromCenter` shows the center position (for comparison with client `yPct`)

---

## Summary of Contract Violations

1. **yPct Anchor Mismatch**: Client computes from TOP, but CSS positions by CENTER
2. **Stale yPx_png After Rewrap**: Server changes `rasterH` but keeps old `yPx_png`
3. **Missing yPct in Response**: Server doesn't return `yPct` in `ssotMeta`
4. **PARITY_CHECKLIST Stale Values**: Logs old client values instead of final server values
5. **totalTextH Computation Inconsistency**: Client uses DOM height, server uses formula

**Primary Root Cause**: `yPct` is TOP-anchored in computation but CENTER-anchored in CSS positioning, and `yPx_png` is not recomputed when `rasterH` changes after rewrap.

**Impact**: Upward drift as text length increases, eventually causing negative `yPx_png` and 400 errors.



