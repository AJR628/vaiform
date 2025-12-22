# Beat Preview Meta Storage Audit Report

## A) Why the Console Test Failed

### Assumed Global Key

The console test attempted to access:
```javascript
const meta = window.__lastBeatPreviewMeta?.['0'];
```

### Evidence: Key Does Not Exist

**Search Results**:
- `grep "__lastBeatPreviewMeta"` → **No matches found**
- `grep "beatPreviewMeta"` → **No matches found**

**Conclusion**: `window.__lastBeatPreviewMeta` is **never created or assigned** anywhere in the codebase. The test assumed a global storage pattern that does not exist.

### Why It Worked Before

The test may have been based on a similar pattern used for caption overlay preview (non-beat preview), which does use global storage:
- `window.__lastCaptionPreview` (line 140, 146, 161, 185, 591)
- `window._overlayMeta` (line 585, 588, 944, 961, 1177)

However, **beat preview uses a different pattern** and does not expose meta globally.

---

## B) Where Meta Exists and Where It's Discarded

### Data Flow Trace

#### Step 1: Meta Creation

**File**: `public/js/caption-preview.js:800-804`

**Location**: `generateBeatCaptionPreview()` function

```javascript
const result = {
  beatId,
  meta: data.data.meta,  // ← Meta comes from server response
  rasterUrl: data.data.meta.rasterUrl
};
```

**Source**: Server response from `/api/caption/preview` endpoint (`data.data.meta`)

**Lifetime**: Local variable `result` within function scope

---

#### Step 2: Meta Caching

**File**: `public/js/caption-preview.js:807`

**Location**: `generateBeatCaptionPreview()` function

```javascript
setCachedBeatPreview(style, text, result);
```

**Cache Structure** (line 659-683):
```javascript
const beatPreviewCache = new Map(); // hash(style+text) -> { meta, rasterUrl, timestamp }

function setCachedBeatPreview(style, text, result) {
  const key = hashStyleAndText(style, text);  // Key = JSON.stringify(style) + "|" + text
  beatPreviewCache.set(key, {
    ...result,  // ← Includes meta
    timestamp: Date.now()
  });
}
```

**Key Insight**: Cache is keyed by `hash(style+text)`, **NOT by beatId**. To retrieve meta from cache, you need:
1. The exact style object (same keys, same values)
2. The exact text string
3. Call `getCachedBeatPreview(style, text)` to get the cached result (which includes meta)

**Lifetime**: Persists in module-level Map until 60-second TTL expires

---

#### Step 3: Meta Passed to Debounced Function

**File**: `public/js/caption-preview.js:851`

**Location**: `generateBeatCaptionPreviewDebounced()` setTimeout callback

```javascript
const timer = setTimeout(async () => {
  const result = await generateBeatCaptionPreview(id, text, style);  // ← result includes meta
  // ...
  if (result && result.rasterUrl) {
    // ...
    applyPreviewResultToBeatCard(beatCardEl, result);  // ← result passed here
  }
}, delay);
```

**Lifetime**: Local variable `result` within setTimeout callback scope

---

#### Step 4: Meta Used in DOM Application

**File**: `public/js/caption-preview.js:914-922`

**Location**: `applyPreviewResultToBeatCard()` function

```javascript
export function applyPreviewResultToBeatCard(beatCardEl, result) {
  // ...
  const meta = result.meta;  // ← Meta extracted from result
  // Prefer server meta.yPct if present, else derive from yPx_png/frameH
  const yPct = Number.isFinite(meta.yPct) ? meta.yPct : (meta.yPx_png / meta.frameH);
  const rasterWRatio = meta.rasterW / meta.frameW;
  const rasterHRatio = meta.rasterH / meta.frameH;
  
  overlayImg.style.setProperty('--y-pct', yPct);
  overlayImg.style.setProperty('--raster-w-ratio', rasterWRatio);
  overlayImg.style.setProperty('--raster-h-ratio', rasterHRatio);
  
  overlayImg.src = result.rasterUrl;
  overlayImg.style.display = 'block';
  // ← meta is discarded here (local variable, not stored)
}
```

**Lifetime**: Local variable `meta` within function scope, **discarded after CSS variables are set**

**Persistence**: Only CSS custom properties (`--y-pct`, `--raster-w-ratio`, `--raster-h-ratio`) persist on the DOM element

---

### Summary: Meta Lifecycle

| Stage | Location | Storage | Key | Lifetime |
|-------|----------|---------|-----|----------|
| Created | `generateBeatCaptionPreview()` line 800-804 | `result.meta` (local) | N/A | Function scope |
| Cached | `setCachedBeatPreview()` line 807 | `beatPreviewCache` Map | `hash(style+text)` | 60 seconds TTL |
| Passed | `generateBeatCaptionPreviewDebounced()` line 851 | `result` (local) | N/A | setTimeout callback scope |
| Applied | `applyPreviewResultToBeatCard()` line 914 | `meta` (local) | N/A | Function scope |
| Persisted | DOM element | CSS custom properties | N/A | Until DOM element removed |

**Key Finding**: Meta is **NOT stored globally by beatId**. It exists only as:
1. Local variables during function execution
2. Module-level cache (keyed by style+text hash, not beatId)
3. CSS custom properties on DOM element (derived values, not raw meta)

---

## C) yPct Calculation and Potential Drift

### Current Implementation

**File**: `public/js/caption-preview.js:915-916`

```javascript
// Prefer server meta.yPct if present, else derive from yPx_png/frameH
const yPct = Number.isFinite(meta.yPct) ? meta.yPct : (meta.yPx_png / meta.frameH);
```

### Anchor Point Analysis

**Two Possible Sources**:
1. **`meta.yPct`**: If server provides this, it's used directly
2. **`meta.yPx_png / meta.frameH`**: Derived fallback if `meta.yPct` is missing/invalid

**Potential Drift Concern**: 
- If server provides `yPct` (percentage, 0.0-1.0), it represents a **normalized position**
- If derived from `yPx_png / frameH`, it assumes `yPx_png` is the **top of the PNG raster** (not baseline, not center)
- **Anchor mismatch** could occur if:
  - Server `yPct` represents center of text box
  - But `yPx_png` represents top of PNG
  - Division gives incorrect normalized position

**Current Evidence**:
- Console test shows `--y-pct: 0.246875`
- This suggests `meta.yPct` may not be present (or is 0.246875 from server)
- If derived, this would mean `yPx_png ≈ 474px` (0.246875 * 1920)

**Recommendation**: Verify what `meta.yPct` contains vs `meta.yPx_png` in server response to confirm anchor point consistency.

---

## D) Recommended Debug-Only Exposure

### Pattern: Store Last Meta by BeatId (Debug Only)

**File**: `public/js/caption-preview.js`

**Location**: Add after `applyPreviewResultToBeatCard()` function (after line 933)

**Change**: Add debug-only global storage that mirrors the pattern used for caption overlay preview:

```javascript
export function applyPreviewResultToBeatCard(beatCardEl, result) {
  // ... existing code ...
  
  if (window.__beatPreviewDebug) {
    console.log('[beat-preview] Overlay applied:', {
      identifier: beatCardEl.getAttribute('data-beat-id') || beatCardEl.getAttribute('data-sentence-index'),
      rasterUrl: result.rasterUrl.substring(0, 50) + '...'
    });
    
    // Store meta globally for debugging (only if debug flag enabled)
    if (!window.__lastBeatPreviewMeta) {
      window.__lastBeatPreviewMeta = {};
    }
    const identifier = beatCardEl.getAttribute('data-beat-id') || beatCardEl.getAttribute('data-sentence-index');
    if (identifier) {
      window.__lastBeatPreviewMeta[identifier] = result.meta;
    }
  }
}
```

### Alternative: Store in Module-Level Map (Exposed via Debug)

**Option**: Store in module-level Map and expose getter function:

```javascript
// At module level (after line 661)
const beatPreviewMetaStore = new Map(); // beatId -> meta (debug only)

// In applyPreviewResultToBeatCard() (after line 933)
if (window.__beatPreviewDebug && result.meta) {
  const identifier = beatCardEl.getAttribute('data-beat-id') || beatCardEl.getAttribute('data-sentence-index');
  if (identifier) {
    beatPreviewMetaStore.set(identifier, result.meta);
  }
}

// Export getter (at end of file, with other exports)
if (window.__beatPreviewDebug) {
  window.getBeatPreviewMeta = (beatId) => beatPreviewMetaStore.get(String(beatId));
}
```

### Recommendation: Use Window Pattern (Simpler)

**Reason**: 
- Matches existing pattern (`window.__lastCaptionPreview`)
- Simpler to access from console: `window.__lastBeatPreviewMeta['0']`
- No need for getter function
- Only created when debug flag is enabled

**Minimal Diff**:

```javascript
// In applyPreviewResultToBeatCard(), add after line 933 (inside existing debug block):
if (window.__beatPreviewDebug) {
  console.log('[beat-preview] Overlay applied:', {
    identifier: beatCardEl.getAttribute('data-beat-id') || beatCardEl.getAttribute('data-sentence-index'),
    rasterUrl: result.rasterUrl.substring(0, 50) + '...'
  });
  
  // Store meta for debugging
  if (!window.__lastBeatPreviewMeta) {
    window.__lastBeatPreviewMeta = {};
  }
  const identifier = beatCardEl.getAttribute('data-beat-id') || beatCardEl.getAttribute('data-sentence-index');
  if (identifier && result.meta) {
    window.__lastBeatPreviewMeta[identifier] = result.meta;
  }
}
```

**Impact**: 
- Zero behavior changes (only runs when `window.__beatPreviewDebug === true`)
- Minimal code addition (5 lines)
- Enables console debugging: `window.__lastBeatPreviewMeta['0']`

---

## E) Summary

### Why Test Failed
- `window.__lastBeatPreviewMeta` does not exist (never created)
- No global storage of meta by beatId currently exists

### Where Meta Lives
1. **Temporary**: Local variables during function execution
2. **Cache**: Module-level Map keyed by `hash(style+text)` (not beatId)
3. **DOM**: CSS custom properties (`--y-pct`, etc.) - derived values only

### Access Methods (Current)
1. **From cache**: Call `getCachedBeatPreview(style, text)` (requires exact style+text)
2. **From DOM**: Read CSS custom properties from `.beat-caption-overlay` element
3. **From server**: Make new request to `/api/caption/preview`

### Recommended Debug Exposure
- Store `result.meta` in `window.__lastBeatPreviewMeta[beatId]` when `window.__beatPreviewDebug === true`
- Minimal 5-line addition in `applyPreviewResultToBeatCard()`
- Enables console access: `window.__lastBeatPreviewMeta['0']`

