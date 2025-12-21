# Beat Preview Apply Fix - Complete Plan

## Root Cause

**Primary Issue**: `generateBeatCaptionPreviewDebounced()` generates the preview but **never applies it to the DOM**. The result is discarded.

**Evidence**:
- `public/js/caption-preview.js:832-849`: Debounce function calls `generateBeatCaptionPreview()` and discards result
- `public/creative.html:7245,7302`: Edit handlers call debounced function but never call apply
- `public/creative.html:6476-6517`: `BeatPreviewManager.applyPreview()` exists but is only called from `applyAllPreviews()` after storyboard renders

## Audit Findings

### A1. Server Response Meta - yPct Presence

**Location**: `src/routes/caption.preview.routes.js:259-308` (V3 raster mode response)

**Finding**: ❌ **yPct is NOT present in server meta response**

The `ssotMeta` object returned in V3 raster mode does NOT include `yPct`. Client must derive `yPct` from `yPx_png / frameH` (current implementation is correct).

**Conclusion**: Prefer `meta.yPct` if present (for future compatibility), else derive from `yPx_png / frameH`.

### A2. CSS Variables Used by .beat-caption-overlay

**Location**: `public/creative.html:289-298`

**Required Variables**:
- `--y-pct`: Normalized Y position (0.0-1.0)
- `--raster-w-ratio`: Normalized width (0.0-1.0)
- `--raster-h-ratio`: Normalized height (0.0-1.0)

**Current Calculation** (line 6501-6503): `yPct = meta.yPx_png / meta.frameH` (correct fallback)

### A3. DOM Insertion Logic

**Location**: `public/creative.html:6491-6496`

**Exact Selector**: `.relative.w-full.h-40` (matches video container in both draft and session modes)

**Strategy**: Insert into video container if found, else append to beatCardEl.

## Implementation Plan

### File: `public/js/caption-preview.js`

#### Edit 1: Add shared apply helper `applyPreviewResultToBeatCard()` 

**Location**: After line 849, before exports

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

#### Edit 2: Update `generateBeatCaptionPreviewDebounced()` (lines 832-849)

**Replace entire function**:
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

#### Edit 3: Update `BeatPreviewManager.applyPreview()` (lines 6476-6517)

**Replace entire method**:
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

## Verification Checklist

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

## Summary

**Root Cause**: Debounce function generates preview but never applies to DOM.

**Fix**: 
1. Extract DOM apply logic into shared helper `applyPreviewResultToBeatCard()` (exported)
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

