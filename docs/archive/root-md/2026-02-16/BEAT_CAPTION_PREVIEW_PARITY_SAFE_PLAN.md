# Beat Caption Preview - Parity-Safe Implementation Plan

## A) Pipeline Safety Assessment

### What Could Break

1. **Existing caption overlay preview fails** if `emitCaptionState()` behavior changes
   - **Prevention**: Extract helper via copy/paste (no logic changes), then refactor `emitCaptionState()` to call helper
   - **Safety**: Golden-master comparison function verifies parity before proceeding

2. **Server rejects preview requests** if `yPxFirstLine` computation is wrong
   - **Prevention**: Use confirmed server formula: `yPxFirstLine = yPx_png + rasterPadding` (from server line 151 fallback and line 1254 usage)
   - **Safety**: Server fallback still works if client sends wrong value, but we compute correctly

3. **Geometry drift** if beat measurement uses different math than overlay
   - **Prevention**: Beat measurement reuses exact same helper (`computeCaptionMetaFromElements`) with same DOM structure
   - **Safety**: Offscreen DOM matches live overlay CSS classes and structure

4. **Performance regression** from beat preview generation
   - **Prevention**: Debounce, AbortController cancellation, cache by hash(style+text), MAX_BEATS cap
   - **Safety**: Feature flag (default false) allows quick disable

### Truth Verification Summary

**Server Truth** (verified in `src/routes/caption.preview.routes.js`):
- Line 151: `yPxFirstLine = data.yPxFirstLine || (yPx_png + rasterPadding)` (fallback formula)
- Line 1254: `yPx = meta.yPxFirstLine - padding` (usage confirms relationship)
- Lines 115-117: Server trusts client values (no recomputation in V3 raster mode)
- Schema (lines 38-54): Requires `rasterW`, `rasterH`, `yPx_png`, `lines`, `totalTextH`, `yPxFirstLine`

**Client Truth** (verified in `public/js/caption-overlay.js`):
- `emitCaptionState()` (line 1203) computes: `lines`, `totalTextH`, `rasterW`, `rasterH`, `rasterPadding`, `yPct`, `yPx_png`, `previewFontString`
- Line 1344: `yPx_png = Math.round(yPct * frameH)` (box top, not baseline)
- Missing: `yPxFirstLine` computation (currently not in overlayMeta)
- `caption-preview.js` line 303: Uses fallback `overlayMeta.yPxFirstLine || (overlayMeta.yPx_png + overlayMeta.rasterPadding)`

---

## B) Minimal Diff Plan

### Files Changed

1. **`public/js/caption-overlay.js`**
   - Add `computeCaptionMetaFromElements()` helper (extracted from `emitCaptionState()`)
   - Add `yPxFirstLine = yPx_png + rasterPadding` computation in helper
   - Refactor `emitCaptionState()` to call helper (preserve existing behavior)
   - Add `compareMetaParity()` dev helper for golden-master test
   - Add `measureBeatCaptionGeometry()` for beat previews (after parity passes)

2. **`public/js/caption-preview.js`**
   - Add `__parityAudit` logging flag (conditional logs before/after POST)
   - Remove `yPxFirstLine` fallback (line 303), use `overlayMeta.yPxFirstLine` directly (helper now computes it)

3. **`public/creative.html`** (Phase 2 only, after parity passes)
   - Add beat preview manager (cache, debounce, AbortController)
   - Wire hooks: `commitBeatTextEdit()`, `renderDraftStoryboard()`, `renderStoryboard()`, clip swap handlers
   - Add overlay DOM/CSS for beat cards
   - Feature flag: `BEAT_PREVIEW_ENABLED` (default false)

### Exact Functions Touched

**`public/js/caption-overlay.js`**:
- `computeCaptionMetaFromElements({ stageEl, boxEl, contentEl, frameW, frameH })` - NEW (extracted from `emitCaptionState()`)
- `emitCaptionState(reason)` - REFACTOR (call helper instead of duplicate logic)
- `compareMetaParity()` - NEW (dev helper)
- `measureBeatCaptionGeometry(text, style)` - NEW (Phase 2, after parity)

**`public/js/caption-preview.js`**:
- `generateCaptionPreview(opts)` - MINOR (remove `yPxFirstLine` fallback, add audit logs)

---

## C) Step-by-Step Test Checklist

### Phase 1: Parity Refactor (Commit 1)

```bash
# 1. Start dev server
npm run dev

# 2. Open browser to creative.html, open DevTools console

# 3. Enable audit logging
window.__parityAudit = true;

# 4. Trigger existing caption preview flow
#    - Edit caption text in overlay
#    - Adjust font size/slider
#    - Verify console logs show:
#      - [__parityAudit] payload: {...}
#      - [__parityAudit] response: {...}
#      - All numeric fields are finite

# 5. Run golden-master comparison
compareMetaParity()
# Expected: console.log('[parity-check] ✅ MATCH - all fields identical')
# Required: Must return TRUE before proceeding

# 6. Verify existing overlay preview still works
#    - Caption appears correctly positioned
#    - Preview PNG matches overlay visually
#    - No console errors

# 7. Verify server accepts preview requests
#    - Check Network tab: POST /api/caption/preview returns 200
#    - Response meta includes all required fields

# 8. Check yPxFirstLine is computed (not fallback)
#    - In console: window.__overlayMeta.yPxFirstLine
#    - Should be: yPx_png + rasterPadding (verify numerically)

# 9. Test edge cases
#    - Empty text (should skip gracefully)
#    - Very long text (wraps correctly)
#    - Extreme font sizes (clamped correctly)
```

### Phase 2: Beat Preview Wiring (Commit 2, only after Phase 1 passes)

```bash
# 1. Enable feature flag
window.BEAT_PREVIEW_ENABLED = true;

# 2. Test draft mode
#    - Create/edit draft storyboard
#    - Edit beat text
#    - Verify preview PNG appears on beat card after 300ms debounce
#    - Verify preview positioned correctly (scaled ratios)

# 3. Test session mode
#    - Load existing session
#    - Edit beat text via API
#    - Verify preview regenerates

# 4. Test cancellation
#    - Rapidly edit beat text multiple times
#    - Verify only latest preview loads (AbortController working)

# 5. Test cache
#    - Edit beat text, then revert to previous text
#    - Verify preview loads instantly from cache

# 6. Test failure handling
#    - Disconnect network
#    - Edit beat text
#    - Verify graceful degradation (no UI blocking, console.warn only)

# 7. Test MAX_BEATS cap
#    - Create storyboard with 8 beats
#    - Verify previews generate for all beats (not skipped)
```

---

## D) Implementation Sequence

### Commit 1: Parity Refactor + Golden-Master + Audit Logs

**Files**: `public/js/caption-overlay.js`, `public/js/caption-preview.js`

**Changes**:
1. Extract `computeCaptionMetaFromElements()` from `emitCaptionState()` (copy/paste, no logic changes)
2. Add `yPxFirstLine = yPx_png + rasterPadding` computation in helper
3. Refactor `emitCaptionState()` to call helper (preserve mode selection, caching, window.__overlayMeta assignment)
4. Add `compareMetaParity()` dev helper
5. Remove `yPxFirstLine` fallback from `caption-preview.js` (use `overlayMeta.yPxFirstLine` directly)
6. Add `__parityAudit` conditional logging in `caption-preview.js`

**Test Gate**: `compareMetaParity()` must return `true` before proceeding

---

### Commit 2: Beat Preview Wiring (after parity gate is green)

**Files**: `public/js/caption-overlay.js`, `public/js/caption-preview.js`, `public/creative.html`

**Changes**:
1. Add `measureBeatCaptionGeometry(text, style)` - offscreen DOM measurement (reuses `computeCaptionMetaFromElements`)
2. Add beat preview manager (cache Map, AbortController Map, debounce timers Map)
3. Add payload builder helper (reuses existing logic from `generateCaptionPreview`)
4. Wire hooks: `commitBeatTextEdit()`, `renderDraftStoryboard()`, `renderStoryboard()`, clip swap handlers
5. Add overlay DOM/CSS for beat cards (normalized ratios: `--y-pct`, `--raster-w-ratio`, `--raster-h-ratio`)
6. Feature flag: `BEAT_PREVIEW_ENABLED` (default false)

**Dependencies**: Commit 1 must pass parity test

---

## E) Key Implementation Details

### computeCaptionMetaFromElements() Signature

```javascript
export function computeCaptionMetaFromElements({ stageEl, boxEl, contentEl, frameW = 1080, frameH = 1920 }) {
  // Copy/paste exact logic from emitCaptionState() lines 1203-1447
  // ONLY addition: compute yPxFirstLine = yPx_png + rasterPadding
  // Returns: overlayMeta object with all SSOT fields including yPxFirstLine
}
```

### measureBeatCaptionGeometry() Approach

- Build offscreen DOM with same classes (`.caption-box`, `.content`)
- Set box position from `style.yPct` BEFORE calling helper (so helper derives correct `yPct` from DOM)
- Call `computeCaptionMetaFromElements()` with offscreen elements
- Do NOT override `meta.yPct` or `meta.yPx_png` after compute
- Cleanup in `finally` block

### Beat Overlay CSS Positioning

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

**CSS variables**:
- `--y-pct`: `meta.yPx_png / meta.frameH` (normalized Y)
- `--raster-w-ratio`: `meta.rasterW / meta.frameW` (normalized width)
- `--raster-h-ratio`: `meta.rasterH / meta.frameH` (normalized height)

