# Caption Preview Investigation Report

## Executive Summary

Investigation of Vaiform's Creative Studio caption preview pipeline reveals **multiple root causes** for the black preview screen and non-functional caption controls. The primary issue is a **canvas sizing race condition** combined with **state synchronization problems** between UI controls and the caption rendering system.

## Root Causes Identified

### 1. Canvas Sizing Race Condition ✅ CONFIRMED
**Evidence**: Console logs show `[preview-init] Canvas sized immediately: {cssW: 0, cssH: 0, dpr: 1.5, canvasw: 0, canvasH: 0}`

**Problem**: Canvas is initialized with zero dimensions before CSS layout completes, causing:
- `[caption-overlay] Canvas not ready, scheduling retry...`
- `[caption-overlay] Canvas still not ready after retry, skipping overlay`
- Black preview until layout stabilizes (1-2 minutes)

**Location**: `public/creative.html:1693-1706` in `sizeCanvasToCSS()` function

### 2. State Synchronization Issues ✅ CONFIRMED  
**Evidence**: Console shows different `top` values in positioning calculations, indicating inconsistent state

**Problem**: UI controls (placement, weight, opacity) update local state but don't properly sync with the caption generation pipeline:
- Placement changes don't affect `yPct` calculation
- Font weight/opacity changes don't reach the server payload
- Size slider changes are overwritten by server meta

**Location**: `public/creative.html:2816-2850` in control event handlers

### 3. Server-Client Meta Mismatch ✅ CONFIRMED
**Evidence**: Server logs show proper meta generation, but client positioning calculations show inconsistencies

**Problem**: Server returns correct meta (fontPx, yPct, placement) but client overlay positioning uses different calculations, leading to:
- Caption appears in wrong position
- Controls don't visually affect caption
- Multiple positioning calculations conflict

**Location**: `public/js/caption-preview.js:195-280` in `createCaptionOverlay()`

## Specific Issues Found

### Canvas Ready Check Logic
```javascript
// Current problematic logic in updateCaptionOverlay()
if (!canvas || canvas.clientWidth === 0 || canvas.clientHeight === 0) {
    // Single retry with requestAnimationFrame
    // Fails if layout hasn't completed
}
```

### Control State Disconnect
```javascript
// Controls update local state but don't sync with captionStyle
document.getElementById('caption-placement').onchange = () => {
    // Updates UI but captionStyle.placement may not be used
    updateCaptionOverlay(text, true);
};
```

### Positioning Calculation Conflicts
```javascript
// Multiple positioning calculations in createCaptionOverlay()
const targetTop = (yPct * finalH) - (scaledTotalTextH / 2);
// vs
const finalScaledTextH = scaledTotalTextH * finalScale;
// vs  
top = Math.max(safeTopMargin, Math.min(targetTop, finalH - safeBottomMargin - finalScaledTextH));
```

## Low-Risk Fixes (≤20 LOC each)

### Fix 1: Robust Canvas Ready Check
**File**: `public/creative.html:957-1007`
```javascript
// Replace single retry with proper wait
async function waitForCanvasReady(canvas, maxRetries = 5) {
    for (let i = 0; i < maxRetries; i++) {
        if (canvas && canvas.clientWidth > 0 && canvas.clientHeight > 0) {
            return true;
        }
        await new Promise(r => requestAnimationFrame(r));
    }
    return false;
}
```

### Fix 2: Control State Synchronization  
**File**: `public/creative.html:2816-2850`
```javascript
// Ensure controls update captionStyle before generation
document.getElementById('caption-placement').onchange = () => {
    const newPlacement = document.getElementById('caption-placement').value;
    captionStyle.placement = newPlacement; // Sync to captionStyle
    updateCaptionOverlay((currentQuote?.text||'').trim(), true);
};
```

### Fix 3: Two-RAF Deferral for Zero-Size Containers
**File**: `public/creative.html:947-955`
```javascript
// Add two-RAF deferral before first measure/draw
if (container.clientWidth === 0 || container.clientHeight === 0) {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
}
```

### Fix 4: Image Decode Wait
**File**: `public/creative.html:857-866`
```javascript
// Ensure image is fully decoded before draw
await img.decode().catch(() => new Promise(r => img.onload = r));
```

## Follow-up Refactor Ideas (Gated by SSOT Rules)

### 1. Unified State Management
- Create single `captionState` object that all controls modify
- Ensure server meta is the single source of truth for positioning
- Remove duplicate positioning calculations

### 2. Canvas Lifecycle Management
- Implement proper canvas ready state tracking
- Add canvas resize observer for dynamic layouts
- Centralize canvas dimension management

### 3. Control-Response Pipeline
- Standardize control change → state update → preview generation flow
- Add validation for control values before server requests
- Implement proper debouncing for rapid control changes

## Test Steps for Verification

1. **Canvas Ready Test**: Select image/video → check console for `[preview-init]` logs → verify canvas dimensions > 0
2. **Control Response Test**: Change placement → check `[controls]` logs → verify `[caption-overlay]` payload includes new placement
3. **Font Application Test**: Change weight/opacity → check `[apply-font]` logs → verify server receives correct values
4. **Positioning Test**: Change placement → check `[preview-overlay] positioning` logs → verify `top` values change consistently

## Success Criteria

- ✅ No "Canvas not ready" messages after initial load
- ✅ Control changes log `[controls]` and `[apply-font]` messages  
- ✅ Caption appears in correct position matching placement setting
- ✅ Font weight/opacity changes are visually applied
- ✅ Size slider effects match `fontPx` values in server meta

## Next Steps

1. Apply low-risk fixes in order (Canvas Ready → Control Sync → Deferral → Image Decode)
2. Test each fix individually with console monitoring
3. Verify all success criteria are met
4. Document any remaining issues for follow-up refactoring

---
*Investigation completed with instrumentation added to track canvas sizing, asset loading, control changes, and positioning calculations.*
