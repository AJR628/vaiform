# Preview ↔ Render Caption Parity Report

**Date**: 2026-01-07  
**Status**: ✅ Parity System Implemented (V3 Raster Mode)  
**Version**: SSOT v3

---

## 1. Executive Summary

### What Parity Means in Vaiform

**Preview ↔ Render Parity** ensures that the caption overlay shown in the Creative Studio beat preview **exactly matches** the caption overlay in the final rendered video. This includes:

- **Visual appearance**: Same font, size, weight, color, stroke, shadow
- **Position**: Same vertical/horizontal placement (TOP-left anchor semantics)
- **Geometry**: Same dimensions (`rasterW`, `rasterH`), same line wrapping
- **Content**: Same text, same line breaks

### Current State: "Preview Now Matches Render"

**What is Guaranteed**:
- ✅ **V3 Raster Mode**: Preview and render both use the same PNG overlay (bit-identical)
- ✅ **SSOT Wrapping**: Both preview and render use the same line-wrapping algorithm (`wrapTextWithFont()`)
- ✅ **Width Semantics**: Both use the same width calculation (`deriveCaptionWrapWidthPx()`)
- ✅ **Position Semantics**: Both use TOP-left anchor (`yPx_png` in frame-space pixels)
- ✅ **Font Parity**: Server validates and echoes `previewFontString` for font matching
- ✅ **PNG Integrity**: `rasterHash` ensures preview PNG matches render PNG

**What is NOT Guaranteed** (by design):
- ⚠️ **ASS Karaoke Overlay**: Render may add ASS subtitles on top of PNG for word-level highlighting (karaoke effect)
- ⚠️ **Per-Beat Text**: Single session-level `overlayCaption` with single PNG; text varies per beat but PNG is constant (design limitation)
- ⚠️ **Legacy Paths**: Old preview paths (v1/v2) are disabled; only V3 raster mode is supported

**Parity Enforcement**:
- Server rewraps lines if client lines overflow or have broken words (server is authoritative)
- Server recomputes `rasterH` and `totalTextH` when rewrap occurs, but keeps `yPx_png` unchanged
- Render validates PNG hash (`rasterHash`) and frame dimensions before using overlay
- Render fails fast if preview was made for different dimensions or PNG hash mismatch

---

## 2. Terminology & SSOT Contract

### Core Terms

- **SSOT (Single Source of Truth)**: The server is authoritative for line wrapping, geometry, and font rendering. Client provides measurements, server validates/rewraps if needed.

- **overlayCaption**: Session-level caption metadata object stored in `session.overlayCaption`. Contains style, geometry, and PNG data (`rasterUrl`, `rasterHash`). Same object applies to all beats (text varies per beat).

- **captionStyle**: Alternative session field (`session.captionStyle`) for UI-only style settings (not yet fully wired for persistence). Render falls back to `session.overlayCaption || session.captionStyle`.

- **caption meta**: Client-side `overlayMeta` object produced by DOM measurement. Contains geometry (`rasterW`, `rasterH`, `yPx_png`), typography (`fontPx`, `weightCss`), and line data (`lines[]`).

- **raster PNG**: Transparent PNG overlay containing rendered caption text. Generated server-side using node-canvas, returned as base64 data URL (`rasterUrl`).

- **ASS karaoke**: ASS subtitle file for word-level highlighting (karaoke effect). Generated from TTS timestamps, overlays on top of PNG in render. Uses same styling as PNG but adds word-level timing.

### Canonical Payload Keys (SSOT)

**Geometry Keys** (frame-space pixels, TOP-left anchor):
- `yPx_png` (number, 0-1920): TOP-left Y coordinate of raster PNG (SSOT for positioning)
- `xPx_png` (number, 0-1080, optional): Absolute X position (optional, falls back to `xExpr_png`)
- `xExpr_png` (string, default: `'(W-overlay_w)/2'`): FFmpeg X expression (centered by default)
- `rasterW` (number, 100-1080): Raster PNG width (tight to text + padding)
- `rasterH` (number, 50-1920): Raster PNG height (text height + padding + shadow)
- `rasterPadding` (number, default: 24): Average vertical padding in pixels
- `totalTextH` (number, min: 1): Text block height (lines × fontPx + line spacing)
- `yPxFirstLine` (number): First line baseline Y (debug-only, computed as `yPx_png + rasterPadding`)

**Typography Keys**:
- `fontPx` (number, 8-400, default: 64): Font size in pixels
- `weightCss` (string, default: 'normal'): Font weight (CSS value: 'normal', 'bold', '700', etc.)
- `fontFamily` (string, default: 'DejaVu Sans'): Font family name
- `fontStyle` (string, default: 'normal'): Font style ('normal', 'italic', etc.)
- `textAlign` (enum: 'left'|'center'|'right', default: 'center'): Text alignment
- `letterSpacingPx` (number, default: 0.5): Letter spacing in pixels (matches karaoke QMain default)
- `lineSpacingPx` (number, default: 0): Line spacing in pixels

**Color & Effects Keys**:
- `color` (string, default: 'rgb(255,255,255)'): Text color
- `opacity` (number, 0-1, default: 1.0): Text opacity
- `strokePx` (number, default: 3): Stroke width in pixels (matches karaoke Outline: 3)
- `strokeColor` (string, default: 'rgba(0,0,0,0.85)'): Stroke color
- `shadowBlur` (number, default: 0): Shadow blur radius (matches karaoke Shadow: 1 minimal)
- `shadowOffsetX` (number, default: 1): Shadow X offset
- `shadowOffsetY` (number, default: 1): Shadow Y offset
- `shadowColor` (string, default: 'rgba(0,0,0,0.6)'): Shadow color

**Line Data Keys**:
- `lines` (string[], min: 1): Wrapped text lines (browser-rendered or server-wrapped)
- `textRaw` (string, optional): Raw text with newlines (used for server rewrap)

**Integrity Keys**:
- `rasterHash` (string, 16 chars): SHA-256 hash of PNG (first 16 chars) for integrity check
- `previewFontString` (string): Exact browser font string (e.g., `"normal bold 48px \"DejaVu Sans\""`) for font parity validation
- `previewFontHash` (string, 16 chars): SHA-256 hash of font string (debug-only)

**Frame Dimensions**:
- `frameW` (number, default: 1080): Frame width (server canonical)
- `frameH` (number, default: 1920): Frame height (server canonical)

**Width/Placement Keys** (informational, not used for positioning in V3):
- `wPct` (number, optional): Width percentage (0.0-1.0, default: 0.8)
- `internalPaddingPx` (number, optional): Internal padding (synonym for `rasterPadding`)
- `yPct` (number, optional): TOP position percentage (0.0-1.0, informational only, not used for positioning)
- `xPct` (number, optional): X position percentage (informational only)
- `placement` (string, optional): Placement preset ('top'|'center'|'bottom', not yet implemented)

**Version/Mode Keys**:
- `ssotVersion` (literal: 3): SSOT version (must be exactly `3`)
- `mode` (literal: 'raster'): Render mode (must be exactly `'raster'`)

### SSOT Contract Documentation

**Primary Contract**: `docs/caption/02-meta-contract-v3-raster.md`
- Defines all V3 raster mode field semantics
- Documents TOP-left anchor semantics (`yPx_png`)
- Documents server authority on rewrap (`lines`, `totalTextH`, `rasterH`)
- Documents request/response schema

**Pipeline Overview**: `docs/caption/01-pipeline-overview.md`
- Maps 6-stage pipeline (DOM → Payload → Server → Preview → Render → FFmpeg)
- Documents field production/consumption table
- Documents data flow diagram

**Debugging Guide**: `docs/caption/03-debugging-parity.md`
- Verification checklist
- Common mismatch patterns
- Debug log prefixes
- Parity test functions

**Legacy Contract**: `docs/caption-meta-contract.md` (OUTDATED)
- Does not cover V3 raster mode
- Defines `yPct` as anchor point (V3 uses `yPx_png` TOP-left only)
- Should be marked as deprecated

### Synonyms/Legacy Names

| Canonical Name | Legacy/Synonym | Location | Status |
|----------------|----------------|----------|--------|
| `rasterPadding` | `internalPadding`, `internalPaddingPx` | `caption.wrapWidth.js`, `story.service.js` | ✅ Accepted synonyms |
| `weightCss` | `weight` (legacy) | `caption-preview.js:63` | ⚠️ Backward compat fallback |
| `fontPx` | `sizePx` (legacy) | `story.service.js:831` | ⚠️ Backward compat fallback |
| `yPx_png` | `yPx` (legacy) | `ffmpeg.video.js:1523` | ⚠️ Backward compat fallback |
| `rasterUrl` | `rasterDataUrl`, `rasterPng` | `ffmpeg.video.js:396` | ✅ Accepted synonyms |

---

## 3. Client-Side Wiring (public/)

### Creative Studio Beat Preview Flow

**Trigger**: User edits beat text or storyboard is prepared

**Call Chain**:
```
User Action (edit beat / prepare storyboard)
  → prepareStoryboard() / updateBeat()
  → renderStoryboard(session)
  → Beat card DOM updated
  → generateBeatCaptionPreviewDebounced(beatId, text, explicitStyle)
  → generateBeatCaptionPreview(beatId, text, explicitStyle)
  → measureBeatCaptionGeometry(text, measureStyle)
  → buildBeatPreviewPayload(text, overlayMeta, explicitStyle)
  → POST /api/caption/preview
  → applyPreviewResultToBeatCard(beatCardEl, result)
  → Beat card shows PNG overlay
```

### Key Files

**`public/creative.html`** (lines 6813-6821, 7227, 7322, 9371):
- **Line 6813-6821**: Beat preview trigger - reads `explicitStyle` from `window.currentStorySession.overlayCaption || window.currentStorySession.captionStyle || {}`
- **Line 7227, 7322**: `prepareStoryboard()` assigns `window.currentStorySession = session` (⚠️ **SESSION OVERWRITE ISSUE** - see Known Issues)
- **Line 9371**: Session load assigns `window.currentStorySession = session`
- **Line 9404**: Session clear assigns `window.currentStorySession = null`

**`public/js/caption-preview.js`**:
- **Lines 691-785**: `buildBeatPreviewPayload(text, overlayMeta, explicitStyle)` - Builds V3 raster payload with SSOT gating (only includes style fields if `explicitStyle.hasOwnProperty(key)`)
- **Lines 794-900**: `generateBeatCaptionPreview(beatId, text, style)` - Main beat preview function
  - Creates `measureStyle = { ...MEASURE_DEFAULTS, ...explicitStyle }` for DOM measurement
  - Calls `measureBeatCaptionGeometry(text, measureStyle)` for geometry
  - Calls `buildBeatPreviewPayload(text, overlayMeta, explicitStyle)` for payload (passes `explicitStyle`, not `measureStyle`)
  - POSTs to `/api/caption/preview`
  - Applies result via `applyPreviewResultToBeatCard()`
- **Lines 903-971**: `applyPreviewResultToBeatCard(beatCardEl, result)` - Applies preview PNG to beat card DOM
  - Creates/updates `.beat-caption-overlay` `<img>` element
  - Sets CSS variables: `--y-pct`, `--raster-w-ratio`, `--raster-h-ratio`
  - Derives TOP yPct: `yPct = meta.yPx_png / meta.frameH` (no centering transform)
- **Lines 131-654**: `generateCaptionPreview(opts)` - Main preview function (for live overlay, not beat previews)

**`public/js/caption-overlay.js`**:
- **Lines 1391-1558**: `computeCaptionMetaFromElements({ stageEl, boxEl, contentEl, frameW, frameH })` - Extracts caption meta from live DOM
  - Computes `yPx_png = Math.round(yPct * frameH)` where `yPct` is TOP-anchored (box top position)
  - Extracts `lines[]` via Range API (`extractRenderedLines()`)
  - Extracts `previewFontString` from `getComputedStyle(contentEl).font`
- **Lines 1699-1811**: `measureBeatCaptionGeometry(text, style)` - Measures geometry using offscreen DOM
  - Creates offscreen DOM element, applies `style`, measures geometry
  - Uses `MEASURE_DEFAULTS` merged with `style` for measurement
  - Returns `overlayMeta` object with same shape as `computeCaptionMetaFromElements()`

**`public/js/ui-actions.js`** (if exists):
- May trigger preview updates on UI control changes (not audited in this report)

### Explicit Style Source

**Source**: `window.currentStorySession.overlayCaption || window.currentStorySession.captionStyle || {}`

**Locations**:
- `public/creative.html:6814` - Beat preview trigger
- `public/creative.html:7554` - Beat editor update (if similar pattern)
- `public/creative.html:8313` - Storyboard render (if similar pattern)

**Semantics**:
- `explicitStyle` is **ONLY user/session overrides** (empty object `{}` if no session)
- `measureStyle = { ...MEASURE_DEFAULTS, ...explicitStyle }` is used for DOM measurement (includes defaults)
- `buildBeatPreviewPayload()` uses `explicitStyle` for SSOT gating (only includes style fields if `explicitStyle.hasOwnProperty(key)`)
- Server defaults apply when fields are omitted from payload

**MEASURE_DEFAULTS** (defined in `caption-preview.js`, top of file):
```javascript
export const MEASURE_DEFAULTS = {
  fontFamily: 'DejaVu Sans',
  weightCss: 'normal',  // Match server default
  fontPx: 64,  // Match server default
  letterSpacingPx: 0.5,  // Match server default
  yPct: 0.5,
  wPct: 0.8,
  opacity: 1,
  color: '#FFFFFF',
  strokePx: 3,  // Match server default
  strokeColor: 'rgba(0,0,0,0.85)',
  shadowBlur: 0,  // Match server default
  shadowOffsetX: 1,
  shadowOffsetY: 1,
  shadowColor: 'rgba(0,0,0,0.6)'
};
```

### Session Assignment Audit

**All locations where `window.currentStorySession` is assigned**:

1. **`public/creative.html:7227`** - `prepareStoryboard()` after storyboard creation (first path)
2. **`public/creative.html:7322`** - `prepareStoryboard()` after storyboard creation (second path)
3. **`public/creative.html:9371`** - Session load (`loadStorySession()`)
4. **`public/creative.html:9404`** - Session clear (error path, sets to `null`)

**⚠️ SESSION OVERWRITE ISSUE**: `prepareStoryboard()` overwrites `window.currentStorySession` without preserving `overlayCaption`/`captionStyle` from previous session. See Known Issues section.

---

## 4. Server-Side Wiring (src/)

### Preview Pipeline

**Route**: `POST /api/caption/preview`  
**File**: `src/routes/caption.preview.routes.js`  
**Location**: Lines 68-1038

**Pipeline Stages**:

1. **V3 Raster Detection Gate** (lines 71-80):
   - Checks `req.body.ssotVersion === 3 && req.body.mode === 'raster'`
   - Returns 400 if not V3 raster mode (legacy paths disabled)

2. **Schema Validation** (lines 103-106):
   - Validates against `RasterSchema` (Zod schema, lines 14-64)
   - Required fields: `ssotVersion: 3`, `mode: 'raster'`, `text`, `lines[]`, `rasterW`, `rasterH`, `yPx_png`, `totalTextH`, `yPxFirstLine`
   - Optional fields with defaults: `fontPx: 64`, `weightCss: 'normal'`, `strokePx: 3`, `shadowBlur: 0`, etc.

3. **Style Extraction** (lines 115-141):
   - Extracts style values from validated `data`
   - Logs effective style after schema defaults: `[preview-style:effective]` with `hasFontPxInPayload`, etc.

4. **Width Derivation (SSOT)** (lines 143-150):
   - Uses `deriveCaptionWrapWidthPx({ frameW: 1080, wPct, internalPaddingPx })` for canonical width
   - Falls back to `rasterW - (2 * rasterPadding)` if needed for compatibility

5. **Font Registration** (lines 152-160):
   - Fonts already registered at server startup (`server.js:22-24`)
   - Uses `canvasFontString()` from `font.registry.js` for font string construction
   - Font family: 'DejaVu Sans' (registered via `registerDejaVuFonts()`)

6. **Line Wrapping (SSOT)** (lines 162-200):
   - **ALWAYS computes lines from `textRaw || text`** using `wrapTextWithFont()` (server is authoritative)
   - Ignores client-provided `lines[]` for drawing (kept for debug comparison only)
   - Uses same algorithm as render: `ctx.measureText()` with letter spacing
   - Logs: `[preview-wrap:ssot]` with `maxWidthPx`, `linesCount`, `fontPx`, `fontFamily`, `weightCss`

7. **Rewrap Detection** (lines 202-250):
   - Compares server-wrapped `lines` vs client-provided `lines`
   - Detects overflow: `width > maxLineWidth + 1`
   - Detects broken words: line ends with letter, next starts with letter, no hyphen
   - If mismatch detected, server is authoritative (uses server-wrapped lines)

8. **Geometry Computation** (lines 252-290):
   - If rewrap occurred: recomputes `serverTotalTextH` (formula-based), `serverRasterH` (includes padding + shadow)
   - Keeps `yPx_png` unchanged (no positioning policy change)
   - Logs: `[parity:server-rewrap:geometry]` with old vs new values

9. **PNG Generation** (lines 1083-1546, `renderCaptionRaster()`):
   - Creates transparent canvas: `rasterW × rasterH`
   - Draws text using server-wrapped lines (or client lines if no rewrap)
   - Applies stroke, shadow, effects
   - Returns PNG as base64 data URL

10. **Response Building** (lines 404-414):
    - Returns `{ ok: true, data: { meta: ssotMeta } }`
    - `ssotMeta` includes: `rasterUrl`, `rasterW`, `rasterH`, `yPx_png`, `lines`, `totalTextH`, `rasterHash`, `previewFontString`, etc.
    - Logs: `[PARITY_CHECKLIST]` with parity verification fields

**Key Functions**:
- `wrapTextWithFont()` (imported from `src/utils/caption.wrap.js`) - Shared SSOT wrapper
- `deriveCaptionWrapWidthPx()` (imported from `src/utils/caption.wrapWidth.js`) - Shared width derivation
- `renderCaptionRaster(meta)` (lines 1083-1546) - PNG generation

### Render Pipeline

**Entry Point**: `src/services/story.service.js:778-1245` (`renderStory()`)

**Caption Strategy Selection** (in `src/utils/ffmpeg.video.js:960-1667`):

1. **Raster Mode Check** (lines 961-991):
   - If `overlayCaption?.mode === 'raster'`:
     - Skips ALL drawtext (`drawCaption = ''`)
     - Requires `rasterUrl` OR `rasterDataUrl` (throws error if missing)
     - Materializes PNG from `overlayCaption.rasterUrl` (lines 818-853)
     - Uses PNG overlay only (no drawtext)

2. **ASS Subtitles Check** (lines 562-570, 1633-1643):
   - If `assPath` exists and `overlayCaption?.mode !== 'raster'`:
     - Uses ASS subtitles for captions (karaoke word highlighting)
     - Excludes drawtext to avoid double captions
   - If `assPath` exists and `overlayCaption?.mode === 'raster'`:
     - ASS overlays on top of PNG (karaoke highlighting on raster PNG)

3. **Drawtext Fallback** (lines 1644-1667):
   - If no raster PNG and no ASS:
     - Uses FFmpeg drawtext for captions

**Strategy Matrix** (see Section 5)

**Caption Wrapping in Render** (`src/services/story.service.js:823-870`):

1. **Check for Pre-Wrapped Lines** (lines 825-827):
   - If `overlayCaption?.lines` exists, uses `overlayCaption.lines.join('\n')`

2. **SSOT Wrapper** (lines 829-870):
   - Uses `wrapTextWithFont()` with same parameters as preview
   - Uses `deriveCaptionWrapWidthPx()` for width (same semantics as preview)
   - Logs: `[render-wrap:ssot]` with `beatId`, `maxWidthPx`, `linesCount`, `fontPx`, `fontFamily`, `weightCss`, `wPct`, `pad`

3. **ASS Generation** (lines 871-920):
   - Passes `wrappedText` to `buildKaraokeASSFromTimestamps()` (already supported)
   - ASS file includes `\N` line breaks at wrapped boundaries

**Parity Enforcement** (`src/utils/ffmpeg.video.js:1039-1059`):

1. **Geometry Lock** (lines 1042-1047):
   - Validates `placement.frameW === W` and `placement.frameH === H`
   - Throws error if preview was made for different dimensions

2. **PNG Integrity** (lines 1049-1057):
   - Validates `rasterHash` matches actual PNG hash
   - Throws error if hash mismatch (preview stale)

3. **Parity Checklist** (lines 1594-1601):
   - Logs `[PARITY_CHECKLIST]` with `rasterW`, `rasterH`, `y`, `xExpr`, `rasterHash`, `previewFontString`

---

## 5. Caption Strategy Matrix

### Strategy Selection Logic

**Location**: `src/utils/ffmpeg.video.js:960-1667`

**Decision Tree**:
```
IF overlayCaption?.mode === 'raster' THEN
  → Strategy: RASTER PNG OVERLAY
  → Skip drawtext (drawCaption = '')
  → Materialize PNG from overlayCaption.rasterUrl
  → Use FFmpeg overlay filter
  → IF assPath exists THEN
      → Add ASS subtitles on top (karaoke highlighting)
ELSE IF assPath exists AND overlayCaption?.mode !== 'raster' THEN
  → Strategy: ASS SUBTITLES
  → Skip drawtext (avoid double captions)
  → Use FFmpeg subtitles filter
ELSE IF drawCaption enabled THEN
  → Strategy: DRAWTEXT
  → Use FFmpeg drawtext filter
ELSE
  → Strategy: NONE
  → No captions
```

### Strategy Details

**A) ASS Subtitles (Karaoke)**
- **When**: `assPath` exists AND `overlayCaption?.mode !== 'raster'`
- **FFmpeg Filter**: `subtitles='${assPath}'`
- **Fonts**: Uses `fontsdir` with DejaVu Sans registered
- **Styling**: Reads from `overlayCaption` via `convertOverlayToASSStyle()` (`src/utils/karaoke.ass.js:137-242`)
- **Line Breaks**: Uses `wrappedText` with `\N` line breaks from SSOT wrapper
- **Word Timing**: ASS file includes `\k` tags for word-level karaoke timing
- **Code**: `src/utils/ffmpeg.video.js:562-570, 1633-1643`

**B) Drawtext**
- **When**: No raster PNG, no ASS, `drawCaption` enabled
- **FFmpeg Filter**: `drawtext=text='${text}':fontfile='${fontfile}':...`
- **Styling**: Uses `overlayCaption` fields (fontPx, weightCss, color, etc.)
- **Positioning**: Uses `yPct` or `placement` (legacy, not V3 raster)
- **Code**: `src/utils/ffmpeg.video.js:1644-1667` (fallback path)

**C) Raster PNG Overlay**
- **When**: `overlayCaption?.mode === 'raster'`
- **FFmpeg Filter**: `overlay=${xExpr}:${y}:format=auto`
- **PNG Source**: `overlayCaption.rasterUrl` (base64 data URL) or `overlayCaption.storagePath` (Firebase Storage, future)
- **Positioning**: Uses `yPx_png` (TOP-left anchor, frame-space pixels)
- **Dimensions**: Uses `rasterW`, `rasterH` verbatim (no scaling)
- **Validation**: Validates `rasterHash` and frame dimensions
- **Code**: `src/utils/ffmpeg.video.js:961-1059, 1516-1601`

**D) Raster PNG + ASS Overlay (Karaoke on Raster)**
- **When**: `overlayCaption?.mode === 'raster'` AND `assPath` exists
- **FFmpeg Filters**: `overlay=${xExpr}:${y}:format=auto` THEN `subtitles='${assPath}'`
- **Purpose**: ASS provides word-level highlighting on top of raster PNG
- **Styling**: ASS matches PNG styling (same font, size, weight) for seamless highlighting
- **Code**: `src/utils/ffmpeg.video.js:562-570` (ASS added after overlay)

### Strategy Selection Logs

**Log Prefix**: `[captions] strategy=... reason="..."`

**Examples**:
- `[captions] strategy=raster reason="usingCaptionPng=true"`
- `[captions] strategy=ass reason="assPath exists"`
- `[captions] strategy=drawtext reason="drawtext enabled, no ass/raster"`

---

## 6. Font + Wrapping Parity

### previewFontString

**What it is**: Exact browser font string (e.g., `"normal bold 48px \"DejaVu Sans\""`)

**Client Construction** (`public/js/caption-overlay.js:1451`):
```javascript
const previewFontString = `${fontStyle} ${weightCss === '700' ? 'bold' : 'normal'} ${fontPx}px "${family}"`;
```

**Server Validation** (`src/routes/caption.preview.routes.js:1315-1338`):
- Server constructs its own font string using `canvasFontString()`
- Compares client `previewFontString` vs server font string
- Logs mismatch warning if different (but doesn't fail)
- Echoes server font string in response (server is authoritative)

**Purpose**: Font parity validation - ensures client and server use same font rendering

### Server "Freezes" Font

**Process**:
1. Client sends `previewFontString` in request
2. Server constructs font string from validated style fields
3. Server applies font to canvas context: `ctx.font = previewFontString`
4. Server "freezes" font: `const previewFontString = ctx.font` (exact string used)
5. Server computes `previewFontHash` (SHA-256 hash of font string)
6. Server echoes `previewFontString` and `previewFontHash` in response

**Code**: `src/routes/caption.preview.routes.js:1315-1317`

### Server Rewrap Detection

**Why we detect broken words / overflow**:
- Client browser may wrap text differently than server (font rendering differences)
- Client may send lines that overflow `maxLineWidth` (browser quirks)
- Client may break words mid-word (Range API edge cases)

**Detection Logic** (`src/routes/caption.preview.routes.js:1182-1291`):
1. **Overflow Check**: For each client line, measure width using `ctx.measureText()`. If `width > maxLineWidth + 1`, mark as overflow.
2. **Broken Word Check**: If line ends with letter, next line starts with letter, no hyphen between, mark as broken word.
3. **Rewrap Decision**: If any overflow or broken word detected, server rewraps using `wrapTextWithFont()`.

**Server Authority**:
- When rewrap occurs, server is authoritative for `lines`, `totalTextH`, `rasterH`
- Server recomputes geometry from server-wrapped lines
- Server keeps `yPx_png` unchanged (no positioning policy change)
- Client must use server response `meta` as SSOT

**Logs**:
- `[parity:server-rewrap] Client lines overflow or broken words detected, rewrapping with server font`
- `[parity:server-rewrap] { oldLines: 10, newLines: 3, maxLineWidth: 816 }`
- `[parity:server-rewrap:geometry] { oldRasterH: 670, newRasterH: 232, ... }`

### Known Mismatches / Caveats

1. **Letter Spacing**: ASS may not render `letterSpacingPx` the same as canvas. Server logs warning if `letterSpacingPx !== 0` (`src/services/story.service.js:861-863`).

2. **Font String Normalization**: Browser `getComputedStyle().font` may normalize weight ('700' → 'bold'). Server uses canonical form.

3. **Line Height Effects**: Client `totalTextH` from DOM may differ from formula (`lines.length * fontPx + lineSpacing`) due to CSS `line-height`. Server uses formula (authoritative).

4. **Per-Beat Text vs Single PNG**: Single session-level `overlayCaption` with single PNG; text varies per beat but PNG is constant. This is a design limitation (not a bug).

---

## 7. Known Issues / Edge Cases

### Session Overwrite Issue

**Problem**: `prepareStoryboard()` overwrites `window.currentStorySession` without preserving `overlayCaption`/`captionStyle` from previous session.

**Location**: `public/creative.html:7227, 7322`

**Impact**: If user sets caption style, then prepares storyboard, style is lost.

**Fix Required**: Preserve `overlayCaption`/`captionStyle` when overwriting session:
```javascript
const prevOverlayCaption = window.currentStorySession?.overlayCaption;
const prevCaptionStyle = window.currentStorySession?.captionStyle;
window.currentStorySession = session;
if (prevOverlayCaption && !session.overlayCaption) {
  session.overlayCaption = prevOverlayCaption;
}
if (prevCaptionStyle && !session.captionStyle) {
  session.captionStyle = prevCaptionStyle;
}
```

**Status**: ⚠️ TODO - Not yet fixed

### AbortError Play/Pause Warning

**Symptom**: Console warning `AbortError: The play() request was interrupted` when hovering video.

**Location**: Video hover preview (not audited in this report)

**Impact**: Unrelated to caption parity (video playback issue).

**Status**: ✅ Confirmed unrelated

### Colorspace Filter Fallback (FFmpeg)

**Issue**: Colorspace filter may be added to FFmpeg filter chain in some paths, causing crashes.

**Location**: `src/utils/ffmpeg.video.js:572-583`

**Impact**: Render may fail if colorspace filter is present in raster chain.

**Detection**: Logs `[v3:filter-chain] ERROR: colorspace filter found in raster chain - this will cause crashes!`

**Status**: ⚠️ Guarded with error log, but filter chain construction may still add it in some paths

### Per-Beat Text vs Single PNG Contradiction

**Problem**: Single session-level `overlayCaption` with single PNG (`rasterUrl`), but text varies per beat. PNG contains fixed text, but render expects per-beat text.

**Current Behavior**: 
- Preview generates PNG with beat-specific text (per-beat preview)
- Render uses session-level `overlayCaption.rasterUrl` (same PNG for all beats if persisted)
- This is a contradiction if PNG is persisted at session level

**Investigation Required**: 
- Probe B.3 from build plan: Does raster mode use per-beat PNGs or single session-level PNG?
- If single PNG: Redesign required (per-beat overlay storage OR render-time PNG generation)

**Status**: ⚠️ Requires probe confirmation (see build plan: `caption_style_persistence_build_plan_a0991c07.plan.md`)

---

## 8. Verification Playbook

### Preview-Only Manual Test

**Steps**:
1. Open Creative Studio
2. Create/edit beat with text: "This is a test caption with multiple words"
3. Open DevTools → Network tab
4. Trigger beat preview (edit beat or prepare storyboard)
5. Find `POST /api/caption/preview` request
6. Inspect request payload:
   - ✅ `ssotVersion: 3`, `mode: 'raster'`
   - ✅ `rasterW`, `rasterH`, `yPx_png` present
   - ✅ `lines[]` array present
   - ✅ Style fields only if `explicitStyle` has them (check `[beat-preview] explicitStyle keys` log)
7. Inspect response:
   - ✅ `ok: true`
   - ✅ `data.meta.rasterUrl` exists (base64 PNG)
   - ✅ `data.meta.rasterW`, `data.meta.rasterH` match request (or server-recomputed if rewrap)
   - ✅ `data.meta.yPx_png` matches request (unchanged)
   - ✅ `data.meta.rasterHash` exists
   - ✅ `data.meta.previewFontString` exists
8. Check beat card: PNG overlay should appear at correct position

**Success Criteria**:
- Preview PNG appears on beat card
- Position matches expected (TOP-anchored, no centering transform)
- No console errors

### Preview vs Render Test

**Steps**:
1. Generate preview (see Preview-Only test)
2. Capture preview PNG: Extract `data.meta.rasterUrl` (base64), decode to PNG file
3. Run render: Trigger video render
4. Extract frame from rendered video at caption timestamp
5. Compare visually:
   - ✅ Same font, size, weight
   - ✅ Same position (TOP-anchored)
   - ✅ Same dimensions
   - ✅ Same line breaks
6. Compare pixel-by-pixel (if ASS not enabled):
   - ✅ Should be bit-identical if same PNG used

**Success Criteria**:
- Preview PNG matches render frame (visual comparison)
- Position matches (TOP-anchored)
- Dimensions match
- Line breaks match

### Debug Signals to Watch

**Client Logs**:
- `[beat-preview] explicitStyle keys: []` - Should be empty if no session overrides
- `[beat-preview] payload style keys: []` - Should be empty if no session overrides (server defaults apply)
- `[beat-preview] POST /caption/preview payload keys: [...]` - Payload structure

**Server Logs**:
- `[preview-style:effective] { fontPx: 64, weightCss: 'normal', ... }` - Effective style after defaults
- `[preview-style:effective] hasFontPxInPayload: false` - Should be `false` if field omitted (server default applied)
- `[preview-wrap:ssot] { maxWidthPx: 816, linesCount: 3, ... }` - SSOT wrapping result
- `[PARITY_CHECKLIST] { mode: 'raster', rasterW, rasterH, yPx_png, ... }` - Parity verification

**Render Logs**:
- `[render-wrap:ssot] { beatId: 0, maxWidthPx: 816, linesCount: 3, ... }` - Should match preview `linesCount`
- `[PARITY_CHECKLIST] { mode: 'raster', rasterW, rasterH, y, ... }` - Should match preview values
- `[captions] strategy=raster reason="usingCaptionPng=true"` - Strategy selection

### Reproducible Scenarios

**Scenario 1: Short 1-Line Caption**
- Text: "Hello world"
- Expected: 1 line, small `rasterH`
- Verify: `linesCount: 1`, `rasterH < 100px`

**Scenario 2: Multi-Line Caption**
- Text: "This is a longer caption that should wrap to multiple lines when the width is constrained"
- Expected: 3-4 lines, larger `rasterH`
- Verify: `linesCount: 3-4`, `rasterH > 200px`, line breaks match preview

**Scenario 3: Bold Override Test**
- Set `overlayCaption = { fontPx: 48, weightCss: 'bold' }`
- Text: "Bold caption test"
- Verify:
  - `[beat-preview] explicitStyle keys: ['fontPx', 'weightCss']`
  - `[beat-preview] payload style keys: ['fontPx', 'weightCss']`
  - `[preview-style:effective] { fontPx: 48, weightCss: 'bold', ... }`
  - `[preview-style:effective] hasFontPxInPayload: true` (both fields)
  - Preview shows bold 48px, render shows bold 48px

---

## 9. Source Map / Index

### Client Files

**`public/creative.html`**
- Main Creative Studio UI
- Triggers beat previews on storyboard prepare/beat edit
- Assigns `window.currentStorySession` (⚠️ session overwrite issue)
- Lines: 6813-6821 (beat preview trigger), 7227, 7322, 9371 (session assignment)

**`public/js/caption-preview.js`**
- Beat preview generation (`generateBeatCaptionPreview()`)
- Payload building (`buildBeatPreviewPayload()`)
- Preview application (`applyPreviewResultToBeatCard()`)
- Main preview function (`generateCaptionPreview()`)
- Exports: `generateBeatCaptionPreview`, `applyPreviewResultToBeatCard`, `generateCaptionPreview`

**`public/js/caption-overlay.js`**
- DOM measurement (`computeCaptionMetaFromElements()`, `measureBeatCaptionGeometry()`)
- Line extraction (`extractRenderedLines()`)
- Font string extraction
- Exports: `computeCaptionMetaFromElements`, `measureBeatCaptionGeometry`, `extractRenderedLines`

**`public/js/caption-live.js`** (if exists)
- Live preview updates (debounced)
- May trigger preview on UI control changes

### Server Files

**`src/routes/caption.preview.routes.js`**
- Preview endpoint (`POST /api/caption/preview`)
- V3 raster mode handler
- Schema validation (`RasterSchema`)
- Line wrapping (SSOT wrapper)
- PNG generation (`renderCaptionRaster()`)
- Response building

**`src/services/story.service.js`**
- Story render entry point (`renderStory()`)
- Caption wrapping for render (SSOT wrapper)
- ASS file generation
- Reads `session.overlayCaption || session.captionStyle`

**`src/services/shorts.service.js`** (if exists)
- Shorts render (similar to story render)
- May use same caption wrapping logic

**`src/utils/ffmpeg.video.js`**
- Render pipeline (`renderVideoQuoteOverlay()`)
- Strategy selection (raster/ASS/drawtext)
- PNG materialization
- FFmpeg filter chain construction
- Parity validation

**`src/utils/ffmpeg.js`**
- Image quote video render (`renderImageQuoteVideo()`)
- May use similar caption overlay logic

**`src/utils/caption.wrap.js`**
- Shared SSOT wrapper (`wrapTextWithFont()`)
- Uses node-canvas `ctx.measureText()` for accurate wrapping
- Accounts for `letterSpacingPx`

**`src/utils/caption.wrapWidth.js`**
- Shared width derivation (`deriveCaptionWrapWidthPx()`)
- Unifies width calculation between preview and render

**`src/utils/karaoke.ass.js`**
- ASS file generation (`buildKaraokeASSFromTimestamps()`)
- Style conversion (`convertOverlayToASSStyle()`)
- Reads from `overlayCaption` for styling

**`src/utils/font.registry.js`**
- Font registration (`registerDejaVuFonts()`)
- Font string construction (`canvasFontString()`)
- Font normalization (`normalizeWeight()`, `normalizeFontStyle()`)

### Documentation Files

**`docs/caption/01-pipeline-overview.md`**
- 6-stage pipeline map
- Field production/consumption table
- Data flow diagram

**`docs/caption/02-meta-contract-v3-raster.md`**
- V3 raster mode field semantics
- Request/response schema
- Server authority on rewrap

**`docs/caption/03-debugging-parity.md`**
- Verification checklist
- Common mismatch patterns
- Debug log prefixes

**`docs/caption-wrapping-phase-0.5-1-summary.md`**
- Phase 0.5: Width semantics fix
- Phase 1: Shared wrapper SSOT

**`docs/caption-wrapping-phase-2-3-summary.md`**
- Phase 2: Preview endpoint uses SSOT wrap
- Phase 3: Render uses same SSOT wrap

**`docs/caption-preview-render-mismatch-audit.md`**
- Historical mismatch analysis (before SSOT fix)
- Character-count approximation vs canvas measurement

---

## 10. Decision Log (Recent)

### Decision 1: V3 Raster Mode (SSOT v3)

**Date**: 2025-12 (approximate, from commit history)

**Problem**: Preview and render used different line-wrapping algorithms (canvas measurement vs character-count approximation), causing visual mismatch.

**Solution**: Created V3 raster mode with SSOT semantics:
- Server is authoritative for line wrapping (`wrapTextWithFont()`)
- Server validates/rewraps client lines if overflow/broken words detected
- Both preview and render use same wrapper and width derivation

**Files Changed**:
- Created `src/utils/caption.wrap.js` (shared wrapper)
- Created `src/utils/caption.wrapWidth.js` (shared width derivation)
- Updated `src/routes/caption.preview.routes.js` (always use server SSOT wrap)
- Updated `src/services/story.service.js` (replace character-count with SSOT wrapper)

**Evidence**: `docs/caption-wrapping-phase-0.5-1-summary.md`, `docs/caption-wrapping-phase-2-3-summary.md`

### Decision 2: TOP-Left Anchor Semantics (yPx_png)

**Date**: 2025-12 (approximate)

**Problem**: `yPct` had ambiguous semantics (center vs top), causing positioning drift.

**Solution**: Defined `yPx_png` as TOP-left anchor (frame-space pixels):
- Client computes `yPx_png = Math.round(yPct * frameH)` where `yPct` is TOP-anchored (box top position)
- Server echoes `yPx_png` unchanged (even after rewrap)
- FFmpeg uses `yPx_png` as overlay Y coordinate (top-left anchor)
- `yPct` is informational/debug-only (not used for positioning in V3)

**Files Changed**:
- `public/js/caption-overlay.js:1502` (TOP-anchored computation)
- `src/routes/caption.preview.routes.js:242` (unchanged after rewrap)
- `src/utils/ffmpeg.video.js:1523` (consumption as top-left)

**Evidence**: `docs/caption/02-meta-contract-v3-raster.md` (yPx_png semantics)

### Decision 3: Server Defaults for Style Parity

**Date**: 2026-01 (from build plan)

**Problem**: Preview used client hardcoded defaults (48px, bold) when `session.overlayCaption` missing, but render used server QMain defaults (64px, normal), causing mismatch.

**Solution**: Made preview use server defaults when fields omitted:
- Client `explicitStyle` is empty object `{}` when no session overrides
- `buildBeatPreviewPayload()` uses `hasOwnProperty` gating (only includes style fields if `explicitStyle.hasOwnProperty(key)`)
- Server defaults apply for omitted fields (matches render behavior)

**Files Changed**:
- `public/js/caption-preview.js` (MEASURE_DEFAULTS constant, hasOwnProperty gating)
- `public/creative.html` (explicitStyle = {} when no session)
- `src/routes/caption.preview.routes.js` (schema defaults aligned to QMain)

**Evidence**: `preview_render_parity_fix_(audited)_712eafa3.plan.md`

### Decision 4: SSOT Gating (hasOwnProperty)

**Date**: 2026-01

**Problem**: Fallback style objects had own properties, so `hasOwnProperty('fontPx')` returned `true` even for fallbacks, defeating server defaults.

**Solution**: Separated `explicitStyle` (user/session overrides only) from `measureStyle` (measurement defaults merged):
- `explicitStyle = {}` when no session (empty object, no own properties)
- `measureStyle = { ...MEASURE_DEFAULTS, ...explicitStyle }` for DOM measurement
- `buildBeatPreviewPayload()` uses `explicitStyle` for gating (not `measureStyle`)

**Files Changed**:
- `public/js/caption-preview.js:828-829` (explicitStyle vs measureStyle split)
- `public/js/caption-preview.js:745-762` (hasOwnProperty gating)

**Evidence**: `preview_render_parity_fix_(audited)_712eafa3.plan.md` (Section: Key Semantic Fix)

### Decision 5: Server Authority on Rewrap

**Date**: 2025-12

**Problem**: Client browser may wrap text differently than server (font rendering differences), causing line count mismatch.

**Solution**: Server is authoritative when rewrap occurs:
- Server always computes lines from `textRaw || text` using `wrapTextWithFont()`
- Server detects overflow/broken words and rewraps if needed
- Server recomputes `rasterH` and `totalTextH` from server-wrapped lines
- Server keeps `yPx_png` unchanged (no positioning policy change)
- Client must use server response `meta` as SSOT

**Files Changed**:
- `src/routes/caption.preview.routes.js:162-200` (always compute lines)
- `src/routes/caption.preview.routes.js:202-250` (rewrap detection)
- `src/routes/caption.preview.routes.js:252-290` (geometry recomputation)

**Evidence**: `docs/caption/02-meta-contract-v3-raster.md` (Server Authority on Rewrap)

---

## Appendix: File Reference Quick Lookup

| File | Purpose | Key Exports/Functions |
|------|---------|----------------------|
| `public/creative.html` | UI triggers, session assignment | `prepareStoryboard()`, beat preview triggers |
| `public/js/caption-preview.js` | Beat preview generation | `generateBeatCaptionPreview()`, `buildBeatPreviewPayload()`, `applyPreviewResultToBeatCard()` |
| `public/js/caption-overlay.js` | DOM measurement | `computeCaptionMetaFromElements()`, `measureBeatCaptionGeometry()` |
| `src/routes/caption.preview.routes.js` | Preview endpoint | `POST /api/caption/preview`, `renderCaptionRaster()` |
| `src/services/story.service.js` | Story render | `renderStory()`, caption wrapping for render |
| `src/utils/ffmpeg.video.js` | Render pipeline | `renderVideoQuoteOverlay()`, strategy selection |
| `src/utils/caption.wrap.js` | Shared wrapper | `wrapTextWithFont()` |
| `src/utils/caption.wrapWidth.js` | Shared width | `deriveCaptionWrapWidthPx()` |
| `src/utils/karaoke.ass.js` | ASS generation | `buildKaraokeASSFromTimestamps()`, `convertOverlayToASSStyle()` |

---

**End of Report**

