# Caption Meta Contract - V3 Raster Mode

**SSOT Documentation** - Complete field semantics dictionary for V3 raster mode caption pipeline.

## Locked Invariants

### 1. yPx_png Semantics

**Invariant**: `yPx_png` is the **TOP-left Y coordinate** of the raster PNG in frame-space pixels (0-1920).

**Anchor**: TOP-left (not center, not baseline).

**Usage**:

- **Client**: Computed from TOP-anchored `yPct` → `yPx_png = Math.round(yPct * frameH)`
- **Server**: Echoed unchanged (even after rewrap)
- **FFmpeg**: Used as overlay Y coordinate (top-left anchor)

**Code References**:

- Production: `public/js/caption-overlay.js:1502` (`computeCaptionMetaFromElements`)
- Server echo: `src/routes/caption.preview.routes.js:242` (`const finalYPx_png = yPx_png`)
- FFmpeg usage: `src/utils/ffmpeg.video.js:1523, 515` (`rasterPlacement.y = overlayCaption.yPx_png`)

### 2. Beat Preview Positioning

**Invariant**: Beat preview overlays must be **TOP-anchored** (no `translateY(-50%)` centering transform).

**Rationale**: Matches FFmpeg overlay semantics (top-left anchor).

**Beat Preview Positioning**:

- Beat preview overlays use TOP-left anchor (FFmpeg overlay semantics) - no `translateY(-50%)` centering transform
- `yPct` is derived from `meta.yPx_png / meta.frameH` (TOP position, not center)
- CSS: `top: calc(var(--y-pct) * 100%)` matches FFmpeg overlay semantics

**Code Reference**: `public/js/caption-preview.js:935-950` (`applyPreviewResultToBeatCard`)

### 3. FFmpeg Overlay Anchor

**Invariant**: FFmpeg `overlay=x:y` filter uses Y as **top-left** of overlay image.

**Code Reference**: `src/utils/ffmpeg.video.js:515` (`overlay=${xExpr}:${y}:format=auto`)

---

## Canonical Semantics & Ownership

### yPx_png

**Canonical Meaning**: TOP-left Y coordinate of the raster PNG in frame-space pixels.

**Units**: Frame-space pixels (0-1920 for 1080×1920 frame).

**Anchor Semantics**: TOP-left (not center, not baseline).

**Ownership**: Client computes, server echoes (unchanged even after rewrap).

**Layer Usage**:

- **Client DOM**: Computed from box top position
- **Server Preview**: Echoed in response (line 242: unchanged after rewrap)
- **Client Preview**: Used to derive TOP yPct for CSS positioning
- **Render Pipeline**: Used as FFmpeg overlay Y coordinate

**Code References**:

- `public/js/caption-overlay.js:1502` - Production
- `src/routes/caption.preview.routes.js:242` - Server echo
- `public/js/caption-preview.js:935` - Client derivation
- `src/utils/ffmpeg.video.js:1523` - Render consumption

### yPct

**Canonical Meaning**: Vertical position percentage (0=top, 1=bottom) representing **TOP position** of caption box.

**Units**: Normalized percentage (0.0-1.0).

**Anchor Semantics**: TOP-anchored (box top position, not center).

**Status in V3 Raster**: **Informational/debug-only** (not used for positioning).

**Ownership**: Client computes, server ignores for positioning (optional in request, not in response).

**Decision**: yPct is **defined as TOP yPct only** (no center meaning anywhere in V3 raster mode). It is kept for backward compatibility and debugging but is not authoritative for positioning.

**Layer Usage**:

- **Client DOM**: Computed from box top (`(boxRect.top - stageRect.top) / stageHeight`)
- **Client Payload**: Passed to server (optional, not used for positioning)
- **Server Preview**: Ignored (comment: "Not used in raster, but pass for consistency")
- **Server Response**: Not included in `ssotMeta`
- **Client Preview**: Derived from `yPx_png / frameH` when needed

**Code References**:

- `public/js/caption-overlay.js:1493` - Production (TOP-anchored)
- `src/routes/caption.preview.routes.js:59` - Optional in schema
- `src/routes/caption.preview.routes.js:205` - Server comment (not used)
- `public/js/caption-preview.js:935` - Client derivation (TOP)

### rasterH

**Canonical Meaning**: Height of the raster PNG in pixels, including text height + padding + shadow effects.

**Units**: Frame-space pixels (typically < 600px for tight PNG).

**Anchor Semantics**: N/A (dimension, not position).

**Ownership**: Client computes, server may recompute if rewrap occurs.

**Layer Usage**:

- **Client DOM**: Computed via `window.CaptionGeom.computeRasterH()`
- **Client Payload**: Passed to server
- **Server Preview**: Echoed (or recomputed if rewrap)
- **Client Preview**: Used for CSS ratio calculation
- **Render Pipeline**: Used for validation/parity checks

**Code References**:

- `public/js/caption-overlay.js:1483-1489` - Production
- `src/routes/caption.preview.routes.js:239, 291` - Server echo/recompute
- `public/js/caption-preview.js:937` - Client consumption

### rasterW

**Canonical Meaning**: Width of the raster PNG in pixels, tight to text content + padding.

**Units**: Frame-space pixels (typically < 600px for tight PNG).

**Anchor Semantics**: N/A (dimension, not position).

**Ownership**: Client computes, server echoes (width doesn't change on rewrap).

**Layer Usage**:

- **Client DOM**: Computed from box width scaled to frame space
- **Client Payload**: Passed to server
- **Server Preview**: Echoed unchanged
- **Client Preview**: Used for CSS ratio calculation
- **Render Pipeline**: Used for validation/parity checks

**Code References**:

- `public/js/caption-overlay.js:1479-1480` - Production
- `src/routes/caption.preview.routes.js:290` - Server echo
- `public/js/caption-preview.js:936` - Client consumption

### totalTextH

**Canonical Meaning**: Height of text block in pixels, excluding padding but including line spacing.

**Formula**: `lines.length * fontPx + (lines.length - 1) * lineSpacingPx`

**Units**: Frame-space pixels.

**Anchor Semantics**: N/A (dimension, not position).

**Ownership**: Client computes (DOM height), server may recompute if rewrap occurs (formula-based).

**Layer Usage**:

- **Client DOM**: Computed from `contentEl.getBoundingClientRect().height` (may differ from formula due to line-height effects)
- **Client Payload**: Passed to server
- **Server Preview**: Echoed (or recomputed from formula if rewrap)
- **Client Preview**: Not used directly
- **Render Pipeline**: Not used directly

**Code References**:

- `public/js/caption-overlay.js:1476` - Production (DOM height)
- `src/routes/caption.preview.routes.js:1251` - Server recomputation (formula)
- `src/routes/caption.preview.routes.js:240, 325` - Server echo/recompute

### lines

**Canonical Meaning**: Array of strings representing wrapped text lines. Browser-rendered (client) or server-wrapped (if rewrap occurred).

**Units**: Array of strings (no units).

**Anchor Semantics**: N/A (content, not position).

**Ownership**: Client provides (browser-rendered), server is authoritative if rewrap occurs.

**Layer Usage**:

- **Client DOM**: Extracted via `extractRenderedLines()` using Range API
- **Client Payload**: Passed to server (browser truth)
- **Server Preview**: Echoed (or rewrapped if overflow detected)
- **Client Preview**: Not used directly
- **Render Pipeline**: Used for ASS subtitle generation (karaoke)

**Code References**:

- `public/js/caption-overlay.js:1442` - Production (Range API)
- `src/routes/caption.preview.routes.js:1241` - Server rewrap
- `src/routes/caption.preview.routes.js:238, 323` - Server echo/rewrap

### yPxFirstLine

**Canonical Meaning**: Y coordinate of first line baseline in frame-space pixels.

**Formula**: `yPx_png + rasterPadding`

**Units**: Frame-space pixels (0-1920).

**Anchor Semantics**: Baseline (first line text baseline).

**Ownership**: Client computes, server echoes (or derives from `yPx_png + rasterPadding`).

**Status**: **Debug-only** (not used for positioning in V3 raster mode).

**Layer Usage**:

- **Client DOM**: Computed as `yPx_png + rasterPadding`
- **Client Payload**: Passed to server (required by schema)
- **Server Preview**: Echoed (or derived if missing)
- **Client Preview**: Not used
- **Render Pipeline**: Not used (uses `yPx_png` only)

**Code References**:

- `public/js/caption-overlay.js:1509` - Production
- `src/routes/caption.preview.routes.js:151` - Server derivation (fallback)
- `src/routes/caption.preview.routes.js:54` - Required in schema

### rasterPadding

**Canonical Meaning**: Average vertical padding in pixels (average of top and bottom padding).

**Units**: Frame-space pixels (typically 24px).

**Anchor Semantics**: N/A (dimension, not position).

**Ownership**: Client computes, server echoes.

**Layer Usage**:

- **Client DOM**: Computed as `Math.round((cssPaddingTop + cssPaddingBottom) / 2)`
- **Client Payload**: Passed to server
- **Server Preview**: Echoed unchanged
- **Client Preview**: Not used directly
- **Render Pipeline**: Used for validation/parity checks

**Code References**:

- `public/js/caption-overlay.js:1490` - Production
- `src/routes/caption.preview.routes.js:292` - Server echo

### previewFontString

**Canonical Meaning**: Exact font string used by browser for rendering (e.g., `"normal bold 48px \"DejaVu Sans\""`).

**Units**: CSS font string (no units).

**Anchor Semantics**: N/A (typography, not position).

**Ownership**: Client provides (browser truth), server echoes (validates parity).

**Layer Usage**:

- **Client DOM**: Extracted from `getComputedStyle(contentEl).font`
- **Client Payload**: Passed to server
- **Server Preview**: Echoed (validates against server font)
- **Client Preview**: Not used
- **Render Pipeline**: Used for parity validation

**Code References**:

- `public/js/caption-overlay.js:1451` - Production
- `src/routes/caption.preview.routes.js:1326-1338` - Server validation
- `src/routes/caption.preview.routes.js:298` - Server echo

---

## Request Schema (V3 Raster Mode)

**Route**: `POST /api/caption/preview`  
**Schema**: `RasterSchema` (Zod)  
**Location**: `src/routes/caption.preview.routes.js:11-61`

### Required Fields

| Field          | Type                 | Range         | Description                             |
| -------------- | -------------------- | ------------- | --------------------------------------- |
| `ssotVersion`  | `3` (literal)        | -             | Must be exactly `3`                     |
| `mode`         | `'raster'` (literal) | -             | Must be exactly `'raster'`              |
| `text`         | `string`             | min 1 char    | Caption text content                    |
| `lines`        | `string[]`           | min 1 element | Browser-rendered line breaks (REQUIRED) |
| `totalTextH`   | `number` (int)       | min 1         | Text block height in pixels (REQUIRED)  |
| `yPxFirstLine` | `number` (int)       | -             | First line baseline Y (REQUIRED)        |
| `rasterW`      | `number` (int)       | 100-1080      | Raster PNG width (REQUIRED)             |
| `rasterH`      | `number` (int)       | 50-1920       | Raster PNG height (REQUIRED)            |
| `yPx_png`      | `number` (int)       | 0-1920        | TOP-left Y of raster PNG (REQUIRED)     |
| `fontPx`       | `number` (int)       | 8-400         | Font size in pixels                     |

### Optional Fields (with defaults)

| Field               | Type           | Default             | Description                                                  |
| ------------------- | -------------- | ------------------- | ------------------------------------------------------------ |
| `xPx_png`           | `number` (int) | -                   | Absolute X position (optional)                               |
| `xExpr_png`         | `string`       | `'(W-overlay_w)/2'` | X expression (fallback)                                      |
| `rasterPadding`     | `number` (int) | 24                  | Average vertical padding                                     |
| `frameW`            | `number` (int) | 1080                | Frame width                                                  |
| `frameH`            | `number` (int) | 1920                | Frame height                                                 |
| `lineSpacingPx`     | `number`       | 0                   | Line spacing in pixels                                       |
| `letterSpacingPx`   | `number`       | 0                   | Letter spacing in pixels                                     |
| `yPct`              | `number`       | -                   | TOP position percentage (optional, not used for positioning) |
| `xPct`              | `number`       | -                   | X position percentage (optional)                             |
| `wPct`              | `number`       | -                   | Width percentage (optional)                                  |
| `textRaw`           | `string`       | -                   | Raw text with newlines                                       |
| `previewFontString` | `string`       | -                   | Browser font string (for parity validation)                  |

**Note**: Server **cannot derive** required fields. Client must provide `lines`, `totalTextH`, `rasterW`, `rasterH`, `yPx_png`, `yPxFirstLine` (SSOT principle - client measurements are authoritative).

---

## Response Schema (V3 Raster Mode)

**Response**: `{ ok: true, data: { meta: ssotMeta } }`  
**Location**: `src/routes/caption.preview.routes.js:404-414`

### Response Structure

```javascript
{
  ok: true,
  data: {
    imageUrl: null,  // V3 raster mode returns PNG in meta.rasterUrl
    wPx: 1080,
    hPx: 1920,
    xPx: 0,
    meta: {
      // Geometry (SSOT)
      ssotVersion: 3,
      mode: 'raster',
      frameW: 1080,
      frameH: 1920,
      rasterUrl: "data:image/png;base64,...",
      rasterW: number,           // Client value (or server-recomputed if rewrap)
      rasterH: number,            // Client value (or server-recomputed if rewrap)
      rasterPadding: number,      // Client value
      xExpr_png: "(W-overlay_w)/2",
      yPx_png: number,            // Client value (unchanged even after rewrap)

      // Integrity hashes
      rasterHash: string,         // SHA-256 hash (first 16 chars)
      previewFontString: string,  // Exact font string used
      previewFontHash: string,    // Font string hash

      // Typography (echoed from request)
      text: string,
      fontPx: number,
      fontFamily: string,
      weightCss: string,
      fontStyle: string,
      textAlign: string,
      letterSpacingPx: number,
      textTransform: string,

      // Color & effects (echoed from request)
      color: string,
      opacity: number,
      strokePx: number,
      strokeColor: string,
      shadowColor: string,
      shadowBlur: number,
      shadowOffsetX: number,
      shadowOffsetY: number,

      // Line data (SSOT - server-wrapped if rewrap occurred)
      lines: string[],            // Server-wrapped if rewrap, else client lines
      lineSpacingPx: number,
      totalTextH: number,         // Server-recomputed if rewrap, else client value

      // Geometry lock (for render parity)
      bgScaleExpr: string,
      bgCropExpr: string
    }
  }
}
```

### Server Authority on Rewrap

**When rewrap occurs** (server detects line overflow or mid-word splits):

- **Server is authoritative** for: `lines`, `totalTextH`, `rasterH`
- **Server recomputes**: `serverTotalTextH`, `serverRasterH` from server-wrapped lines
- **Server keeps unchanged**: `yPx_png` (no positioning policy change)

**Rewrap Behavior**:
When server detects line overflow or mid-word splits:

- Server rewraps lines using `wrapLinesWithFont()` (authoritative)
- Server recomputes `totalTextH` from formula: `lines.length * fontPx + (lines.length - 1) * lineSpacingPx`
- Server recomputes `rasterH` from new `totalTextH` + padding + shadow
- Server keeps `yPx_png` unchanged (no positioning policy change)
- Client must use server response `meta.lines`, `meta.totalTextH`, `meta.rasterH` as SSOT

**Response meta is SSOT**: Client must use server-provided `lines`, `totalTextH`, `rasterH` from response when rewrap occurred.

**Code References**:

- Rewrap detection: `src/routes/caption.preview.routes.js:1182-1291` (`renderCaptionRaster`)
- Server recomputation: `src/routes/caption.preview.routes.js:1251, 1260-1266`
- Response building: `src/routes/caption.preview.routes.js:238-240, 291, 323, 325`

---

## Legacy Contract Notes

**File**: `docs/caption-meta-contract.md`

**Status**: **Outdated** (does not cover V3 raster mode).

**Key Differences**:

1. **yPct semantics**: Legacy doc defines `yPct` as "anchor point" with placement semantics (top/center/bottom). V3 raster uses `yPx_png` (TOP-left) only, and `yPct` is informational/debug-only.
2. **Positioning**: Legacy doc uses `yPct` for positioning. V3 raster uses `yPx_png` (absolute pixels).
3. **Server authority**: Legacy doc doesn't cover server rewrap authority. V3 raster explicitly defines server authority on `lines`, `totalTextH`, `rasterH` when rewrap occurs.
4. **Field set**: Legacy doc doesn't include V3 raster fields (`rasterW`, `rasterH`, `yPx_png`, `rasterPadding`, etc.).

**Action**: Mark legacy doc as deprecated, reference this V3 contract for all new work.

---

## Future Placement Spec (top/center/bottom)

**Note**: This section defines future placement semantics. Current V3 raster mode uses TOP-anchored `yPx_png` only.

### Placement-Based yPx_png Calculation

When implementing placement presets (`'top'`, `'center'`, `'bottom'`), compute `yPx_png` as follows:

```javascript
/**
 * Compute yPx_png from placement preset (future spec)
 * @param {string} placement - 'top' | 'center' | 'bottom'
 * @param {number} rasterH - Raster PNG height
 * @param {number} frameH - Frame height (default 1920)
 * @returns {number} yPx_png (TOP-left Y of raster PNG)
 */
function computeYPxFromPlacement(placement, rasterH, frameH = 1920) {
  const safeTopMargin = Math.max(50, frameH * 0.05); // 96px for 1920px
  const safeBottomMargin = frameH * 0.08; // 154px for 1920px

  let targetTop;
  switch (placement) {
    case 'top':
      // Place raster top at safe top margin
      targetTop = safeTopMargin;
      break;
    case 'center':
      // Center raster vertically: frame center - half raster height
      targetTop = frameH / 2 - rasterH / 2;
      break;
    case 'bottom':
      // Place raster bottom at safe bottom margin
      targetTop = frameH - safeBottomMargin - rasterH;
      break;
    default:
      // Default to center
      targetTop = frameH / 2 - rasterH / 2;
  }

  // Clamp to safe margins (ensure raster doesn't clip)
  const yPx_png = Math.max(safeTopMargin, Math.min(targetTop, frameH - safeBottomMargin - rasterH));

  return Math.round(yPx_png);
}
```

**Key Points**:

- `yPx_png` remains TOP-left of raster PNG (invariant)
- Placement affects the **target top position** calculation
- Safe margins prevent clipping (5% top, 8% bottom)
- Formula: `targetTop = f(placement, rasterH, frameH)` then clamp to safe margins

**Current State**: V3 raster mode does not use placement presets. Client computes `yPx_png` from DOM box position (TOP-anchored `yPct`).

**Code Reference**: `public/js/caption-overlay.js:1362` (`snapToPlacement` function uses similar logic for live overlay, but not for beat previews)

---

## How to Verify

1. **Verify yPx_png is TOP-left**:
   - Check client computation: `caption-overlay.js:1502` (`yPx_png = Math.round(yPct * frameH)` where `yPct` is from box top)
   - Check server echo: `caption.preview.routes.js:242` (unchanged after rewrap)
   - Check FFmpeg usage: `ffmpeg.video.js:515` (overlay Y is top-left)

2. **Verify yPct is informational only**:
   - Check server schema: `caption.preview.routes.js:59` (optional)
   - Check server comment: `caption.preview.routes.js:205` ("Not used in raster")
   - Check response: `caption.preview.routes.js:278-327` (not in `ssotMeta`)

3. **Verify server authority on rewrap**:
   - Trigger rewrap (send lines that overflow)
   - Check server logs: `[geom:server] Using server-recomputed values`
   - Verify response `meta.lines`, `meta.totalTextH`, `meta.rasterH` differ from request
   - Verify response `meta.yPx_png` matches request (unchanged)

---

## Cleanup Candidates

**Documentation only** - no code changes:

1. **Legacy contract doc**: `docs/caption-meta-contract.md`
   - **Status**: Outdated (does not cover V3 raster mode)
   - **Issue**: Defines `yPct` as anchor point with placement semantics, but V3 raster uses `yPx_png` (TOP-left) only
   - **Action**: Mark as legacy, reference new V3 contract docs

2. **yPxFirstLine field**: Present in payload but not used in render
   - **Status**: Debug-only field (computed as `yPx_png + rasterPadding`)
   - **Issue**: Adds complexity without functional benefit
   - **Action**: Consider deprecating if not needed for debugging

3. **yPct in V3 raster**: Optional field, not used for positioning
   - **Status**: Informational/debug-only
   - **Issue**: May cause confusion (present but not authoritative)
   - **Action**: Document clearly as informational only, consider removing from request schema if not needed

4. **Duplicate preview apply paths**: Confirmed duplicate
   - **SSOT**: `applyPreviewResultToBeatCard()` in `caption-preview.js` (lines 903-971) - **Canonical**
   - **Duplicate**: `BeatPreviewManager.applyPreview()` in `creative.html` (lines 6476-6518) - Inline implementation
   - **Issue**: `BeatPreviewManager.applyPreview()` duplicates logic from `applyPreviewResultToBeatCard()` (same DOM manipulation, same CSS variables)
   - **Action**: Refactor `BeatPreviewManager.applyPreview()` to call `applyPreviewResultToBeatCard()` instead of duplicating logic
