# SSOT v3 Fix Summary

**Issue**: Client sends `ssotVersion: 3` but render fails with "Invalid ssotVersion, expected 3, got: 2"

**Root Cause**: Server sanitization was removing `ssotVersion` from request, causing v3 to fall back to v2 path.

## Fixes Applied

### 1. Server Sanitization Fix (`src/routes/caption.preview.routes.js`)

**Problem**: 
```javascript
const COMPUTED_FIELDS = [
  "lineSpacingPx", "totalTextH", "totalTextHPx", "yPxFirstLine", "lineHeight",
  "hpct", "hPct", "hPx", "v2", "ssotVersion", "splitLines", "baselines"  // ❌ ssotVersion was here
];
```

**Fix**:
```javascript
const COMPUTED_FIELDS = [
  "lineSpacingPx", "totalTextH", "totalTextHPx", "yPxFirstLine", "lineHeight",
  "hpct", "hPct", "hPx", "v2", "splitLines", "baselines"  // ✅ ssotVersion removed
];
```

**Reasoning**: `ssotVersion` is an **input field** that tells the server which version to use, not a computed field that should be stripped.

### 2. Improved Logging (`src/routes/caption.preview.routes.js`)

**Before**:
```javascript
console.log('[caption-preview] Using V2 OVERLAY path');
```

**After**:
```javascript
const isV3Raster = req.body.ssotVersion === 3;
console.log('[caption-preview] Using', isV3Raster ? 'V3 RASTER' : 'V2 OVERLAY', 'path');
```

**Benefit**: Clear distinction between v2 and v3 paths in logs.

### 3. Client Payload Cleanup (`public/js/caption-preview.js`)

**Problem**: Client was sending both `ssotVersion: 3` AND `v2: true`, which was confusing.

**Before**:
```javascript
{
  ssotVersion: 3,
  // ... other fields ...
  v2: true,  // ❌ Confusing - v3 shouldn't have v2 flag
}
```

**After**:
```javascript
{
  ssotVersion: 3,
  // ... other fields ...
  // ✅ v2: true removed
}
```

## Expected Flow After Fix

### 1. Client Request
```javascript
// Client sends clean v3 payload
{
  ssotVersion: 3,
  text: "Create a\nmotivational\nquote about\nsuccess",
  placement: 'custom',
  xPct: 0.022193287478552925,
  yPct: 0.1,
  // ... other fields
}
```

### 2. Server Processing
```bash
# Server logs should show:
[caption-preview] Using V3 RASTER path  # ✅ Not V2 anymore
# No more: [caption-preview-sanitize] Removing computed field from request: ssotVersion=3
```

### 3. Server Response
```javascript
{
  ok: true,
  data: {
    imageUrl: "data:image/png;base64,...",  // Preview for display
    meta: {
      ssotVersion: 3,           // ✅ Present
      mode: 'raster',           // ✅ Present
      rasterUrl: "data:image/png;base64,...",  // ✅ PNG for render
      rasterW: 440,
      rasterH: 292,
      yPx: 72,
      // ... other fields
    }
  }
}
```

### 4. Client Storage
```javascript
// Client stores verbatim (no modifications)
localStorage.setItem('overlayMeta', JSON.stringify(meta));
```

### 5. Render Request
```javascript
// Client sends exact same meta to render endpoint
{
  ssotVersion: 3,        // ✅ Present
  mode: 'raster',        // ✅ Present
  rasterUrl: "...",      // ✅ Present
  // ... all other fields
}
```

### 6. Render Processing
```bash
# FFmpeg logs should show:
[overlay] USING RASTER MODE - PNG overlay from preview
[raster] Materialized PNG overlay: /tmp/vaiform-abc123.png
[raster] overlay filter: [vmain][ovr]overlay=(W-overlay_w)/2:72:format=auto[vout]
```

## Test Instructions

1. **Clear localStorage**:
   ```javascript
   localStorage.clear();
   ```

2. **Generate Preview**:
   - Enter caption text with 2+ lines
   - Set yPct=0.1 (top position)
   - Save preview

3. **Check Logs**:
   ```bash
   # Should see:
   [caption-preview] Using V3 RASTER path
   [raster] Drew caption PNG: { rasterW: ..., rasterH: ..., yPx: ... }
   # Should NOT see:
   [caption-preview-sanitize] Removing computed field from request: ssotVersion=3
   ```

4. **Render Video**:
   - Click render button
   - Should NOT see "Preview data is outdated (wrong version)" alert

5. **Verify FFmpeg**:
   ```bash
   # Should see raster overlay, not drawtext:
   [raster] overlay filter: [vmain][ovr]overlay=...
   # Should NOT see:
   drawtext=fontfile=...
   ```

## Files Modified

1. ✅ `src/routes/caption.preview.routes.js` - Fixed sanitization and logging
2. ✅ `public/js/caption-preview.js` - Removed confusing v2 flag

## Status

✅ **Ready for testing** - The core pipeline issue has been fixed.

**Next Steps**:
1. Test the preview generation
2. Verify client receives correct v3 meta
3. Test render with v3 raster overlay
4. Confirm no more "Invalid ssotVersion" errors
