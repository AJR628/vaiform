# Caption Style Persistence — Safety-First Audit Report

**Date**: 2026-01-07  
**Purpose**: Validate wiring + semantics before implementing global caption style persistence  
**Goal**: Ensure we don't break preview↔render parity, karaoke, or render pipeline

---

## A) Repo Findings

### A1. SSOT Key Identification & Current Usage

**Intended SSOT Key**: `session.overlayCaption` (with fallback to `session.captionStyle`)

**Render Pipeline Consumption**:
- `src/services/story.service.js:810` - Reads `session.overlayCaption || session.captionStyle` for ASS generation
- `src/services/story.service.js:960` - Reads `session.overlayCaption || session.captionStyle` for video render
- **Scope**: Session-level (read ONCE outside render loop, same object for all beats)

**Preview Payload Construction**:
- `public/creative.html:7582` - `explicitStyle = session.overlayCaption || session.captionStyle || {}`
- `public/creative.html:8334` - `explicitStyle = window.currentStorySession.overlayCaption || window.currentStorySession.captionStyle || {}`
- **Usage**: Passed to `generateBeatCaptionPreview(beatId, text, explicitStyle)` → `buildBeatPreviewPayload(text, overlayMeta, explicitStyle)`

**UI State**:
- `public/creative.html:2009` - Constructs `captionStyle` object from UI controls (font, weight, size, placement, opacity)
- `public/creative.html:5403` - Similar construction for quote render path
- **Storage**: NOT persisted to session (only used for live preview generation)

**Current Persistence Status**:
- ❌ **NO route saves `overlayCaption` to session** (`grep` found 0 assignments in `src/routes/story.routes.js`)
- ✅ **Render reads from session** (expects it, but it's never saved)
- ⚠️ **Preview meta stored in window globals/localStorage** (`window._overlayMeta`, `localStorage.overlayMetaV3`) - NOT in session

---

### A2. Session Write Paths Audit

**All `saveStorySession` call sites** (`src/services/story.service.js`, `src/routes/story.routes.js`):

| Location | Pattern | Risk: Clobber overlayCaption? | Why |
|----------|---------|-------------------------------|-----|
| `story.service.js:99` | `createStorySession` → new session object | ✅ **NO** | Creates new session, no existing `overlayCaption` to clobber |
| `story.service.js:142` | `generateStory` → `loadStorySession` → modify → save | ⚠️ **YES** | Loads session, modifies `story`, saves. If loaded session lacks `overlayCaption`, it's not preserved |
| `story.service.js:170` | `updateStorySentences` → `loadStorySession` → modify → save | ⚠️ **YES** | Loads session, modifies `story.sentences`, clears `plan`/`shots`, saves. Does NOT preserve `overlayCaption` |
| `story.service.js:188` | `planShots` → `loadStorySession` → modify → save | ⚠️ **YES** | Loads session, modifies `plan`/`shots`, saves. Does NOT preserve `overlayCaption` |
| `story.service.js:410` | `searchShots` → `loadStorySession` → modify → save | ⚠️ **YES** | Loads session, modifies `shots`, saves. Does NOT preserve `overlayCaption` |
| `story.service.js:461` | `buildTimeline` → `loadStorySession` → modify → save | ⚠️ **YES** | Loads session, modifies `timeline`, saves. Does NOT preserve `overlayCaption` |
| `story.service.js:489` | `generateCaptionTimings` → `loadStorySession` → modify → save | ⚠️ **YES** | Loads session, modifies `captions`, saves. Does NOT preserve `overlayCaption` |
| `story.service.js:550` | `finalizeStory` → `loadStorySession` → modify → save | ⚠️ **YES** | Loads session, modifies `status`, saves. Does NOT preserve `overlayCaption` |
| `story.routes.js:673` | `create-manual-session` → `createStorySession` → modify → save | ✅ **NO** | Creates new session, no existing `overlayCaption` to clobber |

**Pattern Analysis**:
- All paths use **"load → modify → save"** pattern (merge-friendly)
- **BUT**: None of them explicitly preserve `overlayCaption` if it exists in loaded session
- **Result**: If `overlayCaption` exists in loaded session, it's preserved (because `saveStorySession` saves entire `data` object). If it doesn't exist, it's not added.

**Client-Side Session Assignment** (`public/creative.html`):
- `line 7227` - `window.currentStorySession = session` (after `/story/search` response)
- `line 7332` - `window.currentStorySession = session` (manual script path)
- `line 9371` - `window.currentStorySession = session` (after `/story/create-manual-session`)
- **Risk**: Direct assignment replaces entire object. `preserveCaptionOverrides` called BEFORE assignment, but only preserves if server lacks `overlayCaption` (which it always does).

---

### A3. Dangerous Fields Audit

**Preview Response Meta Shape** (`public/js/caption-preview.js:625-656`, `public/creative.html:5067-5087`):

Preview responses (`normalizedMeta`) contain:
- ✅ **Style fields**: `fontPx`, `weightCss`, `fontFamily`, `color`, `opacity`, `placement`, `yPct`, `wPct`, `lineSpacingPx`, `letterSpacingPx`
- ⚠️ **Dangerous fields**: `mode: 'raster'`, `lines: []`, `rasterUrl`, `rasterHash`, `rasterW`, `rasterH`, `yPx_png`, `totalTextH`, `yPxFirstLine`, `ssotVersion: 3`, `text` (beat-specific)

**Storage Locations**:
- `window._overlayMeta` - Full preview meta (includes dangerous fields)
- `localStorage.overlayMetaV3` - Full preview meta (includes dangerous fields)
- `window.__serverCaptionMeta` - Full preview meta (includes dangerous fields)
- ❌ **NOT stored in `session.overlayCaption`** (no route saves it)

**Render Payload Usage** (`public/creative.html:5599`):
- `payload.overlayCaption = savedMeta` - Uses full preview meta (includes dangerous fields)
- **Context**: Quote render path, NOT story render path
- **Story render path**: Reads from `session.overlayCaption` (which doesn't exist)

**Conclusion**: Dangerous fields exist in preview responses and window globals, but are **NOT persisted to session** (because no route saves them). However, if we add a route that saves `overlayCaption`, we must ensure it only saves style-only fields.

---

### A4. Render Branch Triggers Validation

**Branch 1: Raster Mode** (`src/utils/ffmpeg.video.js:961`):
```javascript
if (overlayCaption?.mode === 'raster') {
  // Requires rasterUrl/rasterDataUrl (throws error if missing at line 981)
  if (!(overlayCaption.rasterUrl || overlayCaption.rasterDataUrl)) {
    throw new Error('RASTER: overlayCaption missing rasterUrl/rasterDataUrl at ffmpeg entry');
  }
  // Skips ALL drawtext paths
  drawCaption = '';
}
```

**Risk**: If persisted `overlayCaption` has `mode: 'raster'` but lacks `rasterUrl`/`rasterDataUrl`, render **WILL FAIL** (throws error).

**Branch 2: Pre-Wrapped Lines** (`src/services/story.service.js:825`):
```javascript
if (overlayCaption?.lines && Array.isArray(overlayCaption.lines)) {
  wrappedText = overlayCaption.lines.join('\n');
  // Skips SSOT wrapper
} else if (caption?.text) {
  // Uses SSOT wrapper (correct path)
  wrappedText = wrapTextWithFont(caption.text, {...});
}
```

**Risk**: If persisted `overlayCaption` has `lines: []` (from one beat's preview), render will reuse those lines for ALL beats, causing incorrect wrapping for beats with different text lengths.

**Required Fields for Raster Mode**:
- `rasterUrl` OR `rasterDataUrl` (REQUIRED, throws if missing)
- `rasterW`, `rasterH` (required for overlay dimensions)
- `yPx_png` (required for positioning)
- `frameW`, `frameH` (required for geometry lock)

**Conclusion**: Both branches are **SAFE** if `overlayCaption` is style-only (no `mode`, no `lines`). Render will use SSOT wrapper and ASS subtitles (expected behavior).

---

### A5. Preview Payload Construction Trace

**Function**: `buildBeatPreviewPayload(text, overlayMeta, explicitStyle)` (`public/js/caption-preview.js:732-785`)

**Gating Logic**: Uses `Object.prototype.hasOwnProperty.call(explicitStyle, key)` to conditionally include style fields (lines 745-762).

**Call Chain**:
1. `generateBeatCaptionPreview(beatId, text, style)` (`caption-preview.js:794`)
   - `explicitStyle = style || {}` (line 828)
   - `measureStyle = { ...MEASURE_DEFAULTS, ...explicitStyle }` (line 829)
   - `overlayMeta = measureBeatCaptionGeometry(text, measureStyle)` (line 832)
   - `payload = buildBeatPreviewPayload(text, overlayMeta, explicitStyle)` (line 838)

2. Caller: `public/creative.html:7582` or `8334`
   - `explicitStyle = session.overlayCaption || session.captionStyle || {}`

**Path 1: Style Present**:
- `session.overlayCaption = { fontPx: 48, weightCss: 'bold' }`
- `explicitStyle = { fontPx: 48, weightCss: 'bold' }`
- `buildBeatPreviewPayload` checks `explicitStyle.hasOwnProperty('fontPx')` → ✅ true
- Payload includes `fontPx: overlayMeta.fontPx` (from measurement)
- Server receives `fontPx: 48` in payload → uses it (no default)

**Path 2: Style Missing**:
- `session.overlayCaption = undefined`
- `explicitStyle = {}` (empty object)
- `buildBeatPreviewPayload` checks `explicitStyle.hasOwnProperty('fontPx')` → ❌ false
- Payload omits `fontPx` field
- Server receives payload without `fontPx` → schema default applies (`fontPx: 64`)

**Conclusion**: Gating logic is **CORRECT**. Empty `explicitStyle` → server defaults apply (matches render behavior). Style present → payload includes style keys → server uses them.

---

### A6. Browser Import Path Audit

**Dynamic Imports** (`public/creative.html`, `public/js/caption-preview.js`):

| Import Statement | Resolved Path (relative to `public/`) | Status |
|------------------|--------------------------------------|--------|
| `import('./api.mjs')` | `/api.mjs` (root) | ✅ Correct |
| `import('./js/caption-overlay.js')` | `/js/caption-overlay.js` | ✅ Correct |
| `import('./js/caption-preview.js')` | `/js/caption-preview.js` | ✅ Correct |
| `import('./js/caption-live.js')` | `/js/caption-live.js` | ✅ Correct |

**All imports use relative paths** (`./`), which resolve correctly from `public/` directory.

**No mismatches found** (no `../api.mjs` or `/api.mjs` conflicts).

---

## B) Risk Map

| Component | Risk | Evidence | Severity |
|-----------|------|----------|----------|
| **Session Write Paths** | Clobber `overlayCaption` if not explicitly preserved | All `saveStorySession` calls use "load → modify → save" but don't preserve `overlayCaption` | ⚠️ **MEDIUM** (only affects if `overlayCaption` exists) |
| **Client Session Assignment** | Replace entire object, drop `overlayCaption` | `window.currentStorySession = session` (lines 7227, 7332, 9371) | ⚠️ **MEDIUM** (mitigated by `preserveCaptionOverrides`, but no session ID check) |
| **Style Bleed Across Sessions** | Old session style applied to new session | `preserveCaptionOverrides` doesn't check `session.id` | ⚠️ **MEDIUM** (only affects if user creates new session while old session has style) |
| **Dangerous Fields in Preview Meta** | `mode: 'raster'`, `lines`, `rasterUrl` exist in preview responses | `normalizedMeta` contains all fields (`caption-preview.js:625`) | ✅ **LOW** (not persisted to session currently) |
| **Render Branch: Raster Mode** | If `mode: 'raster'` persisted without `rasterUrl`, render fails | `ffmpeg.video.js:981` throws error if `rasterUrl` missing | 🔴 **HIGH** (if we persist `mode` accidentally) |
| **Render Branch: Pre-Wrapped Lines** | If `lines` persisted, render reuses one beat's wrap for all beats | `story.service.js:825` short-circuits SSOT wrapper | 🔴 **HIGH** (if we persist `lines` accidentally) |
| **Preview Payload Gating** | Style keys missing when `explicitStyle` is empty | `buildBeatPreviewPayload` uses `hasOwnProperty` gating | ✅ **SAFE** (correct behavior - server defaults apply) |

---

## C) Updated Plan Adjustments

### C1. What is Currently Correct / Safe Already?

✅ **Preview payload gating**: `buildBeatPreviewPayload` correctly gates style keys using `hasOwnProperty`. Empty `explicitStyle` → server defaults apply (matches render).

✅ **Render consumption**: Render correctly reads `session.overlayCaption || session.captionStyle` and passes to ASS builder. No changes needed.

✅ **Dangerous fields isolation**: Preview meta with dangerous fields (`mode`, `lines`, `rasterUrl`) is stored in window globals/localStorage, NOT in session. No risk of accidental persistence.

✅ **Session write pattern**: All `saveStorySession` calls use "load → modify → save" (merge-friendly). If `overlayCaption` exists in loaded session, it's preserved.

✅ **Import paths**: All dynamic imports use correct relative paths. No regressions expected.

### C2. Minimal Missing Capability

**Required**: Add route `POST /api/story/update-caption-style` that:
1. Accepts style-only fields (whitelist validation)
2. Loads session, merges style into `session.overlayCaption`, saves
3. Returns updated session

**Client wiring**: Add "Apply Caption Settings" button that:
1. Extracts style-only fields from UI controls
2. POSTs to `/api/story/update-caption-style`
3. Updates `window.currentStorySession.overlayCaption` (optimistic update)
4. Refreshes beat previews

**Session overwrite fix**: Update `preserveCaptionOverrides` to check `session.id` before preserving.

### C3. Highest-Risk Clobber Points

1. **`updateStorySentences`** (`story.service.js:149-170`): Loads session, modifies `story.sentences`, saves. Does NOT preserve `overlayCaption` if it exists. **Risk**: If user edits script after setting caption style, style could be lost.

2. **Client session assignment** (`creative.html:7227, 7332, 9371`): Direct assignment replaces entire object. `preserveCaptionOverrides` called before assignment, but only preserves if server lacks `overlayCaption` (which it always does currently). **Risk**: If server response includes `overlayCaption` in future, client assignment could overwrite it.

3. **Style bleed** (`creative.html:7106-7124`): `preserveCaptionOverrides` doesn't check `session.id`. **Risk**: If user creates new session while old session has style, style could bleed into new session.

### C4. Required Guardrails

**Guardrail 1: Style-Only Schema** (MUST HAVE):
- Whitelist validation before saving: Only allow `fontFamily`, `fontPx`, `weightCss`, `fontStyle`, `letterSpacingPx`, `lineSpacingPx`, `color`, `opacity`, `strokePx`, `strokeColor`, `shadowBlur`, `shadowOffsetX`, `shadowOffsetY`, `shadowColor`, `placement`, `yPct`, `xPct`, `wPct`
- Explicitly REJECT: `mode`, `lines`, `rasterUrl`, `rasterHash`, `rasterW`, `rasterH`, `yPx_png`, `totalTextH`, `yPxFirstLine`, `rasterPadding`, `xExpr_png`, `xPx_png`, `frameW`, `frameH`, `bgScaleExpr`, `bgCropExpr`, `previewFontString`, `previewFontHash`, `ssotVersion`, `text`

**Guardrail 2: Session ID Check** (MUST HAVE):
- `preserveCaptionOverrides` must check `nextSession.id === prevSession?.id` before preserving
- OR: Only preserve from UI state (explicit user action), not from previous session

**Guardrail 3: Render Guard Log** (SHOULD HAVE):
- Add log in render pipeline (`story.service.js:810`) that warns if dangerous fields present in `overlayCaption`
- Helps catch accidental persistence during development

**Guardrail 4: Client-Side Extraction** (MUST HAVE):
- Client must extract style-only fields before POSTing to `/api/story/update-caption-style`
- Use helper function `extractStyleOnly(obj)` that whitelists allowed fields

### C5. Test Checklist

**Manual Tests**:

1. **Style Persistence**:
   - Set caption style (font: bold, size: 48px) → Click "Apply" → Verify `session.overlayCaption` saved to session doc
   - Reload page → Verify style restored from session
   - Edit beat → Verify preview uses saved style (check `[beat-preview] explicitStyle keys` log)

2. **Style-Only Validation**:
   - Try to save `{ mode: 'raster', fontPx: 48 }` → Verify `mode` stripped, only `fontPx` saved
   - Try to save `{ lines: ['test'], fontPx: 48 }` → Verify `lines` stripped, only `fontPx` saved

3. **Session ID Guard**:
   - Set style in Session A → Create new Session B → Verify Session B does NOT have Session A's style

4. **Preview Payload**:
   - With saved style → Verify payload includes `fontPx`, `weightCss` (check `[beat-preview] payload style keys` log)
   - Without saved style → Verify payload omits style keys (server defaults apply)

5. **Render Pipeline**:
   - Set style → Render → Verify render uses SSOT wrapper (check `[render-wrap:ssot]` log)
   - Verify render uses ASS subtitles (check `[captions] strategy=ass` log)
   - Verify render does NOT use raster mode (check `[captions] strategy=raster` log - should NOT appear)

**Log-Based Checks**:

1. **Render Guard Log** (`story.service.js:810`):
   - If dangerous fields present → Should log warning: `[render-guard] Found dangerous fields in overlayCaption: mode, lines`

2. **Preview Payload Log** (`caption-preview.js:844`):
   - `[beat-preview] explicitStyle keys: ['fontPx', 'weightCss']` → Should match saved style
   - `[beat-preview] payload style keys: ['fontPx', 'weightCss']` → Should match explicitStyle

3. **Server Schema Log** (`caption.preview.routes.js:115-141`):
   - `[preview-style:effective] hasFontPxInPayload: true` → Should be true if style saved
   - `[preview-style:effective] hasFontPxInPayload: false` → Should be false if style not saved (server default applies)

4. **Render Wrap Log** (`story.service.js:865`):
   - `[render-wrap:ssot] { beatId: 0, linesCount: 3, ... }` → Should use SSOT wrapper (not pre-wrapped lines)

5. **Render Strategy Log** (`ffmpeg.video.js:617`):
   - `[captions] strategy=ass reason="assPath exists"` → Should use ASS subtitles (not raster mode)

---

## D) Verification Checklist

### D1. Pre-Implementation Verification

- [ ] Confirm `session.overlayCaption` is never written to session (current state)
- [ ] Confirm preview meta (`savedMeta`) contains dangerous fields but is NOT persisted to session
- [ ] Confirm render branches (`mode === 'raster'`, `lines` check) are safe if `overlayCaption` is style-only
- [ ] Confirm preview payload gating works correctly (empty `explicitStyle` → server defaults)

### D2. Post-Implementation Verification

- [ ] Style-only schema validation rejects dangerous fields
- [ ] Session ID guard prevents style bleed across sessions
- [ ] Render guard log warns if dangerous fields present
- [ ] Preview payload includes style keys when style saved
- [ ] Render uses SSOT wrapper (not pre-wrapped lines)
- [ ] Render uses ASS subtitles (not raster mode)
- [ ] Karaoke highlighting works with custom styles

### D3. Regression Tests

- [ ] Beat previews still work (no import path regressions)
- [ ] Render still works (no pipeline breakage)
- [ ] Session overwrite doesn't drop `overlayCaption` (if it exists)
- [ ] Preview parity maintained (preview matches render)

---

## Summary

**Current State**: `session.overlayCaption` is read at render time but never saved. Preview meta with dangerous fields exists in window globals/localStorage but is NOT persisted to session.

**Required Changes**: Add route to save style-only `overlayCaption`, fix session overwrite to preserve style, add session ID guard to prevent style bleed.

**Critical Guardrails**: Style-only schema validation, session ID check in `preserveCaptionOverrides`, render guard log.

**Risk Level**: **MEDIUM** (mitigated by guardrails). Main risks are accidental persistence of dangerous fields and style bleed across sessions.
