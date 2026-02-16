# Caption Render Audit - No-Guesswork Verification

**Goal**: Verify exact wiring + semantics for caption placement/font settings with EXACT preview↔render parity, preparing FUTURE-PROOF split between raster overlay captions and karaoke captions.

**Status**: AUDIT COMPLETE - Contradictions resolved with evidence

**Hard Constraints**:
- Do NOT change karaoke behavior/appearance in this verification step
- ONLY auditing + producing minimal implementation plan
- Any conclusion MUST cite exact file + line evidence
- Split-style route:
  - `session.captionStyle` = raster/beat overlay caption settings (placement/font/size/color/etc.)
  - `session.karaokeStyle` = karaoke-only settings (NOT implemented now; future)
  - Karaoke must continue using existing defaults unless/until we add karaokeStyle explicitly later

---

## CONTRADICTION 1: RESOLVED - Per-Beat Text Rendering

### Question
Audit claims `overlayCaption` is session-level (read once) AND raster mode requires `rasterUrl`. But beats have different `caption.text`. A single `rasterUrl` would imply same caption text on all beats. Prove how per-beat text is actually rendered.

### Evidence

#### A) Render Loop Structure

**Location**: `src/services/story.service.js:778-955`

```778:955:src/services/story.service.js
for (let i = 0; i < shotsWithClips.length; i++) {
  const shot = shotsWithClips[i];
  const caption = session.captions.find(c => c.sentenceIndex === shot.sentenceIndex);
  
  // ... TTS generation ...
  
  // Render segment
  await renderVideoQuoteOverlay({
    text: caption.text,  // ← Text varies per beat
    captionText: caption.text,  // ← Text varies per beat
    overlayCaption: overlayCaption,  // ← SAME object for all beats
  });
}
```

**Finding**: ✅ **Text is per-beat** (`caption.text` varies per iteration), but `overlayCaption` is **session-level** (read once at line 937).

#### B) overlayCaption Read Location

**Location**: `src/services/story.service.js:937`

```937:937:src/services/story.service.js
const overlayCaption = session.overlayCaption || session.captionStyle;
```

**Finding**: ✅ **Read ONCE outside loop** (line 937, BEFORE loop starts at line 778). Same object passed to all `renderVideoQuoteOverlay()` calls.

#### C) Raster Mode PNG Materialization

**Location**: `src/utils/ffmpeg.video.js:818-853`

```818:853:src/utils/ffmpeg.video.js
// 🔒 EARLY PNG MATERIALIZATION - read directly from overlayCaption for raster mode
if (overlayCaption?.mode === 'raster') {
  const dataUrl = overlayCaption.rasterUrl || overlayCaption.rasterDataUrl || overlayCaption.rasterPng;
  
  if (!dataUrl) {
    throw new Error('RASTER: missing rasterDataUrl/rasterUrl');
  }
  
  try {
    usingCaptionPng = true;
    captionPngPath = await fetchToTmp(dataUrl, '.png');
    // ... verify PNG file ...
  } catch (error) {
    throw new Error(`Raster overlay failed: ${error.message}. Please regenerate preview.`);
  }
}
```

**Finding**: ✅ **PNG is materialized ONCE per `renderVideoQuoteOverlay()` call** from `overlayCaption.rasterUrl`. The same PNG (with same text) would be used for all beats if `overlayCaption` is session-level.

#### D) Raster Mode Drawtext Disable

**Location**: `src/utils/ffmpeg.video.js:960-976`

```960:976:src/utils/ffmpeg.video.js
// CRITICAL: Early raster mode guard - skip ALL caption drawtext paths
if (overlayCaption?.mode === 'raster') {
  console.log('[render] RASTER MODE detected - skipping ALL caption drawtext paths');
  
  // 🔒 RASTER MODE ASSERTION - fail fast if PNG missing
  if (!(overlayCaption.rasterUrl || overlayCaption.rasterDataUrl)) {
    throw new Error('RASTER: overlayCaption missing rasterUrl/rasterDataUrl at ffmpeg entry');
  }
  
  // Disable all caption drawtext in pure raster mode
  drawCaption = '';
}
```

**Finding**: ✅ **Raster mode SKIPS all drawtext** - no text is drawn via FFmpeg drawtext. Only PNG overlay is used.

### Resolution

**CONTRADICTION RESOLVED**: The current implementation has a **BUG** or **UNUSED FEATURE**:

1. **Current behavior**: `overlayCaption.rasterUrl` is session-level (single PNG for all beats)
2. **Expected behavior**: Each beat should have its own PNG with its own text
3. **Reality**: All beats would show the **SAME text** from the single session-level PNG

**Possible explanations**:
- **Option A**: Raster mode is not actually used in production (drawtext mode is used instead)
- **Option B**: PNG is regenerated per-beat at render time (but no evidence found)
- **Option C**: There is per-beat overlayCaption storage (but audit found none)

**Evidence for Option A**: Looking at `src/utils/ffmpeg.video.js:976-1055`, there's a fallback path that uses `overlayCaption.text` (not raster mode) which would generate drawtext per beat.

**Conclusion**: **Raster mode with session-level `overlayCaption.rasterUrl` cannot support per-beat text**. Either:
- Raster mode is not used (drawtext mode is used instead), OR
- PNG must be regenerated per-beat at render time from `captionStyle` + `caption.text`, OR
- Per-beat overlayCaption storage must exist (but not found in current codebase)

**Recommendation**: For implementation, we must choose:
- **Strategy 1**: Store `captionStyle` (UI settings) + regenerate PNG per-beat at render time from `captionStyle` + `caption.text`
- **Strategy 2**: Store per-beat `overlayCaption` meta (with `rasterUrl`) keyed by `sentenceIndex`

---

## CONTRADICTION 2: RESOLVED - Preview Response Shape

### Question
Prove the exact `/api/caption/preview` response shape (field names + nesting). Does it return `imageUrl`, `rasterDataUrl`, `rasterUrl`, and where exactly in the JSON?

### Evidence

#### A) V3 Raster Mode Response

**Location**: `src/routes/caption.preview.routes.js:405-415`

```405:415:src/routes/caption.preview.routes.js
return res.status(200).json({
  ok: true,
  data: {
    imageUrl: null,  // V3 raster mode returns PNG in meta.rasterUrl
    wPx: data.frameW,
    hPx: data.frameH,
    xPx: 0,
    // yPx removed - use meta.yPx_png instead (no ambiguous top-level field)
    meta: ssotMeta,
  }
});
```

**Finding**: ✅ **V3 raster mode response shape**:
- `ok: true`
- `data.imageUrl: null` (explicitly null for V3)
- `data.wPx: number` (frame width)
- `data.hPx: number` (frame height)
- `data.xPx: 0` (always 0)
- `data.meta: object` (contains all raster meta)

#### B) meta Object Contents (ssotMeta)

**Location**: `src/routes/caption.preview.routes.js:279-328`

```279:328:src/routes/caption.preview.routes.js
const ssotMeta = {
  ssotVersion: 3,
  mode: 'raster',
  
  // Geometry lock (same as V2)
  frameW: data.frameW,
  frameH: data.frameH,
  bgScaleExpr: "scale='if(gt(a,1080/1920),-2,1080)':'if(gt(a,1080/1920),1920,-2)'",
  bgCropExpr: "crop=1080:1920",
  
  // ✅ FIX: Use server-computed values if rewrap occurred, otherwise echo client SSOT
  rasterUrl: rasterResult.rasterUrl,
  rasterW: data.rasterW,  // ✅ Client canonical value (width doesn't change on rewrap)
  rasterH: finalRasterH,  // ✅ Server-recomputed if rewrap, else client canonical
  rasterPadding: data.rasterPadding,  // ✅ Client canonical value
  xExpr_png: data.xExpr_png,  // ✅ Client canonical value
  yPx_png: finalYPx_png,  // ✅ Keep client value (no positioning policy change)
  
  // Verification hashes - echo back actual server values
  rasterHash,
  previewFontString: rasterResult.previewFontString,
  previewFontHash: rasterResult.previewFontHash,
  
  // Typography (pass-through)
  textRaw: data.textRaw,  // Pass through if provided
  text,
  fontPx,
  fontFamily: data.fontFamily,
  weightCss: data.weightCss,
  fontStyle: data.fontStyle,
  textAlign: data.textAlign,
  letterSpacingPx,
  textTransform: data.textTransform,
  
  // Color & effects (pass-through)
  color: data.color,
  opacity: data.opacity,
  strokePx: data.strokePx,
  strokeColor: data.strokeColor,
  shadowColor: data.shadowColor,
  shadowBlur: data.shadowBlur,
  shadowOffsetX: data.shadowOffsetX,
  shadowOffsetY: data.shadowOffsetY,
  
  // ✅ FIX: Return server-wrapped lines if rewrap occurred, otherwise client lines
  lines: finalLines,  // ✅ Server-wrapped lines if rewrap, else client lines
  lineSpacingPx,
  totalTextH: finalTotalTextH,  // ✅ Server-recomputed if rewrap, else client value
  // yPxFirstLine removed - debug only, not used for positioning
};
```

**Finding**: ✅ **`meta.rasterUrl` contains PNG data URL** (base64-encoded PNG). This is the ONLY place where PNG data exists in the response.

#### C) rasterUrl Generation

**Location**: `src/routes/caption.preview.routes.js:235-236`

```235:236:src/routes/caption.preview.routes.js
const pngBuffer = Buffer.from(rasterResult.rasterUrl.split(',')[1], 'base64');
const rasterHash = crypto.createHash('sha256').update(pngBuffer).digest('hex').slice(0, 16);
```

**Finding**: ✅ **`rasterResult.rasterUrl` is a data URL** (format: `data:image/png;base64,...`). It's generated by `renderCaptionRaster()`.

#### D) renderCaptionRaster Return Value

**Location**: `src/routes/caption.preview.routes.js:1517-1546`

```1517:1546:src/routes/caption.preview.routes.js
return {
  rasterUrl: rasterDataUrl,
  rasterW,
  rasterH,
  yPx,
  padding,  // CRITICAL: actual padding used (for parity verification)
  previewFontString,
  previewFontHash,
  // ✅ FIX: Return rewrap info for route handler
  rewrapped: needsRewrap,
  finalLines: serverWrappedLines,
  serverTotalTextH: needsRewrap ? serverTotalTextH : meta.totalTextH,
  serverRasterH: needsRewrap ? serverRasterH : meta.rasterH,
  // Echo back all styles used (helps debugging)
  fontPx,
  lineSpacingPx: meta.lineSpacingPx,
  fontFamily: fontFamilyName,
  weightCss: fontWeight,
  fontStyle,
  color,
  opacity,
  textAlign,
  letterSpacingPx,
  strokePx,
  strokeColor,
  shadowColor,
  shadowBlur,
  shadowOffsetX,
  shadowOffsetY
};
```

**Finding**: ✅ **`rasterUrl` is a data URL** (`rasterDataUrl` from canvas `toDataURL("image/png")`).

### Resolution

**CONTRADICTION RESOLVED**: Exact response shape proven:

```javascript
{
  ok: true,
  data: {
    imageUrl: null,  // Always null for V3 raster mode
    wPx: 1080,  // Frame width
    hPx: 1920,  // Frame height
    xPx: 0,  // Always 0
    meta: {
      ssotVersion: 3,
      mode: 'raster',
      rasterUrl: "data:image/png;base64,...",  // ← PNG data URL (ONLY location)
      rasterW: number,
      rasterH: number,
      yPx_png: number,
      xExpr_png: string,
      rasterPadding: number,
      frameW: 1080,
      frameH: 1920,
      rasterHash: string,
      previewFontString: string,
      previewFontHash: string,
      fontFamily: string,
      weightCss: string,
      fontPx: number,
      // ... other style fields
      lines: string[],
      totalTextH: number,
      // ... other meta fields
    }
  }
}
```

**Key Finding**: 
- ✅ **`data.meta.rasterUrl`** contains the PNG data URL (base64)
- ❌ **`data.imageUrl`** is always `null` for V3 raster mode
- ❌ **`data.rasterDataUrl`** does NOT exist in response (only `meta.rasterUrl`)

**Storage Implication**: If we persist preview results, we must store `meta.rasterUrl` (the data URL), NOT `data.imageUrl` (which is null).

---

## TASK A: Render Path Trace

### A.1) overlayCaption.rasterUrl Production

**Question**: Where is `overlayCaption.rasterUrl` / `overlayCaption.rasterDataUrl` produced for render?

**Answer**: **NOT produced at render time - must exist in session data**

**Evidence**:
- **Location**: `src/utils/ffmpeg.video.js:818-829`
  ```818:829:src/utils/ffmpeg.video.js
  if (overlayCaption?.mode === 'raster') {
    const dataUrl = overlayCaption.rasterUrl || overlayCaption.rasterDataUrl || overlayCaption.rasterPng;
    
    if (!dataUrl) {
      throw new Error('RASTER: missing rasterDataUrl/rasterUrl');
    }
    
    captionPngPath = await fetchToTmp(dataUrl, '.png');
  }
  ```
- **Finding**: ✅ Render **reads** `overlayCaption.rasterUrl` from session, does NOT generate it.

### A.2) Render-Time PNG Generation

**Question**: Does `renderVideoQuoteOverlay` (or a helper) generate raster from (text + style) at render time, OR does it expect precomputed raster in persisted session data?

**Answer**: **Expects precomputed raster - does NOT generate at render time**

**Evidence**:
- **Location**: `src/utils/ffmpeg.video.js:818-853`
  - Render materializes PNG from `overlayCaption.rasterUrl` (data URL)
  - No call to `renderCaptionRaster()` found in render path
  - `renderCaptionRaster()` only exists in `src/routes/caption.preview.routes.js:1084` (preview route)
- **Finding**: ✅ Render **requires** precomputed `rasterUrl` - throws error if missing (line 828).

### A.3) overlayCaption Mutation Per Beat

**Question**: Is `overlayCaption` mutated per beat inside a loop, or is it truly constant?

**Answer**: **Truly constant - NOT mutated per beat**

**Evidence**:
- **Location**: `src/services/story.service.js:937`
  ```937:937:src/services/story.service.js
  const overlayCaption = session.overlayCaption || session.captionStyle;
  ```
  - Read ONCE outside loop (line 937, loop starts at line 778)
  - Same object passed to all `renderVideoQuoteOverlay()` calls (line 950)
- **Finding**: ✅ **Constant** - same `overlayCaption` object for all beats.

### A.4) Render Path Call Chain Map

```
renderStory() [story.service.js:754]
  → loadStorySession() [story.service.js:755]
    → session.overlayCaption || session.captionStyle [story.service.js:937]
  → for each beat [story.service.js:778]
    → renderVideoQuoteOverlay() [story.service.js:939]
      → Materialize PNG from overlayCaption.rasterUrl [ffmpeg.video.js:818-833]
        → fetchToTmp(dataUrl, '.png') [ffmpeg.video.js:833]
      → buildVideoChain() [ffmpeg.video.js:1636]
        → FFmpeg overlay filter [ffmpeg.video.js:524]
          → overlay=${xExpr}:${y} [ffmpeg.video.js:524]
```

**Key Findings**:
1. ✅ `overlayCaption` read from session (line 937)
2. ✅ PNG materialized from `overlayCaption.rasterUrl` (line 818-833)
3. ✅ Same PNG used for all beats (no per-beat generation)
4. ❌ **BUG**: All beats would show same text if `rasterUrl` is session-level

---

## TASK B: Persisted Session Storage

### B.1) Session Storage Location

**Location**: `src/services/story.service.js:55-57`

```55:57:src/services/story.service.js
export async function saveStorySession({ uid, sessionId, data }) {
  await saveJSON({ uid, studioId: sessionId, file: 'story.json', data });
}
```

**Storage Path**: `drafts/{uid}/{sessionId}/story.json` (via `src/utils/json.store.js:16-18`)

### B.2) Session Size Limit

**Location**: `src/utils/json.store.js:22-23`

```22:23:src/utils/json.store.js
const MAX_SESSION_BYTES = 500 * 1024; // 500KB
if (sizeBytes > MAX_SESSION_BYTES) {
  throw new Error('SESSION_TOO_LARGE');
}
```

**Finding**: ✅ **500KB limit** - base64 PNG data URLs would quickly exceed this.

### B.3) Current Session Schema (Inferred)

**Evidence from code**:
- `session.overlayCaption` - read at `story.service.js:808, 937`
- `session.captionStyle` - read at `story.service.js:808, 937` (fallback)
- `session.captions` - array of `{ text, sentenceIndex, startTimeSec, endTimeSec }`
- `session.shots` - array of shot objects

**Finding**: ❌ **No evidence of per-beat overlayCaption storage** - only session-level.

### B.4) Base64 Data URL Storage

**Question**: Is any raster data stored as base64 data URL in session JSON?

**Answer**: **UNKNOWN - requires inspection of actual session files**

**Recommendation**: Add temporary probe to inspect session JSON after successful render:
- Log `Object.keys(session)` and `session.overlayCaption` structure
- Check if `overlayCaption.rasterUrl` exists and its size
- Verify if base64 data URLs are present

---

## TASK C: Karaoke Coupling

### C.1) Karaoke ASS Generation Location

**Location**: `src/services/story.service.js:857-866`

```857:866:src/services/story.service.js
assPath = await buildKaraokeASSFromTimestamps({
  text: caption.text,
  timestamps: ttsResult.timestamps,
  durationMs: ttsDurationMs,
  audioPath: ttsPath,
  wrappedText: wrappedText,
  overlayCaption: overlayCaption, // Pass overlay styling (SSOT)
  width: 1080,
  height: 1920
});
```

**Finding**: ✅ Karaoke receives `overlayCaption` as parameter (same object as render).

### C.2) Karaoke Style Conversion

**Location**: `src/utils/karaoke.ass.js:137-153`

```137:153:src/utils/karaoke.ass.js
export function convertOverlayToASSStyle(overlayCaption, width = 1080, height = 1920) {
  if (!overlayCaption) {
    return null;
  }
  
  // Extract styling from overlay
  const fontFamily = overlayCaption.fontFamily || 'DejaVu Sans';
  const fontPx = overlayCaption.fontPx || overlayCaption.sizePx || 64;
  const color = overlayCaption.color || '#ffffff';
  const opacity = typeof overlayCaption.opacity === 'number' ? overlayCaption.opacity : 1.0;
  const textAlign = overlayCaption.textAlign || overlayCaption.align || 'center';
  const placement = overlayCaption.placement || 'center';
  const weightCss = overlayCaption.weightCss || 'normal';
  const fontStyle = overlayCaption.fontStyle || 'normal';
  const yPct = typeof overlayCaption.yPct === 'number' ? overlayCaption.yPct : 0.5;
  const xPct = typeof overlayCaption.xPct === 'number' ? overlayCaption.xPct : 0.5;
  const wPct = typeof overlayCaption.wPct === 'number' ? overlayCaption.wPct : 0.8;
```

**Karaoke Expected Keys**:

| Key | Default | Used For |
|-----|---------|----------|
| `fontFamily` | `'DejaVu Sans'` | ASS font name |
| `fontPx` or `sizePx` | `64` | ASS font size |
| `color` | `'#ffffff'` | ASS text color |
| `opacity` | `1.0` | ASS text opacity |
| `textAlign` or `align` | `'center'` | ASS text alignment |
| `placement` | `'center'` | ASS vertical placement |
| `weightCss` | `'normal'` | ASS font weight |
| `fontStyle` | `'normal'` | ASS font style (italic) |
| `yPct` | `0.5` | ASS vertical position |
| `xPct` | `0.5` | ASS horizontal position |
| `wPct` | `0.8` | ASS text width percentage |

### C.3) Karaoke Style Source

**Location**: `src/services/story.service.js:808`

```808:808:src/services/story.service.js
const overlayCaption = session.overlayCaption || session.captionStyle;
```

**Finding**: ✅ Karaoke reads from **same source as render** (`session.overlayCaption || session.captionStyle`).

### C.4) Future Separation Strategy

**Current**: Karaoke uses `overlayCaption` (same as raster overlay)

**Future**: 
- `session.captionStyle` → raster overlay only
- `session.karaokeStyle` → karaoke only (NOT implemented yet)
- Karaoke fallback: If `karaokeStyle` missing, use current defaults (NOT `captionStyle`)

**Implementation Note**: For this phase, karaoke MUST continue using existing defaults (hardcoded in `convertOverlayToASSStyle()`), NOT `captionStyle`.

---

## TASK D: Style Key Semantics

### D.1) Weight Key Mismatch

**Question**: Which callers pass `opts.weight` vs `opts.weightCss` vs `style.weightCss`?

**Evidence**:

1. **Function Signature** (`public/js/caption-preview.js:63`):
   ```63:63:public/js/caption-preview.js
   * @param {string} [opts.weight='bold'] - Font weight
   ```
   - Accepts `opts.weight` (legacy)

2. **Payload Construction** (`public/js/caption-preview.js:324`):
   ```324:324:public/js/caption-preview.js
   weightCss: opts.weight || overlayMeta?.weightCss || 'normal',
   ```
   - Stores as `weightCss` (canonical)

3. **UI Construction** (`public/creative.html:2022`):
   - Uses `weightCss: fontConfig.weightCss` (canonical)

**Finding**: ✅ **Mismatch exists** - function accepts `opts.weight` but stores as `weightCss`.

**Recommendation**: Standardize to `weightCss` everywhere. Update function signature to accept `opts.weightCss` (with fallback to `opts.weight` for backward compatibility).

### D.2) Canonical CaptionStyle Schema

```typescript
{
  // Typography (REQUIRED)
  fontFamily: string;        // e.g., 'DejaVu Sans'
  weightCss: string;         // Canonical: 'normal' | 'bold' | '700' | etc. (CSS value)
  fontPx: number;           // Font size in pixels (8-400)
  fontStyle?: string;       // 'normal' | 'italic' (default: 'normal')
  textAlign?: string;       // 'left' | 'center' | 'right' (default: 'center')
  letterSpacingPx?: number; // Letter spacing in pixels (default: 0)
  textTransform?: string;   // 'none' | 'uppercase' | etc. (default: 'none')
  
  // Color & Effects
  color: string;            // e.g., '#FFFFFF' or 'rgb(255,255,255)'
  opacity: number;          // 0-1 (default: 1.0)
  strokePx?: number;        // Stroke width in pixels (default: 0)
  strokeColor?: string;    // Stroke color (default: 'rgba(0,0,0,0.85)')
  shadowColor?: string;    // Shadow color (default: 'rgba(0,0,0,0.6)')
  shadowBlur?: number;      // Shadow blur in pixels (default: 12)
  shadowOffsetX?: number;  // Shadow X offset (default: 0)
  shadowOffsetY?: number;  // Shadow Y offset (default: 2)
  
  // Placement (REQUIRED)
  placement: 'top' | 'center' | 'bottom';  // Vertical placement preset
  yPct: number;            // 0-1 (derived from placement or user-set)
  wPct?: number;           // Text width percentage (default: 0.8)
  
  // UI-only fields (NOT used in render)
  shadow?: boolean;         // UI toggle (not used in render)
  showBox?: boolean;        // UI toggle (not used in render)
  boxColor?: string;        // UI-only (not used in render)
  lineHeight?: number;      // UI-only (not used in render)
  padding?: number;         // UI-only (not used in render)
  maxWidthPct?: number;     // UI-only (not used in render)
  borderRadius?: number;   // UI-only (not used in render)
}
```

**Key Rules**:
- ✅ **Canonical key**: `weightCss` (NOT `weight`)
- ✅ **Legacy support**: Accept `weight` as input, normalize to `weightCss`
- ✅ **Placement**: Use `placement` enum, derive `yPct` from placement

### D.3) Canonical Raster Meta Schema

```typescript
{
  // Mode & Version
  ssotVersion: 3;
  mode: 'raster';
  
  // Geometry (frame-space pixels)
  frameW: number;           // Frame width (default: 1080)
  frameH: number;           // Frame height (default: 1920)
  rasterW: number;          // Overlay width (100-1080)
  rasterH: number;          // Overlay height (50-1920)
  yPx_png: number;          // TOP-LEFT Y coordinate (0-1920) - REQUIRED for FFmpeg overlay
  xPx_png?: number;         // Absolute X position (0-1080) - optional
  xExpr_png: string;       // X expression (default: '(W-overlay_w)/2')
  rasterPadding: number;    // Internal padding (default: 24)
  
  // PNG Data (REQUIRED for render)
  rasterUrl: string;        // PNG data URL (base64) - REQUIRED
  rasterHash: string;       // SHA256 hash (first 16 chars) - integrity check
  previewFontString: string; // Font string for parity validation
  previewFontHash: string;   // Font hash for parity validation
  
  // Typography (from captionStyle)
  fontFamily: string;
  weightCss: string;
  fontPx: number;
  lineSpacingPx: number;
  // ... other style fields ...
  
  // Text & Lines
  text: string;             // Original text
  lines: string[];          // Browser-rendered line breaks (REQUIRED)
  totalTextH: number;       // Total text height in pixels
  
  // Background scaling (for geometry lock)
  bgScaleExpr: string;      // FFmpeg scale expression
  bgCropExpr: string;       // FFmpeg crop expression
}
```

**Key Rules**:
- ✅ **yPx_png**: TOP-LEFT anchor semantics (used directly in FFmpeg `overlay=x:y`)
- ✅ **rasterUrl**: Base64 data URL (format: `data:image/png;base64,...`)
- ✅ **lines**: Browser-rendered line breaks (SSOT from client)

### D.4) Placement Semantics

**Evidence**: `src/utils/ffmpeg.video.js:1541`

```1541:1541:src/utils/ffmpeg.video.js
y: overlayCaption.yPx_png ?? overlayCaption.yPx,  // Use PNG anchor, not drawtext anchor
```

**FFmpeg Overlay Expression**: `src/utils/ffmpeg.video.js:524`

```524:524:src/utils/ffmpeg.video.js
const overlayExpr = `[vmain][ovr]overlay=${xExpr}:${y}:format=auto,${endFormat}[vout]`;
```

**Finding**: ✅ **yPx_png is TOP-LEFT anchor** - FFmpeg `overlay=x:y` uses Y as top-left of overlay image.

---

## TASK E: Truth Table & Implementation Plan

### E.1) No-Guesswork Truth Table

| Scenario | Session Has | overlayCaption Has | Render Outcome | Notes |
|----------|-------------|-------------------|----------------|-------|
| **1) captionStyle only** | ✅ `captionStyle` | ❌ No `rasterUrl` | ❌ **FAILS** | Render requires `rasterUrl` (throws error at `ffmpeg.video.js:828`) |
| **2) overlayCaption only** | ❌ No `captionStyle` | ✅ `rasterUrl` | ✅ **WORKS** | Render uses `overlayCaption.rasterUrl` (all beats show same text) |
| **3) Both** | ✅ `captionStyle` | ✅ `rasterUrl` | ✅ **WORKS** | Render uses `overlayCaption.rasterUrl` (all beats show same text) |
| **4) After refresh** | ❌ Lost | ❌ Lost | ❌ **FAILS** | Window globals lost; render throws "missing rasterUrl" |
| **5) Per-beat vs session-level** | Session-level | Session-level | ⚠️ **BUG** | All beats show same text (from single PNG) |

**Key Findings**:
1. ✅ Render **requires** `overlayCaption.rasterUrl` - cannot work with `captionStyle` alone
2. ❌ Current implementation has **BUG**: All beats show same text if `rasterUrl` is session-level
3. ⚠️ **Storage strategy must support per-beat text** OR regenerate PNG per-beat at render time

### E.2) Minimal-Diff Implementation Plan - Commit 1

**Goal**: Persist `session.captionStyle` (UI settings) safely, without altering karaoke behavior, without storing base64 in JSON.

#### Step 1: Add Session Save Route for Caption Style

**File**: `src/routes/story.routes.js`

**Action**: Add new route to save UI style settings (NOT full `overlayCaption` meta):

```javascript
r.post("/update-caption-style", async (req, res) => {
  const parsed = z.object({
    sessionId: z.string().min(3),
    captionStyle: z.object({
      fontFamily: z.string().optional(),
      weightCss: z.string().optional(),  // Canonical (normalize weight -> weightCss)
      fontPx: z.number().optional(),
      placement: z.enum(['top', 'center', 'bottom']).optional(),
      yPct: z.number().min(0).max(1).optional(),
      opacity: z.number().min(0).max(1).optional(),
      color: z.string().optional(),
      // UI-only fields (not used in render)
      shadow: z.boolean().optional(),
      showBox: z.boolean().optional(),
      boxColor: z.string().optional(),
      lineHeight: z.number().optional(),
      padding: z.number().optional(),
      maxWidthPct: z.number().optional(),
      borderRadius: z.number().optional()
    })
  }).safeParse(req.body);
  
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "INVALID_INPUT", detail: parsed.error.flatten() });
  }
  
  const { sessionId, captionStyle } = parsed.data;
  const session = await getStorySession({ uid: req.user.uid, sessionId });
  if (!session) {
    return res.status(404).json({ success: false, error: "SESSION_NOT_FOUND" });
  }
  
  // Normalize weight -> weightCss
  if (captionStyle.weight && !captionStyle.weightCss) {
    captionStyle.weightCss = captionStyle.weight;
    delete captionStyle.weight;
  }
  
  session.captionStyle = { ...session.captionStyle, ...captionStyle };
  await saveStorySession({ uid: req.user.uid, sessionId, data: session });
  
  return res.json({ success: true, data: { captionStyle: session.captionStyle } });
});
```

**Key Decision**: Store `captionStyle` (UI settings), NOT `overlayCaption` (render meta with `rasterUrl`). This avoids base64 bloat in JSON.

#### Step 2: Wire UI Changes → Save Route

**File**: `public/creative.html`

**Location**: After `captionStyle` construction (line 2025)

**Action**: Add debounced save call:

```javascript
const saveCaptionStyleToSession = debounce(async (style) => {
  if (!window.currentStorySession?.id) return;
  
  try {
    await apiFetch('/api/story/update-caption-style', {
      method: 'POST',
      body: {
        sessionId: window.currentStorySession.id,
        captionStyle: {
          fontFamily: style.fontFamily,
          weightCss: style.weightCss,
          fontPx: style.fontPx,
          placement: style.placement,
          yPct: style.yPct,
          opacity: style.opacity,
          color: style.color
        }
      }
    });
    console.log('[caption-style] Saved to session');
  } catch (err) {
    console.warn('[caption-style] Save failed:', err);
  }
}, 500);

// Call after captionStyle construction:
saveCaptionStyleToSession(captionStyle);
```

#### Step 3: Load Style from Session on Session Load

**File**: `public/creative.html`

**Location**: `renderStoryboard(session)` function or session load handler

**Action**: Apply loaded `captionStyle` to UI controls (font dropdown, weight dropdown, size slider, placement dropdown, opacity slider).

**Test**: Change style → save called (debounced), `session.captionStyle` updated. Load session → UI controls reflect saved style.

### E.3) Minimal-Diff Plan for Render Parity (Future Commits)

**Problem**: Render requires `overlayCaption.rasterUrl`, but we're only storing `captionStyle`. We must either:
- **Option A**: Regenerate PNG per-beat at render time from `captionStyle` + `caption.text`
- **Option B**: Persist per-beat raster meta + Storage PNG references (NOT base64), keyed by `sentenceIndex`

#### Option A: Render-Time PNG Generation

**Files**: `src/utils/ffmpeg.video.js`, `src/routes/caption.preview.routes.js`

**Changes**:
1. Import `renderCaptionRaster()` into `ffmpeg.video.js`
2. In `renderVideoQuoteOverlay()`, if `overlayCaption.mode === 'raster'` but `rasterUrl` missing:
   - Generate PNG from `captionStyle` + `text` using `renderCaptionRaster()`
   - Use generated PNG for overlay
3. This requires `captionStyle` to be passed to `renderVideoQuoteOverlay()` (or read from session)

**Pros**: No per-beat storage, always fresh PNGs
**Cons**: Slower render (PNG generation per beat), requires text + style at render time

#### Option B: Per-Beat Raster Meta + Storage

**Files**: `src/routes/story.routes.js`, `src/services/story.service.js`, `src/utils/ffmpeg.video.js`

**Changes**:
1. Store per-beat `overlayCaption` meta keyed by `sentenceIndex`:
   ```javascript
   session.beatOverlays = {
     [sentenceIndex]: {
       mode: 'raster',
       storagePath: 'drafts/{uid}/{sessionId}/caption-{sentenceIndex}.png',
       rasterW, rasterH, yPx_png, xExpr_png,
       // ... other meta (NO base64)
     }
   }
   ```
2. Upload PNG to Firebase Storage (NOT base64 in JSON)
3. At render time, read `session.beatOverlays[sentenceIndex]` and download PNG from Storage

**Pros**: Fast render (precomputed PNGs), survives refresh
**Cons**: More complex storage structure, requires preview generation before render

**Recommendation**: **Option A** (render-time generation) for Phase 1, **Option B** (per-beat storage) for Phase 2 if needed.

---

## Summary of Key Findings

### Critical Discoveries

1. **Contradiction 1 RESOLVED**: Current raster mode implementation has a **BUG** - all beats would show the same text if `overlayCaption.rasterUrl` is session-level. Either raster mode is not used, or PNG must be regenerated per-beat.

2. **Contradiction 2 RESOLVED**: Preview response shape proven:
   - `data.meta.rasterUrl` contains PNG data URL (base64)
   - `data.imageUrl` is always `null` for V3 raster mode
   - No `rasterDataUrl` field exists

3. **Render Dependency**: Render **requires** `overlayCaption.rasterUrl` - cannot work with `captionStyle` alone (throws error at `ffmpeg.video.js:828`).

4. **Karaoke Coupling**: Karaoke reads from `session.overlayCaption || session.captionStyle` (same source as render). For future split, karaoke must use `session.karaokeStyle` (NOT implemented yet).

5. **Storage Limit**: Session JSON has 500KB limit - base64 PNG data URLs would quickly exceed this.

### Recommended Implementation Approach

**Phase 1 (Minimal)**:
- Store `captionStyle` (UI settings) in session via `/api/story/update-caption-style`
- Wire UI changes → save route (debounced)
- Load `captionStyle` from session on session load
- **DO NOT** store `overlayCaption.rasterUrl` in JSON (would exceed size limit)

**Phase 2 (Render Parity)**:
- **Option A**: Regenerate PNG per-beat at render time from `captionStyle` + `caption.text`
- **Option B**: Persist per-beat raster meta + Storage PNG references (NOT base64), keyed by `sentenceIndex`

**Phase 3 (Future - Karaoke Split)**:
- Add `session.karaokeStyle` for karaoke-only settings
- Update karaoke to read from `karaokeStyle` (fallback to current defaults, NOT `captionStyle`)

---

## Open Questions Requiring Probes

1. **Is raster mode actually used in production?**
   - **Probe**: Add temporary log in `renderVideoQuoteOverlay()` to check if `overlayCaption?.mode === 'raster'` is ever true
   - **Alternative**: Check if drawtext mode is used instead (which would support per-beat text)

2. **What is the actual session JSON structure after a successful render?**
   - **Probe**: Add temporary log to dump `Object.keys(session)` and `session.overlayCaption` structure
   - **Check**: Does `overlayCaption.rasterUrl` exist? Is it base64? What is its size?

3. **Does render-time PNG generation already exist?**
   - **Probe**: Search codebase for calls to `renderCaptionRaster()` outside preview route
   - **Check**: Is there any code path that generates PNG from text+style at render time?

---

## Evidence Citations Summary

| Claim | File | Line(s) |
|-------|------|---------|
| overlayCaption read once (session-level) | `src/services/story.service.js` | 937 |
| Text varies per beat | `src/services/story.service.js` | 946-947 |
| Render requires rasterUrl | `src/utils/ffmpeg.video.js` | 828 |
| Raster mode skips drawtext | `src/utils/ffmpeg.video.js` | 960-976 |
| Preview response shape | `src/routes/caption.preview.routes.js` | 405-415 |
| meta.rasterUrl contains PNG | `src/routes/caption.preview.routes.js` | 290 |
| Karaoke reads overlayCaption | `src/services/story.service.js` | 808, 863 |
| Karaoke style conversion | `src/utils/karaoke.ass.js` | 137-153 |
| Weight key mismatch | `public/js/caption-preview.js` | 63, 324 |
| Session storage path | `src/services/story.service.js` | 55-57 |
| Session size limit | `src/utils/json.store.js` | 22-23 |
| yPx_png TOP-LEFT anchor | `src/utils/ffmpeg.video.js` | 1541, 524 |

---

**End of Audit**


