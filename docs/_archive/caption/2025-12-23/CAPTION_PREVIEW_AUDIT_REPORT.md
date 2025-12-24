# Caption Render Pipeline Audit Report
**Phase 1: Audit**  
**Goal**: Identify single source of truth for render captions and document existing preview endpoint

---

## Executive Summary

The caption rendering system uses **SSOT (Single Source of Truth) v3 with "raster" mode**. Captions are rendered as PNG overlays that are composited via FFmpeg, with karaoke word-level highlighting provided via ASS subtitle files. There **IS** an existing preview endpoint (`/api/caption/preview`) that matches render parity when using V3 raster mode.

---

## 1. Single Source of Truth (SSOT) for Render Captions

### 1.1 Caption Generation Flow

**Primary Flow (SSOT v3 raster mode)**:
1. **Preview Generation**: Client calls `POST /api/caption/preview` with caption styling
2. **Server Response**: Returns PNG data URL (`rasterUrl`) + metadata (geometry, typography, positioning)
3. **Render Pipeline**: FFmpeg uses PNG overlay + ASS file for karaoke

### 1.2 Key Files & Functions

#### Preview Endpoint (SSOT v3)
- **File**: `src/routes/caption.preview.routes.js`
- **Route**: `POST /api/caption/preview` (line 65)
- **Function**: `renderCaptionRaster()` (line 1039)
- **Mode**: V3 raster mode (requires `ssotVersion: 3, mode: 'raster'`)

#### Render Pipeline
- **File**: `src/utils/ffmpeg.video.js`
- **Function**: `renderVideoQuoteOverlay()` (line 727)
- **Function**: `buildVideoChain()` (line 382)
- **ASS Generation**: `src/utils/karaoke.ass.js`
  - `buildKaraokeASSFromTimestamps()` (line 356)
  - `convertOverlayToASSStyle()` (line 137)

---

## 2. Styling Decisions & Parameters

### 2.1 Typography (SSOT Fields)

**Font Family**:
- Source: `overlayCaption.fontFamily` (default: `'DejaVu Sans'`)
- Used in: ASS style `Fontname`, Canvas font string
- Location: `karaoke.ass.js:143`, `caption.preview.routes.js:132`

**Font Size**:
- Source: `overlayCaption.fontPx` or `overlayCaption.sizePx`
- Range: Server clamps to 8-400px (`caption.schema.js:17`)
- Used in: ASS style `Fontsize`, Canvas `fontPx`
- Location: `karaoke.ass.js:144`, `renderCaptionRaster()` line 1047

**Font Weight**:
- Source: `overlayCaption.weightCss` (string or number, e.g., `'700'` or `700`)
- Conversion: `normalizeWeight(weightCss) >= 600 ? 1 : 0` for ASS Bold flag
- Location: `karaoke.ass.js:149, 226`

**Font Style**:
- Source: `overlayCaption.fontStyle` (`'normal'`, `'italic'`, `'oblique'`)
- Used in: ASS style `Italic` flag (0 or 1)
- Location: `karaoke.ass.js:150, 227`

**Letter Spacing**:
- Source: `overlayCaption.letterSpacingPx` (default: 0)
- Used in: Canvas rendering (manual glyph positioning)
- Location: `renderCaptionRaster()` line 1050, 1274-1296

**Text Transform**:
- Source: `overlayCaption.textTransform` (`'none'`, `'uppercase'`, `'lowercase'`, `'capitalize'`)
- Applied during rendering
- Location: `renderCaptionRaster()` line 1076-1084

### 2.2 Line Breaks & Wrapping

**Line Wrapping**:
- Source: `overlayCaption.lines` array (browser-rendered, sent from client)
- Server validates: Checks if lines fit within `maxLineWidth` (can rewrap if overflow)
- Formula: `lines.length * fontPx + (lines.length - 1) * lineSpacingPx = totalTextH`
- Location: `renderCaptionRaster()` line 1141-1200

**Line Spacing**:
- Source: `overlayCaption.lineSpacingPx` (pixels, default: 0)
- Used in: Canvas rendering (`currentY += fontPx + lineSpacingPx`), ASS not directly used
- Location: `renderCaptionRaster()` line 1369

### 2.3 Box Padding & Layout

**Internal Padding**:
- Source: `overlayCaption.internalPadding` or `overlayCaption.rasterPadding` (default: 24px)
- Used in: PNG raster generation (padding around text in transparent canvas)
- Location: `renderCaptionRaster()` line 1203, 1304

**Safe Margins**:
- Server-side: `safeTopMargin = 50px` or `H * 0.05` (whichever larger), `safeBottomMargin = H * 0.08`
- Applied during positioning clamp
- Location: `overlay.helpers.js:359-360`, `caption.preview.routes.js:550-551`

**Max Width**:
- Source: `overlayCaption.wPct` (default: 0.8 = 80% of frame width)
- Used in: Text wrapping calculation
- Location: `caption.preview.routes.js:472`

### 2.4 Stroke/Outline

**Stroke Width**:
- Source: `overlayCaption.strokePx` (default: 0, typical: 3)
- Used in: Canvas rendering (`ctx.lineWidth`, `ctx.strokeText`)
- Location: `renderCaptionRaster()` line 1066, 1350-1360

**Stroke Color**:
- Source: `overlayCaption.strokeColor` (default: `'rgba(0,0,0,0.85)'`)
- Used in: Canvas rendering (`ctx.strokeStyle`)
- Location: `renderCaptionRaster()` line 1067, 1353

**ASS Outline** (for karaoke):
- Fixed: `Outline: 3`, `OutlineColour: "&H80202020"` (semi-transparent dark)
- Location: `karaoke.ass.js:235`, `convertOverlayToASSStyle()` line 224

### 2.5 Shadow

**Shadow Properties**:
- Source: `overlayCaption.shadowColor` (default: `'rgba(0,0,0,0.6)'`)
- Source: `overlayCaption.shadowBlur` (default: 12)
- Source: `overlayCaption.shadowOffsetX` (default: 0)
- Source: `overlayCaption.shadowOffsetY` (default: 2)
- Used in: Canvas rendering (`ctx.shadowColor`, `ctx.shadowBlur`, etc.)
- Location: `renderCaptionRaster()` line 1070-1073, 1331-1347

**ASS Shadow** (for karaoke):
- Fixed: `Shadow: 1`
- Location: `karaoke.ass.js:236`

### 2.6 Placement & Positioning

**Vertical Placement**:
- Source: `overlayCaption.yPct` (0.0-1.0, e.g., 0.1 = top, 0.5 = center, 0.9 = bottom)
- Formula: `targetTop = (yPct * H) - (totalTextH / 2)`, then clamped to safe margins
- Location: `overlay.helpers.js:222`, `caption.preview.routes.js:546`

**Horizontal Placement**:
- Source: `overlayCaption.xPct` (default: 0.5 = center)
- Expression: `xExpr = '(W-overlay_w)/2'` for center (raster mode)
- Location: `overlay.helpers.js:290`, `caption.preview.routes.js:45`

**Placement Mode**:
- Source: `overlayCaption.placement` (`'top'`, `'center'`, `'bottom'`, `'custom'`)
- Used in: ASS alignment calculation (`alignmentToASS()`)
- Location: `karaoke.ass.js:121-128`, `convertOverlayToASSStyle()` line 148, 237

### 2.7 Scaling to 1080x1920

**Frame Dimensions**:
- Fixed: `frameW: 1080`, `frameH: 1920`
- Used in: ASS header `PlayResX: 1080`, `PlayResY: 1920`
- Location: `karaoke.ass.js:324-325`, `caption.preview.routes.js:48-49`

**Raster PNG Dimensions**:
- Source: `overlayCaption.rasterW`, `overlayCaption.rasterH` (client-computed, tight to text)
- Validation: Must be < 600px (to ensure tight PNG, not full canvas)
- Location: `overlay.helpers.js:99-101`

---

## 3. Inputs (Session Fields)

### 3.1 Required Fields for Preview (V3 Raster Mode)

```javascript
{
  ssotVersion: 3,
  mode: 'raster',
  text: string,                    // Raw text
  textRaw: string,                 // Optional: text with newlines
  lines: string[],                 // REQUIRED: browser-rendered line breaks
  fontFamily: string,              // Default: 'DejaVu Sans'
  fontPx: number,                  // 8-400
  lineSpacingPx: number,           // Default: 0
  letterSpacingPx: number,         // Default: 0
  weightCss: string | number,      // Default: '700'
  fontStyle: string,               // 'normal' | 'italic' | 'oblique'
  textAlign: string,               // 'left' | 'center' | 'right'
  textTransform: string,           // 'none' | 'uppercase' | 'lowercase' | 'capitalize'
  color: string,                   // Default: 'rgb(255,255,255)'
  opacity: number,                 // 0-1, default: 1.0
  strokePx: number,                // Default: 0
  strokeColor: string,             // Default: 'rgba(0,0,0,0.85)'
  shadowColor: string,             // Default: 'rgba(0,0,0,0.6)'
  shadowBlur: number,              // Default: 12
  shadowOffsetX: number,           // Default: 0
  shadowOffsetY: number,           // Default: 2
  rasterW: number,                 // Client-computed tight width
  rasterH: number,                 // Client-computed tight height
  yPx_png: number,                 // Client-computed Y position (top of PNG)
  rasterPadding: number,           // Default: 24
  totalTextH: number,              // Client-computed: lines.length * fontPx + (lines.length-1) * lineSpacingPx
  yPxFirstLine: number,            // Client-computed: first line baseline Y
  frameW: number,                  // Default: 1080
  frameH: number                   // Default: 1920
}
```

### 3.2 Overlay Caption Object (Used in Render)

The `overlayCaption` object passed to render functions contains:
- All preview fields above
- Plus: `rasterUrl` (PNG data URL from preview), `rasterHash`, `previewFontString`, `previewFontHash`
- Plus: `xPct`, `yPct`, `wPct`, `placement`, `internalPadding`

---

## 4. Outputs (Used by Render)

### 4.1 Raster PNG Overlay

**Format**: PNG with transparent background, tight bounding box around text  
**Dimensions**: `rasterW` x `rasterH` (client-computed, < 600px typically)  
**Position**: `xExpr_png: '(W-overlay_w)/2'` (center), `yPx_png: number` (absolute Y)  
**Usage**: FFmpeg overlay filter: `[vmain][ovr]overlay=${xExpr}:${yPx}`  
**Location**: `ffmpeg.video.js:534-544`

### 4.2 ASS Subtitle File (Karaoke)

**Format**: ASS (Advanced SubStation Alpha) subtitle file  
**Location**: Temporary file created in `os.tmpdir()`, passed to FFmpeg  
**Usage**: FFmpeg subtitles filter: `[base]subtitles='${escAssPath}'[vsub]`  
**Styling**: Derived from `overlayCaption` via `convertOverlayToASSStyle()`  
**Karaoke**: Word-level highlighting via `\k` tags (timing from TTS)  
**Location**: `karaoke.ass.js:356-758`, `ffmpeg.video.js:583-627`

**ASS Style Properties** (from `convertOverlayToASSStyle()`):
- `Fontname`: from `overlayCaption.fontFamily`
- `Fontsize`: from `overlayCaption.fontPx`
- `PrimaryColour`: from `overlayCaption.color` + `opacity` (converted to ASS format)
- `SecondaryColour`: highlight color for karaoke (cyan for white text, brighter for colored)
- `OutlineColour`: fixed `"&H80202020"` (semi-transparent dark)
- `Bold`: `normalizeWeight(weightCss) >= 600 ? 1 : 0`
- `Italic`: `fontStyle === 'italic' ? 1 : 0`
- `Outline`: fixed `3`
- `Shadow`: fixed `1`
- `Alignment`: computed from `textAlign` + `placement` (see `alignmentToASS()`)
- `MarginL`, `MarginR`, `MarginV`: computed from `xPct`, `wPct`, `yPct`, `placement`

### 4.3 Drawtext Filter (Legacy/Fallback)

**Usage**: Only when `assPath` not present AND `overlayCaption.mode !== 'raster'`  
**Location**: `ffmpeg.video.js:1189-1202`  
**Note**: Raster mode is preferred; drawtext is legacy path.

---

## 5. Existing Preview Endpoint Analysis

### 5.1 Endpoint Details

**Route**: `POST /api/caption/preview`  
**File**: `src/routes/caption.preview.routes.js` (line 65)  
**Current Status**: ✅ **ACTIVE** and supports V3 raster mode

### 5.2 Request Format (V3 Raster Mode)

```javascript
POST /api/caption/preview
Content-Type: application/json

{
  ssotVersion: 3,
  mode: 'raster',
  // ... all fields from section 3.1 above
}
```

### 5.3 Response Format

```javascript
{
  ok: true,
  data: {
    imageUrl: null,  // V3 raster mode returns PNG in meta.rasterUrl
    wPx: 1080,
    hPx: 1920,
    xPx: 0,
    meta: {
      ssotVersion: 3,
      mode: 'raster',
      frameW: 1080,
      frameH: 1920,
      rasterUrl: "data:image/png;base64,...",  // PNG data URL
      rasterW: number,                          // Tight width
      rasterH: number,                          // Tight height
      rasterPadding: number,                    // Padding used
      xExpr_png: "(W-overlay_w)/2",
      yPx_png: number,                          // PNG top Y position
      rasterHash: string,                       // SHA-256 hash (first 16 chars)
      previewFontString: string,                // Exact font string used
      previewFontHash: string,                  // Font string hash
      // ... all typography/color/stroke/shadow fields echoed back
      lines: string[],                          // Exact lines used
      lineSpacingPx: number,
      totalTextH: number
    }
  }
}
```

### 5.4 Render Parity Check

✅ **MATCHES RENDER**: When using V3 raster mode, the preview endpoint:
1. Uses same font rendering (Canvas with same font string)
2. Uses same geometry (`rasterW`, `rasterH`, `yPx_png`, `rasterPadding`)
3. Uses same typography (`fontPx`, `lineSpacingPx`, `letterSpacingPx`, etc.)
4. Uses same effects (stroke, shadow with same parameters)
5. Returns PNG that is directly composited in FFmpeg (no recomputation)

**Verification**: The render pipeline reads `overlayCaption.rasterUrl` and uses it verbatim in FFmpeg overlay filter (`ffmpeg.video.js:783-816`).

---

## 6. Render Pipeline Summary

### 6.1 FFmpeg Filter Graph (Raster Mode)

```
[0:v]scale=...crop=1080:1920[vmain]
[1:v]format=rgba[ovr]
[vmain][ovr]overlay=(W-overlay_w)/2:${yPx_png}[vsub]
[vsub]subtitles='${assPath}'[vout]
```

**Notes**:
- PNG overlay is composited first
- ASS subtitles are composited on top (provides karaoke word highlighting)
- ASS styling matches PNG (same font, size, color, outline)

### 6.2 ASS File Generation

**Function**: `buildKaraokeASSFromTimestamps()`  
**Inputs**: 
- `text`: Raw caption text
- `timestamps`: TTS word timings (from ElevenLabs)
- `overlayCaption`: Styling object (SSOT)

**Process**:
1. Convert `overlayCaption` to ASS style via `convertOverlayToASSStyle()`
2. Tokenize text into words
3. Map words to wrapped lines (if `wrappedText` provided)
4. Generate `\k` tags for karaoke (word durations in centiseconds)
5. Write ASS file to temp directory

**Output**: ASS file path (passed to FFmpeg)

---

## 7. Key Constants & Defaults

### 7.1 Frame Dimensions
- **Width**: 1080px (fixed)
- **Height**: 1920px (fixed)

### 7.2 Safe Margins
- **Top**: `max(50px, H * 0.05)` = 96px (for 1920px height)
- **Bottom**: `H * 0.08` = 154px (for 1920px height)

### 7.3 Font Limits
- **Min**: 8px (schema validation)
- **Max**: 400px (schema validation)
- **Default**: 48-64px (depending on context)

### 7.4 ASS Fixed Values
- **Outline**: 3px
- **Shadow**: 1 (depth)
- **OutlineColour**: `"&H80202020"` (semi-transparent dark)
- **PlayResX**: 1080
- **PlayResY**: 1920

---

## 8. Important Notes for Storyboard Preview

### 8.1 Still Preview (No Karaoke)

For storyboard beat cards, you need a **still caption preview** (no karaoke animation). The existing `/api/caption/preview` endpoint already provides this:
- Returns PNG raster image (static, no animation)
- Can be displayed directly on beat cards
- Matches render styling exactly (same PNG used in render)

### 8.2 What to Display

For each beat card, you should:
1. Call `/api/caption/preview` with the beat's caption text + styling
2. Display the returned `meta.rasterUrl` (PNG data URL) as an overlay on the video thumbnail
3. Position using `meta.yPx_png` (scale to beat card dimensions)

### 8.3 Styling Source

The caption styling for each beat should come from:
- Session-level defaults (if beats don't have per-beat styling)
- OR per-beat styling (if stored in session data)
- The same styling will be used at render time, ensuring parity

---

## 9. Files to Reference

### Core Files
- `src/routes/caption.preview.routes.js` - Preview endpoint (SSOT v3)
- `src/utils/karaoke.ass.js` - ASS generation + style conversion
- `src/utils/ffmpeg.video.js` - Render pipeline
- `src/render/overlay.helpers.js` - Placement computation
- `src/schemas/caption.schema.js` - Schema validation

### Client Files (for reference)
- `public/js/caption-preview.js` - Client preview generation
- `public/js/caption-overlay.js` - Overlay manipulation
- `public/creative.html` - UI for caption editing

---

## 10. Questions & Recommendations

### Questions
1. **Per-beat styling**: Do beats have individual caption styling, or do they inherit from session defaults?
2. **Styling persistence**: Where is caption styling stored in the session? (Need to check session schema)
3. **Beat card dimensions**: What are the dimensions of storyboard beat cards? (For scaling `yPx_png`)

### Recommendations
1. ✅ Use existing `/api/caption/preview` endpoint (no new endpoint needed)
2. ✅ Use V3 raster mode (`ssotVersion: 3, mode: 'raster'`)
3. ✅ Store `overlayCaption` object in session for each beat (for render-time reuse)
4. ✅ Scale preview PNG proportionally to beat card dimensions (maintain aspect ratio)
5. ⚠️ Ensure beat card container has `position: relative` for absolute-positioned caption overlay

---

## Conclusion

The caption rendering system is well-architected with SSOT v3 raster mode. The existing preview endpoint (`/api/caption/preview`) **already matches render parity** and can be used directly for storyboard beat card previews. No changes to the render pipeline are needed.

**Next Steps**:
1. Identify where caption styling is stored per beat (or session)
2. Implement client-side code to call preview endpoint for each beat
3. Display PNG overlay on beat cards (positioned using `yPx_png` scaled to card dimensions)
4. Test that preview matches final render output

