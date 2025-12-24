# Beat Preview Boot Audit Report - First Edit Flakiness

## Problem Statement

Beat caption previews do not appear on first edit after hard refresh. After running the diagnostic script in console, editing works correctly. This indicates a **boot/initialization issue** rather than a core functionality problem.

---

## Evidence Analysis

### Diagnostic Script Results (Working After Script)

**Script Actions**:
1. Sets `window.BEAT_PREVIEW_ENABLED = true`
2. Sets `window.__beatPreviewDebug = true`
3. Imports module: `await import('./js/caption-preview.js')`
4. Tests all functions → all pass
5. Manual generate + apply → works

**After Script, Edit Works**:
- `[beat-preview] Debounce triggered: {identifier: '0', textLength: 19}`
- `[beat-preview] Card found: {identifier: '0', found: true}`
- `[beat-preview] Overlay applied: {identifier: '0', rasterUrl: 'data:image/png;base64...'}`

**Conclusion**: All core functionality works. The script's primary action that makes it work is **enabling the feature flag**.

---

## Pipeline Audit

### Step 1: Boot Initialization

**Location**: `public/creative.html:6540-6548`

**Current Code**:
```javascript
// Feature flag (default false)
if (typeof window.BEAT_PREVIEW_ENABLED === 'undefined') {
    window.BEAT_PREVIEW_ENABLED = false;  // ❌ DISABLED BY DEFAULT
}

// Preload caption-preview module at boot (deterministic init)
window.__beatPreviewModulePromise = import('./js/caption-preview.js')
    .then(m => (window.__beatPreviewModule = m, m))
    .catch(err => (console.warn('[beat-preview] Module load failed:', err), null));
```

**Analysis**:
- ✅ Module preload is implemented correctly
- ❌ **Feature flag defaults to `false`** - this is the PRIMARY BLOCKER
- Module will load but all code paths check the flag first and exit early if disabled

### Step 2: Edit Handler (Draft Mode)

**Location**: `public/creative.html:7238-7252`

**Current Code**:
```javascript
if (window.BEAT_PREVIEW_ENABLED) {  // ❌ FALSE BY DEFAULT - EXITS HERE
    const style = window.draftStoryboard?.captionStyle || {...};
    const m = window.__beatPreviewModule || await window.__beatPreviewModulePromise;
    if (m) {
        m.generateBeatCaptionPreviewDebounced(identifier, newText, style);
    }
}
```

**Analysis**:
- ✅ Module access pattern is correct (preloaded module + fallback to promise)
- ❌ **Blocked by feature flag check** - returns early if flag is false
- No other issues identified

### Step 3: Edit Handler (Session Mode)

**Location**: `public/creative.html:7297-7314`

**Current Code**:
```javascript
if (window.BEAT_PREVIEW_ENABLED) {  // ❌ FALSE BY DEFAULT - EXITS HERE
    const style = window.currentStorySession.overlayCaption || {...};
    requestAnimationFrame(async () => {
        const m = window.__beatPreviewModule || await window.__beatPreviewModulePromise;
        if (m) {
            m.generateBeatCaptionPreviewDebounced(identifier, newText, style);
        }
    });
}
```

**Analysis**:
- ✅ DOM timing handled with `requestAnimationFrame` (correct)
- ✅ Module access pattern is correct
- ❌ **Blocked by feature flag check** - returns early if flag is false

### Step 4: Debounced Function

**Location**: `public/js/caption-preview.js:832-874`

**Current Code**:
```javascript
export function generateBeatCaptionPreviewDebounced(beatId, text, style, delay = 300) {
  if (!window.BEAT_PREVIEW_ENABLED) {  // ❌ SECONDARY CHECK - ALSO BLOCKS
    return;
  }
  
  const id = String(beatId);  // ✅ Normalized
  // ... rest of function
}
```

**Analysis**:
- ✅ Identifier normalization implemented (line 838)
- ✅ Debounce logic correct
- ✅ Card finding logic correct (tries both selectors)
- ❌ **Also checks feature flag** - redundant but correct

### Step 5: Generate Function

**Location**: `public/js/caption-preview.js:751-823`

**Current Code**:
```javascript
export async function generateBeatCaptionPreview(beatId, text, style) {
  if (!window.BEAT_PREVIEW_ENABLED) {  // ❌ TERTIARY CHECK - ALSO BLOCKS
    return null;
  }
  // ... rest of function
}
```

**Analysis**:
- ✅ Feature flag check present (defensive programming)
- ✅ All other logic appears correct

---

## Root Cause Analysis

### Primary Blocker: Feature Flag Disabled by Default

**Issue**: `window.BEAT_PREVIEW_ENABLED` defaults to `false` at boot (line 6542).

**Evidence**:
1. Diagnostic script sets flag to `true` → preview works
2. Flag defaults to `false` → preview blocked at multiple checkpoints
3. All code paths have early returns when flag is false

**Impact**: 
- Edit handlers exit immediately (lines 7239, 7298)
- Debounced function exits immediately (line 833)
- Generate function exits immediately (line 753)

**Fix**: Change default from `false` to `true` OR remove the default initialization (allow undefined to be truthy, but this is less safe).

### Secondary Checks (Redundant but Safe)

All three layers check the flag:
1. Edit handler (draft/session mode)
2. `generateBeatCaptionPreviewDebounced()`
3. `generateBeatCaptionPreview()`

This is defensive programming and acceptable. The issue is only that the default value blocks execution.

---

## Additional Observations

### ✅ What's Working Correctly

1. **Module preload**: Implemented correctly, loads at boot
2. **Module access pattern**: Uses preloaded module with promise fallback
3. **DOM timing**: `requestAnimationFrame` used correctly in session mode
4. **Identifier normalization**: Implemented in debounced function
5. **Card finding**: Tries both selector patterns (draft/session)
6. **Debug logging**: Works when flag is enabled

### ⚠️ Potential Edge Cases (Not Blocking)

1. **Identifier type consistency**: 
   - `generateBeatCaptionPreviewDebounced` normalizes `beatId` to `id` (string)
   - Calls `generateBeatCaptionPreview(id, ...)` with normalized id
   - But `generateBeatCaptionPreview` uses `beatId` directly in `beatPreviewControllers.get(beatId)`
   - **Impact**: Low risk - debounced function normalizes before calling, so should be consistent

2. **Module load failure**:
   - Preload promise catches errors and returns `null`
   - Edit handlers check `if (m)` before calling
   - **Impact**: Safe - graceful degradation

---

## Minimal Fix Plan

### Change Required

**File**: `public/creative.html`

**Location**: Line 6542

**Change**: Set default feature flag to `true` instead of `false`

**Before**:
```javascript
if (typeof window.BEAT_PREVIEW_ENABLED === 'undefined') {
    window.BEAT_PREVIEW_ENABLED = false;
}
```

**After**:
```javascript
if (typeof window.BEAT_PREVIEW_ENABLED === 'undefined') {
    window.BEAT_PREVIEW_ENABLED = true;  // Enable by default
}
```

**Rationale**: 
- Feature is ready for production use
- All core functionality is working (verified by diagnostic)
- Defaulting to enabled matches user expectation
- Can still be disabled via console: `window.BEAT_PREVIEW_ENABLED = false;`

---

## Testing Checklist

After fix:

1. **Hard refresh** → verify no console errors
2. **First edit** (draft mode) → preview appears within 300ms debounce
3. **First edit** (session mode) → preview appears after DOM update + debounce
4. **Verify logs** (if debug enabled):
   - `[beat-preview] Debounce triggered`
   - `[beat-preview] Card found`
   - `[beat-preview] Overlay applied`
5. **No console scripts required** → works on first edit immediately

---

## Alternative: Configurable Default

If we want to keep it disabled by default but make it easier to enable:

**Option A**: Check URL parameter
```javascript
if (typeof window.BEAT_PREVIEW_ENABLED === 'undefined') {
    const urlParams = new URLSearchParams(window.location.search);
    window.BEAT_PREVIEW_ENABLED = urlParams.has('beatPreview') || false;
}
```

**Option B**: Check localStorage
```javascript
if (typeof window.BEAT_PREVIEW_ENABLED === 'undefined') {
    const stored = localStorage.getItem('beatPreviewEnabled');
    window.BEAT_PREVIEW_ENABLED = stored === 'true' || false;
}
```

**Recommendation**: Use simple `true` default (main fix) since feature is working and ready.

---

## Summary

**Root Cause**: Feature flag defaults to `false`, blocking all preview generation paths.

**Fix**: Change default to `true` in boot initialization (1 line change).

**Complexity**: Trivial - single line edit.

**Risk**: Low - all functionality already tested and working when flag is enabled.

**Reversibility**: Easy - can revert default back to `false` if needed.

