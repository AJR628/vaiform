# Minimal Fix Plan for Preview↔Render Parity

**Based on**: `CAPTION_PREVIEW_RENDER_PARITY_AUDIT.md`  
**Priority**: Fix #1 (server rewrap) → Fix #2 (font weight) → Add instrumentation

---

## Fix #1: Server Recomputes Geometry on Rewrap (CRITICAL)

### Problem
When server rewraps lines (e.g., 8 → 2), it uses server-wrapped lines for drawing but echoes client's `rasterH`/`yPx_png`/`totalTextH` (computed for 8 lines). This causes vertical drift.

### Solution
When `needsRewrap === true`, server must recompute dependent geometry from server-wrapped lines.

### Changes Required

**File**: `src/routes/caption.preview.routes.js`

**Location 1**: Inside `renderCaptionRaster()` function, after line 1200 (after rewrap logic)

```javascript
  // Server-side rewrap if client lines overflow or have broken words
  if (needsRewrap) {
    console.log('[parity:server-rewrap] Client lines overflow or broken words detected, rewrapping with server font');
    serverWrappedLines = wrapLinesWithFont(text, maxLineWidth, tempCtx, letterSpacingPx);
    console.log('[parity:server-rewrap]', {
      oldLines: lines.length,
      newLines: serverWrappedLines.length,
      maxLineWidth: Math.round(maxLineWidth)
    });
    
    // ✅ FIX: Recompute geometry from server-wrapped lines
    const serverTotalTextH = serverWrappedLines.length * fontPx + (serverWrappedLines.length - 1) * lineSpacingPx;
    
    // Recompute rasterH using same logic as client (server-side equivalent)
    const cssPaddingTop = meta.padTop || meta.rasterPadding || 24;
    const cssPaddingBottom = meta.padBottom || meta.rasterPadding || 24;
    const shadowBlur = meta.shadowBlur || 12;
    const shadowOffsetY = meta.shadowOffsetY || 2;
    
    // Server-side computeRasterH equivalent
    const serverRasterH = Math.round(
      serverTotalTextH + 
      cssPaddingTop + 
      cssPaddingBottom + 
      Math.max(0, shadowBlur * 2) + 
      Math.max(0, shadowOffsetY)
    );
    
    // Recompute yPx_png from yPct (if available) or keep client value
    let serverYPx_png = meta.yPx_png;
    if (Number.isFinite(meta.yPct)) {
      const targetTop = (meta.yPct * meta.frameH) - (serverTotalTextH / 2);
      const safeTopMargin = Math.max(50, meta.frameH * 0.05);
      const safeBottomMargin = meta.frameH * 0.08;
      serverYPx_png = Math.round(Math.max(safeTopMargin, Math.min(targetTop, meta.frameH - safeBottomMargin - serverTotalTextH)));
    }
    
    console.log('[parity:server-rewrap:geometry]', {
      oldRasterH: meta.rasterH,
      newRasterH: serverRasterH,
      oldTotalTextH: meta.totalTextH,
      newTotalTextH: serverTotalTextH,
      oldYPx_png: meta.yPx_png,
      newYPx_png: serverYPx_png
    });
    
    // Override meta with server-computed values
    meta.rasterH = serverRasterH;
    meta.totalTextH = serverTotalTextH;
    meta.yPx_png = serverYPx_png;
    // Use server-wrapped lines for drawing (already set above)
  }
```

**Location 2**: After line 275 (in response building), use server-wrapped lines if rewrap occurred

```javascript
    // ✅ FIX: Return server-wrapped lines if rewrap occurred
    const finalLines = needsRewrap ? serverWrappedLines : lines;
    
    const ssotMeta = {
      // ... existing fields ...
      lines: finalLines,  // ✅ Use server-wrapped lines, not client lines
      rasterW: data.rasterW,  // Keep client rasterW (width doesn't change on rewrap)
      rasterH: meta.rasterH,  // ✅ Use recomputed rasterH if rewrap occurred
      yPx_png: meta.yPx_png,  // ✅ Use recomputed yPx_png if rewrap occurred
      totalTextH: meta.totalTextH,  // ✅ Use recomputed totalTextH if rewrap occurred
      // ... rest of fields ...
    };
```

**Note**: `needsRewrap` and `serverWrappedLines` are computed inside `renderCaptionRaster()`, so we need to return them or pass them back. Current code structure requires refactoring `renderCaptionRaster()` to return rewrap info.

**Alternative (Simpler)**: Pass rewrap info via return value:

```javascript
// In renderCaptionRaster(), return:
return {
  rasterUrl: rasterDataUrl,
  rasterW,
  rasterH: meta.rasterH,  // May be recomputed if rewrap
  yPx: meta.yPx_png,     // May be recomputed if rewrap
  padding,
  previewFontString,
  previewFontHash,
  // ✅ NEW: Return rewrap info
  rewrapped: needsRewrap,
  serverLines: serverWrappedLines,
  serverTotalTextH: meta.totalTextH,
  serverRasterH: meta.rasterH,
  serverYPx_png: meta.yPx_png
};
```

Then in route handler (line 231):
```javascript
const rasterResult = await renderCaptionRaster({...});

// ✅ FIX: Use server-computed values if rewrap occurred
const finalLines = rasterResult.rewrapped ? rasterResult.serverLines : lines;
const finalRasterH = rasterResult.rewrapped ? rasterResult.serverRasterH : data.rasterH;
const finalTotalTextH = rasterResult.rewrapped ? rasterResult.serverTotalTextH : totalTextH;
const finalYPx_png = rasterResult.rewrapped ? rasterResult.serverYPx_png : data.yPx_png;

const ssotMeta = {
  // ... existing fields ...
  lines: finalLines,
  rasterH: finalRasterH,
  totalTextH: finalTotalTextH,
  yPx_png: finalYPx_png,
  // ... rest of fields ...
};
```

### Testing
1. Send preview request with text that will overflow (long single line)
2. Verify server logs show `rewrapped: true` and geometry recomputed
3. Verify response `lines` count matches server-wrapped count
4. Verify preview position doesn't drift upward

---

## Fix #2: Align Font Weight Defaults (HIGH PRIORITY)

### Problem
Default `weightCss` differs: client `'bold'`, server `'700'`, render `'normal'`.

### Solution
Use single SSOT default: `'700'` (matches server).

### Changes Required

**File 1**: `public/js/caption-preview.js`  
**Location**: Line 324

```javascript
        weightCss: opts.weight || overlayMeta?.weightCss || '700',  // ✅ Changed from 'normal' to '700'
```

**File 2**: `src/render/overlay.helpers.js`  
**Location**: Line 421

```javascript
    weightCss = '700',  // ✅ Changed from 'normal' to '700'
```

### Testing
1. Generate preview with missing `weightCss` in style object
2. Verify preview and render both use `'700'` (check logs)
3. Verify visual appearance matches

---

## Fix #3: Return yPct in Server Response (OPTIONAL)

### Problem
Server doesn't return `yPct` in V3 raster response, but client CSS needs it for center-anchored positioning.

### Solution
Add `yPct` to server response meta.

### Changes Required

**File**: `src/routes/caption.preview.routes.js`  
**Location**: Line 259 (in `ssotMeta` building)

```javascript
    const ssotMeta = {
      // ... existing fields ...
      yPct: data.yPct ?? ((data.yPx_png + data.rasterH / 2) / data.frameH),  // ✅ Add yPct (center-anchored)
      // ... rest of fields ...
    };
```

### Testing
1. Generate preview
2. Verify response includes `meta.yPct`
3. Verify client CSS uses it correctly (no center derivation needed)

---

## Implementation Order

1. **Phase 1**: Apply Fix #1 (server rewrap) - **CRITICAL**
   - Effort: Medium (requires refactoring `renderCaptionRaster()` return value)
   - Risk: Medium (touches core rendering logic)
   - Impact: Fixes vertical drift

2. **Phase 2**: Apply Fix #2 (font weight defaults) - **HIGH**
   - Effort: Low (2-line change)
   - Risk: Low (simple default change)
   - Impact: Fixes font weight mismatch

3. **Phase 3**: Add debug instrumentation (from `DEBUG_INSTRUMENTATION_PATCH.md`) - **MEDIUM**
   - Effort: Low (3 log statements)
   - Risk: None (debug-only)
   - Impact: Enables verification

4. **Phase 4**: Apply Fix #3 (return yPct) - **OPTIONAL**
   - Effort: Low (1-line change)
   - Risk: Low (additive only)
   - Impact: Simplifies client CSS positioning

---

## Rollback Plan

If Fix #1 causes issues:

1. **Option A**: Revert to rejecting client lines that overflow (return 400 error)
2. **Option B**: Disable server rewrap entirely (trust client lines always)
3. **Option C**: Keep current behavior but add warning log when rewrap occurs

---

## Success Criteria

After all fixes:

1. ✅ Preview position stable (no upward drift as text length increases)
2. ✅ Preview and render font weight match (both use '700' default)
3. ✅ Server logs show geometry recomputed when rewrap occurs
4. ✅ Debug logs show matching `linesCount`/`rasterH`/`yPx_png` across client/server/render

---

**End of Minimal Fix Plan**

