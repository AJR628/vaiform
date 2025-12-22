# Debug Instrumentation Patch (No Behavior Change)

**Purpose**: Add structured debug logging to track preview↔render parity  
**Guard**: Only logs when debug flags enabled  
**Files**: 3 locations (client + server + render)

---

## Patch 1: Client Request Log (Before POST)

**File**: `public/js/caption-preview.js`  
**Location**: After line 787 (after `buildBeatPreviewPayload`, before `apiFetch`)

```javascript
    // Build payload using helper
    const payload = buildBeatPreviewPayload(text, overlayMeta);
    
    // DEBUG ONLY: Structured parity log before POST
    if (window.__beatPreviewDebug || window.__parityAudit) {
      console.log('[PARITY:CLIENT:REQUEST]', JSON.stringify({
        textLen: text?.length || 0,
        linesCount: payload.lines?.length || 0,
        rasterW: payload.rasterW,
        rasterH: payload.rasterH,
        yPct: payload.yPct,
        yPx_png: payload.yPx_png,
        fontPx: payload.fontPx,
        weightCss: payload.weightCss,
        previewFontString: payload.previewFontString,
        totalTextH: payload.totalTextH,
        timestamp: Date.now()
      }));
    }
    
    // Call preview endpoint (using already-imported apiFetch from line 7)
    const data = await apiFetch('/caption/preview', {
```

---

## Patch 2: Server Response Log (Before Response)

**File**: `src/routes/caption.preview.routes.js`  
**Location**: After line 358 (after `PARITY_CHECKLIST` log, before `return res.status(200).json`)

**Note**: Need to capture `needsRewrap` and `serverWrappedLines` from `renderCaptionRaster()` scope. These are computed inside `renderCaptionRaster()` but not returned. For now, log what we have access to.

```javascript
    // Add parity checklist log
    console.log('[PARITY_CHECKLIST]', {
      mode: 'raster',
      frameW: data.frameW,
      frameH: data.frameH,
      rasterW: data.rasterW,
      rasterH: data.rasterH,
      xExpr_png: data.xExpr_png,
      yPx_png: data.yPx_png,
      rasterPadding: data.rasterPadding,
      padTop: data.padTop || data.rasterPadding,
      padBottom: data.padBottom || data.rasterPadding,
      previewFontString: rasterResult.previewFontString,
      previewFontHash: rasterResult.previewFontHash,
      rasterHash,
      bgScaleExpr: "scale='if(gt(a,1080/1920),-2,1080)':'if(gt(a,1080/1920),1920,-2)'",
      bgCropExpr: "crop=1080:1920",
      willMatchPreview: true
    });
    
    // DEBUG ONLY: Structured parity log before response
    if (process.env.DEBUG_CAPTION_PARITY === '1') {
      console.log('[PARITY:SERVER:RESPONSE]', JSON.stringify({
        textLen: text?.length || 0,
        clientLinesCount: data.lines?.length || 0,
        serverLinesCount: ssotMeta.lines?.length || 0,
        rewrapped: ssotMeta.lines?.length !== data.lines?.length,
        rasterW: ssotMeta.rasterW,
        rasterH: ssotMeta.rasterH,
        yPx_png: ssotMeta.yPx_png,
        fontPx: ssotMeta.fontPx,
        weightCss: ssotMeta.weightCss,
        previewFontString: ssotMeta.previewFontString,
        totalTextH: ssotMeta.totalTextH,
        timestamp: Date.now()
      }));
    }
    
    return res.status(200).json({
```

**Note**: `rewrapped` is inferred from line count mismatch. For exact detection, we'd need to pass `needsRewrap` from `renderCaptionRaster()` return value, but that's a larger change. This approximation is sufficient for debugging.

---

## Patch 3: Render FFmpeg Log (Before Filter Graph)

**File**: `src/utils/ffmpeg.video.js`  
**Location**: After line 463 (after `[raster:ffmpeg]` log, before filter graph construction)

```javascript
    console.log('[raster:ffmpeg] Using exact preview dimensions:', {
      rasterW: placement.rasterW,
      rasterH: placement.rasterH,
      yPx_png: placement.y,
      xExpr_png: placement.xExpr
    });
    
    // DEBUG ONLY: Structured parity log before FFmpeg
    if (process.env.DEBUG_CAPTION_PARITY === '1') {
      console.log('[PARITY:RENDER:FFMPEG]', JSON.stringify({
        textLen: overlayCaption?.text?.length || 0,
        linesCount: overlayCaption?.lines?.length || 0,
        rasterW: placement.rasterW,
        rasterH: placement.rasterH,
        yPx_png: placement.y,
        fontPx: overlayCaption?.fontPx,
        weightCss: overlayCaption?.weightCss,
        previewFontString: overlayCaption?.previewFontString,
        totalTextH: overlayCaption?.totalTextH,
        timestamp: Date.now()
      }));
    }
    
    // Build filter graph: scale -> crop -> format -> [vmain], then overlay PNG
```

---

## Usage

**Enable Client Logging**:
```javascript
window.__beatPreviewDebug = true;  // or window.__parityAudit = true
```

**Enable Server/Render Logging**:
```bash
DEBUG_CAPTION_PARITY=1 node server.js
```

**Example Output**:
```
[PARITY:CLIENT:REQUEST] {"textLen":45,"linesCount":8,"rasterW":500,"rasterH":200,"yPct":0.5,"yPx_png":960,"fontPx":48,"weightCss":"bold","previewFontString":"normal bold 48px \"DejaVu Sans\"","totalTextH":384,"timestamp":1703001234567}
[PARITY:SERVER:RESPONSE] {"textLen":45,"clientLinesCount":8,"serverLinesCount":2,"rewrapped":true,"rasterW":500,"rasterH":200,"yPx_png":960,"fontPx":48,"weightCss":"700","previewFontString":"normal bold 48px \"DejaVu Sans\"","totalTextH":384,"timestamp":1703001234568}
[PARITY:RENDER:FFMPEG] {"textLen":45,"linesCount":8,"rasterW":500,"rasterH":200,"yPx_png":960,"fontPx":48,"weightCss":"700","previewFontString":"normal bold 48px \"DejaVu Sans\"","totalTextH":384,"timestamp":1703001234569}
```

**Key Indicators**:
- `rewrapped: true` → Server changed line count but kept client geometry (parity break)
- `clientLinesCount !== serverLinesCount` → Rewrap occurred
- `weightCss` mismatch between client and server → Default mismatch

---

## Verification

After applying patches:

1. Enable debug flags
2. Generate beat preview
3. Check console for structured JSON logs
4. Compare `linesCount`, `rasterH`, `yPx_png` across client/server/render
5. Look for `rewrapped: true` to confirm server rewrap detection

---

**End of Debug Instrumentation Patch**

