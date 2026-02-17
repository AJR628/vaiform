# Caption Style & Placement Build Plan

**Goal**: Persist caption style settings (font, weight, size, placement, opacity, color) to session storage while preserving preview↔render parity and NOT breaking karaoke.

**Status**: PLANNING COMPLETE - Ready for implementation after probe confirmation

**Hard Constraints**:
- Do NOT change karaoke behavior/appearance
- All claims backed by exact file+line evidence
- No assumptions about raster mode usage
- SSOT rules: use existing field names, keep server meta keys verbatim

---

## 1. Current-State Truth Table (No-Guesswork)

### 1.1 Render Route (`/api/story/render`) Input/Output

**Location**: `src/routes/story.routes.js:454-481`

**Evidence**:
```454:481:src/routes/story.routes.js
r.post("/render", async (req, res) => {
  try {
    const parsed = SessionSchema.safeParse(req.body || {});
    if (!parsed.success) {
      return res.status(400).json({
        success: false,
        error: "INVALID_INPUT",
        detail: parsed.error.flatten()
      });
    }
    
    const { sessionId } = parsed.data;
    const session = await renderStory({
      uid: req.user.uid,
      sessionId
    });
    
    return res.json({ success: true, data: session });
  } catch (e) {
    console.error("[story][render] error:", e);
    return res.status(500).json({
      success: false,
      error: "STORY_RENDER_FAILED",
      detail: e?.message || "Failed to render story"
    });
  }
});
```

**SessionSchema Definition** (`src/routes/story.routes.js:36-38`):
```36:38:src/routes/story.routes.js
const SessionSchema = z.object({
  sessionId: z.string().min(3),
});
```

**Truth Table**:

| Aspect | Value | Evidence |
|--------|-------|----------|
| **Request body accepts** | `{ sessionId: string }` only | `SessionSchema` (line 36-38) |
| **Request body does NOT accept** | `overlayCaption`, `captionStyle`, or any other fields | Schema validation (line 457) |
| **overlayCaption source** | `session.overlayCaption || session.captionStyle` from persisted session JSON | `src/services/story.service.js:937` |
| **Payload injection** | ❌ NO - Route does NOT inject `overlayCaption` from request | No code path found that saves `req.body.overlayCaption` to session |

**Conclusion**: Render route reads `overlayCaption` **ONLY from persisted session JSON**, not from request payload.

### 1.2 overlayCaption Read Location & Scope

**Location**: `src/services/story.service.js:937`

**Evidence**:
```937:937:src/services/story.service.js
const overlayCaption = session.overlayCaption || session.captionStyle;
```

**Render Loop Structure** (`src/services/story.service.js:778-955`):
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

**Truth Table**:

| Aspect | Value | Evidence |
|--------|-------|----------|
| **overlayCaption read location** | Line 937 (OUTSIDE render loop) | `src/services/story.service.js:937` |
| **overlayCaption scope** | **SESSION-LEVEL** (single object for all beats) | Read once before loop (line 937), loop starts at line 778 |
| **Text source per beat** | `caption.text` (varies per `sentenceIndex`) | Line 780: `session.captions.find(c => c.sentenceIndex === shot.sentenceIndex)` |
| **overlayCaption passed to** | Same object to all `renderVideoQuoteOverlay()` calls | Line 950: `overlayCaption: overlayCaption` |

**Conclusion**: ✅ **SESSION-LEVEL** - Single `overlayCaption` object applies to all beats/shots. Text varies per beat, but `overlayCaption` (including `rasterUrl`) is constant.

### 1.3 Raster Mode Usage & Behavior

**Location**: `src/utils/ffmpeg.video.js:960-976`

**Evidence**:
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

**PNG Materialization** (`src/utils/ffmpeg.video.js:818-853`):
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

**Truth Table**:

| Aspect | Value | Evidence |
|--------|-------|----------|
| **Raster mode check** | `overlayCaption?.mode === 'raster'` | `src/utils/ffmpeg.video.js:961` |
| **Raster mode behavior** | Skips ALL drawtext, uses PNG overlay only | Line 970: `drawCaption = ''` |
| **Required field** | `rasterUrl` OR `rasterDataUrl` (throws error if missing) | Line 965-966: Error thrown if missing |
| **PNG materialization** | Once per `renderVideoQuoteOverlay()` call | Line 818-833: Materialized from `overlayCaption.rasterUrl` |
| **Is raster mode actually used?** | ⚠️ **UNKNOWN** - Requires probe | No evidence of production usage found in codebase |

**Conclusion**: Raster mode **exists in code** and **skips drawtext**, but **actual production usage is UNKNOWN**. Requires probe to confirm.

### 1.4 Karaoke Style Keys

**Location**: `src/utils/karaoke.ass.js:137-153`

**Evidence**:
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

**Karaoke Usage** (`src/services/story.service.js:808, 857-863`):
```808:808:src/services/story.service.js
const overlayCaption = session.overlayCaption || session.captionStyle;
```

```857:863:src/services/story.service.js
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

**Truth Table**:

| Key | Default | Used For | Evidence |
|-----|---------|----------|----------|
| `fontFamily` | `'DejaVu Sans'` | ASS font name | Line 143 |
| `fontPx` or `sizePx` | `64` | ASS font size | Line 144 |
| `color` | `'#ffffff'` | ASS text color | Line 145 |
| `opacity` | `1.0` | ASS text opacity | Line 146 |
| `textAlign` or `align` | `'center'` | ASS text alignment | Line 147 |
| `placement` | `'center'` | ASS vertical placement | Line 148 |
| `weightCss` | `'normal'` | ASS font weight | Line 149 |
| `fontStyle` | `'normal'` | ASS font style (italic) | Line 150 |
| `yPct` | `0.5` | ASS vertical position | Line 151 |
| `xPct` | `0.5` | ASS horizontal position | Line 152 |
| `wPct` | `0.8` | ASS text width percentage | Line 153 |

**Conclusion**: ✅ Karaoke reads from `overlayCaption` parameter (same object as render). All keys listed above must be preserved for karaoke compatibility.

### 1.5 Preview Endpoint Response Shape

**Location**: `src/routes/caption.preview.routes.js:405-415`

**Evidence**:
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

**ssotMeta Structure** (`src/routes/caption.preview.routes.js:279-328`):
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

**Truth Table**:

| Field | Location | Type | Notes |
|-------|----------|------|-------|
| `ok` | Top-level | `boolean` | Always `true` for success |
| `data.imageUrl` | `data.imageUrl` | `null` | Always `null` for V3 raster mode |
| `data.wPx` | `data.wPx` | `number` | Frame width (default: 1080) |
| `data.hPx` | `data.hPx` | `number` | Frame height (default: 1920) |
| `data.xPx` | `data.xPx` | `number` | Always `0` |
| `data.meta.rasterUrl` | `data.meta.rasterUrl` | `string` | PNG data URL (base64) - **ONLY location of PNG** |
| `data.meta.rasterW` | `data.meta.rasterW` | `number` | Overlay width (100-1080) |
| `data.meta.rasterH` | `data.meta.rasterH` | `number` | Overlay height (50-1920) |
| `data.meta.yPx_png` | `data.meta.yPx_png` | `number` | TOP-left Y coordinate (0-1920) |
| `data.meta.xExpr_png` | `data.meta.xExpr_png` | `string` | X expression (default: `'(W-overlay_w)/2'`) |
| `data.meta.fontFamily` | `data.meta.fontFamily` | `string` | Font family name |
| `data.meta.weightCss` | `data.meta.weightCss` | `string` | Font weight (CSS value) |
| `data.meta.fontPx` | `data.meta.fontPx` | `number` | Font size in pixels |
| `data.meta.lines` | `data.meta.lines` | `string[]` | Browser-rendered line breaks |
| `data.meta.totalTextH` | `data.meta.totalTextH` | `number` | Total text height in pixels |

**Conclusion**: ✅ Preview response shape proven. `data.meta.rasterUrl` contains PNG data URL (base64). All style fields are in `data.meta`.

### 1.6 Session Storage Current State

**Location**: `src/services/story.service.js:55-57`

**Evidence**:
```55:57:src/services/story.service.js
export async function saveStorySession({ uid, sessionId, data }) {
  await saveJSON({ uid, studioId: sessionId, file: 'story.json', data });
}
```

**Storage Path**: `drafts/{uid}/{sessionId}/story.json` (via `src/utils/json.store.js:16-18`)

**Size Limit** (`src/utils/json.store.js:22-23`):
```22:23:src/utils/json.store.js
const MAX_SESSION_BYTES = 500 * 1024; // 500KB
if (sizeBytes > MAX_SESSION_BYTES) {
  throw new Error('SESSION_TOO_LARGE');
}
```

**Current Persistence**:
- ❌ **NO route saves `overlayCaption` to session** (grep found 0 assignments in `src/routes/story.routes.js`)
- ✅ **Render reads from session** (`src/services/story.service.js:808, 937`)
- ⚠️ **Current flow**: `overlayCaption` stored in **window globals** (`window.__serverCaptionMeta`, `window._overlayMeta`) after preview generation
- ❌ **Window globals are in-memory only** - lost on page refresh

**Truth Table**:

| Aspect | Value | Evidence |
|--------|-------|----------|
| **Session storage path** | `drafts/{uid}/{sessionId}/story.json` | `src/services/story.service.js:55-57` |
| **Session size limit** | 500KB | `src/utils/json.store.js:22-23` |
| **overlayCaption persistence** | ❌ **NOT persisted** | No route found that saves `overlayCaption` |
| **Current storage location** | Window globals only (`window.__serverCaptionMeta`) | `public/js/caption-preview.js:585, 588` |
| **Render source** | `session.overlayCaption || session.captionStyle` | `src/services/story.service.js:937` |

**Conclusion**: `overlayCaption` is **NOT persisted to session**. It exists only in window globals (lost on page refresh). Render expects it in session but it's never saved.

---

## 2. Contradictions + Resolution Steps

### 2.1 Contradiction: Session-Level overlayCaption vs Per-Beat Text

**Contradiction**:
- `overlayCaption` is **session-level** (read once, same object for all beats)
- `caption.text` is **per-beat** (varies per `sentenceIndex`)
- Raster mode uses a **single PNG** (`overlayCaption.rasterUrl`) for all beats
- Raster mode **skips drawtext** (no text drawn via FFmpeg)

**Question**: How can per-beat text be rendered if raster mode uses a single PNG with fixed text?

**Evidence**:
- **overlayCaption read**: `src/services/story.service.js:937` (session-level, outside loop)
- **Text source**: `src/services/story.service.js:780` (`caption.text` varies per beat)
- **Raster mode**: `src/utils/ffmpeg.video.js:961` (skips drawtext, uses PNG only)
- **PNG materialization**: `src/utils/ffmpeg.video.js:818-833` (materialized from `overlayCaption.rasterUrl`)

**Possible Explanations**:

1. **Option A**: Raster mode is **NOT actually used** in production (drawtext mode is used instead)
   - **Evidence**: No production logs found showing raster mode usage
   - **Probe Required**: Add temporary log to check if `overlayCaption?.mode === 'raster'` is ever true

2. **Option B**: PNG is **regenerated per-beat** at render time (but no evidence found)
   - **Evidence**: No code path found that regenerates PNG per-beat
   - **Probe Required**: Check if `renderCaptionRaster()` is called inside render loop

3. **Option C**: PNG is **text-agnostic** (box-only, karaoke draws text)
   - **Evidence**: Karaoke uses ASS subtitles (`src/services/story.service.js:857-863`)
   - **Probe Required**: Inspect actual PNG content to verify if it contains text or is box-only

4. **Option D**: Current implementation has a **BUG** (all beats show same text)
   - **Evidence**: Single PNG with fixed text would show same text on all beats
   - **Probe Required**: Check actual render output to verify if beats show different text

**Resolution Strategy**:
- **Mark as UNRESOLVED** until probe confirms which explanation is correct
- **Probe required**: See Section 3.1

### 2.2 Contradiction: overlayCaption Not Persisted vs Render Expects It

**Contradiction**:
- Render **expects** `session.overlayCaption` (`src/services/story.service.js:937`)
- **NO route saves** `overlayCaption` to session (grep found 0 matches)
- `overlayCaption` exists only in **window globals** (lost on page refresh)
- Render **requires** `rasterUrl` if `mode === 'raster'` (throws error if missing)

**Question**: How does render work if `overlayCaption` is not persisted?

**Evidence**:
- **Render read**: `src/services/story.service.js:937` (`session.overlayCaption || session.captionStyle`)
- **Persistence**: No route found that saves `overlayCaption`
- **Window globals**: `public/js/caption-preview.js:585, 588` (`window.__serverCaptionMeta`)
- **Render route**: `src/routes/story.routes.js:454-481` (reads from session, not window globals)

**Possible Explanations**:

1. **Option A**: Render only works if preview was generated in **same browser session** (window globals persist)
   - **Evidence**: Window globals exist after preview generation
   - **Limitation**: Breaks on page refresh

2. **Option B**: Render **fails silently** or uses fallback (but no evidence found)
   - **Evidence**: Render throws error if `rasterUrl` missing (`src/utils/ffmpeg.video.js:965-966`)
   - **Probe Required**: Check if render actually fails or uses fallback

3. **Option C**: `session.captionStyle` exists and render uses it (but no evidence found)
   - **Evidence**: Fallback to `session.captionStyle` exists (`src/services/story.service.js:937`)
   - **Probe Required**: Check if `session.captionStyle` is actually populated

**Resolution Strategy**:
- **Mark as UNRESOLVED** until probe confirms actual behavior
- **Probe required**: See Section 3.2

### 2.3 Resolution: Weight Key Semantics

**Contradiction**:
- Function accepts `opts.weight` (legacy parameter)
- Internally stores as `weightCss` (SSOT key)
- UI uses `weightCss` (correct)

**Evidence**:
- **Function signature**: `public/js/caption-preview.js:63` - `@param {string} [opts.weight='bold']`
- **Payload construction**: `public/js/caption-preview.js:324` - `weightCss: opts.weight || overlayMeta?.weightCss || 'normal'`
- **UI construction**: `public/creative.html:2022` - Uses `weightCss: fontConfig.weightCss`

**Resolution**:
- ✅ **RESOLVED** - Standardize to `weightCss` everywhere
- **Action**: Update function signature to accept `opts.weightCss` (with fallback to `opts.weight` for backward compatibility)
- **Implementation**: See Commit 2

---

## 3. Smallest Probe Section

### 3.1 Probe: Raster Mode Usage in Production

**Question**: Is raster mode actually used in production renders?

**Probe Design**:
- **Location**: `src/utils/ffmpeg.video.js:961` (raster mode check)
- **Action**: Add temporary log (gated by env flag) to record raster mode detection
- **Code**:
  ```javascript
  if (overlayCaption?.mode === 'raster') {
    console.log('[PROBE:RASTER_MODE]', {
      timestamp: Date.now(),
      hasRasterUrl: Boolean(overlayCaption.rasterUrl || overlayCaption.rasterDataUrl),
      rasterW: overlayCaption.rasterW,
      rasterH: overlayCaption.rasterH,
      text: overlayCaption.text?.substring(0, 50) || 'N/A',
      sessionId: process.env.PROBE_SESSION_ID || 'unknown'
    });
    // ... existing code ...
  }
  ```

**Gate**: `process.env.PROBE_RASTER_MODE === '1'`

**Removal**: Remove after 1 week of production logs OR after confirming raster mode usage

**Success Criteria**:
- If logs show raster mode is used → Proceed with raster mode persistence strategy
- If logs show raster mode is NOT used → Skip raster mode persistence, use drawtext mode only

**Stop Condition**: If probe shows raster mode is used but per-beat text differs, **STOP** and redesign (per-beat overlay storage required).

### 3.2 Probe: Session overlayCaption at Render Start

**Question**: What is the actual structure of `session.overlayCaption` at render start?

**Probe Design**:
- **Location**: `src/services/story.service.js:937` (overlayCaption read)
- **Action**: Add temporary log (gated by env flag) to dump session structure
- **Code**:
  ```javascript
  const overlayCaption = session.overlayCaption || session.captionStyle;
  
  if (process.env.PROBE_SESSION_STRUCTURE === '1') {
    console.log('[PROBE:SESSION_STRUCTURE]', {
      timestamp: Date.now(),
      hasOverlayCaption: Boolean(session.overlayCaption),
      hasCaptionStyle: Boolean(session.captionStyle),
      overlayCaptionKeys: session.overlayCaption ? Object.keys(session.overlayCaption) : [],
      overlayCaptionMode: session.overlayCaption?.mode,
      hasRasterUrl: Boolean(session.overlayCaption?.rasterUrl || session.overlayCaption?.rasterDataUrl),
      rasterUrlLength: (session.overlayCaption?.rasterUrl || session.overlayCaption?.rasterDataUrl || '').length,
      sessionKeys: Object.keys(session).filter(k => k !== 'captions' && k !== 'shots')
    });
  }
  ```

**Gate**: `process.env.PROBE_SESSION_STRUCTURE === '1'`

**Removal**: Remove after 1 week of production logs OR after confirming session structure

**Success Criteria**:
- If logs show `session.overlayCaption` exists → Proceed with persistence strategy
- If logs show `session.overlayCaption` is missing → Proceed with creation strategy

**Stop Condition**: If probe shows `overlayCaption` exists but structure differs from expected, **STOP** and verify schema compatibility.

### 3.3 Probe: Per-Beat Text vs Single PNG

**Question**: Do rendered beats show different text when using raster mode?

**Probe Design**:
- **Location**: `src/services/story.service.js:950` (renderVideoQuoteOverlay call)
- **Action**: Add temporary log (gated by env flag) to record text per beat
- **Code**:
  ```javascript
  await renderVideoQuoteOverlay({
    text: caption.text,  // ← Text varies per beat
    captionText: caption.text,
    overlayCaption: overlayCaption,
  });
  
  if (process.env.PROBE_PER_BEAT_TEXT === '1' && overlayCaption?.mode === 'raster') {
    console.log('[PROBE:PER_BEAT_TEXT]', {
      timestamp: Date.now(),
      sentenceIndex: caption.sentenceIndex,
      text: caption.text?.substring(0, 50),
      hasRasterUrl: Boolean(overlayCaption.rasterUrl || overlayCaption.rasterDataUrl),
      rasterUrlText: overlayCaption.text?.substring(0, 50) || 'N/A'
    });
  }
  ```

**Gate**: `process.env.PROBE_PER_BEAT_TEXT === '1'`

**Removal**: Remove after confirming per-beat text behavior

**Success Criteria**:
- If logs show different text per beat → **STOP** - Contradiction confirmed, redesign required
- If logs show same text per beat → Proceed with session-level overlay storage

**Stop Condition**: If probe confirms per-beat text differs but single PNG is used, **STOP** and implement per-beat overlay storage OR render-time PNG generation.

---

## 4. Implementation Plan (Commit-by-Commit)

### Commit 0 (Optional): Add Gated Probes

**Scope**: Add temporary probes to eliminate ambiguity about raster mode usage and session persistence.

**Files**:
- `src/utils/ffmpeg.video.js` (add raster mode probe)
- `src/services/story.service.js` (add session structure probe)
- `src/services/story.service.js` (add per-beat text probe)

**Changes**:
1. Add `[PROBE:RASTER_MODE]` log in raster mode check (gated by `process.env.PROBE_RASTER_MODE === '1'`)
2. Add `[PROBE:SESSION_STRUCTURE]` log at overlayCaption read (gated by `process.env.PROBE_SESSION_STRUCTURE === '1'`)
3. Add `[PROBE:PER_BEAT_TEXT]` log in render loop (gated by `process.env.PROBE_PER_BEAT_TEXT === '1'`)

**Data Shape Changes**: None (logs only)

**Back-Compat**: ✅ Safe - Probes are gated by env flags, no behavior changes

**Acceptance Tests**:
- Set `PROBE_RASTER_MODE=1` → Run render → Check logs for `[PROBE:RASTER_MODE]`
- Set `PROBE_SESSION_STRUCTURE=1` → Run render → Check logs for `[PROBE:SESSION_STRUCTURE]`
- Set `PROBE_PER_BEAT_TEXT=1` → Run render → Check logs for `[PROBE:PER_BEAT_TEXT]`

**Stop Condition**: If probes reveal contradictions (e.g., per-beat text differs but single PNG used), **STOP** and redesign.

**Removal**: Remove probes after 1 week OR after confirming behavior.

---

### Commit 1: Add Persistence Route for session.captionStyle

**Scope**: Add API route to persist UI style settings (`captionStyle`) to session storage.

**Files**:
- `src/routes/story.routes.js` (add route)

**Changes**:
1. Add `POST /api/story/update-caption-style` route
2. Validate `captionStyle` schema (Zod validation)
3. Normalize `weight` → `weightCss` (backward compatibility)
4. Store `session.captionStyle` (merge with existing, if any)
5. Save session via `saveStorySession()`

**Route Implementation**:
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

**Data Shape Changes**:
- **New field**: `session.captionStyle` (object with UI settings)
- **Fields**: `fontFamily`, `weightCss`, `fontPx`, `placement`, `yPct`, `opacity`, `color`, plus UI-only fields

**Back-Compat**: ✅ Safe - New field, optional, render falls back to defaults if missing

**Acceptance Tests**:
```bash
# Test 1: Save captionStyle
curl -X POST http://localhost:3000/api/story/update-caption-style \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "sessionId": "test-session",
    "captionStyle": {
      "fontFamily": "DejaVu Sans",
      "weightCss": "bold",
      "fontPx": 48,
      "placement": "center",
      "yPct": 0.5,
      "opacity": 0.9,
      "color": "#FFFFFF"
    }
  }'

# Expected: { "success": true, "data": { "captionStyle": { ... } } }

# Test 2: Verify session JSON contains captionStyle
# Check drafts/{uid}/{sessionId}/story.json → should contain "captionStyle" field

# Test 3: Invalid schema → 400 error
curl -X POST http://localhost:3000/api/story/update-caption-style \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "sessionId": "test-session",
    "captionStyle": {
      "fontPx": "invalid"  // Should be number
    }
  }'

# Expected: { "success": false, "error": "INVALID_INPUT", "detail": { ... } }
```

**Stop Condition**: If route fails to save or session JSON exceeds 500KB limit, **STOP** and investigate.

---

### Commit 2: Wire Frontend to Load/Apply captionStyle and Send Updates

**Scope**: Wire UI controls to load `captionStyle` from session on load and save updates (debounced, on blur/Enter).

**Files**:
- `public/creative.html` (add save/load logic)
- `public/js/caption-preview.js` (fix weight key semantics)

**Changes**:

1. **Add debounced save function** (after `captionStyle` construction, line ~2025):
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
   
   // Call after captionStyle construction
   saveCaptionStyleToSession(captionStyle);
   ```

2. **Add load logic** (in `renderStoryboard(session)` or session load handler):
   ```javascript
   if (session.captionStyle) {
     const oc = session.captionStyle;
     
     // Set font dropdown
     if (oc.fontFamily) {
       const fontSelect = document.getElementById('caption-font');
       if (fontSelect) {
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
     
     // Set size slider (map fontPx to slider value)
     if (oc.fontPx) {
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
     
     // Trigger update to apply loaded style
     updateOverlayCaption();
   }
   ```

3. **Fix weight key semantics** (`public/js/caption-preview.js:63, 324`):
   - Update function signature: Accept `opts.weightCss` (with fallback to `opts.weight`)
   - Update JSDoc: `@param {string} [opts.weightCss='bold'] - Font weight (CSS value)`
   - Keep backward compatibility: `weightCss: opts.weightCss || opts.weight || overlayMeta?.weightCss || 'normal'`

**Data Shape Changes**: None (client-side only)

**Back-Compat**: ✅ Safe - Load logic is additive, save is debounced, weight key fix maintains backward compatibility

**Acceptance Tests**:
1. **Manual UI Test**:
   - Load session → UI controls should reflect saved `captionStyle`
   - Change font → Save called (debounced, check network tab)
   - Change placement → Save called
   - Refresh page → UI controls should restore saved style

2. **Network Test**:
   - Open DevTools → Network tab
   - Change font dropdown → Should see POST to `/api/story/update-caption-style` (after 500ms debounce)
   - Verify payload contains correct `captionStyle` fields

3. **Session JSON Test**:
   - Change style → Wait for save
   - Check `drafts/{uid}/{sessionId}/story.json` → Should contain updated `captionStyle`

**Stop Condition**: If UI controls don't restore on load or save fails, **STOP** and debug.

---

### Commit 3: Conditional - Raster Mode Persistence (ONLY if Probe Confirms Usage)

**Prerequisites**: 
- Probe 3.1 confirms raster mode is used in production
- Probe 3.2 confirms `session.overlayCaption` structure
- Probe 3.3 confirms per-beat text behavior (if per-beat text differs, skip this commit and redesign)

**Scope**: Persist `overlayCaption` meta (with `rasterUrl`) to session when preview is generated.

**Files**:
- `src/routes/story.routes.js` (add route)
- `public/js/caption-preview.js` (wire preview response → save)
- `src/utils/ffmpeg.video.js` (support storagePath download)

**Changes**:

1. **Add route**: `POST /api/story/update-overlay-caption`
   - Accept `overlayCaption` meta (with `rasterDataUrl`)
   - Upload PNG to Firebase Storage at `drafts/{uid}/{sessionId}/caption-overlay.png`
   - Store lightweight meta in session JSON (NO base64)
   - Store `storagePath` reference instead of `rasterUrl`

2. **Wire preview response → save** (`public/js/caption-preview.js`):
   - After preview response, call `/api/story/update-overlay-caption`
   - Pass `result.meta` (includes `rasterUrl` as data URL)

3. **Support storagePath download** (`src/utils/ffmpeg.video.js:818-833`):
   - If `overlayCaption.storagePath` exists, download PNG from Storage
   - Convert to data URL, use as `rasterDataUrl`

**Data Shape Changes**:
- **New field**: `session.overlayCaption.storagePath` (string, Firebase Storage path)
- **New field**: `session.overlayCaption.rasterHash` (string, integrity check)
- **Removed from JSON**: `rasterUrl` (moved to Storage, not in JSON)

**Back-Compat**: ✅ Safe - Render supports both `rasterUrl` (data URL) and `storagePath` (download from Storage)

**Acceptance Tests**:
1. Generate preview → Check session JSON → Should contain `overlayCaption.storagePath`
2. Check Firebase Storage → PNG should exist at `drafts/{uid}/{sessionId}/caption-overlay.png`
3. Run render → Should download PNG from Storage, render succeeds
4. Verify session JSON size → Should be <1KB (no base64 PNG)

**Stop Condition**: 
- If probe 3.3 confirms per-beat text differs, **STOP** - Skip this commit, redesign required (per-beat overlay storage)
- If Storage upload fails, **STOP** and investigate

---

### Commit 4: Contract Smoke Test

**Scope**: Add minimal contract test to verify preview meta matches render expectations.

**Files**:
- `tests/caption-style-parity.test.js` (NEW)

**Changes**:
- Add test fixture with 3 beats (short/medium/long text)
- Test preview meta has required fields (`rasterUrl`, `rasterW`, `rasterH`, `yPx_png`, `weightCss`, `fontFamily`, `fontPx`)
- Test karaoke style conversion works with `weightCss`/`fontFamily`/`fontPx`

**Data Shape Changes**: None (test only)

**Back-Compat**: ✅ Safe (test only)

**Acceptance Tests**:
- Run test suite → All tests pass
- Verify preview meta shape matches render expectations

**Stop Condition**: If tests fail, **STOP** and fix before proceeding.

---

## 5. Non-Goals (Explicit)

1. **No new karaoke animations** (scaling/"ballooning") in this phase
2. **No refactor of render pipeline** beyond what's required for persistence/parity
3. **No per-beat overlay storage** (unless probe 3.3 confirms per-beat text differs)
4. **No render-time PNG generation** (unless probe confirms raster mode is used but PNGs are missing)
5. **No changes to karaoke behavior/appearance** (hard constraint)

---

## 6. Stop/Do Not Proceed Conditions

1. **If probe 3.1 shows raster mode is NOT used**: Skip Commit 3 (raster mode persistence)
2. **If probe 3.3 confirms per-beat text differs but single PNG is used**: **STOP** - Contradiction confirmed, redesign required (per-beat overlay storage OR render-time PNG generation)
3. **If session JSON exceeds 500KB limit**: **STOP** - Storage strategy must change (use Storage for PNGs, not JSON)
4. **If karaoke breaks**: **STOP** - Preserve karaoke compatibility (all keys in Section 1.4 must be present)

---

## 7. Evidence Citations Summary

| Claim | File | Line(s) |
|-------|------|---------|
| Render route accepts only `sessionId` | `src/routes/story.routes.js` | 36-38, 454-481 |
| overlayCaption read once (session-level) | `src/services/story.service.js` | 937 |
| Text varies per beat | `src/services/story.service.js` | 780, 946-947 |
| Render requires rasterUrl | `src/utils/ffmpeg.video.js` | 965-966 |
| Raster mode skips drawtext | `src/utils/ffmpeg.video.js` | 960-976 |
| Preview response shape | `src/routes/caption.preview.routes.js` | 405-415 |
| meta.rasterUrl contains PNG | `src/routes/caption.preview.routes.js` | 290 |
| Karaoke reads overlayCaption | `src/services/story.service.js` | 808, 857-863 |
| Karaoke style conversion | `src/utils/karaoke.ass.js` | 137-153 |
| Weight key mismatch | `public/js/caption-preview.js` | 63, 324 |
| Session storage path | `src/services/story.service.js` | 55-57 |
| Session size limit | `src/utils/json.store.js` | 22-23 |
| yPx_png TOP-LEFT anchor | `src/utils/ffmpeg.video.js` | 1541, 524 |

---

**End of Build Plan**


