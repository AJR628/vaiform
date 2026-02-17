# Caption Wrapping SSOT - Preflight Audit Report

**Date**: 2026-01-07  
**Purpose**: Verify width semantics, font semantics, and data structure parity before implementing SSOT wrapper

---

## A) Wrapping Implementations Found

### Preview Path
- **Location**: `src/routes/caption.preview.routes.js:1633-1662`
- **Function**: `wrapLinesWithFont(text, maxLineWidth, ctx, letterSpacingPx)`
- **Method**: Canvas font measurement using `ctx.measureText()` with letter spacing accounting
- **Used in**: `renderCaptionRaster()` at line 1242 (when server rewraps client lines)

### Render Path
- **Location**: `src/services/story.service.js:826-855`
- **Method**: Character-count approximation
- **Formula**: `approxCharW = fontPx * 0.55`, `maxChars = floor(boxWidthPx / approxCharW)`
- **Also in**: `src/services/shorts.service.js:180-210` (same approximation)

### ASS Generation
- **Location**: `src/utils/karaoke.ass.js:244-341, 356-758`
- **Functions**: `buildKaraokeASS()`, `buildKaraokeASSFromTimestamps()`
- **Behavior**: Accepts `wrappedText` parameter, uses `mapTokensToWrappedLines()` to map tokens to wrapped lines, inserts `\N` at line breaks (line 305)

---

## B) Width Semantics Verification (GOTCHA #1)

### Preview's `maxLineWidthPx` Formula

**Location**: `src/routes/caption.preview.routes.js:204`

```javascript
maxLineWidth: rasterW - (2 * rasterPadding),  // Use client geometry
```

**Derivation**:
- `rasterW`: Client-provided raster canvas width (typically 864px from logs)
- `rasterPadding`: Client-provided padding (typically 24px)
- **Result**: `maxLineWidth = 864 - (2 * 24) = 816px`

**Alternative path** (V2 mode, line 519):
```javascript
const boxW = Math.round(wPct * CANVAS_W);  // wPct * 1080
const maxWidth = Math.max(0, boxW - 2 * internalPadding);  // internalPadding = 32
// Example: 0.8 * 1080 = 864, 864 - 64 = 800px
```

### Render's `maxLineWidthPx` Formula

**Location**: `src/services/story.service.js:833`

```javascript
const boxWidthPx = 1080 - 120; // Same as renderVideoQuoteOverlay
```

**Result**: `boxWidthPx = 960px` (hardcoded)

### Width Semantics Mismatch

**CRITICAL ISSUE**: Preview wraps at **~816px** (or ~800px in V2 mode), but render wraps at **960px**.

**Impact**: Same text will produce different line counts:
- Preview: Wraps at 816px → more lines
- Render: Wraps at 960px → fewer lines

**Root Cause**: Render uses hardcoded `1080 - 120 = 960px`, while preview uses client-provided `rasterW - (2 * rasterPadding)`.

**Proposed Fix**: Create shared `deriveCaptionWrapWidthPx()` function that:
1. Accepts `{ frameW, overlayCaption, internalPadding }` or `{ rasterW, rasterPadding }`
2. Returns: `rasterW ? (rasterW - 2 * rasterPadding) : (frameW * wPct - 2 * internalPadding)`
3. Default `internalPadding = 24` if not provided
4. Both preview and render use this function

---

## C) Font + Style Semantics Verification (GOTCHA #2)

### Preview Font String Building

**Location**: `src/routes/caption.preview.routes.js:1136`

```javascript
const font = meta.previewFontString || canvasFontString(meta.weightCss, meta.fontStyle, fontPx, 'DejaVu Sans');
```

**Helper**: `src/utils/font.registry.js:113-116`
```javascript
export function canvasFontString(weightCss, fontStyle, px, baseFamily = 'DejaVu Sans') {
  const w = normalizeWeight(weightCss) >= 700 ? 'bold' : 'normal';
  const s = normalizeFontStyle(fontStyle);
  return `${s} ${w} ${px}px "${baseFamily}"`;  // e.g., "normal bold 57px \"DejaVu Sans\""
}
```

**Font Registration**: 
- `src/caption/canvas-fonts.js` provides `registerDejaVuFonts()` function
- **NOT CALLED** in preview route (grep found no imports)
- **RISK**: If fonts aren't registered, node-canvas may fall back to system fonts, which could differ from libass

### Render ASS Style Creation

**Location**: `src/utils/karaoke.ass.js:137-242`

```javascript
export function convertOverlayToASSStyle(overlayCaption, width = 1080, height = 1920) {
  const fontFamily = overlayCaption.fontFamily || 'DejaVu Sans';
  const fontPx = overlayCaption.fontPx || overlayCaption.sizePx || 64;
  const weightCss = overlayCaption.weightCss || 'normal';
  const fontStyle = overlayCaption.fontStyle || 'normal';
  
  return {
    Fontname: fontFamily,  // 'DejaVu Sans'
    Fontsize: Math.round(fontPx),
    Bold: normalizeWeight(weightCss) >= 600 ? 1 : 0,
    Italic: fontStyle === 'italic' ? 1 : 0,
    // ...
  };
}
```

**Font Directory**: `src/utils/ffmpeg.video.js:627-648`
- Resolves `assets/fonts/` or `src/assets/fonts/`
- Passes to FFmpeg: `:fontsdir='${fontsDir}'`
- Fonts exist: `assets/fonts/DejaVuSans*.ttf` (4 variants)

### Font Semantics Consistency

**Status**: ✅ **CONSISTENT** (with caveat)

- Both use `'DejaVu Sans'` as base family name
- Both use `normalizeWeight()` from `font.registry.js` for weight mapping
- Both use same font files (`assets/fonts/DejaVuSans*.ttf`)

**Caveat**: 
- Preview may not have fonts registered (no `registerDejaVuFonts()` call found)
- If unregistered, node-canvas may use system DejaVu (could differ from libass)
- **Recommendation**: Ensure `registerDejaVuFonts()` is called at server startup or in preview route

### Letter/Line Spacing

**Preview**: 
- `letterSpacingPx`: Accounted for in `measureTextWidth()` (line 1159-1169)
- `lineSpacingPx`: Used in `totalTextH` calculation (line 1252)

**Render ASS**:
- `letterSpacingPx`: **NOT USED** in ASS style (ASS has `Spacing` but it's character spacing, not letter spacing)
- `lineSpacingPx`: **NOT USED** in ASS (line spacing controlled by `\N` breaks and font size)

**Impact**: Letter spacing affects preview wrapping but not render wrapping. This is acceptable if ASS doesn't support letter spacing, but we should log a warning if `letterSpacingPx !== 0`.

---

## D) Data Structure Parity Verification

### Preview Fields (from `RasterSchema`)

**Location**: `src/routes/caption.preview.routes.js:12-61`

- `fontPx`: number (int, 8-400)
- `fontFamily`: string (default: 'DejaVu Sans')
- `weightCss`: string (default: '700')
- `fontStyle`: string (default: 'normal')
- `letterSpacingPx`: number (default: 0)
- `lineSpacingPx`: number (int, 0-400, default: 0)
- `rasterPadding`: number (int, default: 24)
- `rasterW`: number (int, 100-1080)
- `wPct`: number (optional)

### Render Fields (from `overlayCaption`)

**Location**: `src/services/story.service.js:832-833`, `src/utils/karaoke.ass.js:143-153`

- `fontPx` or `sizePx`: number (default: 64)
- `fontFamily`: string (default: 'DejaVu Sans')
- `weightCss`: string (default: 'normal')
- `fontStyle`: string (default: 'normal')
- `letterSpacingPx`: **NOT USED** in width calculation
- `lineSpacingPx`: **NOT USED** in width calculation
- `rasterPadding` or `internalPadding`: **NOT USED** in width calculation
- `wPct`: number (default: 0.8, used in ASS margin calculation)

### Data Structure Mismatches

1. **Field name synonyms**: `fontPx` vs `sizePx` (both accepted, but `fontPx` is canonical)
2. **Missing fields in render**: `letterSpacingPx`, `lineSpacingPx`, `rasterPadding`/`internalPadding` not used for width calculation
3. **Width derivation**: Render uses hardcoded `1080 - 120`, preview uses `rasterW - (2 * rasterPadding)`

**Proposed Normalization**: 
- Use `fontPx` (not `sizePx`) as canonical name
- Create `deriveCaptionWrapWidthPx()` that accepts both `{ rasterW, rasterPadding }` and `{ frameW, wPct, internalPadding }`
- Ensure render reads `overlayCaption.rasterPadding` or `overlayCaption.internalPadding` if available

---

## E) Audit Conclusion

### GO / NO-GO Decision

**Status**: ⚠️ **CONDITIONAL GO** (with required fixes)

### Required Fixes Before Implementation

1. **Width Semantics Unification** (MANDATORY):
   - Create `deriveCaptionWrapWidthPx()` function
   - Preview: Use `deriveCaptionWrapWidthPx({ rasterW, rasterPadding })`
   - Render: Use `deriveCaptionWrapWidthPx({ frameW: 1080, wPct: overlayCaption?.wPct || 0.8, internalPadding: overlayCaption?.rasterPadding || overlayCaption?.internalPadding || 24 })`
   - **STOP if width formulas cannot be unified**

2. **Font Registration** (RECOMMENDED):
   - Ensure `registerDejaVuFonts()` is called at server startup or in preview route
   - Verify node-canvas uses same font files as libass

3. **Letter Spacing Warning** (OPTIONAL):
   - Log warning if `letterSpacingPx !== 0` (ASS doesn't support letter spacing)

### Implementation Order

1. **Phase 0.5**: Create `deriveCaptionWrapWidthPx()` and verify width formulas match
2. **Phase 1**: Create shared wrapper SSOT (extract `wrapLinesWithFont()`)
3. **Phase 2**: Update preview to always use server SSOT
4. **Phase 3**: Update render to use shared wrapper with unified width

### Risks

- **Width mismatch**: If not fixed, preview and render will still produce different line counts
- **Font mismatch**: If fonts aren't registered, node-canvas may use system fonts (different metrics)
- **Letter spacing**: Preview accounts for it, render doesn't (acceptable if ASS doesn't support it)

---

## Evidence Citations

| Finding | File | Line(s) |
|---------|------|---------|
| Preview wrapping | `src/routes/caption.preview.routes.js` | 1633-1662 |
| Preview maxLineWidth | `src/routes/caption.preview.routes.js` | 204 |
| Render boxWidthPx | `src/services/story.service.js` | 833 |
| Render approximation | `src/services/story.service.js` | 836-837 |
| Font string builder | `src/utils/font.registry.js` | 113-116 |
| ASS style converter | `src/utils/karaoke.ass.js` | 137-242 |
| Font registration | `src/caption/canvas-fonts.js` | 63-115 |
| Letter spacing measure | `src/routes/caption.preview.routes.js` | 1159-1169 |

