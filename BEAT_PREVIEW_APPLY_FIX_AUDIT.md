# Beat Preview Apply Fix - Audit Report & Implementation Plan

## A) Audit Results

### A1. Server Response Meta - yPct Presence

**Location**: `src/routes/caption.preview.routes.js:259-308` (V3 raster mode response)

**Finding**: ❌ **yPct is NOT present in server meta response**

The `ssotMeta` object returned in V3 raster mode includes:
- `rasterW`, `rasterH`, `rasterPadding`, `yPx_png` (geometry)
- `frameW`, `frameH` (frame dimensions)
- Typography, color, effects fields
- **Missing**: `yPct` (not echoed back from request)

**Evidence**:
- Line 205: Server receives `yPct: data.yPct` but comment says "Not used in raster, but pass for consistency"
- Line 259-308: `ssotMeta` object does NOT include `yPct` field
- Line 360-369: Response returns `meta: ssotMeta` without `yPct`

**Conclusion**: Client must derive `yPct` from `yPx_png / frameH` (current implementation is correct).

### A2. CSS Variables Used by .beat-caption-overlay

**Location**: `public/creative.html:289-298` (CSS definition)

**CSS Variables Required**:
```css
.beat-caption-overlay {
    position: absolute;
    left: 50%;
    top: calc(var(--y-pct) * 100%);
    width: calc(var(--raster-w-ratio) * 100%);
    height: calc(var(--raster-h-ratio) * 100%);
    transform: translateX(-50%) translateY(-50%);
    pointer-events: none;
    z-index: 10;
    object-fit: contain;
}
```

**Variables Set** (current implementation, line 6505-6507):
- `--y-pct`: `meta.yPx_png / meta.frameH` (normalized Y position, 0.0-1.0)
- `--raster-w-ratio`: `meta.rasterW / meta.frameW` (normalized width, 0.0-1.0)
- `--raster-h-ratio`: `meta.rasterH / meta.frameH` (normalized height, 0.0-1.0)

**Conclusion**: Current CSS variable names and calculation are correct. No changes needed.

### A3. DOM Insertion Logic in BeatPreviewManager.applyPreview()

**Location**: `public/creative.html:6485-6497`

**Exact Implementation**:
```javascript
// Find or create overlay img element
let overlayImg = beatCardEl.querySelector('.beat-caption-overlay');
if (!overlayImg) {
    overlayImg = document.createElement('img');
    overlayImg.className = 'beat-caption-overlay';
    // Insert into video container (first .relative element)
    const videoContainer = beatCardEl.querySelector('.relative.w-full.h-40');
    if (videoContainer) {
        videoContainer.appendChild(overlayImg);
    } else {
        beatCardEl.appendChild(overlayImg);
    }
}
```

**DOM Structure Analysis**:
- **Draft mode** (line 6762): `<div class="relative w-full h-40 overflow-hidden">` contains `<video>`
- **Session mode** (line 6614): `<div class="relative w-full h-40 overflow-hidden">` contains `<video>`
- **Placeholder** (line 6586): `<div class="relative w-full h-40 bg-gray-800 flex items-center justify-center">` (no video)

**Selector Issue**: `.relative.w-full.h-40` is a Tailwind class selector that matches:
- Video container: `class="relative w-full h-40 overflow-hidden"`
- Placeholder container: `class="relative w-full h-40 bg-gray-800 flex items-center justify-center"`

**Better Selector**: Use a more specific selector or data attribute. However, since both containers have the same classes, the current selector works but is brittle.

**Recommendation**: Use `beatCardEl.querySelector('.relative.w-full.h-40')` as fallback, but prefer a more specific container if available. For now, reuse exact same logic to avoid breaking changes.

## B) Root Cause Confirmation

**Primary Issue**: `generateBeatCaptionPreviewDebounced()` generates preview but **never applies it to DOM**.

**Evidence**:
- `public/js/caption-preview.js:832-849`: Debounce function calls `generateBeatCaptionPreview()` and discards result
- `public/creative.html:7245,7302`: Edit handlers call debounced function but never call apply
- `public/creative.html:6476-6517`: `BeatPreviewManager.applyPreview()` exists but is only called from `applyAllPreviews()` after storyboard renders

**Secondary Issue**: No shared apply helper - logic is duplicated in `BeatPreviewManager.applyPreview()` only.

## C) Implementation Plan

### C1. Create Shared Apply Helper

**File**: `public/js/caption-preview.js`

**Function**: `applyPreviewResultToBeatCard(beatCardEl, result)`

**Logic** (extracted from `BeatPreviewManager.applyPreview()`, lines 6485-6511):
1. Find or create `.beat-caption-overlay` img element
2. Insert into `.relative.w-full.h-40` container (or beatCardEl as fallback)
3. Calculate CSS variables:
   - `--y-pct`: Prefer `meta.yPct` if present, else `meta.yPx_png / meta.frameH`
   - `--raster-w-ratio`: `meta.rasterW / meta.frameW`
   - `--raster-h-ratio`: `meta.rasterH / meta.frameH`
4. Set CSS variables on overlayImg
5. Set `overlayImg.src = result.rasterUrl`
6. Set `overlayImg.style.display = 'block'`

### C2. Update generateBeatCaptionPreviewDebounced()

**File**: `public/js/caption-preview.js:832-849`

**Change**: After `generateBeatCaptionPreview()` completes, find beatCardEl and call shared helper.

**Identifier Handling**:
- Draft mode: `identifier` is `beatId` (string) → selector: `[data-beat-id="${identifier}"]`
- Session mode: `identifier` is `sentenceIndex` (number) → selector: `[data-sentence-index="${identifier}"]`
- Try both selectors (same as `applyAllPreviews` does)

### C3. Update BeatPreviewManager.applyPreview()

**File**: `public/creative.html:6476-6517`

**Change**: Replace inline DOM manipulation with call to shared helper from `caption-preview.js`.

**Import**: `import { applyPreviewResultToBeatCard } from './js/caption-preview.js'`

### C4. Add Debug Logs

**Behind `window.__beatPreviewDebug` flag**:
1. In `generateBeatCaptionPreviewDebounced()`: Log "Debounce triggered" with identifier
2. In `applyPreviewResultToBeatCard()`: Log "Card found" or "Card not found" with identifier
3. In `applyPreviewResultToBeatCard()`: Log "Overlay inserted" with rasterUrl preview

## D) Exact File Edits

### File: `public/js/caption-preview.js`

#### Edit 1: Add shared apply helper (after `generateBeatCaptionPreviewDebounced`, before exports)

**Location**: After line 849, before any exports

```javascript
/**
 * Apply preview result to beat card DOM (shared SSOT logic)
 * Extracted from BeatPreviewManager.applyPreview() - single source of truth
 * 
 * @param {HTMLElement} beatCardEl - Beat card DOM element
 * @param {object} result - Preview result from generateBeatCaptionPreview
 * @returns {void}
 */
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
  // Prefer server meta.yPct if present, else derive from yPx_png/frameH
  const yPct = Number.isFinite(meta.yPct) ? meta.yPct : (meta.yPx_png / meta.frameH);
  const rasterWRatio = meta.rasterW / meta.frameW;
  const rasterHRatio = meta.rasterH / meta.frameH;
  
  overlayImg.style.setProperty('--y-pct', yPct);
  overlayImg.style.setProperty('--raster-w-ratio', rasterWRatio);
  overlayImg.style.setProperty('--raster-h-ratio', rasterHRatio);
  
  // Set image source
  overlayImg.src = result.rasterUrl;
  overlayImg.style.display = 'block';
  
  if (window.__beatPreviewDebug) {
    console.log('[beat-preview] Overlay inserted:', {
      identifier: beatCardEl.getAttribute('data-beat-id') || beatCardEl.getAttribute('data-sentence-index'),
      rasterUrl: result.rasterUrl.substring(0, 50) + '...'
    });
  }
}
```

#### Edit 2: Update generateBeatCaptionPreviewDebounced() (lines 832-849)

**Replace**:
```javascript
export function generateBeatCaptionPreviewDebounced(beatId, text, style, delay = 300) {
  if (!window.BEAT_PREVIEW_ENABLED) {
    return;
  }
  
  // Clear existing timer
  const existingTimer = beatPreviewDebounceTimers.get(beatId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  
  const timer = setTimeout(async () => {
    await generateBeatCaptionPreview(beatId, text, style);
    beatPreviewDebounceTimers.delete(beatId);
  }, delay);
  
  beatPreviewDebounceTimers.set(beatId, timer);
}
```

**With**:
```javascript
export function generateBeatCaptionPreviewDebounced(beatId, text, style, delay = 300) {
  if (!window.BEAT_PREVIEW_ENABLED) {
    return;
  }
  
  if (window.__beatPreviewDebug) {
    console.log('[beat-preview] Debounce triggered:', { beatId, textLength: text?.length || 0 });
  }
  
  // Clear existing timer
  const existingTimer = beatPreviewDebounceTimers.get(beatId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  
  const timer = setTimeout(async () => {
    const result = await generateBeatCaptionPreview(beatId, text, style);
    beatPreviewDebounceTimers.delete(beatId);
    
    // Apply preview to DOM (NEW)
    if (result && result.rasterUrl) {
      // Find beat card: try both selector patterns (draft vs session mode)
      const beatCardEl = document.querySelector(`[data-beat-id="${beatId}"]`) || 
                         document.querySelector(`[data-sentence-index="${beatId}"]`);
      
      if (beatCardEl) {
        if (window.__beatPreviewDebug) {
          console.log('[beat-preview] Card found:', { beatId, found: true });
        }
        applyPreviewResultToBeatCard(beatCardEl, result);
      } else {
        if (window.__beatPreviewDebug) {
          console.warn('[beat-preview] Card not found:', { beatId, found: false });
        }
      }
    }
  }, delay);
  
  beatPreviewDebounceTimers.set(beatId, timer);
}
```

### File: `public/creative.html`

#### Edit 3: Update BeatPreviewManager.applyPreview() (lines 6476-6517)

**Replace**:
```javascript
async applyPreview(beatCardEl, beatId, text, style) {
    if (!window.BEAT_PREVIEW_ENABLED) return;
    
    try {
        const { generateBeatCaptionPreview } = await import('./js/caption-preview.js');
        const result = await generateBeatCaptionPreview(beatId, text, style);
        
        if (!result || !result.rasterUrl) return;
        
        // Find or create overlay img element
        let overlayImg = beatCardEl.querySelector('.beat-caption-overlay');
        if (!overlayImg) {
            overlayImg = document.createElement('img');
            overlayImg.className = 'beat-caption-overlay';
            // Insert into video container (first .relative element)
            const videoContainer = beatCardEl.querySelector('.relative.w-full.h-40');
            if (videoContainer) {
                videoContainer.appendChild(overlayImg);
            } else {
                beatCardEl.appendChild(overlayImg);
            }
        }
        
        // Set CSS variables for positioning
        const meta = result.meta;
        const yPct = meta.yPx_png / meta.frameH;
        const rasterWRatio = meta.rasterW / meta.frameW;
        const rasterHRatio = meta.rasterH / meta.frameH;
        
        overlayImg.style.setProperty('--y-pct', yPct);
        overlayImg.style.setProperty('--raster-w-ratio', rasterWRatio);
        overlayImg.style.setProperty('--raster-h-ratio', rasterHRatio);
        
        // Set image source
        overlayImg.src = result.rasterUrl;
        overlayImg.style.display = 'block';
    } catch (err) {
        if (window.__parityAudit || window.__beatPreviewDebug) {
            console.warn('[beat-preview] Failed to apply preview:', err);
        }
        // Graceful degradation - don't block UI
    }
},
```

**With**:
```javascript
async applyPreview(beatCardEl, beatId, text, style) {
    if (!window.BEAT_PREVIEW_ENABLED) return;
    
    try {
        const { generateBeatCaptionPreview, applyPreviewResultToBeatCard } = await import('./js/caption-preview.js');
        const result = await generateBeatCaptionPreview(beatId, text, style);
        
        if (result && result.rasterUrl) {
            applyPreviewResultToBeatCard(beatCardEl, result);
        }
    } catch (err) {
        if (window.__parityAudit || window.__beatPreviewDebug) {
            console.warn('[beat-preview] Failed to apply preview:', err);
        }
        // Graceful degradation - don't block UI
    }
},
```

## E) Verification Checklist

1. **Enable feature flag**: `window.BEAT_PREVIEW_ENABLED = true;`
2. **Enable debug logs**: `window.__beatPreviewDebug = true;`
3. **Edit beat text in draft mode**:
   - Open DevTools console
   - Edit a beat's text (click text, type, press Enter)
   - Wait 300ms (debounce delay)
   - Verify console logs:
     - `[beat-preview] Debounce triggered: { beatId: "...", textLength: N }`
     - `[beat-preview] Card found: { beatId: "...", found: true }`
     - `[beat-preview] Overlay inserted: { identifier: "...", rasterUrl: "data:image/png;base64,..." }`
   - Verify Network tab: POST `/api/caption/preview` appears after 300ms
   - Verify DOM: `.beat-caption-overlay` img element appears on beat card
   - Verify CSS variables: Check overlayImg.style has `--y-pct`, `--raster-w-ratio`, `--raster-h-ratio`
4. **Edit beat text in session mode**:
   - Same steps as draft mode
   - Verify identifier is number (sentenceIndex)
   - Verify selector `[data-sentence-index="${identifier}"]` works
5. **Verify overlay positioning**:
   - Check overlay appears at correct Y position (matches caption style yPct)
   - Verify overlay scales proportionally with beat card
6. **Test rapid edits**:
   - Edit text multiple times quickly
   - Verify only latest preview appears (AbortController working)
   - Verify no duplicate overlays (querySelector finds existing)
7. **Test after storyboard render**:
   - Verify `applyAllPreviews()` still works (calls shared helper)
   - Verify previews appear on all beats after render

## F) Summary

**Root Cause**: Debounce function generates preview but never applies to DOM.

**Fix**: 
1. Extract DOM apply logic into shared helper `applyPreviewResultToBeatCard()`
2. Update debounce to find beatCardEl and call shared helper
3. Update `BeatPreviewManager.applyPreview()` to use shared helper (no duplication)

**SSOT Compliance**:
- ✅ Single apply implementation (no duplication)
- ✅ Prefers `meta.yPct` if present, falls back to `yPx_png / frameH`
- ✅ Reuses exact DOM insertion strategy from `BeatPreviewManager` (`.relative.w-full.h-40` selector)
- ✅ CSS variables match `.beat-caption-overlay` expectations

**Files Changed**:
1. `public/js/caption-preview.js` - Add shared helper, update debounce
2. `public/creative.html` - Update `BeatPreviewManager.applyPreview()` to use shared helper

**No Changes To**:
- Server code (`src/routes/caption.preview.routes.js`)
- CSS (`.beat-caption-overlay` styles)
- Edit handlers (already call debounce correctly)

