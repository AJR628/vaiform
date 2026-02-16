# Caption & Font Pipeline Audit Report

**Date**: 2025-01-XX  
**Purpose**: Audit Vaiform's caption system to safely add new font settings WITHOUT breaking SSOT parity or karaoke captions  
**Status**: Audit Only - No Implementation

---

## Executive Summary

This audit maps the complete caption pipeline from UI → overlay state → preview payload → server render → returned meta → live overlay/karaoke → final export. The system currently uses **DejaVu Sans** as the single font family with 4 variants (regular, bold, italic, bold-italic). All font operations follow SSOT (Single Source of Truth) principles where the server owns meta keys and the client consumes them verbatim.

**Key Findings**:
- ✅ Font loading is centralized: client uses `@font-face` in CSS + Font Loading API; server uses `registerDejaVuFonts()` for canvas
- ✅ Font mapping is consistent: UI font names map to server font files via `font.registry.js`
- ✅ Karaoke system reads from `overlayCaption` parameter (same source as render)
- ⚠️ Font family is hardcoded to "DejaVu Sans" in multiple places
- ⚠️ Text measurement uses canvas `measureText()` on both client and server
- ⚠️ Line wrapping depends on font metrics - font changes will affect wrapping

---

## 1. Caption Pipeline Map (End-to-End)

### Stage 1: UI → Overlay State

**File**: `public/creative.html` (lines 2007-2034)

**Font Selection UI**:
```javascript
const fontMapping = {
    'system': { family: 'DejaVu Sans', weightCss: 'normal' },
    'bold': { family: 'DejaVu Sans', weightCss: 'bold' },
    'cinematic': { family: 'DejaVu Sans', weightCss: 'bold' }, // Fallback to DejaVu
    'minimal': { family: 'DejaVu Sans', weightCss: 'normal' }
};
```

**Key Functions**:
- Font selection: `document.getElementById('caption-font')?.value` → mapped via `fontMapping`
- Caption style assembly: `captionStyle` object built with `fontFamily`, `weightCss`, `fontPx`, etc.

**Output**: `captionStyle` object passed to overlay system

---

### Stage 2: Overlay State → Preview Payload

**File**: `public/js/caption-overlay.js`

**Key Functions**:
- `computeCaptionMetaFromElements()` (lines 1434-1609): Extracts meta from DOM elements
  - Reads computed styles: `fontFamily`, `fontPx`, `weightCss`, `fontStyle`
  - Extracts lines via `extractRenderedLines(contentEl)` (line 1494)
  - Computes `previewFontString`: `${fontStyle} ${weightCss === '700' ? 'bold' : 'normal'} ${fontPx}px "${family}"` (line 1503)
  - **Hardcoded**: `const family = 'DejaVu Sans';` (line 1502)
  
- `extractRenderedLines()` (lines 2148-2220): Extracts browser-rendered line breaks
  - Primary: DOM Range API (lines 2289-2329)
  - Fallback: Canvas `measureText()` (lines 2332-2367)
  - **Font dependency**: Canvas fallback uses `ctx.font = ${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`

- `emitCaptionState()` / `getCaptionMeta()`: Builds `__overlayMeta` object
  - Includes: `fontFamily`, `fontPx`, `weightCss`, `fontStyle`, `previewFontString`, `lines[]`, `totalTextH`, `yPx_png`, etc.

**Output**: `overlayMeta` object with SSOT fields

---

### Stage 3: Preview Payload → Server Render

**File**: `src/routes/caption.preview.routes.js`

**Route**: `POST /api/caption/preview` (line 69)

**Schema**: V3 Raster Schema (lines 14-65)
- Requires: `ssotVersion: 3`, `mode: 'raster'`
- Typography: `fontFamily`, `fontPx`, `weightCss`, `fontStyle`, `letterSpacingPx`, `lineSpacingPx`
- Geometry: `rasterW`, `rasterH`, `yPx_png`, `lines[]`, `totalTextH`

**Key Functions**:
- `renderCaptionRaster(meta)` (lines 1061-1524): Renders PNG overlay
  - Uses `canvasFontString()` from `font.registry.js` (line 7)
  - Calls `wrapTextWithFont()` from `caption.wrap.js` for server-side wrapping (if needed)
  - Returns: `rasterUrl`, `previewFontString`, `fontFamily`, `weightCss`, etc.

- `wrapLinesWithFont()` (lines 1610-1639): Server-side text wrapping
  - Uses canvas `measureText()` with letter spacing accounting
  - **Font dependency**: Wrapping depends on `ctx.measureText()` which requires registered font

**Font Registration**:
- `registerDejaVuFonts()` called at server startup (`server.js:23`)
- Uses `@napi-rs/canvas` `GlobalFonts.registerFromPath()`
- Files: `DejaVuSans.ttf`, `DejaVuSans-Bold.ttf`, `DejaVuSans-Oblique.ttf`, `DejaVuSans-BoldOblique.ttf`

**Output**: PNG data URL + meta object with `previewFontString`, `fontFamily`, etc.

---

### Stage 4: Returned Meta → Live Overlay/Karaoke

**File**: `public/js/caption-overlay.js`, `public/js/caption-live.js`

**Live Overlay**:
- Receives `meta` from preview response
- Applies `previewFontString` to DOM element
- Uses `yPct` from server for positioning (no client recomputation)

**Karaoke System**:
- **File**: `src/utils/karaoke.ass.js`
- **Function**: `buildKaraokeASSFromTimestamps()` (lines 408-810)
- **Input**: `overlayCaption` parameter (same object as render)
- **Style Conversion**: `convertOverlayToASSStyle()` (lines 144-253)
  - Reads: `fontFamily`, `fontPx`, `weightCss`, `fontStyle`, `color`, `opacity`, `placement`, `yPct`
  - **Hardcoded fallback**: `fontFamily = overlayCaption.fontFamily || 'DejaVu Sans'` (line 150)
  - Converts to ASS format: `Fontname`, `Fontsize`, `Bold`, `Italic`, etc.

**Karaoke Word Highlighting**:
- Uses `\k` tags for word-level timing (lines 687-727)
- Text tokenization: `tokenize(text)` splits by whitespace (line 8)
- Line wrapping: Uses `mapTokensToWrappedLines()` if `wrappedText` provided (line 681)
- **Font dependency**: Wrapping depends on font metrics (via `wrappedText` parameter)

---

### Stage 5: Final Export

**File**: `src/utils/ffmpeg.video.js`

**Raster Mode** (skips drawtext):
- Uses PNG overlay only (line 960-976)
- No font dependency in raster mode

**Drawtext Mode** (legacy):
- Uses `resolveFontFile()` from `font.registry.js` (line 61)
- Builds `fontfile=` argument for FFmpeg drawtext filter
- **Font dependency**: FFmpeg requires font file path

**Karaoke Mode**:
- Uses ASS subtitles file (generated by `buildKaraokeASSFromTimestamps()`)
- ASS file includes font name in style definition
- **Font dependency**: ASS `Fontname` must match system font or be registered

---

## 2. Karaoke System Map

### 2.1 Word Timings Source

**File**: `src/services/story.service.js` (lines 800-863)

**Source**: ElevenLabs TTS API timestamps
- `ttsResult.timestamps.words[]` - word-level timings
- `ttsResult.timestamps.characters[]` - character-level timings (fallback)
- Each word has: `start_time_ms`, `end_time_ms`

**Usage**: Passed to `buildKaraokeASSFromTimestamps()` (line 896)

---

### 2.2 Highlighting Application

**File**: `src/utils/karaoke.ass.js` (lines 687-727)

**Mechanism**: ASS `\k` tags
- Format: `{\kNN}word` where NN = centiseconds to wait
- Behavior: Word starts in `SecondaryColour` (cyan), transitions to `PrimaryColour` (white) after `\k` duration
- Example: `{\k20}Hello {\k30}world` → "Hello" highlights for 200ms, then "world" for 300ms

**Duration Calculation**:
- From TTS timestamps: `durMs = wordEndMs - wordStartMs`
- Scaling: If audio duration doesn't match timestamp sum, scale factor applied (lines 512-541)
- Conversion: `k = Math.max(1, Math.round(durMs / 10))` (centiseconds)

---

### 2.3 Line/Word Measurement & Splitting

**Text Tokenization**:
- Function: `tokenize(text)` (line 8)
- Logic: `String(text || "").trim().split(/\s+/)`
- **No font dependency**: Simple whitespace splitting

**Line Wrapping**:
- Function: `mapTokensToWrappedLines(rawTokens, wrappedText)` (lines 18-64)
- **Input**: `wrappedText` parameter (pre-wrapped text with `\n` line breaks)
- **Source**: `wrappedText` comes from `compileCaptionSSOT()` which uses `wrapTextWithFont()` (server-side canvas measurement)
- **Font dependency**: ✅ **CRITICAL** - Wrapping depends on font metrics via `wrappedText` parameter

**Line Break Insertion**:
- Checks if next word starts a new line: `wrapMap.tokenToLine[i] !== wrapMap.tokenToLine[i + 1]`
- Inserts `\N` (ASS newline) between words on different lines
- Inserts space between words on same line

---

### 2.4 Assumptions & Dependencies

**Assumptions**:
1. `wrappedText` parameter matches actual rendered line breaks (from server canvas measurement)
2. Word tokens from `tokenize()` align with TTS word timings
3. Font metrics are consistent between preview (client canvas) and render (server canvas)
4. ASS font name matches system font or is registered in FFmpeg

**Dependencies**:
- ✅ Text tokenization: **No font dependency** (whitespace splitting only)
- ⚠️ Line wrapping: **Font dependent** (via `wrappedText` parameter from server)
- ⚠️ Highlighting: **No font dependency** (uses word timings only)
- ⚠️ ASS style: **Font dependent** (ASS `Fontname` must be valid)

**Caches**:
- No font-specific caches found
- `lastGoodDOMCache` in `extractLinesStable()` caches by `text`, `contentWidth`, `fontPx`, `lineSpacingPx` (lines 2245-2252)
- **Invalidation**: Cache key includes `fontPx` and `lineSpacingPx`, so font size changes invalidate cache ✅

---

## 3. Font System Map

### 3.1 Allowed Font Names

**Current**: Only **"DejaVu Sans"** is supported

**Client UI Names** (mapped to server names):
- `'system'` → `'DejaVu Sans'` (normal)
- `'bold'` → `'DejaVu Sans'` (bold)
- `'cinematic'` → `'DejaVu Sans'` (bold) - **TODO**: Add actual cinematic font
- `'minimal'` → `'DejaVu Sans'` (normal) - **TODO**: Add actual minimal font

**Server Font Family**: Always `'DejaVu Sans'` (hardcoded in multiple places)

---

### 3.2 Font File Mappings

**File**: `src/utils/font.registry.js`

**Function**: `resolveFontFile(weightCss, fontStyle)` (lines 56-72)

**Mapping Table**:
| Weight | Style | Filename | Family Name |
|--------|-------|----------|--------------|
| 400 | normal | `DejaVuSans.ttf` | `DejaVu Sans` |
| 700 | normal | `DejaVuSans-Bold.ttf` | `DejaVu Sans` |
| 400 | italic | `DejaVuSans-Oblique.ttf` | `DejaVu Sans` |
| 700 | italic | `DejaVuSans-BoldOblique.ttf` | `DejaVu Sans` |

**Path Resolution**:
- Candidates: `assets/fonts/`, `src/assets/fonts/`
- Function: `resolveFontPath(filename)` (lines 14-30)

---

### 3.3 Font Loading & Registration

#### Client-Side Loading

**CSS**: `public/creative.css` (lines 1-29)
```css
@font-face { 
  font-family: "DejaVu Sans"; 
  src: url("/assets/fonts/DejaVuSans.ttf") format("truetype"); 
  font-weight: 400; 
  font-style: normal; 
}
/* ... 3 more variants ... */
```

**Font Loading API**: `public/creative.html` (lines 3662-3689)
- Function: `ensureDejaVuVariantsReady()`
- Uses: `document.fonts.load()` and `document.fonts.check()`
- Descriptors:
  - `'16px "DejaVu Sans"'`
  - `'bold 16px "DejaVu Sans"'`
  - `'italic 16px "DejaVu Sans"'`
  - `'italic bold 16px "DejaVu Sans"'`

**Font Gating**: `public/js/caption-live.js` (lines 29-43)
- Waits for `document.fonts.ready` before first layout
- Logs font readiness status

#### Server-Side Registration

**File**: `src/caption/canvas-fonts.js`

**Function**: `registerDejaVuFonts()` (lines 63-115)
- Uses: `@napi-rs/canvas` `GlobalFonts.registerFromPath()`
- Registers all 4 variants as base family `"DejaVu Sans"`
- Called at server startup: `server.js:23`

**Font String Building**:
- Function: `canvasFontString()` in `font.registry.js` (lines 113-117)
- Format: `${style} ${weight} ${px}px "${family}"`
- Example: `"italic bold 57px \"DejaVu Sans\""`

---

### 3.4 Fallback Behavior

**Client**:
- CSS fallback: `font-family: "DejaVu Sans", sans-serif;` (line 161 in `caption-overlay.js`)
- If font not loaded: Browser falls back to system sans-serif
- **Risk**: Font metrics may differ if fallback occurs

**Server**:
- Canvas registration: If font file not found, `addFont()` returns `false` (line 55)
- Canvas fallback: `@napi-rs/canvas` may use system fonts if registration fails
- **Risk**: Font metrics may differ if fallback occurs

**FFmpeg**:
- Drawtext: If `fontfile=` not found, FFmpeg uses default system font
- **Risk**: Font appearance may differ if fallback occurs

**Karaoke ASS**:
- ASS `Fontname`: If font not found, FFmpeg subtitles filter may use default
- **Risk**: Font appearance may differ if fallback occurs

---

### 3.5 Font Strings Used in Canvas/FFmpeg

**Canvas (Preview)**:
- Format: `"${fontStyle} ${weightCss === '700' ? 'bold' : 'normal'} ${fontPx}px \"${family}\""`
- Example: `"normal bold 64px \"DejaVu Sans\""`
- Location: `caption-overlay.js:1503`, `font.registry.js:113-117`

**FFmpeg Drawtext**:
- Format: `fontfile=/absolute/path/to/DejaVuSans-Bold.ttf`
- Escaping: `escapeFontPath()` replaces `:` with `\:` (line 138 in `font.registry.js`)
- Location: `ffmpeg.video.js:1241`, `ffmpeg.video.js:1474`

**Karaoke ASS**:
- Format: `Fontname: DejaVu Sans` (in ASS style definition)
- Location: `karaoke.ass.js:381`

---

### 3.6 Final Chosen Font Decision

**Decision Point**: `font.registry.js` functions

1. **Normalize weight**: `normalizeWeight(weightCss)` → 400 or 700 (lines 34-39)
2. **Normalize style**: `normalizeFontStyle(fontStyle)` → 'normal' or 'italic' (lines 46-48)
3. **Resolve file**: `resolveFontFile(weightCss, fontStyle)` → absolute path (lines 56-72)
4. **Build canvas string**: `canvasFontString(weightCss, fontStyle, px, family)` → font string (lines 113-117)
5. **Build FFmpeg path**: `escapeFontPath(resolveFontFile(...))` → escaped path (lines 137-139)

**Current Limitation**: All paths hardcode `'DejaVu Sans'` as the only font family.

---

## 4. Caption Geometry/Meta Computation (SSOT)

### 4.1 Meta Keys Contract (Client)

**File**: `public/js/caption-overlay.js`

**Function**: `computeCaptionMetaFromElements()` (lines 1434-1609)

**Exported Keys** (`overlayMeta` object):
```javascript
{
  // Typography
  fontFamily: string,           // "DejaVu Sans" (hardcoded)
  fontPx: number,               // Parsed from computed style
  lineSpacingPx: number,        // Computed: lineHeight - fontPx
  letterSpacingPx: number,      // Parsed from computed style
  weightCss: string,            // "400" or "700"
  fontStyle: string,            // "normal" or "italic"
  textAlign: string,            // "left" | "center" | "right"
  textTransform: string,        // "none" | "uppercase" | etc.
  previewFontString: string,    // Exact font string browser used
  
  // Color & Effects
  color: string,                // RGB/RGBA string
  opacity: number,              // 0-1
  strokePx: number,            // Parsed from webkitTextStroke
  strokeColor: string,         // Parsed from webkitTextStroke
  shadowColor: string,         // Parsed from textShadow
  shadowBlur: number,          // Parsed from textShadow
  shadowOffsetX: number,       // Parsed from textShadow
  shadowOffsetY: number,      // Parsed from textShadow
  
  // Geometry (frame-space pixels, TOP-left anchor)
  frameW: number,              // 1080
  frameH: number,              // 1920
  rasterW: number,             // Box width in frame space
  rasterH: number,             // Box height in frame space
  totalTextH: number,          // Text block height (DOM measured)
  rasterPadding: number,       // Average vertical padding
  rasterPaddingX: number,      // Horizontal padding
  rasterPaddingY: number,      // Vertical padding
  xPct: number,                // 0-1
  yPct: number,                 // 0-1 (TOP-anchored)
  wPct: number,                // 0-1
  yPx_png: number,             // TOP-left Y in frame space
  xPx_png: number,             // TOP-left X in frame space
  xExpr_png: string,           // FFmpeg X expression
  yPxFirstLine: number,        // First line baseline Y
  
  // Line Data
  lines: string[],             // Browser-rendered line breaks
  text: string,                // Normalized text
  textRaw: string,             // Raw text (if different)
  
  // Metadata
  ssotVersion: 3               // SSOT version
}
```

---

### 4.2 SSOT Alignment

**Documentation**: `docs/caption-meta-contract.md` (deprecated, points to V3 docs)

**Current Contract**: `docs/caption/02-meta-contract-v3-raster.md` (referenced in deprecated doc)

**Key SSOT Rules** (from user rules):
1. Client must use server meta keys verbatim (no renaming)
2. Allowed meta keys: `yPct`, `totalTextH`, `lineSpacingPx`, `fontPx`, `internalPadding`, `placement`, `wPx`, `hPx`, `splitLines`, `baselines`
3. No duplicate positioning logic (vertical position driven by `yPct` from server)
4. Variables that get reassigned must be `let` (e.g., `top`, `left`)
5. No synonyms for same concept (`internalPadding` is the only name)

**Current Implementation**:
- ✅ Client reads `yPct` from server (no recomputation)
- ✅ Client uses `previewFontString` verbatim
- ⚠️ Some keys use different names: `rasterPadding` vs `internalPadding` (both exist)
- ✅ No duplicate positioning logic (client clamps only)

---

### 4.3 Key Functions

**`computeCaptionMetaFromElements()`**:
- Location: `caption-overlay.js:1434-1609`
- Purpose: Extract meta from DOM elements
- Output: `overlayMeta` object

**`emitCaptionState()`**:
- Location: `caption-overlay.js` (referenced but not shown in audit)
- Purpose: Emit caption state changes
- Output: Updates `__overlayMeta`

**`getCaptionMeta()`**:
- Location: `caption-overlay.js` (referenced but not shown in audit)
- Purpose: Get current caption meta
- Output: Returns `__overlayMeta`

**`snapToPlacement()`**:
- Location: `caption-overlay.js:1365-1416`
- Purpose: Snap caption to placement (top/center/bottom)
- Logic: Uses `window.CaptionGeom.computeYPxFromPlacement()` and `window.CaptionGeom.computeRasterH()`

---

## 5. Text Measurement & Line Splitting Audit

### 5.1 Measurement Sources

#### Client-Side Measurement

**DOM Measurement** (Primary):
- Function: `extractRenderedLines()` (lines 2148-2220)
- Method: DOM Range API (`document.createRange()`, `getClientRects()`)
- **Font dependency**: ✅ Uses browser's rendered layout (depends on loaded font)
- Location: `caption-overlay.js:2289-2329`

**Canvas Measurement** (Fallback):
- Function: `tryCanvasExtraction()` (lines 2332-2367)
- Method: `ctx.measureText()` with word-by-word wrapping
- **Font dependency**: ✅ Uses `ctx.font = ${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
- Location: `caption-overlay.js:2338`

**Stable Extraction**:
- Function: `extractLinesStable()` (lines 2226-2286)
- Method: DOM first, then canvas fallback, with caching
- **Font dependency**: ✅ Caches by `fontPx` and `lineSpacingPx` (invalidates on font change)

#### Server-Side Measurement

**Canvas Measurement** (SSOT):
- Function: `wrapTextWithFont()` in `caption.wrap.js` (lines 51-120)
- Method: `ctx.measureText()` with letter spacing accounting
- **Font dependency**: ✅ Uses `canvasFontString()` to build font string
- Location: `caption.wrap.js:77-92`

**Preview Route Wrapping**:
- Function: `wrapLinesWithFont()` in `caption.preview.routes.js` (lines 1610-1639)
- Method: Same as `wrapTextWithFont()` (word-by-word with letter spacing)
- **Font dependency**: ✅ Uses canvas `measureText()`

---

### 5.2 Line Splitting Logic

**Client**:
1. Extract lines from DOM using Range API (primary)
2. If DOM fails, use canvas `measureText()` with word-by-word wrapping
3. Word splitting: `text.trim().split(/\s+/)` (whitespace)
4. Line break: When `measureText(testLine).width > maxWidth`

**Server**:
1. Use `wrapTextWithFont()` from `caption.wrap.js`
2. Word splitting: `textRaw.trim().split(/\s+/)` (whitespace)
3. Letter spacing accounting: If `letterSpacingPx > 0`, measure each character individually
4. Line break: When `measureWidth(test) > maxWidthPx`

**Karaoke**:
1. Tokenize: `tokenize(text)` → `split(/\s+/)` (whitespace)
2. Use `wrappedText` parameter (pre-wrapped from server) to map tokens to lines
3. Insert `\N` (ASS newline) between words on different lines

---

### 5.3 Metrics Computation

**`totalTextH`**:
- Client: `Math.round(contentEl.getBoundingClientRect().height)` (DOM measured)
- Server: `lines.length * fontPx + (lines.length - 1) * lineSpacingPx` (calculated)
- **Font dependency**: ✅ Depends on `fontPx` and `lineSpacingPx`

**`lineSpacingPx`**:
- Client: `Math.max(0, Math.round(lineHeightPx - fontPx))` (from computed style)
- Server: From payload or calculated from line height multiplier
- **Font dependency**: ✅ Depends on `fontPx`

**`yPxFirstLine`**:
- Client: `yPx_png + rasterPadding` (line 1561)
- Server: Computed from `yPct` and `totalTextH`
- **Font dependency**: Indirect (via `totalTextH`)

---

### 5.4 Risks

**Font Metric Mismatch**:
- ⚠️ **Risk**: If client and server use different fonts, `measureText()` results will differ
- **Impact**: Line wrapping will differ → preview/render mismatch
- **Mitigation**: Ensure same font registered on both client and server

**Font Loading Race**:
- ⚠️ **Risk**: If font not loaded when `measureText()` called, browser may use fallback
- **Impact**: Incorrect measurements → wrong wrapping
- **Mitigation**: `document.fonts.ready` gating (client), font registration at startup (server)

**Letter Spacing Accounting**:
- ⚠️ **Risk**: Letter spacing affects text width, must be accounted for in measurement
- **Impact**: Without accounting, wrapping may be incorrect
- **Mitigation**: Both client and server account for `letterSpacingPx` in measurement

**Cache Invalidation**:
- ✅ **Safe**: `extractLinesStable()` cache includes `fontPx` and `lineSpacingPx` in key
- **Impact**: Font changes properly invalidate cache

---

## 6. Risk Checklist for Adding New Fonts

### 6.1 Exact Places That Must Be Updated Together

#### A) Font File Registration

**Client CSS** (`public/creative.css`):
- Add `@font-face` declarations for new font (4 variants: regular, bold, italic, bold-italic)
- Lines: 1-29 (add after existing DejaVu declarations)

**Client Font Loading** (`public/creative.html`):
- Add font descriptors to `ensureDejaVuVariantsReady()` (or create new function)
- Lines: 3667-3672 (add new descriptors)
- **Risk**: If font not loaded, measurements will be wrong

**Server Registration** (`src/caption/canvas-fonts.js`):
- Add `addFont()` calls for new font files
- Function: `registerDejaVuFonts()` → rename or create `registerAllFonts()`
- Lines: 76-79 (add new font registrations)
- **Risk**: If font not registered, canvas will use fallback

**Font File Location**:
- Place font files in `assets/fonts/` directory
- Files needed: `{FontName}.ttf`, `{FontName}-Bold.ttf`, `{FontName}-Oblique.ttf`, `{FontName}-BoldOblique.ttf`

---

#### B) Font Mapping & Resolution

**UI Font Mapping** (`public/creative.html`):
- Update `fontMapping` object to map UI names to server font families
- Lines: 2008-2013 (add new mappings)
- **Risk**: If mapping wrong, wrong font will be used

**Font Registry** (`src/utils/font.registry.js`):
- Update `resolveFontFile()` to support new font family
- Current: Hardcoded to DejaVu files only
- **Risk**: New fonts won't resolve → fallback or error

**Font Family Constant** (`src/utils/font.registry.js`):
- Update `FONT_FAMILY` constant or make it dynamic
- Current: `export const FONT_FAMILY = 'DejaVu Sans';` (line 11)
- **Risk**: Hardcoded family name won't work for new fonts

---

#### C) Hardcoded Font Names

**Client Overlay** (`public/js/caption-overlay.js`):
- Line 1502: `const family = 'DejaVu Sans';` → **MUST UPDATE**
- Line 1474: `fontFamily` read from computed style (should work if CSS updated)
- **Risk**: Hardcoded family will always use DejaVu

**Karaoke Style** (`src/utils/karaoke.ass.js`):
- Line 150: `fontFamily = overlayCaption.fontFamily || 'DejaVu Sans'` → fallback only, OK
- Line 301: Default style `Fontname: "DejaVu Sans"` → **MUST UPDATE** if used as fallback
- **Risk**: Default fallback will use DejaVu

**Server Preview** (`src/routes/caption.preview.routes.js`):
- Line 22: Schema default `fontFamily: z.string().default('DejaVu Sans')` → **MUST UPDATE**
- **Risk**: Default will use DejaVu if fontFamily not provided

---

#### D) Font String Building

**Canvas Font String** (`src/utils/font.registry.js`):
- Function: `canvasFontString()` (lines 113-117)
- Current: Uses `baseFamily` parameter (defaults to 'DejaVu Sans')
- **Risk**: If `baseFamily` not passed, will use DejaVu default

**Preview Font String** (`public/js/caption-overlay.js`):
- Line 1503: Builds `previewFontString` using hardcoded `family`
- **Risk**: Will always use DejaVu in preview string

---

#### E) FFmpeg Font Path

**Font File Resolution** (`src/utils/font.registry.js`):
- Function: `resolveFontFile()` (lines 56-72)
- Current: Hardcoded to DejaVu file names
- **Risk**: New fonts won't resolve → FFmpeg will use fallback

**FFmpeg Usage** (`src/utils/ffmpeg.video.js`):
- Lines: 1163, 1241, 1474 (uses `resolveFontFile()`)
- **Risk**: If `resolveFontFile()` doesn't support new font, FFmpeg will fail or use fallback

---

#### F) Karaoke ASS Font Name

**ASS Style** (`src/utils/karaoke.ass.js`):
- Line 381: ASS style definition includes `Fontname: ${style.Fontname}`
- Style comes from `convertOverlayToASSStyle()` which reads `overlayCaption.fontFamily`
- **Risk**: If ASS `Fontname` doesn't match system font or FFmpeg registered font, will use fallback

---

### 6.2 Tests to Run for Each New Font

#### Parity Test Checklist

1. **Font Loading Test**:
   - [ ] Open browser console, check `document.fonts.check('16px "New Font"')` returns `true`
   - [ ] Check server logs for font registration success
   - [ ] **Failure signature**: Console shows `false` for font check, or server logs "Font not found"

2. **Preview Parity Test**:
   - [ ] Create caption with new font
   - [ ] Compare preview PNG text appearance with live overlay
   - [ ] Verify `previewFontString` in response matches expected format
   - [ ] **Failure signature**: Preview text looks different from overlay, or `previewFontString` contains wrong font name

3. **Line Wrapping Parity Test**:
   - [ ] Create long caption text (should wrap to multiple lines)
   - [ ] Compare client `lines[]` with server `lines[]` in preview response
   - [ ] Verify line breaks match exactly
   - [ ] **Failure signature**: Client and server `lines[]` arrays differ, or text overflows/underflows

4. **Render Parity Test**:
   - [ ] Generate final video with new font
   - [ ] Compare rendered caption text with preview PNG
   - [ ] Verify text position matches (`yPx_png` alignment)
   - [ ] **Failure signature**: Rendered text position differs from preview, or text appearance differs

5. **Karaoke Test**:
   - [ ] Generate video with karaoke captions using new font
   - [ ] Verify word highlighting works (words change from cyan to white)
   - [ ] Verify line breaks match preview (no mid-word breaks)
   - [ ] Verify font appearance matches preview
   - [ ] **Failure signature**: Karaoke highlighting broken, line breaks wrong, or font appearance differs

6. **Font Variant Test** (for each variant: regular, bold, italic, bold-italic):
   - [ ] Test regular variant
   - [ ] Test bold variant (`weightCss: '700'`)
   - [ ] Test italic variant (`fontStyle: 'italic'`)
   - [ ] Test bold-italic variant (`weightCss: '700'`, `fontStyle: 'italic'`)
   - [ ] **Failure signature**: Variant not applied (e.g., bold looks like regular)

---

#### Failure Signatures

**Font Fallback Indicators**:
- Console: `[fonts] check() still false for some faces`
- Console: `[canvas-fonts] Font not found: {filename}`
- Server: `[canvas-fonts] Failed to register font: {path}`
- Preview: Text appearance differs from expected (e.g., system font fallback)

**Karaoke Breakage Indicators**:
- Console: `[karaoke] ASS file present, using subtitles filter` (should appear)
- Video: Words don't highlight (stuck in cyan or white)
- Video: Line breaks don't match preview (mid-word breaks)
- Video: Font appearance differs from preview

**Parity Mismatch Indicators**:
- Console: `[parity:server-rewrap] Client lines overflow or broken words detected`
- Preview response: `rewrapped: true` in meta
- Visual: Preview PNG text position differs from live overlay
- Visual: Rendered video text position differs from preview

**Measurement Mismatch Indicators**:
- Console: `[extractLines] Canvas fallback: {N} lines` (should use DOM method)
- Console: `[caption-preview:ERROR] bad metrics` (server-side)
- Preview: Text overflows container or has excessive whitespace

---

## 7. Summary & Recommendations

### 7.1 Current State

- ✅ Font system is centralized (client CSS + server registration)
- ✅ Font mapping is consistent (UI → server via `font.registry.js`)
- ✅ SSOT principles are followed (server owns meta, client consumes verbatim)
- ⚠️ Font family is hardcoded in multiple places
- ⚠️ Only DejaVu Sans is supported (other UI names map to DejaVu)

### 7.2 Adding New Fonts: Required Changes

1. **Add font files** to `assets/fonts/` (4 variants per font)
2. **Update CSS** (`public/creative.css`) with `@font-face` declarations
3. **Update font loading** (`public/creative.html`) to load new font variants
4. **Update server registration** (`src/caption/canvas-fonts.js`) to register new fonts
5. **Update font registry** (`src/utils/font.registry.js`) to resolve new font files
6. **Update UI mapping** (`public/creative.html`) to map UI names to new font families
7. **Remove hardcoded font names** in:
   - `caption-overlay.js:1502` (hardcoded `'DejaVu Sans'`)
   - `caption.preview.routes.js:22` (schema default)
   - `karaoke.ass.js:301` (default style, if used)
8. **Test all variants** (regular, bold, italic, bold-italic) for each new font

### 7.3 Critical Risks

1. **Font metric mismatch**: If client and server use different fonts, line wrapping will differ
2. **Font loading race**: If font not loaded when measured, incorrect wrapping
3. **Hardcoded names**: Multiple places hardcode `'DejaVu Sans'` → must update all
4. **Karaoke dependency**: Karaoke uses `wrappedText` from server → font changes affect wrapping
5. **FFmpeg font path**: If font file not resolved, FFmpeg will use fallback

### 7.4 Testing Strategy

1. **Start with one new font** (e.g., "Cinematic" or "Minimal")
2. **Test all 4 variants** (regular, bold, italic, bold-italic)
3. **Run parity tests** (preview ↔ render ↔ karaoke)
4. **Verify SSOT compliance** (no client recomputation of positioning)
5. **Check failure signatures** (console logs, visual differences)

---

## Appendix: File Reference Map

### Client Files
- `public/creative.html` - UI font selection, font loading
- `public/creative.css` - `@font-face` declarations
- `public/js/caption-overlay.js` - Overlay meta computation, line extraction
- `public/js/caption-live.js` - Font readiness gating
- `public/js/caption-preview.js` - Preview payload building

### Server Files
- `src/caption/canvas-fonts.js` - Canvas font registration
- `src/utils/font.registry.js` - Font file resolution, font string building
- `src/utils/caption.wrap.js` - Server-side text wrapping (SSOT)
- `src/routes/caption.preview.routes.js` - Preview route handler
- `src/utils/karaoke.ass.js` - Karaoke ASS generation
- `src/services/story.service.js` - Story rendering (calls karaoke)
- `src/utils/ffmpeg.video.js` - FFmpeg video rendering

### Documentation
- `docs/caption-meta-contract.md` - Legacy contract (deprecated)
- `docs/caption/02-meta-contract-v3-raster.md` - Current V3 contract
- `docs/caption/01-pipeline-overview.md` - Pipeline documentation

---

**End of Audit Report**
