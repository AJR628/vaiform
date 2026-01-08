# Preview vs Render Parity Root Cause Analysis

## Problem Summary

**Preview** still uses old defaults (`fontPx: 48`, `weightCss: '700'`, `strokePx: 0`, `shadowBlur: 12`, etc.) while **Render** uses QMain defaults (`fontPx: 64`, `weightCss: 'normal'`, `strokePx: 3`, `shadowBlur: 0`, etc.).

**Log Evidence**:
- Preview: `[preview-style:effective] { fontPx: 48, weightCss: '700', strokePx: 0, shadowBlur: 12, ... }`
- Render: `[render-wrap:ssot] { fontPx: 64, weightCss: 'normal', ... }`

## Root Cause Chain

### 1. Session overlayCaption is Missing
**Logs show**:
```
[PROBE:SESSION_STRUCTURE] {
  hasSessionOverlayCaption: false,
  hasSessionCaptionStyle: false,
  overlayCaptionMode: null,
}
```

When `session.overlayCaption` is missing, the code paths diverge:

### 2. Render Path Uses QMain Defaults ✅
**Location**: `src/services/story.service.js:831-833`
```javascript
const fontPx = overlayCaption?.fontPx || overlayCaption?.sizePx || 64;  // ✅ Defaults to 64
const weightCss = overlayCaption?.weightCss || 'normal';  // ✅ Defaults to 'normal'
```

**Result**: Render correctly uses QMain defaults when `overlayCaption` is missing.

### 3. Preview Path Uses Client Hardcoded Defaults ❌
**Location**: `public/creative.html:6813-6821`
```javascript
const style = window.currentStorySession.overlayCaption || window.currentStorySession.captionStyle || {
    fontFamily: 'DejaVu Sans',
    weightCss: 'bold',  // ❌ Hardcoded 'bold'
    fontPx: 48,  // ❌ Hardcoded 48
    yPct: 0.5,
    wPct: 0.8,
    opacity: 1,
    color: '#FFFFFF'
};
```

**Then in `measureBeatCaptionGeometry`** (line 1761):
```javascript
const fontPx = style.fontPx ?? 48;  // ❌ Uses 48 if style doesn't have fontPx
font-weight: ${style.weightCss || 'bold'};  // ❌ Uses 'bold' if style doesn't have weightCss
```

**Then in `computeCaptionMetaFromElements`** (line 1423-1433):
```javascript
const fontPx = parseInt(cs.fontSize, 10);  // Reads 48 from DOM
const weightCss = (rawWeight === 'bold' || parseInt(rawWeight, 10) >= 600) ? '700' : '400';  // Gets '700'
```

**Then in `buildBeatPreviewPayload`** (line 711-762):
```javascript
function buildBeatPreviewPayload(text, overlayMeta) {
  return {
    ...
    fontPx: overlayMeta.fontPx,  // ❌ ALWAYS includes (48)
    weightCss: overlayMeta.weightCss,  // ❌ ALWAYS includes ('700')
    strokePx: overlayMeta.strokePx,  // ❌ ALWAYS includes (0)
    shadowBlur: overlayMeta.shadowBlur,  // ❌ ALWAYS includes (12)
    ...
  };
}
```

**Result**: Preview always sends hardcoded client defaults, server schema defaults never apply.

### 4. Main Preview Path Also Includes overlayMeta Styles
**Location**: `public/js/caption-preview.js:338-369`
The conditional payload building correctly omits fields if `undefined`, BUT `overlayMeta` always has values from DOM computed styles, so fields are never `undefined`.

## Solution

### Option A: Make Preview Use Server Defaults When overlayCaption Missing (RECOMMENDED)

**Strategy**: When `session.overlayCaption` is missing, preview should omit style fields from payload so server schema defaults apply (same as render).

**Changes Required**:

1. **Update `buildBeatPreviewPayload`** (`public/js/caption-preview.js:711-762`):
   - Change to conditional building: only include style fields if `overlayMeta` has them AND they were explicitly set by user (not just computed from DOM)
   - Problem: How to distinguish "user set" vs "computed from DOM"?
   - Solution: Only include style fields if `style` parameter has them explicitly set

2. **Update `measureBeatCaptionGeometry`** (`public/js/caption-overlay.js:1761-1764`):
   - Don't use fallbacks; use server defaults when `style` doesn't have field
   - BUT: We need DOM values for measurement/geometry calculation
   - Solution: Use server defaults for DOM construction, but mark fields as "computed" vs "user-set"

3. **Update `creative.html` style fallback** (`public/creative.html:6813-6821`):
   - Change hardcoded defaults to match server defaults:
     ```javascript
     const style = window.currentStorySession.overlayCaption || window.currentStorySession.captionStyle || {
         fontFamily: 'DejaVu Sans',
         weightCss: 'normal',  // ✅ Match server default
         fontPx: 64,  // ✅ Match server default
         yPct: 0.5,
         wPct: 0.8,
         opacity: 1,
         color: '#FFFFFF'
     };
     ```

### Option B: Make Render Use Same Defaults as Preview (NOT RECOMMENDED)

This would break karaoke appearance.

## Recommended Fix (Option A)

### Step 1: Update `creative.html` Style Fallback
When `session.overlayCaption` is missing, use server defaults instead of hardcoded client defaults.

### Step 2: Update `measureBeatCaptionGeometry` Fallbacks
Use server defaults when `style` parameter doesn't have field:
- `fontPx ?? 64` (not 48)
- `weightCss || 'normal'` (not 'bold')
- `strokePx ?? 3` (not 0)
- `shadowBlur ?? 0` (not 12)
- `shadowOffsetX ?? 1` (not 0)
- `shadowOffsetY ?? 1` (not 2)

### Step 3: Update `buildBeatPreviewPayload` to Conditionally Include Style Fields
Only include style fields if they were explicitly set by user (passed in `style` parameter), not just computed from DOM.

**Problem**: Currently `buildBeatPreviewPayload` doesn't receive `style` parameter, only `overlayMeta`.

**Solution**: Pass `style` parameter to `buildBeatPreviewPayload` and only include fields that exist in `style`.

### Step 4: Verify Render Path Also Uses Server Defaults
Render path already uses server defaults (64, 'normal') when `overlayCaption` is missing - this is correct and should remain.

## Implementation Approach

**Simplest fix**: Update `creative.html` and `measureBeatCaptionGeometry` to use server defaults, then update `buildBeatPreviewPayload` to conditionally include style fields based on what was passed in `style` parameter.

**Key Insight**: We need to track which fields were explicitly set by user vs computed from DOM. The `style` parameter passed to `generateBeatCaptionPreview` is the source of truth for "user set" fields.

## Verification

After fix:
- Preview logs should show: `[preview-style:effective] { fontPx: 64, weightCss: 'normal', strokePx: 3, shadowBlur: 0, shadowOffsetX: 1, shadowOffsetY: 1, ... }`
- Render logs should show: `[render-wrap:ssot] { fontPx: 64, weightCss: 'normal', ... }`
- Visual comparison: Preview and render should match (weight, size, outline, shadow)

