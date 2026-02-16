# Beat Caption Preview - Focused Audit Report

**Goal**: Add still caption previews on storyboard beat cards that match render styling EXACTLY, using SSOT v3 raster mode and existing `/api/caption/preview` endpoint.

---

## A) SSOT / STYLE SOURCE

### A1. Where does `overlayCaption` come from at render time?

**Answer**: Session-level storage (NOT per-shot)

**Location**: `src/services/story.service.js`
- Line 796: `const overlayCaption = session.overlayCaption || session.captionStyle;`
- Line 910: `const overlayCaption = session.overlayCaption || session.captionStyle;`

**Used in**:
- ASS file generation (line 851): `overlayCaption: overlayCaption` passed to `buildKaraokeASSFromTimestamps()`
- Render pipeline (line 923): `overlayCaption: overlayCaption` passed to `renderVideoQuoteOverlay()`

**Storage**: Single `session.overlayCaption` object applies to **all beats/shots** in the session.

### A2. Manual session creation

**Location**: `src/routes/story.routes.js` (line 562-666)

**Current behavior**: The `create-manual-session` route does NOT set `overlayCaption` or `captionStyle` on the session object.

**Lines 621-641**: Creates session with `story.sentences` and `shots`, but no caption styling.

**Recommendation**: For v1, manual sessions should inherit the same caption styling defaults as script sessions. Options:
1. **Option A (recommended)**: Store caption style defaults in session when manual session is created (read from UI state if available, or use hardcoded defaults matching script sessions)
2. **Option B**: Always use hardcoded defaults matching render pipeline defaults

**Default style location**: Should match what's used in `creative.html` caption UI (lines 1783-1799), which uses:
- `fontFamily`: from font dropdown
- `weightCss`: from weight dropdown  
- `fontPx`: from size slider
- `placement`: from placement dropdown
- `opacity`: from opacity slider
- Defaults: `fontFamily: 'DejaVu Sans'`, `weightCss: 'bold'`, `placement: 'center'`, `yPct: 0.5`, etc.

### A3. Single style for all beats confirmed

✅ **Confirmed**: Render uses `session.overlayCaption` (session-level) applied to **every beat/shot** in the session. No per-shot styling exists.

**For v1**: Use single session-level caption style for all beat previews. Future per-beat styling can be a feature flag.

---

## B) /api/caption/preview CONTRACT

### B1. Minimum required request payload for SSOT v3 raster preview

**Location**: `src/routes/caption.preview.routes.js`

**Schema**: `RasterSchema` (lines 11-61)

**REQUIRED fields** (schema validation will reject if missing):
- `ssotVersion: 3` (literal)
- `mode: 'raster'` (literal)
- `text: string` (min 1 char)
- `lines: string[]` (array, min 1 element) - **REQUIRED by schema**
- `totalTextH: number` (int, min 1) - **REQUIRED by schema**
- `yPxFirstLine: number` (int) - **REQUIRED by schema**
- `rasterW: number` (int, 100-1080) - **REQUIRED by schema**
- `rasterH: number` (int, 50-1920) - **REQUIRED by schema**
- `yPx_png: number` (int, 0-1920) - **REQUIRED by schema**
- `fontPx: number` (int, 8-400)

**Server CANNOT derive these**: The schema requires client to provide `lines`, `totalTextH`, `yPxFirstLine`, `rasterW`, `rasterH`, `yPx_png`. Server validates but does not recompute them (SSOT principle - client measurements are authoritative).

**Optional fields with defaults**:
- `lineSpacingPx` (default: 0)
- `letterSpacingPx` (default: 0)
- `rasterPadding` (default: 24)
- `frameW` (default: 1080)
- `frameH` (default: 1920)
- `xExpr_png` (default: '(W-overlay_w)/2')
- `textRaw` (optional)
- `previewFontString` (optional)

### B2. Existing client helper that computes required fields

**Location**: `public/js/caption-overlay.js`

**Function**: `window.getCaptionMeta()` (line 856-1447)

**Computes**:
- **`lines`**: Extracts wrapped lines from DOM using Range API + TreeWalker (lines 860-923), falls back to canvas measurement if DOM method fails
- **`totalTextH`**: Uses `content.getBoundingClientRect().height` (line 1316)
- **`rasterW`**: Computes from box width scaled to frame space (line 1319-1320)
- **`rasterH`**: Uses `window.CaptionGeom.computeRasterH()` helper (line 1323-1329)
- **`yPxFirstLine`**: Not directly computed in `getCaptionMeta()`, but `yPx_png` is computed (line 1344)

**Additional helper**: `extractRenderedLines()` (line 1536-1601) - exported function that extracts lines from any element using Range API.

**Key dependencies**:
- Requires DOM element with rendered text (`#caption-content`)
- Requires `window.CaptionGeom` helpers (for `computeRasterH`, `getFrameDims`)
- Requires stage/box elements to be initialized (`initCaptionOverlay()`)

**For beat previews**: We need a standalone function that can compute these values WITHOUT requiring the full caption overlay system to be initialized. Should extract/reuse the measurement logic.

---

## C) CLIENT-SIDE PREVIEW GENERATION REUSE

### C1. Existing code that calls `/api/caption/preview` successfully

**Location**: `public/js/caption-preview.js`

**Function**: `generateCaptionPreview(opts)` (line 131-553)

**Request building**: Lines 259-332 build the V3 raster payload:
- Checks `overlayV2` flag and `hasRasterFields` (line 251-257)
- Builds payload with all required fields (lines 260-314)
- Uses `overlayMeta` from `window.__overlayMeta` or `window.getCaptionMeta()`

**Lines computation**: Delegates to `overlayMeta.lines` (line 301), which comes from `getCaptionMeta()`.

**Raster sizing**: Delegates to `overlayMeta.rasterW`, `overlayMeta.rasterH` (lines 293-294).

**Y placement**: Delegates to `overlayMeta.yPx_png` (line 297).

**Key insight**: `generateCaptionPreview()` expects `overlayMeta` to already have all raster fields computed. It does NOT compute them itself - it just packages them into the request payload.

### C2. Payload builder extraction

**Location**: `public/js/caption-preview.js` lines 259-332

**Current structure**:
```javascript
const payload = (overlayV2 && hasRasterFields)
  ? {
      ssotVersion: 3,
      mode: 'raster',
      // ... all fields from overlayMeta
    }
  : { /* legacy fallback */ };
```

**Recommendation**: Extract a reusable function:
```javascript
export function buildCaptionPreviewPayload(text, style, overlayMeta) {
  // Build V3 raster payload from text + style + computed overlayMeta
  // Returns payload ready for POST /api/caption/preview
}
```

**Where `overlayMeta` comes from**: For beat previews, we'll need to compute it from text + style WITHOUT the full overlay system. Extract measurement logic from `getCaptionMeta()`.

---

## D) BEAT CARD OVERLAY PLACEMENT

### D1. Normalized render-space coordinates approach

**Strategy**: Use normalized percentages from meta, not absolute pixels.

**From meta response**:
- `meta.rasterW` / `meta.frameW` (1080) = normalized width (0.0-1.0)
- `meta.rasterH` / `meta.frameH` (1920) = normalized height (0.0-1.0)  
- `meta.yPx_png` / `meta.frameH` (1920) = normalized Y position (0.0-1.0)
- `meta.xExpr_png` = always `'(W-overlay_w)/2'` for center → use CSS `left: 50%; transform: translateX(-50%)`

### D2. CSS positioning plan

```css
.beat-caption-overlay {
  position: absolute;
  left: 50%;
  top: calc(var(--y-pct) * 100%);
  width: calc(var(--raster-w-ratio) * 100%);
  height: calc(var(--raster-h-ratio) * 100%);
  transform: translateX(-50%);
  pointer-events: none;
  z-index: 10;
  object-fit: contain;
}
```

**Example calculation**:
- `meta.rasterW = 500`, `meta.frameW = 1080` → `--raster-w-ratio: 0.463`
- `meta.rasterH = 150`, `meta.frameH = 1920` → `--raster-h-ratio: 0.078`
- `meta.yPx_png = 960`, `meta.frameH = 1920` → `--y-pct: 0.5`

**Result**: Overlay scales proportionally with beat card container, maintains aspect ratio, centers horizontally, positions vertically using normalized coordinates.

**Confirmation**: ✅ This approach avoids dependency on beat card pixel dimensions and guarantees parity across responsive layouts.

---

## E) WHERE TO APPLY (update hooks)

### E1. Draft mode hooks

**Location**: `public/creative.html`

**Hook 1**: `commitBeatTextEdit()` (line 7076)
- Called when: User finishes editing beat text (Enter key or blur)
- Current behavior: Updates `window.draftStoryboard.beats[].text` (line 7105)
- **Add**: Call preview generation after text update (line 7110, before `updateRenderArticleButtonState()`)

**Hook 2**: `renderDraftStoryboard()` (line 6583)
- Called when: Draft storyboard needs re-rendering
- Current behavior: Creates beat cards from `window.draftStoryboard.beats` (line 6595-6686)
- **Add**: Generate previews for all beats after cards are created (line 6708, after `updateRenderArticleButtonState()`)

**Hook 3**: `handleSwapButtonClick()` / clip selection
- Location: Line 6722
- Called when: User selects a new clip for a beat
- **Add**: Regenerate preview if clip changes (may affect layout if beat card dimensions change)

### E2. Session mode hooks

**Hook 1**: `updateBeatText` API response handler (line 7115-7158)
- Current behavior: Updates `window.currentStorySession.story.sentences` (line 7141)
- **Add**: After line 7141, before `renderStoryboard()` call, generate previews for all beats

**Hook 2**: `renderStoryboard(session)` (line 6508)
- Called when: Session storyboard needs re-rendering
- Current behavior: Creates beat cards from `session.story.sentences` (line 6508-6581)
- **Add**: Generate previews for all beats after cards are created (line 6580, after `updateRenderArticleButtonState()`)

**Hook 3**: Clip swap in session mode
- Similar to draft mode, regenerate preview when clip changes

### E3. Summary of update points

1. ✅ `commitBeatTextEdit()` - after text update (draft mode)
2. ✅ `renderDraftStoryboard()` - after storyboard render (draft mode)
3. ✅ `updateBeatText` response handler - after text update (session mode)
4. ✅ `renderStoryboard()` - after storyboard render (session mode)
5. ✅ Clip selection/swap handlers - after clip change (both modes)

**Pattern**: Generate previews AFTER beat cards are rendered in DOM, so we can measure text dimensions if needed. For v1, we'll compute from text + style without DOM measurement (simpler, no dependency on rendered cards).

---

## F) PERFORMANCE GUARDS

### F1. Debounce strategy

**Location**: Add to preview generation function

**Implementation**:
- Debounce: ~300ms when text is being typed
- Use `setTimeout` with `clearTimeout` pattern
- Store timeout ID per beat (by beat ID or sentence index)

### F2. AbortController per beat

**Location**: Track in beat preview state object

**Implementation**:
```javascript
const beatPreviewControllers = new Map(); // beatId -> AbortController

function generateBeatPreview(beatId, text, style) {
  // Cancel previous request for this beat
  const prev = beatPreviewControllers.get(beatId);
  if (prev) prev.abort();
  
  const controller = new AbortController();
  beatPreviewControllers.set(beatId, controller);
  
  // Pass signal to fetch
  fetch('/api/caption/preview', { 
    signal: controller.signal,
    // ...
  });
}
```

### F3. Cache by hash(style+text)

**Location**: Store cache in module-level Map

**Implementation**:
```javascript
const previewCache = new Map(); // hash -> { meta, rasterUrl, timestamp }

function hashStyleAndText(style, text) {
  // Simple hash: JSON.stringify sorted keys + text
  const styleStr = JSON.stringify(style, Object.keys(style).sort());
  return `${styleStr}|${text}`;
}

function getCachedPreview(style, text) {
  const key = hashStyleAndText(style, text);
  const cached = previewCache.get(key);
  if (cached && Date.now() - cached.timestamp < 60000) { // 1min TTL
    return cached;
  }
  return null;
}
```

### F4. Cap at MAX_BEATS

**Location**: Use existing `MAX_BEATS` constant

**Current**: `MAX_BEATS = 8` (referenced in code)

**Implementation**: Only generate previews for beats that exist (up to 8). Skip empty beats.

### F5. Failure handling

**Implementation**:
- Wrap preview generation in try/catch
- Log errors but do NOT throw
- If preview fails, beat card shows without caption overlay (graceful degradation)
- Never block render or editing operations

**Location**: All preview generation calls should be wrapped:
```javascript
try {
  await generateBeatPreview(beatId, text, style);
} catch (err) {
  console.warn('[beat-preview] Failed:', err);
  // Continue without preview - don't block UI
}
```

---

## Summary of Key Findings

1. ✅ **Style source**: `session.overlayCaption` (session-level, applies to all beats)
2. ✅ **Manual sessions**: Currently don't store `overlayCaption` - need to add defaults
3. ✅ **Preview payload**: Client MUST supply `lines`, `totalTextH`, `yPxFirstLine`, `rasterW`, `rasterH`, `yPx_png` (server validates, doesn't compute)
4. ✅ **Client helper**: `getCaptionMeta()` computes these, but requires full overlay system. Need standalone extractor.
5. ✅ **Placement**: Use normalized coordinates (ratios) for responsive scaling
6. ✅ **Update hooks**: 5 locations identified (2 draft, 3 session)
7. ✅ **Performance**: Debounce, AbortController, cache, MAX_BEATS cap, graceful failure

**Next**: Implementation plan with minimal diffs.

