# Caption Style + Placement Audit & Implementation Plan

**Goal**: Add caption placement + font settings while keeping EXACT preview/render parity.  
**Status**: PHASE 0 AUDIT COMPLETE - Ready for implementation plan confirmation

---

## PHASE 0 — AUDIT RESULTS

### 1) Caption Style + Meta Ownership Map

#### A) Client-Side Caption Style Construction

**Location**: `public/creative.html:2009-2025`

**Function**: `updateOverlayCaption()` builds `captionStyle` object from UI controls:

```2009:2025:public/creative.html
const captionStyle = {
    text: text.trim(),
    fontFamily: fontConfig.family,
    weightCss: fontConfig.weightCss,
    fontPx: sizePx, // Use fitted size
    color: "#FFFFFF",
    opacity: opacityPct / 100,
    shadow: true,
    showBox: showBoxToggle,
    boxColor: `rgba(0,0,0,${boxOpacityPct/100})`,
    placement: placementData.placement,
    yPct: placementData.placement === 'bottom' ? 0.90 : placementData.placement === 'top' ? 0.10 : 0.50, // Set yPct based on placement
    lineHeight: 1.05, // reduced for better stacking
    padding: 24,
    maxWidthPct: 0.90, // increased for bigger text
    borderRadius: 16
};
```

**UI Controls**:
- Font dropdown: `document.getElementById('caption-font')` → `fontMapping` (line 2000-2003)
- Weight dropdown: `document.getElementById('caption-weight')` → `weightCss`
- Size slider: `document.getElementById('caption-size')` → `sizePx` (via `getCaptionPx()`)
- Placement dropdown: `document.getElementById('caption-placement')` → `placement` (line 1962)
- Opacity slider: `document.getElementById('caption-opacity')` → `opacityPct`

**Placement Mapping** (lines 1972-1978):
```1972:1978:public/creative.html
function placementToServerFormat(placement) {
    switch ((placement || 'bottom').toLowerCase()) {
        case 'top':    return { placement: 'top' };
        case 'center': return { placement: 'center' };
        default:       return { placement: 'bottom' };
    }
}
```

**Current Behavior**: `captionStyle` is constructed but **NOT persisted to session storage**. It's only used for live preview generation.

#### B) Server-Side Session Storage

**Location**: `src/services/story.service.js:808, 937`

**Render-Time Usage**:
```808:808:src/services/story.service.js
const overlayCaption = session.overlayCaption || session.captionStyle;
```

```937:937:src/services/story.service.js
const overlayCaption = session.overlayCaption || session.captionStyle;
```

**Storage Path**: Session JSON stored in Firebase Storage at `drafts/{uid}/{sessionId}/story.json`

**Current State**: 
- ✅ `session.overlayCaption` is read at render time (lines 808, 937)
- ❌ **NO route found that saves `overlayCaption` to session** (grep found 0 matches in `src/routes/story.routes.js`)
- ❌ Manual session creation (`src/routes/story.routes.js:562-666`) does NOT set `overlayCaption` or `captionStyle`

**Storage Schema** (from `FIRESTORE_STORAGE_AUDIT_REPORT.md:696`):
```typescript
{
  overlayCaption?: object;  // Session-level caption style
  // ... other fields
}
```

#### C) Per-Beat Caption Meta Storage

**Finding**: ❌ **NO per-beat caption meta storage exists**

**Evidence**:
- Beat previews use session-level `style` object (line 7554 in `creative.html`)
- `generateBeatCaptionPreview()` accepts `style` parameter but doesn't store per-beat
- Session JSON schema shows no per-beat caption fields

**Current Pattern**: All beats use the same session-level style.

---

### 2) Preview Pipeline Code Map

#### A) Payload Building for POST /api/caption/preview

**Location 1**: `public/js/caption-preview.js:309-364` (main preview function)

**Function**: `generateCaptionPreview(opts)` builds V3 raster payload:

```309:364:public/js/caption-preview.js
const payload = (overlayV2 && hasRasterFields)
  ? {
      // V3 raster format – complete payload with all required fields
      ssotVersion: 3,
      mode: 'raster',  // ← REQUIRED for V3 raster detection
      text: opts.text || overlayMeta.text,
      placement: 'custom',
      xPct: Number.isFinite(opts?.xPct) ? opts.xPct : (overlayMeta?.xPct ?? 0.5),
      yPct: Number.isFinite(opts?.yPct) ? opts.yPct : (overlayMeta?.yPct ?? 0.5),
      wPct: Number.isFinite(opts?.wPct) ? opts.wPct : (overlayMeta?.wPct ?? 0.8),
      
      // Typography
      fontPx,  // ← Already clamped
      lineSpacingPx,  // ← Already clamped
      fontFamily: opts.fontFamily || overlayMeta?.fontFamily || 'DejaVu Sans',
      weightCss: opts.weight || overlayMeta?.weightCss || 'normal',
      fontStyle: domStyles.fontStyle || overlayMeta?.fontStyle || 'normal',
      textAlign: domStyles.textAlign || overlayMeta?.textAlign || 'center',
      letterSpacingPx: domStyles.letterSpacingPx ?? overlayMeta?.letterSpacingPx ?? 0,
      textTransform: overlayMeta?.textTransform || 'none',
      
      // Color & effects
      color: opts.color || overlayMeta?.color || '#FFFFFF',
      opacity: Number(opts.opacity ?? overlayMeta?.opacity ?? 0.85),
      strokePx: domStyles.strokePx ?? overlayMeta?.strokePx ?? 0,
      strokeColor: domStyles.strokeColor || overlayMeta?.strokeColor || 'rgba(0,0,0,0.85)',
      shadowColor: domStyles.shadowColor || overlayMeta?.shadowColor || 'rgba(0,0,0,0.6)',
      shadowBlur: domStyles.shadowBlur ?? overlayMeta?.shadowBlur ?? 12,
      shadowOffsetX: domStyles.shadowOffsetX ?? overlayMeta?.shadowOffsetX ?? 0,
      shadowOffsetY: domStyles.shadowOffsetY ?? overlayMeta?.shadowOffsetY ?? 2,
      
      // Geometry - required V3 raster fields
      frameW: overlayMeta.frameW || frameW,
      frameH: overlayMeta.frameH || frameH,
      rasterW: overlayMeta.rasterW,
      rasterH: overlayMeta.rasterH,
      rasterPadding: overlayMeta.rasterPadding,
      xPx_png: Number.isFinite(opts?.xPx_png) ? opts.xPx_png : (overlayMeta?.xPx_png ?? xPx_png),
      yPx_png: Number.isFinite(opts?.yPx_png) ? opts.yPx_png : (overlayMeta?.yPx_png ?? yPx_png),
      xExpr_png: overlayMeta?.xExpr_png || '(W-overlay_w)/2',
      
      // Browser-rendered line data (REQUIRED)
      lines: overlayMeta.lines,
      totalTextH: overlayMeta.totalTextH,
      yPxFirstLine: overlayMeta.yPxFirstLine,
      
      // Font string for parity validation
      previewFontString: overlayMeta.previewFontString || (
        typeof window !== 'undefined' && document.getElementById('caption-content')
          ? getComputedStyle(document.getElementById('caption-content')).font
          : undefined
      ),
      
      // Optional textRaw
      textRaw: overlayMeta.textRaw || opts.text
    }
```

**Location 2**: `public/js/caption-preview.js:691-742` (beat preview helper)

**Function**: `buildBeatPreviewPayload(text, overlayMeta)` - extracts from `overlayMeta`:

```691:742:public/js/caption-preview.js
function buildBeatPreviewPayload(text, overlayMeta) {
  return {
    ssotVersion: 3,
    mode: 'raster',
    text: overlayMeta.text || text,
    placement: 'custom',
    xPct: overlayMeta.xPct ?? 0.5,
    yPct: overlayMeta.yPct ?? 0.5,
    wPct: overlayMeta.wPct ?? 0.8,
    
    // Typography
    fontPx: overlayMeta.fontPx,
    lineSpacingPx: overlayMeta.lineSpacingPx,
    fontFamily: overlayMeta.fontFamily,
    weightCss: overlayMeta.weightCss,
    fontStyle: overlayMeta.fontStyle,
    textAlign: overlayMeta.textAlign,
    letterSpacingPx: overlayMeta.letterSpacingPx,
    textTransform: overlayMeta.textTransform,
    
    // Color & effects
    color: overlayMeta.color,
    opacity: overlayMeta.opacity,
    strokePx: overlayMeta.strokePx,
    strokeColor: overlayMeta.strokeColor,
    shadowColor: overlayMeta.shadowColor,
    shadowBlur: overlayMeta.shadowBlur,
    shadowOffsetX: overlayMeta.shadowOffsetX,
    shadowOffsetY: overlayMeta.shadowOffsetY,
    
    // Geometry - required V3 raster fields
    frameW: overlayMeta.frameW || 1080,
    frameH: overlayMeta.frameH || 1920,
    rasterW: overlayMeta.rasterW,
    rasterH: overlayMeta.rasterH,
    rasterPadding: overlayMeta.rasterPadding,
    xPx_png: overlayMeta.xPx_png,
    yPx_png: overlayMeta.yPx_png,
    xExpr_png: overlayMeta.xExpr_png || '(W-overlay_w)/2',
    
    // Browser-rendered line data (REQUIRED)
    lines: overlayMeta.lines,
    totalTextH: overlayMeta.totalTextH,
    yPxFirstLine: overlayMeta.yPxFirstLine, // Now always present from helper
    
    // Font string for parity validation
    previewFontString: overlayMeta.previewFontString,
    
    // Optional textRaw
    textRaw: overlayMeta.textRaw || text
  };
}
```

**Key Fields Sent**:
- ✅ `yPx_png` (TOP-left Y coordinate in frame-space pixels)
- ✅ `xPx_png` (absolute X position, or `xExpr_png` for centering)
- ✅ `placement: 'custom'` (signals server to use manual placement)
- ✅ `fontFamily`, `weightCss`, `fontPx` (typography)
- ✅ `rasterW`, `rasterH`, `yPxFirstLine`, `totalTextH` (geometry)

**Semantics Confirmed**: 
- `yPx_png` uses **TOP-left anchor** semantics (line 1502 in `caption-overlay.js`)
- `xExpr_png` defaults to `'(W-overlay_w)/2'` for center (line 1504-1506)

#### B) Server Response Meta Application to Beat Cards

**Location**: `public/js/caption-preview.js:903-971`

**Function**: `applyPreviewResultToBeatCard(beatCardEl, result)`:

```903:971:public/js/caption-preview.js
export function applyPreviewResultToBeatCard(beatCardEl, result) {
  if (!result || !result.rasterUrl) {
    if (window.__beatPreviewDebug) {
      console.warn('[beat-preview] No result or rasterUrl to apply');
    }
    return;
  }
  
  if (!beatCardEl) {
    if (window.__beatPreviewDebug) {
      console.warn('[beat-preview] beatCardEl is null/undefined');
    }
    return;
  }
  
  // Find or create overlay img element
  let overlayImg = beatCardEl.querySelector('.beat-caption-overlay');
  if (!overlayImg) {
    overlayImg = document.createElement('img');
    overlayImg.className = 'beat-caption-overlay';
    // Insert into video container (reuse exact selector from BeatPreviewManager)
    const videoContainer = beatCardEl.querySelector('.relative.w-full.h-40');
    if (videoContainer) {
      videoContainer.appendChild(overlayImg);
    } else {
      beatCardEl.appendChild(overlayImg);
    }
  }
  
  // Set CSS variables for positioning
  const meta = result.meta;
  // Derive TOP yPct from yPx_png (TOP-anchored to match FFmpeg overlay placement)
  const yPct = Math.max(0, Math.min(1, meta.yPx_png / meta.frameH));
  const rasterWRatio = meta.rasterW / meta.frameW;
  const rasterHRatio = meta.rasterH / meta.frameH;
  
  if (window.__beatPreviewDebug) {
    console.log('[beat-preview] yPct calculation:', {
      yPx_png: meta.yPx_png,
      frameH: meta.frameH,
      derivedYPct: meta.yPx_png / meta.frameH,
      clampedYPct: yPct
    });
  }
  
  overlayImg.style.setProperty('--y-pct', yPct);
  overlayImg.style.setProperty('--raster-w-ratio', rasterWRatio);
  overlayImg.style.setProperty('--raster-h-ratio', rasterHRatio);
  
  // Set image source
  overlayImg.src = result.rasterUrl;
  overlayImg.style.display = 'block';
  
  if (window.__beatPreviewDebug) {
    console.log('[beat-preview] Overlay applied:', {
      identifier: beatCardEl.getAttribute('data-beat-id') || beatCardEl.getAttribute('data-sentence-index'),
      rasterUrl: result.rasterUrl.substring(0, 50) + '...'
    });
    
    // Store meta for debugging (only if debug flag enabled)
    if (!window.__lastBeatPreviewMeta) {
      window.__lastBeatPreviewMeta = {};
    }
    const identifier = beatCardEl.getAttribute('data-beat-id') || beatCardEl.getAttribute('data-sentence-index');
    if (identifier && result.meta) {
      window.__lastBeatPreviewMeta[identifier] = result.meta;
    }
  }
}
```

**CSS Positioning** (from `BEAT_CAPTION_PREVIEW_AUDIT.md:167-188`):
- Uses normalized coordinates: `--y-pct`, `--raster-w-ratio`, `--raster-h-ratio`
- CSS: `top: calc(var(--y-pct) * 100%)` (TOP-anchored, no `translateY(-50%)`)
- Horizontal: `left: 50%; transform: translateX(-50%)` (centers horizontally)

**Confirmation**: ✅ Preview uses server meta verbatim (no client-side recomputation of position).

---

### 3) Render Pipeline Code Map

#### A) Render-Time Caption Meta Usage

**Location**: `src/services/story.service.js:937-939`

**Function**: `renderStory()` reads `overlayCaption` from session:

```937:939:src/services/story.service.js
// Check if session has overlay caption styling to pass to render
const overlayCaption = session.overlayCaption || session.captionStyle;

await renderVideoQuoteOverlay({
```

**Passed to**: `renderVideoQuoteOverlay()` at line 939

#### B) FFmpeg Overlay Positioning

**Location**: `src/utils/ffmpeg.video.js:1534-1541`

**Function**: `renderVideoQuoteOverlay()` constructs `rasterPlacement`:

```1534:1541:src/utils/ffmpeg.video.js
const rasterPlacement = overlayCaption?.mode === 'raster' ? {
  mode: 'raster',
  rasterUrl: overlayCaption.rasterUrl || overlayCaption.rasterDataUrl || overlayCaption.rasterPng,
  rasterW: overlayCaption.rasterW,
  rasterH: overlayCaption.rasterH,
  xExpr: (overlayCaption.xExpr_png || overlayCaption.xExpr || '(W-overlay_w)/2').replace(/\s+/g, ''),
  xPx_png: overlayCaption.xPx_png,   // <-- keep threading it through
  y: overlayCaption.yPx_png ?? overlayCaption.yPx,  // Use PNG anchor, not drawtext anchor
```

**FFmpeg Overlay Expression** (line 524):

```524:524:src/utils/ffmpeg.video.js
const overlayExpr = `[vmain][ovr]overlay=${xExpr}:${y}:format=auto,${endFormat}[vout]`;
```

**Semantics Confirmed**: 
- ✅ FFmpeg `overlay=x:y` uses Y as **top-left** of overlay image
- ✅ `y` is set to `overlayCaption.yPx_png` (TOP-left anchor)
- ✅ `xExpr` uses `xExpr_png` or defaults to `'(W-overlay_w)/2'` for center

**Render Behavior**: 
- ❓ **QUESTION**: Does render regenerate caption rasters at render time, or use pre-computed `rasterUrl`?
- **Finding**: `overlayCaption.rasterUrl` is referenced (line 1536), suggesting pre-computed PNGs are used
- **However**: No evidence found of where `rasterUrl` is stored in session. Likely computed from `overlayCaption` style + text at render time.

---

### 4) Audit Result Summary

#### A) Current Data Shape

**Preview Time** (client → server):
```javascript
{
  ssotVersion: 3,
  mode: 'raster',
  text: string,
  placement: 'custom',
  fontFamily: string,        // e.g., 'DejaVu Sans'
  weightCss: string,         // e.g., 'bold' or '700'
  fontPx: number,            // e.g., 48
  yPx_png: number,           // TOP-left Y (0-1920)
  xExpr_png: string,         // e.g., '(W-overlay_w)/2'
  rasterW: number,
  rasterH: number,
  lines: string[],
  totalTextH: number,
  yPxFirstLine: number,
  // ... color, opacity, effects
}
```

**Preview Response** (server → client):
```javascript
{
  ok: true,
  data: {
    imageUrl: string,        // PNG data URL
    meta: {
      ssotVersion: 3,
      mode: 'raster',
      rasterUrl: string,      // PNG URL
      yPx_png: number,        // Echoed unchanged
      rasterW: number,
      rasterH: number,
      fontFamily: string,
      weightCss: string,
      // ... other meta fields
    }
  }
}
```

**Render Time** (session → FFmpeg):
```javascript
{
  overlayCaption: {
    mode: 'raster',
    yPx_png: number,         // Used as overlay Y
    xExpr_png: string,       // Used as overlay X expression
    rasterW: number,
    rasterH: number,
    fontFamily: string,
    weightCss: string,
    fontPx: number,
    // ... other style fields
  }
}
```

#### B) Single Best Injection Point

**Recommended**: **Session-level `overlayCaption` storage**

**Rationale**:
1. ✅ Already consumed at render time (`story.service.js:937`)
2. ✅ Single source of truth (no per-beat duplication)
3. ✅ Preview can read from session on load
4. ✅ Minimal changes (add save route, wire UI → save)

**Injection Points**:

1. **Save Style to Session** (NEW):
   - Route: Extend existing `/api/story/update-script` or add `/api/story/update-caption-style`
   - Location: `src/routes/story.routes.js`
   - Function: Save `overlayCaption` to session JSON

2. **Load Style from Session** (EXISTS):
   - Location: `public/creative.html:7554` (already reads `session.overlayCaption`)
   - Function: Apply loaded style to UI controls on session load

3. **Wire UI Changes → Save** (NEW):
   - Location: `public/creative.html:2009-2025` (captionStyle construction)
   - Function: Call save route when style changes (debounced)

4. **Preview Generation** (EXISTS):
   - Location: `public/js/caption-preview.js:309-364`
   - Function: Already uses `overlayMeta` which can come from session style

5. **Render Pipeline** (EXISTS):
   - Location: `src/services/story.service.js:937`
   - Function: Already reads `session.overlayCaption`

---

## PHASE 0.5 — VERIFICATION RESULTS & TRUTH TABLE

### Verification 1: Session overlayCaption Persistence

**Question**: Where is `overlayCaption` saved to session storage?

**Findings**:
- ❌ **NO route saves `overlayCaption` to `session.story.json`**
  - `grep` found 0 assignments of `overlayCaption =` in `src/routes/story.routes.js`
  - `saveStorySession()` exists and saves entire session object, but no route populates `overlayCaption`
- ✅ **Render reads from session** (`src/services/story.service.js:808, 937`)
- ✅ **Render payload sets `overlayCaption`** (`public/creative.html:5599`, `public/js/render-payload-helper.js:117`)
- ⚠️ **Current flow**: `overlayCaption` is stored in **window globals** (`window.__serverCaptionMeta`, `window._overlayMeta`) after preview generation
  - At render time, `savedMeta` is read from `window.getSavedOverlayMeta()` (line 3847)
  - This is **in-memory only** - not persisted to session storage

**Conclusion**: `overlayCaption` is **NOT persisted to session**. It exists only in:
1. Window globals (in-memory, lost on page refresh)
2. Render payload (temporary, sent to render endpoint)
3. Session read path (expects it, but it's never saved)

### Verification 2: Render Behavior When rasterUrl Missing

**Question**: What happens if `overlayCaption.mode === 'raster'` but `rasterUrl` is missing?

**Findings**:
- **Location 1**: `src/utils/ffmpeg.video.js:965-966`
  ```javascript
  if (!(overlayCaption.rasterUrl || overlayCaption.rasterDataUrl)) {
    throw new Error('RASTER: overlayCaption missing rasterUrl/rasterDataUrl at ffmpeg entry');
  }
  ```
- **Location 2**: `src/utils/ffmpeg.video.js:827-828`
  ```javascript
  if (!dataUrl) {
    throw new Error('RASTER: missing rasterDataUrl/rasterUrl');
  }
  ```
- **Location 3**: `src/utils/ffmpeg.video.js:97`
  ```javascript
  if (!overlayCaption.rasterUrl) errors.push('rasterUrl missing');
  ```

**Conclusion**: Render **WILL FAIL** (throws error) if `rasterUrl`/`rasterDataUrl` is missing in raster mode. Render does **NOT** regenerate PNGs - it requires pre-computed `rasterUrl`.

**Implication**: If we store only UI style settings (without `rasterUrl`), render will fail. We must either:
- Option A: Store full meta including `rasterUrl` (from preview response)
- Option B: Regenerate `rasterUrl` at render time from style + text (requires render-time PNG generation)

### Verification 3: Preview Weight Key Semantics

**Question**: Does `generateCaptionPreview` use `opts.weight` or `opts.weightCss`?

**Findings**:
- **Function signature** (`public/js/caption-preview.js:63`): `@param {string} [opts.weight='bold']`
- **Payload construction** (`public/js/caption-preview.js:324`): 
  ```javascript
  weightCss: opts.weight || overlayMeta?.weightCss || 'normal',
  ```
- **UI construction** (`public/creative.html:2022`): Uses `weightCss: fontConfig.weightCss`

**Conclusion**: **Mismatch exists**:
- Function accepts `opts.weight` (legacy parameter name)
- Internally stores as `weightCss` (SSOT key)
- UI uses `weightCss` (correct)

**Recommendation**: Standardize to `weightCss` everywhere. Update function signature to accept `opts.weightCss` (with fallback to `opts.weight` for backward compatibility).

### Truth Table

| Scenario | Session has overlayCaption? | overlayCaption has rasterUrl? | Render Outcome | Notes |
|----------|----------------------------|-------------------------------|----------------|-------|
| **Current (preview generated)** | ❌ NO | ✅ YES (in window globals) | ✅ WORKS | `rasterUrl` from preview response stored in `window.__serverCaptionMeta` |
| **After page refresh** | ❌ NO | ❌ NO | ❌ FAILS | Window globals lost; render throws "missing rasterUrl" |
| **If we save style only** | ✅ YES | ❌ NO | ❌ FAILS | Render requires `rasterUrl`; cannot generate from style alone |
| **If we save style + meta** | ✅ YES | ✅ YES | ✅ WORKS | Full meta from preview response includes `rasterUrl` |
| **If render generates PNG** | ✅ YES | ❌ NO (but computed) | ⚠️ UNKNOWN | Would require render-time PNG generation (not currently implemented) |

### Key Insights

1. **Current State**: `overlayCaption` is **ephemeral** (window globals only). Render works only if preview was generated in same session.

2. **Render Dependency**: Render **requires** `rasterUrl` - it does not regenerate PNGs from style + text.

3. **Storage Strategy**: Two viable approaches:
   - **Strategy A (Recommended)**: Store UI style settings (`captionStyle`) separately from render meta (`overlayCaption` with `rasterUrl`)
     - Store `captionStyle` in session (font, weight, size, placement, opacity, color)
     - Generate `overlayCaption` with `rasterUrl` at preview time
     - Store full `overlayCaption` meta in session **only if** we want to persist preview results
   - **Strategy B**: Always store full `overlayCaption` meta (including `rasterUrl`) from preview response
     - Requires preview to be generated before render
     - More storage overhead (PNG data URLs are large)

4. **Weight Key Fix**: Standardize `opts.weight` → `opts.weightCss` in `generateCaptionPreview()` signature.

### Updated Recommendation

**Store UI settings (`captionStyle`) in session, NOT full `overlayCaption` meta**:

- **Why**: UI settings are small, stable, and user-controlled. `rasterUrl` is large, text-dependent, and regenerated per preview.
- **How**: 
  - Save `captionStyle` (font, weight, size, placement, opacity, color) to session
  - Generate `overlayCaption` with `rasterUrl` at preview/render time from `captionStyle` + text
  - If we want to persist preview results, store `overlayCaption` meta separately (optional)

**Exception**: If render-time PNG generation is added, we can store style-only and generate `rasterUrl` at render. Currently, render requires pre-computed `rasterUrl`.

---

## PHASE 1 — MINIMAL IMPLEMENTATION PLAN

### Constraints

- ✅ No draggable overlay (placement presets only: 'top' | 'center' | 'bottom')
- ✅ Maintain parity: preview uses server meta verbatim; render uses same meta semantics
- ✅ Avoid new naming: use existing SSOT keys (`yPx_png`, `rasterW`, `rasterH`, `xExpr_png`, etc.)
- ✅ Persist style in ONE place (session-level `overlayCaption`)
- ✅ Avoid duplicating "style defaults" in 2+ places

### Implementation Steps

#### Step 1: Add Session Save Route for Caption Style

**File**: `src/routes/story.routes.js`

**Action**: Add new route to save UI style settings (NOT full `overlayCaption` meta):

```javascript
// Store UI style settings separately from render meta
r.post("/update-caption-style", async (req, res) => {
  const parsed = z.object({
    sessionId: z.string().min(3),
    captionStyle: z.object({
      fontFamily: z.string().optional(),
      weightCss: z.string().optional(),
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
  
  // Store UI style settings (NOT overlayCaption meta with rasterUrl)
  session.captionStyle = { ...session.captionStyle, ...captionStyle };
  await saveStorySession({ uid: req.user.uid, sessionId, data: session });
  
  return res.json({ success: true, data: { captionStyle: session.captionStyle } });
});
```

**Key Decision**: Store `captionStyle` (UI settings), not `overlayCaption` (render meta with `rasterUrl`). Render will read `captionStyle` and generate `overlayCaption` at render time, OR we can store `overlayCaption` separately if preview results need persistence.

**Service Function**: `saveStorySession()` already exists and saves entire session object (`src/services/story.service.js:55-57`).

#### Step 2: Wire UI Changes → Save Route

**File**: `public/creative.html`

**Location**: After `captionStyle` construction (line 2025)

**Action**: Add debounced save call (save `captionStyle`, not `overlayCaption`):

```javascript
// After line 2025, add:
const saveCaptionStyleToSession = debounce(async (style) => {
  if (!window.currentStorySession?.id) return; // Only save if session exists
  
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
          color: style.color,
          // Optional UI-only fields
          shadow: style.shadow,
          showBox: style.showBox,
          boxColor: style.boxColor,
          lineHeight: style.lineHeight,
          padding: style.padding,
          maxWidthPct: style.maxWidthPct,
          borderRadius: style.borderRadius
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

**Trigger Points**:
- Font dropdown change (line 10016)
- Weight dropdown change (line 10020)
- Size slider change (via `updateOverlayCaption`)
- Placement dropdown change (line 10035)
- Opacity slider change (line 10027)

#### Step 3: Load Style from Session on Session Load

**File**: `public/creative.html`

**Location**: `renderStoryboard(session)` function (line 6508) or session load handler

**Action**: Apply loaded `captionStyle` to UI controls:

```javascript
// After session load, apply captionStyle to UI:
if (session.captionStyle) {
  const oc = session.captionStyle;
  
  // Set font dropdown
  if (oc.fontFamily) {
    const fontSelect = document.getElementById('caption-font');
    if (fontSelect) {
      // Map fontFamily to dropdown value (inverse of fontMapping)
      const fontValue = Object.keys(fontMapping).find(key => fontMapping[key].family === oc.fontFamily) || 'system';
      fontSelect.value = fontValue;
    }
  }
  
  // Set weight dropdown
  if (oc.weightCss) {
    const weightSelect = document.getElementById('caption-weight');
    if (weightSelect) {
      weightSelect.value = oc.weightCss === 'bold' || oc.weightCss === '700' ? 'bold' : 'normal';
    }
  }
  
  // Set size slider
  if (oc.fontPx) {
    // Map fontPx to slider value (inverse of getCaptionPx mapping)
    // Implementation depends on slider mapping logic
  }
  
  // Set placement dropdown
  if (oc.placement) {
    const placementSelect = document.getElementById('caption-placement');
    if (placementSelect) {
      placementSelect.value = oc.placement;
    }
  }
  
  // Set opacity slider
  if (oc.opacity !== undefined) {
    const opacitySlider = document.getElementById('caption-opacity');
    if (opacitySlider) {
      opacitySlider.value = Math.round(oc.opacity * 100);
    }
  }
}
```

#### Step 4: Ensure Preview Uses Session Style

**File**: `public/js/caption-preview.js`

**Location**: `generateBeatCaptionPreview()` function (line 751)

**Action**: Read style from session if available:

```javascript
export async function generateBeatCaptionPreview(beatId, text, style) {
  // If style not provided, try to read from session
  if (!style && typeof window !== 'undefined' && window.currentStorySession?.overlayCaption) {
    style = window.currentStorySession.overlayCaption;
  }
  
  // Fallback to defaults
  style = style || {
    fontFamily: 'DejaVu Sans',
    weightCss: 'bold',
    fontPx: 48,
    placement: 'center',
    yPct: 0.5,
    opacity: 1,
    color: '#FFFFFF'
  };
  
  // ... rest of function
}
```

**Already Handled**: `measureBeatCaptionGeometry(text, style)` accepts style parameter and uses it for measurement.

#### Step 5: Ensure Render Uses Stored Style

**Status**: ⚠️ **Needs update**

**Location**: `src/services/story.service.js:937`

**Current Behavior**: Render reads `session.overlayCaption || session.captionStyle` (line 808, 937)

**Action Required**: 
- Option A: Generate `overlayCaption` with `rasterUrl` at render time from `captionStyle` + text (requires render-time PNG generation - NOT currently implemented)
- Option B: Store `overlayCaption` meta (with `rasterUrl`) separately when preview is generated, keep `captionStyle` for UI settings

**Recommendation**: For Phase 1, use Option B:
- Store `captionStyle` in session (UI settings)
- Store `overlayCaption` meta (with `rasterUrl`) in session when preview is generated
- Render reads `overlayCaption` if available, falls back to `captionStyle` + generates PNG (if render-time generation is added)

**Verification**: Ensure render can handle both:
- `session.overlayCaption` (full meta with `rasterUrl`) - current behavior
- `session.captionStyle` (UI settings only) - requires render-time PNG generation

---

## PHASE 2 — IMPLEMENTATION COMMITS

### Commit 1: Add Session Save Route for Caption Style

**Files**:
- `src/routes/story.routes.js` (add route)
- `src/services/story.service.js` (verify `saveStorySession` exists - already confirmed)

**Changes**:
- Add `POST /api/story/update-caption-style` route
- Validate `captionStyle` schema (UI settings, NOT `overlayCaption` meta)
- Store `session.captionStyle` (separate from `session.overlayCaption`)

**Test**:
- POST with valid `captionStyle` → `session.captionStyle` updated
- POST with invalid schema → 400 error
- POST with non-existent session → 404 error

### Commit 2: Wire UI Changes → Save + Load from Session

**Files**:
- `public/creative.html` (add save call, add load logic)

**Changes**:
- Add `saveCaptionStyleToSession()` debounced function (saves `captionStyle`, not `overlayCaption`)
- Call save after `captionStyle` construction
- Add load logic in `renderStoryboard()` or session load handler
- Apply loaded `captionStyle` to UI controls
- Fix weight key: standardize `opts.weight` → `opts.weightCss` in `generateCaptionPreview()` signature

**Test**:
- Change font → save called (debounced), `session.captionStyle` updated
- Change placement → save called
- Load session → UI controls reflect saved `captionStyle`
- Change style → preview updates immediately

### Commit 3: Ensure Preview Uses Session Style

**Files**:
- `public/js/caption-preview.js` (read style from session if not provided)

**Changes**:
- Update `generateBeatCaptionPreview()` to read from session
- Ensure `measureBeatCaptionGeometry()` uses session style

**Test**:
- Generate beat preview without style param → uses session style
- Generate beat preview with style param → uses provided style (override)

### Commit 4: Contract Test Fixture

**Files**:
- `tests/caption-style-parity.test.js` (NEW)

**Changes**:
- Add fixture with 3 beats (short/medium/long text)
- Test preview meta matches render meta
- Test font + placement changes persist

**Test**:
- Run fixture → preview meta = render meta
- Change style → preview updates → render uses same style

---

## Definition of Done

- [ ] Changing font or placement updates beat previews immediately (debounced ok)
- [ ] Render output matches preview for at least 3 fixture beats (short/medium/long text)
- [ ] No alternate "second pipeline" for style: one canonical stored style/meta path
- [ ] Style persists in session storage (`session.overlayCaption`)
- [ ] Style loads from session on session load
- [ ] UI controls reflect loaded style
- [ ] Preview uses session style (or provided override)
- [ ] Render uses session style (already implemented)

---

## Open Questions (RESOLVED)

1. **Render-time raster generation**: Does render regenerate caption PNGs, or use pre-computed `rasterUrl`? 
   - ✅ **RESOLVED**: Render **requires** pre-computed `rasterUrl`. Throws error if missing (`ffmpeg.video.js:965-966, 827-828`).
   - **Action**: Store UI style settings (`captionStyle`) separately. Generate `overlayCaption` with `rasterUrl` at preview time.

2. **Style field completeness**: What fields must be stored in `session.overlayCaption`?
   - ✅ **RESOLVED**: Two-tier approach:
     - **Store in session**: `captionStyle` (UI settings: `fontFamily`, `weightCss`, `fontPx`, `placement`, `yPct`, `opacity`, `color`)
     - **Generate at preview/render**: `overlayCaption` meta (includes `rasterUrl`, `rasterW`, `rasterH`, `yPx_png`, etc.)
   - **Rationale**: UI settings are small and stable; `rasterUrl` is large and text-dependent.

3. **Manual session defaults**: Should manual sessions get default caption style?
   - ✅ **RESOLVED**: Yes - add default `captionStyle` to manual session creation (matching UI defaults).
   - **Action**: Set `session.captionStyle` in `create-manual-session` route with defaults matching `creative.html` UI.

4. **Weight key semantics**: Standardize `opts.weight` → `opts.weightCss`?
   - ✅ **RESOLVED**: Yes - update `generateCaptionPreview()` to accept `opts.weightCss` (with fallback to `opts.weight` for backward compatibility).

---

## Risk Assessment

**Low Risk**:
- Adding save route (isolated, testable)
- Wiring UI → save (client-only, debounced)
- Loading style from session (read-only, fallback to defaults)

**Medium Risk**:
- Ensuring preview uses session style (may require refactoring if current code assumes inline style)
- Contract test fixtures (requires understanding exact meta shape)

**Mitigation**:
- Incremental commits (test each step)
- Fallback to defaults if session style missing
- Preserve existing behavior (don't break current preview/render)

---

## Summary of Key Findings

### Critical Discoveries

1. **`overlayCaption` is NOT persisted to session** - Currently exists only in window globals (lost on page refresh)
2. **Render requires `rasterUrl`** - Throws error if missing; does NOT regenerate PNGs from style + text
3. **Two-tier storage strategy needed**:
   - Store `captionStyle` (UI settings: font, weight, size, placement, opacity, color) in session
   - Generate `overlayCaption` meta (with `rasterUrl`) at preview/render time OR store separately when preview is generated
4. **Weight key mismatch** - Function accepts `opts.weight` but stores as `weightCss` (needs standardization)

### Recommended Implementation Approach

**Phase 1 (Minimal)**:
- Store `captionStyle` (UI settings) in session via `/api/story/update-caption-style`
- Wire UI changes → save route (debounced)
- Load `captionStyle` from session on session load
- Keep existing `overlayCaption` flow (window globals → render payload) for now

**Phase 2 (Future Enhancement)**:
- Option A: Add render-time PNG generation (generate `overlayCaption` from `captionStyle` + text at render)
- Option B: Persist `overlayCaption` meta (with `rasterUrl`) to session when preview is generated

### Truth Table Summary

| Storage Strategy | Session Persistence | Render Works? | Notes |
|-----------------|-------------------|---------------|-------|
| **Current** | ❌ None | ✅ Yes (if preview in same session) | Window globals only |
| **Store `captionStyle` only** | ✅ Yes | ❌ No (missing `rasterUrl`) | Requires render-time PNG generation |
| **Store `captionStyle` + `overlayCaption`** | ✅ Yes | ✅ Yes | Full persistence, larger storage |

**Recommendation**: Start with storing `captionStyle` only. Add `overlayCaption` persistence later if needed.

---

---

## PHASE 0.6 — NO-GUESSWORK VERIFICATION RESULTS

### Verification 1: Per-Beat vs Session-Level overlayCaption

**Question**: Is `overlayCaption` used per-beat or session-level at render time?

**Answer**: **SESSION-LEVEL** (single object for all beats)

**Evidence**:
- **Location**: `src/services/story.service.js:937` (OUTSIDE render loop)
  ```937:937:src/services/story.service.js
  const overlayCaption = session.overlayCaption || session.captionStyle;
  ```
- **Render loop**: Starts at line 778 (`for (let i = 0; i < shotsWithClips.length; i++)`)
- **overlayCaption read**: Line 937 (BEFORE loop, single read)
- **Usage in loop**: Line 950 - same `overlayCaption` object passed to `renderVideoQuoteOverlay()` for ALL beats
- **Karaoke usage**: Line 863 - same `overlayCaption` passed to `buildKaraokeASSFromTimestamps()` for ALL beats

**Conclusion**: ✅ **SESSION-LEVEL** - Single `overlayCaption` object applies to all beats/shots. No per-beat caption meta storage exists.

### Verification 2: Render Route overlayCaption Source

**Question**: Does render route read from session JSON or inject from request payload?

**Answer**: **(a) Reads session JSON untouched** - NO payload injection

**Evidence**:
- **Render route**: `src/routes/story.routes.js:454-481`
  ```454:470:src/routes/story.routes.js
  r.post("/render", async (req, res) => {
    const parsed = SessionSchema.safeParse(req.body || {});
    const { sessionId } = parsed.data;
    const session = await renderStory({
      uid: req.user.uid,
      sessionId
    });
  ```
- **Schema**: Only accepts `sessionId` (line 36-38), NO `overlayCaption` in request body
- **renderStory()**: Reads directly from `loadStorySession()` at line 755, then reads `session.overlayCaption` at line 937
- **NO payload injection**: No code path that takes `req.body.overlayCaption` and saves it to session before render

**Conclusion**: ✅ **(a) Session JSON only** - Render route does NOT inject window/global meta from request payload. It reads `session.overlayCaption` directly from persisted session JSON.

**Note**: There IS a separate `/api/caption/render` route (`src/routes/caption.render.routes.js`) that accepts overlayCaption in payload, but this is NOT the story render route (`/api/story/render`).

### Verification 3: rasterUrl Guarantee Mechanism

**Question**: If we persist only `session.captionStyle`, what guarantees `rasterUrl` exists before render?

**Current State**:
- Render requires `rasterUrl` (throws error if missing: `ffmpeg.video.js:965-966`)
- Render does NOT generate PNGs from style + text
- `overlayCaption` with `rasterUrl` comes from preview response, stored in window globals
- Render route reads from session, NOT from window globals

**Option Analysis**:

**Option 1**: On session load, automatically regenerate beat previews (recreate `rasterUrl`/meta) before enabling render.
- ✅ **Pros**: Always fresh previews, no storage overhead
- ❌ **Cons**: Requires preview generation on every session load (slow, requires TTS/text), breaks if preview fails
- ❌ **Risk**: Preview generation may fail (network, server errors), blocking render

**Option 2**: Persist per-beat overlay meta (`rasterUrl`, `rasterW/H`, `xExpr_png`, `yPx_png`, etc.) and load it.
- ✅ **Pros**: Guaranteed `rasterUrl` exists, fast render (no preview generation), survives page refresh
- ❌ **Cons**: Storage overhead (PNG data URLs are large), requires per-beat storage structure
- ⚠️ **Note**: Current architecture is session-level, not per-beat

**Recommendation**: **Option 2 (Hybrid)** - Store `captionStyle` (UI settings) in session, AND store `overlayCaption` meta (with `rasterUrl`) when preview is generated.

**Rationale**:
1. `captionStyle` is small and stable (font, weight, size, placement, opacity, color)
2. `overlayCaption` meta with `rasterUrl` is text-dependent and large, but required for render
3. Store both: `captionStyle` for UI persistence, `overlayCaption` for render guarantee
4. On session load: Use `captionStyle` to restore UI, use `overlayCaption` for render (if available)

**Implementation**:
- Save `captionStyle` when UI changes (debounced)
- Save `overlayCaption` meta (with `rasterUrl`) when preview is generated (after `/api/caption/preview` response)
- Render reads `session.overlayCaption` (already implemented)
- If `overlayCaption` missing but `captionStyle` exists, show warning: "Preview required before render"

### Verification 4: Weight Semantics Fix

**Question**: Update `generateCaptionPreview` to accept `opts.weightCss` (canonical), fallback to `opts.weight` (legacy).

**Current State**:
- **Function signature**: `public/js/caption-preview.js:63` - `@param {string} [opts.weight='bold']`
- **Payload construction**: `public/js/caption-preview.js:324` - `weightCss: opts.weight || overlayMeta?.weightCss || 'normal'`
- **UI construction**: `public/creative.html:2022` - Uses `weightCss: fontConfig.weightCss`

**Callsites to Update**:
1. **Direct calls** (no weight param):
   - `public/creative.html:2088` - `await generateCaptionPreview(payload)` (payload may have `weightCss`)
   - `public/js/caption-overlay.js:2003` - `await generateCaptionPreview()` (no args)
2. **Indirect calls** (may pass `weight`):
   - `public/js/caption-preview.js:1194` - `await generateCaptionPreview(options)` (check if `options.weight` exists)

**Fix Required**:
- Update function signature to accept `opts.weightCss` (canonical)
- Keep fallback: `opts.weightCss || opts.weight` (backward compatibility)
- Update JSDoc: `@param {string} [opts.weightCss='bold'] - Font weight (CSS value)`
- Remove or deprecate `@param {string} [opts.weight]` (legacy)

### Verification 5: Karaoke Pipeline Isolation

**Question**: Does karaoke read from `session.captionStyle` or `session.overlayCaption`?

**Answer**: ✅ **Karaoke DOES read from `overlayCaption`** - but it's passed as parameter, NOT directly from session

**Evidence**:
- **Karaoke function**: `src/utils/karaoke.ass.js:356`
  ```356:356:src/utils/karaoke.ass.js
  export async function buildKaraokeASSFromTimestamps({ text, timestamps, durationMs, audioPath = null, wrappedText = null, style = {}, overlayCaption = null, width = 1080, height = 1920 })
  ```
- **Karaoke usage**: `src/services/story.service.js:857-863`
  ```857:863:src/services/story.service.js
  assPath = await buildKaraokeASSFromTimestamps({
    text: caption.text,
    timestamps: ttsResult.timestamps,
    durationMs: ttsDurationMs,
    audioPath: ttsPath,
    wrappedText: wrappedText,
    overlayCaption: overlayCaption, // Pass overlay styling (SSOT)
  ```
- **overlayCaption source**: Line 808 - `const overlayCaption = session.overlayCaption || session.captionStyle;`
- **Karaoke style conversion**: `src/utils/karaoke.ass.js:137-152` - `convertOverlayToASSStyle(overlayCaption)` reads:
  - `fontFamily`, `fontPx`, `color`, `opacity`, `textAlign`, `placement`, `weightCss`, `fontStyle`, `yPct`, `xPct`, `wPct`

**Conclusion**: ⚠️ **Karaoke IS coupled to overlayCaption** - It receives the same `overlayCaption` object that render uses.

**Impact Assessment**:
- **Current behavior**: Karaoke uses same styling as overlay captions (font, size, color, placement)
- **Risk**: If we change `captionStyle` structure, karaoke may break
- **Mitigation**: Karaoke reads from `overlayCaption` parameter (not directly from session), so as long as we maintain `overlayCaption` shape, karaoke is safe

**Recommendation**: 
- ✅ **Safe to proceed** - Karaoke receives `overlayCaption` as parameter, not directly from session
- ✅ **No changes needed** - As long as `overlayCaption` object shape is maintained, karaoke will continue working
- ⚠️ **Future consideration**: If we want karaoke to have separate styling, we'd need `session.karaokeStyle` and pass that instead

---

## NO-GUESSWORK IMPLEMENTATION DECISION

### Decision: **Option 2 (Hybrid Storage Strategy)**

**Store both `captionStyle` and `overlayCaption` in session**:

1. **`session.captionStyle`** (UI settings):
   - Small, stable, user-controlled
   - Fields: `fontFamily`, `weightCss`, `fontPx`, `placement`, `yPct`, `opacity`, `color`
   - Saved when UI changes (debounced)
   - Used to restore UI controls on session load

2. **`session.overlayCaption`** (render meta with `rasterUrl`):
   - Large, text-dependent, required for render
   - Fields: All `captionStyle` fields PLUS `rasterUrl`, `rasterW`, `rasterH`, `yPx_png`, `xExpr_png`, `lines`, `totalTextH`, etc.
   - Saved when preview is generated (after `/api/caption/preview` response)
   - Used by render pipeline (already implemented)

**Why This Preserves Preview/Render Parity**:

1. ✅ **Render guarantee**: `session.overlayCaption` with `rasterUrl` ensures render works (no missing PNG error)
2. ✅ **UI persistence**: `session.captionStyle` ensures UI controls restore on session load
3. ✅ **Preview generation**: Preview uses `captionStyle` (or `overlayCaption` if available) to generate new meta
4. ✅ **Karaoke safety**: Karaoke receives `overlayCaption` parameter (maintains existing behavior)
5. ✅ **Session-level consistency**: Both stored at session level (matches current architecture)

**Implementation Steps**:

1. **Save `captionStyle` route**: `/api/story/update-caption-style` (saves UI settings)
2. **Save `overlayCaption` route**: Extend existing save mechanism OR add `/api/story/update-overlay-caption` (saves preview meta)
3. **UI → Save `captionStyle`**: Wire UI changes to save route (debounced)
4. **Preview → Save `overlayCaption`**: After preview response, save meta to session
5. **Session load**: Restore UI from `captionStyle`, use `overlayCaption` for render
6. **Render guard**: If `overlayCaption` missing, show warning: "Preview required before render"

**Fallback Behavior**:
- If `overlayCaption` missing but `captionStyle` exists: Show warning, disable render button
- If both missing: Use defaults (current behavior)
- If `overlayCaption` exists: Use it for render (current behavior)

---

## PHASE 1 — VERIFIED SEMANTICS (Code Citations)

### Verification 1: Raster Overlay Scope (Global vs Per-Beat)

**Question**: Is raster overlay at render time global or per-beat?

**Answer**: **GLOBAL** - Single `overlayCaption` object applies to all beats/shots

**Evidence**:

**Location**: `src/services/story.service.js:754-973`

1. **overlayCaption read ONCE (outside loop)**:
   ```937:937:src/services/story.service.js
   const overlayCaption = session.overlayCaption || session.captionStyle;
   ```
   - Read at line 937, BEFORE render loop starts
   - Same read also at line 808 (for karaoke ASS generation)

2. **Render loop structure**:
   ```778:955:src/services/story.service.js
   for (let i = 0; i < shotsWithClips.length; i++) {
     const shot = shotsWithClips[i];
     const caption = session.captions.find(c => c.sentenceIndex === shot.sentenceIndex);
     // ... TTS generation ...
     // ... ASS generation (uses overlayCaption from line 808) ...
     // Render segment
     await renderVideoQuoteOverlay({
       text: caption.text,  // ← Text varies per beat
       captionText: caption.text,  // ← Text varies per beat
       overlayCaption: overlayCaption,  // ← SAME object for all beats
     });
   }
   ```

3. **Text source per beat**:
   - Line 780: `const caption = session.captions.find(c => c.sentenceIndex === shot.sentenceIndex)`
   - Line 946: `text: caption.text` (varies per shot)
   - Line 947: `captionText: caption.text` (varies per shot)

**Truth Table**:

| Aspect | Value | Evidence |
|--------|-------|----------|
| **overlayCaption applies to** | **Entire video (all shots)** | Line 937: Read once, same object passed to all `renderVideoQuoteOverlay()` calls |
| **Text source for raster overlay** | **Per sentenceIndex caption** | Line 780: `session.captions.find(c => c.sentenceIndex === shot.sentenceIndex)` |
| **Raster PNG used** | **Same PNG for all beats** | Line 950: Same `overlayCaption.rasterUrl` passed to all segments |
| **Positioning (yPx_png)** | **Same for all beats** | Line 1541: `y: overlayCaption.yPx_png` (same value for all) |

**Conclusion**: ✅ **GLOBAL overlayCaption, PER-BEAT text** - The same `overlayCaption` object (with same `rasterUrl`, `rasterW`, `rasterH`, `yPx_png`, etc.) is used for all beats, but each beat renders with its own `caption.text`.

### Verification 2: Raster Requirements

**Question**: What are the exact required fields in raster mode?

**Answer**: **Required fields and error behavior**

**Evidence**:

**Location**: `src/utils/ffmpeg.video.js:960-967`

1. **Required fields check**:
   ```965:967:src/utils/ffmpeg.video.js
   if (!(overlayCaption.rasterUrl || overlayCaption.rasterDataUrl)) {
     throw new Error('RASTER: overlayCaption missing rasterUrl/rasterDataUrl at ffmpeg entry');
   }
   ```

2. **Raster placement construction**:
   ```1534:1553:src/utils/ffmpeg.video.js
   const rasterPlacement = overlayCaption?.mode === 'raster' ? {
     mode: 'raster',
     rasterUrl: overlayCaption.rasterUrl || overlayCaption.rasterDataUrl || overlayCaption.rasterPng,
     rasterW: overlayCaption.rasterW,
     rasterH: overlayCaption.rasterH,
     xExpr: (overlayCaption.xExpr_png || overlayCaption.xExpr || '(W-overlay_w)/2').replace(/\s+/g, ''),
     xPx_png: overlayCaption.xPx_png,
     y: overlayCaption.yPx_png ?? overlayCaption.yPx,  // Use PNG anchor, not drawtext anchor
     wPct: overlayCaption.wPct ?? 1,
     frameW: overlayCaption.frameW,
     frameH: overlayCaption.frameH,
     bgScaleExpr: overlayCaption.bgScaleExpr,
     bgCropExpr: overlayCaption.bgCropExpr,
     rasterHash: overlayCaption.rasterHash,
     previewFontString: overlayCaption.previewFontString,
     previewFontHash: overlayCaption.previewFontHash,
     rasterPadding: overlayCaption.rasterPadding
   } : null;
   ```

3. **FFmpeg overlay expression**:
   ```524:524:src/utils/ffmpeg.video.js
   const overlayExpr = `[vmain][ovr]overlay=${xExpr}:${y}:format=auto,${endFormat}[vout]`;
   ```

**Required Fields**:

| Field | Required | Default | Usage |
|-------|----------|---------|-------|
| `rasterUrl` OR `rasterDataUrl` | ✅ **REQUIRED** | None | PNG data URL or URL (throws error if missing) |
| `rasterW` | ✅ **REQUIRED** | None | Overlay width in pixels |
| `rasterH` | ✅ **REQUIRED** | None | Overlay height in pixels |
| `yPx_png` | ✅ **REQUIRED** | `overlayCaption.yPx` | Top-left Y coordinate (used as `y` in overlay expression) |
| `xExpr_png` | ⚠️ Optional | `'(W-overlay_w)/2'` | X expression for centering |
| `frameW` | ⚠️ Optional | 1080 | Frame width (for geometry lock) |
| `frameH` | ⚠️ Optional | 1920 | Frame height (for geometry lock) |

**Error Behavior**: If `rasterUrl`/`rasterDataUrl` missing → **throws Error** at line 966, render fails immediately.

### Verification 3: Karaoke Coupling

**Question**: Which object does karaoke read from?

**Answer**: **Karaoke reads from `overlayCaption` parameter (same object as render)**

**Evidence**:

**Location**: `src/services/story.service.js:808, 857-863`

1. **overlayCaption source for karaoke**:
   ```808:808:src/services/story.service.js
   const overlayCaption = session.overlayCaption || session.captionStyle;
   ```

2. **Karaoke function call**:
   ```857:863:src/services/story.service.js
   assPath = await buildKaraokeASSFromTimestamps({
     text: caption.text,
     timestamps: ttsResult.timestamps,
     durationMs: ttsDurationMs,
     audioPath: ttsPath,
     wrappedText: wrappedText,
     overlayCaption: overlayCaption, // Pass overlay styling (SSOT)
   });
   ```

3. **Karaoke style conversion**:
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

**Conclusion**: ⚠️ **Karaoke IS coupled to overlayCaption** - It receives the same `overlayCaption` object that render uses. Any changes to `overlayCaption` structure must preserve these keys for karaoke compatibility.

### Verification 4: V3 Positioning Semantics

**Question**: Confirm yPx_png is top-left anchor and client preview uses it correctly.

**Answer**: ✅ **Confirmed - top-left anchor semantics**

**Evidence**:

1. **FFmpeg overlay Y usage**:
   ```1541:1541:src/utils/ffmpeg.video.js
   y: overlayCaption.yPx_png ?? overlayCaption.yPx,  // Use PNG anchor, not drawtext anchor
   ```
   ```524:524:src/utils/ffmpeg.video.js
   const overlayExpr = `[vmain][ovr]overlay=${xExpr}:${y}:format=auto,${endFormat}[vout]`;
   ```
   - FFmpeg `overlay=x:y` uses Y as **top-left** of overlay image
   - `y` is set to `overlayCaption.yPx_png` (absolute pixel coordinate)

2. **Client preview CSS** (from previous audit):
   - `public/js/caption-preview.js:275` - Derives `yPct` from `yPx_png / frameH`
   - CSS: `top: calc(var(--y-pct) * 100%)` (TOP-anchored, no `translateY(-50%)`)

**Conclusion**: ✅ **Top-left anchor confirmed** - `yPx_png` is absolute top-left Y coordinate (0-1920), used directly in FFmpeg overlay expression and converted to `yPct` for CSS positioning.

---

## PHASE 2 — MINIMAL-DIFF IMPLEMENTATION PLAN

### Chosen Strategy: **GLOBAL overlayCaption with Storage Path Reference**

**Rationale**:
1. ✅ **Raster overlay is GLOBAL** (verified: same object for all beats)
2. ✅ **Text is per-beat** (each beat uses `caption.text`, but same PNG overlay)
3. ✅ **Storage safety**: Store PNG in Firebase Storage, reference via path (NOT base64 in JSON)
4. ✅ **Karaoke safety**: Preserve `overlayCaption` object shape (all keys karaoke expects)

**Storage Strategy**:

1. **`session.captionStyle`** (UI settings, small):
   - Store in session JSON directly
   - Fields: `fontFamily`, `weightCss`, `fontPx`, `placement`, `yPct`, `opacity`, `color`
   - Size: ~200 bytes

2. **`session.overlayCaption`** (render meta, with storage reference):
   - Store lightweight meta in session JSON
   - Store PNG in Firebase Storage at `drafts/{uid}/{sessionId}/caption-overlay.png`
   - Fields in JSON:
     ```javascript
     {
       mode: 'raster',
       storagePath: 'drafts/{uid}/{sessionId}/caption-overlay.png',  // ← Storage reference
       rasterHash: 'abc123...',  // ← Integrity check
       rasterW: 1080,
       rasterH: 200,
       yPx_png: 960,
       xExpr_png: '(W-overlay_w)/2',
       frameW: 1080,
       frameH: 1920,
       fontFamily: 'DejaVu Sans',
       weightCss: 'bold',
       fontPx: 48,
       // ... other style fields (for karaoke compatibility)
     }
     ```
   - Size: ~500 bytes (no base64 PNG)

3. **Render-time PNG download**:
   - Read `overlayCaption.storagePath` from session
   - Download PNG from Firebase Storage
   - Use as `rasterDataUrl` in FFmpeg overlay

**Why This Preserves Parity**:
- ✅ Same `overlayCaption` object shape (karaoke compatible)
- ✅ Same `rasterUrl`/`rasterDataUrl` flow (download from storage → use in overlay)
- ✅ Same positioning (`yPx_png`, `xExpr_png`)
- ✅ No base64 bloat in session JSON

---

## PHASE 3 — IMPLEMENTATION STEPS

### Commit 1: Add API Routes for Caption Persistence

**Files**:
- `src/routes/story.routes.js` (add routes)

**Changes**:

1. **Route: `/api/story/update-caption-style`** (save UI settings):
   ```javascript
   r.post("/update-caption-style", async (req, res) => {
     const parsed = z.object({
       sessionId: z.string().min(3),
       captionStyle: z.object({
         fontFamily: z.string().optional(),
         weightCss: z.string().optional(),  // ← Canonical (normalize weight -> weightCss)
         fontPx: z.number().optional(),
         placement: z.enum(['top', 'center', 'bottom']).optional(),
         yPct: z.number().min(0).max(1).optional(),
         opacity: z.number().min(0).max(1).optional(),
         color: z.string().optional()
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

2. **Route: `/api/story/update-overlay-caption`** (save preview meta + upload PNG):
   ```javascript
   r.post("/update-overlay-caption", async (req, res) => {
     const parsed = z.object({
       sessionId: z.string().min(3),
       overlayCaption: z.object({
         mode: z.literal('raster'),
         rasterDataUrl: z.string(),  // Base64 PNG from preview
         rasterW: z.number(),
         rasterH: z.number(),
         yPx_png: z.number(),
         xExpr_png: z.string().optional(),
         fontFamily: z.string().optional(),
         weightCss: z.string().optional(),
         fontPx: z.number().optional(),
         // ... other meta fields
       })
     }).safeParse(req.body);
     
     if (!parsed.success) {
       return res.status(400).json({ success: false, error: "INVALID_INPUT", detail: parsed.error.flatten() });
     }
     
     const { sessionId, overlayCaption } = parsed.data;
     const session = await getStorySession({ uid: req.user.uid, sessionId });
     if (!session) {
       return res.status(404).json({ success: false, error: "SESSION_NOT_FOUND" });
     }
     
     // Upload PNG to Storage
     const storagePath = `drafts/${req.user.uid}/${sessionId}/caption-overlay.png`;
     const pngBuffer = Buffer.from(overlayCaption.rasterDataUrl.split(',')[1], 'base64');
     await uploadPublic(pngBuffer, storagePath, 'image/png');
     
     // Store lightweight meta (NO base64)
     const { rasterDataUrl, ...metaWithoutDataUrl } = overlayCaption;
     session.overlayCaption = {
       ...metaWithoutDataUrl,
       storagePath: storagePath,  // ← Storage reference
       rasterHash: crypto.createHash('sha256').update(pngBuffer).digest('hex').slice(0, 16)
     };
     
     await saveStorySession({ uid: req.user.uid, sessionId, data: session });
     
     return res.json({ success: true, data: { overlayCaption: session.overlayCaption } });
   });
   ```

**Test**:
- POST `/update-caption-style` → `session.captionStyle` updated
- POST `/update-overlay-caption` → PNG uploaded, `session.overlayCaption.storagePath` set
- Verify PNG accessible at storage path

### Commit 2: Wire UI Controls to Persist captionStyle

**Files**:
- `public/creative.html` (add save calls)

**Changes**:

1. **After `captionStyle` construction** (line 2025):
   ```javascript
   // Save captionStyle to session (debounced)
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
   
   // Call after captionStyle construction
   saveCaptionStyleToSession(captionStyle);
   ```

2. **After preview response** (in `generateCaptionPreview` callback):
   ```javascript
   // After preview response, save overlayCaption meta
   if (result.meta && result.meta.rasterUrl) {
     await apiFetch('/api/story/update-overlay-caption', {
       method: 'POST',
       body: {
         sessionId: window.currentStorySession.id,
         overlayCaption: result.meta  // Includes rasterDataUrl
       }
     });
   }
   ```

**Test**:
- Change font → `captionStyle` saved (debounced)
- Generate preview → `overlayCaption` saved with storage path

### Commit 3: Render Downloads PNG from Storage

**Files**:
- `src/utils/ffmpeg.video.js` (modify raster materialization)

**Changes**:

**Location**: `src/utils/ffmpeg.video.js:818-833` (PNG materialization)

```javascript
// 🔒 EARLY PNG MATERIALIZATION - read from Storage if storagePath exists
if (overlayCaption?.mode === 'raster') {
  let dataUrl = overlayCaption.rasterUrl || overlayCaption.rasterDataUrl || overlayCaption.rasterPng;
  
  // If storagePath exists, download from Storage
  if (!dataUrl && overlayCaption.storagePath) {
    try {
      const { downloadFile } = await import('../services/storage.service.js');
      const pngBuffer = await downloadFile(overlayCaption.storagePath);
      dataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
      console.log('[render] Downloaded PNG from Storage:', overlayCaption.storagePath);
    } catch (err) {
      console.error('[render] Failed to download PNG from Storage:', err);
      throw new Error('RASTER: failed to download PNG from storage path');
    }
  }
  
  if (!dataUrl) {
    throw new Error('RASTER: missing rasterDataUrl/rasterUrl');
  }
  
  // ... rest of materialization code
}
```

**Test**:
- Render with `overlayCaption.storagePath` → PNG downloaded, render succeeds
- Render without `storagePath` but with `rasterDataUrl` → uses existing flow

### Commit 4: Contract Smoke Test

**Files**:
- `tests/caption-style-parity.test.js` (NEW)

**Changes**:

```javascript
import { describe, it, expect } from 'vitest';
import { convertOverlayToASSStyle } from '../src/utils/karaoke.ass.js';

describe('Caption Style Parity', () => {
  it('should generate preview meta with required fields', async () => {
    // Generate preview payload
    const payload = {
      ssotVersion: 3,
      mode: 'raster',
      text: 'Test caption',
      fontFamily: 'DejaVu Sans',
      weightCss: 'bold',
      fontPx: 48,
      // ... other fields
    };
    
    // Call preview endpoint (mock or real)
    const response = await fetch('/api/caption/preview', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    
    // Verify required fields
    expect(result.data.meta).toHaveProperty('rasterUrl');
    expect(result.data.meta).toHaveProperty('rasterW');
    expect(result.data.meta).toHaveProperty('rasterH');
    expect(result.data.meta).toHaveProperty('yPx_png');
    expect(result.data.meta).toHaveProperty('weightCss');
    expect(result.data.meta).toHaveProperty('fontFamily');
    expect(result.data.meta).toHaveProperty('fontPx');
  });
  
  it('should convert overlayCaption to ASS style (karaoke compatibility)', () => {
    const overlayCaption = {
      fontFamily: 'DejaVu Sans',
      weightCss: 'bold',
      fontPx: 48,
      color: '#FFFFFF',
      opacity: 0.9,
      placement: 'center',
      yPct: 0.5
    };
    
    const assStyle = convertOverlayToASSStyle(overlayCaption);
    
    expect(assStyle).toBeTruthy();
    expect(assStyle.fontName).toBe('DejaVu Sans');
    expect(assStyle.fontSize).toBe(48);
    expect(assStyle.primaryColour).toBeTruthy();
  });
});
```

**Test**:
- Run test → preview meta has required fields
- Run test → karaoke style conversion works with `weightCss`/`fontFamily`/`fontPx`

---

## Definition of Done (DoD)

### Parity Requirements
- [ ] Preview meta matches render meta (same `yPx_png`, `rasterW`, `rasterH`, `fontPx`, etc.)
- [ ] Render uses same `overlayCaption` object as preview generated
- [ ] PNG positioning matches preview (top-left anchor, same Y coordinate)

### Karaoke Safety
- [ ] Karaoke still receives `overlayCaption` with all expected keys (`weightCss`, `fontFamily`, `fontPx`, `placement`, `yPct`, etc.)
- [ ] `convertOverlayToASSStyle()` generates valid ASS style block
- [ ] No karaoke appearance changes (same font, size, color, placement)

### Storage Safety
- [ ] PNG stored in Firebase Storage (NOT base64 in JSON)
- [ ] Session JSON size remains small (<1KB for caption data)
- [ ] Render downloads PNG from storage path successfully

### UI Persistence
- [ ] `captionStyle` saves when UI changes (debounced)
- [ ] `captionStyle` loads from session on session load
- [ ] UI controls reflect saved style

### Render Guarantee
- [ ] If `overlayCaption.storagePath` exists, render downloads PNG
- [ ] If `overlayCaption` missing, show warning: "Preview required before render"
- [ ] Render succeeds with persisted `overlayCaption`

---

**End of Audit & Plan**

