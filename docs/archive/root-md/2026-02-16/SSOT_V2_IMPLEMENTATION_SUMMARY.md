# SSOT V2 Implementation Summary

## Overview
Fixed preview↔render mismatches by implementing Single Source of Truth (SSOT) version 2 for caption overlays.

## Changes Made

### 1. Client: `public/js/caption-preview.js`
**Changes:**
- Set `ssotVersion: 2` as first field in all payloads
- Ensure `splitLines` is always included from server response
- Normalize metadata with all required SSOT fields
- Store complete SSOT v2 meta to localStorage

**Key fields saved:**
```javascript
{
  ssotVersion: 2,
  text, xPct, yPct, wPct,
  fontPx, lineSpacingPx,
  fontFamily, weightCss, color, opacity,
  placement, internalPadding,
  splitLines,          // Array of pre-wrapped lines
  totalTextH,          // Total text block height
  totalTextHPx,        // Alias for compatibility
  yPxFirstLine         // Exact Y position of first line
}
```

### 2. Server Preview: `src/routes/caption.preview.routes.js`
**Changes:**
- Always recompute metrics from `meta.sizePx` (ignore client's stale values)
- Return full SSOT v2 bundle with `ssotVersion: 2`
- Include all style fields: `fontFamily`, `weightCss`, `color`, `opacity`
- Compute `lineSpacingPx` using fixed 1.15 multiplier
- Calculate `yPxFirstLine` as block-center with safe margin clamping

**Formula:**
```javascript
const lineHeight = Math.round(fontPx * 1.15);
const lineSpacingPx = lines.length === 1 ? 0 : Math.round(lineHeight - fontPx);
const totalTextH = lines.length * lineHeight;
const yPxFirstLine = Math.round(anchorY - (totalTextH / 2));  // clamped to safe margins
```

### 3. Render Selection: `src/render/overlay.helpers.js`
**Changes:**
- Check for `ssotVersion === 2` AND all required fields
- Force SSOT path when `v2Ready && hasSplitLines`
- Return `willUseSSOT: true` flag in placement result
- Use exact `yPxFirstLine` from preview (no recomputation)
- Set `xExpr: '(W - text_w)/2'` for proper centering

**Required fields for V2:**
```javascript
['xPct', 'yPct', 'wPct', 'fontPx', 'lineSpacingPx', 'totalTextH', 'yPxFirstLine']
// AND splitLines array with length > 0
```

**V2 result structure:**
```javascript
{
  mode: 'ssot',
  willUseSSOT: true,
  xPct, yPct, wPct,
  fontPx, lineSpacingPx,
  splitLines,
  totalTextH,
  y: yPxFirstLine,  // Exact Y from preview
  xExpr: '(W - text_w)/2'  // Center without ad-hoc constants
}
```

### 4. FFmpeg Render: `src/utils/ffmpeg.video.js`
**Changes:**
- Detect `useSSOT = placement?.willUseSSOT === true`
- When SSOT mode: skip all sanity checks, use values verbatim
- Use `splitLines.join('\n')` when available (no rewrapping!)
- Center X with `(W - text_w)/2` instead of `24 + (1039 - text_w)/2`
- All variables that need reassignment use `let` (not `const`)

**SSOT text handling:**
```javascript
if (useSSOT && splitLines && splitLines.length > 0) {
  textToRender = splitLines.join('\n');  // No rewrap!
  console.log(`[render] Using SSOT splitLines: ${splitLines.length} lines`);
}
```

**Sanity checks ONLY for non-SSOT:**
```javascript
if (useSSOT) {
  console.log('[ffmpeg] Using SSOT values verbatim (no sanity corrections)');
} else {
  // Apply fallback sanity checks...
}
```

### 5. Normalize Function: `src/render/overlay.helpers.js`
**Changes:**
- Pass through `ssotVersion` field
- Detect V2 with `overlay?.ssotVersion === 2`
- Include all SSOT fields when present

## Expected Log Output

### Preview Generation
```
[caption-preview-input] meta.sizePx: 56, incoming lineSpacingPx: ..., lines.length: 2
[caption-preview-calc] fontPx: 56, lineHeight: 64, totalTextH: 128, lineSpacingPx: 8
[caption-preview] SSOT meta: {"ssotVersion":2,"text":"...","xPct":0.5,"yPct":0.1,...,"splitLines":["line1","line2"],"fontPx":56,"lineSpacingPx":8,"totalTextH":128,"yPxFirstLine":128}
```

### Render with SSOT
```
[overlay] SSOT field detection: {ssotVersion:2, hasV2:true, v2Ready:true, hasSplitLines:true, willUseSSOT:true}
[overlay] USING SAVED PREVIEW - SSOT mode, no recompute
[render] SSOT placement computed: {useSSOT:true, willUseSSOT:true, mode:'ssot', fontPx:56, lineSpacingPx:8, totalTextH:128, computedY:128, xExpr:'(W - text_w)/2', splitLines:2}
[ffmpeg] Pre-drawtext SSOT: {useSSOT:true, willUseSSOT:true, fontPx:56, lineSpacingPx:8, totalTextH:128, y:128, splitLines:2}
[ffmpeg] Using SSOT values verbatim (no sanity corrections)
[render] Using SSOT splitLines: 2 lines
[ffmpeg] USING VALUES: {useSSOT:true, willUseSSOT:true, fontPx:56, y:128, lineSpacingPx:8, xExpr:'(W - text_w)/2', splitLines:2, lines:2}
```

### ❌ Old behavior (rejected):
```
[overlay] Ignoring saved preview with old/missing ssotVersion: undefined
willUseSSOT: false  ← Falls back, computes new positioning
splitLines: undefined  ← FFmpeg rewraps text
x=24 + (1039 - text_w)/2  ← Ad-hoc centering
```

## Acceptance Criteria

✅ **No "Ignoring saved preview" warnings** when ssotVersion=2 present  
✅ **willUseSSOT: true** in logs  
✅ **splitLines** array with correct count in all logs  
✅ **Pre-drawtext SSOT** shows computed values (fontPx~56, lineSpacingPx~8)  
✅ **Final filter** uses `x=(W - text_w)/2`, `y=~128` for yPct=0.1  
✅ **Output video** matches preview positioning exactly (no top-runoff, correct spacing)

## Testing Commands

```bash
# 1. Clear any stale localStorage
# In browser console: localStorage.clear()

# 2. Generate preview with custom text
# Navigate to creative.html, enter text, adjust position slider to 10% from top

# 3. Save and render
# Click "Save Preview", then "Finalize Video"

# 4. Check server logs for:
grep "SSOT" server.log
grep "willUseSSOT" server.log
grep "splitLines" server.log

# 5. Verify no warnings:
! grep "Ignoring saved preview" server.log
```

## Formula Reference

**Line spacing (1.15 line height):**
```
lineHeight = round(fontPx * 1.15)
lineSpacingPx = lineHeight - fontPx
```

**Example for fontPx=56:**
```
lineHeight = round(56 * 1.15) = 64
lineSpacingPx = 64 - 56 = 8
totalTextH (2 lines) = 2 * 64 = 128
```

**Y positioning (center at yPct=0.1 = 192px on 1920px canvas):**
```
anchorY = 0.1 * 1920 = 192
yPxFirstLine = anchorY - (totalTextH / 2) = 192 - 64 = 128
```

## Files Modified
1. `public/js/caption-preview.js` - Client saves SSOT v2
2. `src/routes/caption.preview.routes.js` - Server returns SSOT v2
3. `src/render/overlay.helpers.js` - SSOT path selection and normalize
4. `src/utils/ffmpeg.video.js` - FFmpeg uses SSOT values

## Breaking Changes
None. Legacy overlays without ssotVersion will continue to work with fallback computation.

## Migration Path
1. Deploy server changes (backward compatible)
2. Clear client localStorage to break stale data loop
3. Generate new previews (automatically get ssotVersion=2)
4. Renders will automatically use SSOT path when available

