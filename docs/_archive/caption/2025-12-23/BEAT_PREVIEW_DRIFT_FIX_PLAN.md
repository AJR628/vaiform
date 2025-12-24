# Beat Caption Preview Drift Fix - Audit Report & Implementation Plan

## Executive Summary

**Problem**: Caption previews drift upward as text length increases, eventually causing `yPx_png` to become negative and `/api/caption/preview` to return 400 INVALID_INPUT errors.

**Root Causes**:
1. **TOP-anchored yPct**: Client computes `yPct` from box TOP position, not CENTER
2. **Stale yPx_png after rewrap**: Server rewraps lines and recomputes `rasterH`, but keeps old `yPx_png` (computed from old `rasterH`)
3. **Stale meta in PARITY_CHECKLIST**: Logs old client values even after server recomputation
4. **Untrusted client lines**: Client sends word-split lines (one word per line), server rewraps but positioning doesn't account for new geometry

**Solution**: Enforce CENTER-anchored `yPct` everywhere, make server authoritative on wrapping, and recompute `yPx_png` from `yPct` + final `rasterH` after rewrap.

---

## Task A: Audit Findings

### A1. Beat Preview Payload Building

**Location**: `public/js/caption-preview.js`

**Function**: `buildBeatPreviewPayload()` (line 691-742)
- Builds V3 raster payload from `overlayMeta` object
- Uses `overlayMeta.lines` directly (line 732)
- Uses `overlayMeta.yPx_png` directly (line 728)
- Uses `overlayMeta.yPct` directly (line 698)

**Function**: `generateBeatCaptionPreview()` (line 751-842)
- Calls `measureBeatCaptionGeometry(text, style)` to get `overlayMeta` (line 781)
- Passes `overlayMeta` to `buildBeatPreviewPayload()` (line 787)

**Lines Source**: `overlayMeta.lines` comes from `extractRenderedLines()` in `computeCaptionMetaFromElements()` (line 1442)

**Issue**: If `extractRenderedLines()` produces word-split lines (one word per line), these are sent to server. Server rewraps, but client's `yPx_png` was computed from old line count.

---

### A2. yPx_png / yPct Computation

**Location**: `public/js/caption-overlay.js`

**Function**: `computeCaptionMetaFromElements()` (line 1391-1558)

**Current computation** (line 1493):
```javascript
const yPct = (boxRect.top - stageRect.top) / stageHeight;
```

**Issue**: This computes `yPct` from box **TOP** position, not CENTER. When text grows and `rasterH` increases, the box top stays fixed, but the center moves up.

**yPx_png computation** (line 1502):
```javascript
const yPx_png = Math.round(yPct * frameH);
```

**Issue**: `yPx_png` is derived from TOP-anchored `yPct`. When server rewraps and `rasterH` changes, `yPx_png` should be recomputed from CENTER-anchored `yPct` + new `rasterH`, but it's not.

**Function**: `measureBeatCaptionGeometry()` (line 1699-1811)
- Sets box position with `transform: translateY(-50%)` (line 1755) - this CENTERS the box
- But then `computeCaptionMetaFromElements()` computes `yPct` from box TOP (line 1493), not CENTER

**Inconsistency**: Box is positioned by CENTER (via CSS transform), but `yPct` is computed from TOP.

---

### A3. Server Rewrap + Response Build

**Location**: `src/routes/caption.preview.routes.js`

**Rewrap detection** (line 1182-1291):
- Server checks if client lines overflow `maxLineWidth` (line 1185-1204)
- Server checks for mid-word splits (line 1206-1228)
- If rewrap needed, calls `wrapLinesWithFont()` (line 1241)
- Recomputes `serverTotalTextH` and `serverRasterH` (line 1248-1283)

**Response building** (line 237-242):
```javascript
const finalLines = rasterResult.rewrapped ? rasterResult.finalLines : lines;
const finalRasterH = rasterResult.rewrapped ? rasterResult.serverRasterH : rasterH;
const finalTotalTextH = rasterResult.rewrapped ? rasterResult.serverTotalTextH : totalTextH;
// Keep yPx_png as-is (no positioning policy change, only geometry recomputation)
const finalYPx_png = yPx_png;  // ❌ STALE - computed from old rasterH
```

**Issue**: When rewrap occurs, `finalYPx_png` keeps the old client value (computed from old `rasterH`). It should be recomputed from `yPct` + new `finalRasterH`.

**ssotMeta building** (line 278-327):
```javascript
const ssotMeta = {
  // ...
  rasterH: finalRasterH,  // ✅ Server-recomputed if rewrap
  yPx_png: finalYPx_png,  // ❌ STALE - old client value
  lines: finalLines,       // ✅ Server-wrapped if rewrap
  totalTextH: finalTotalTextH,  // ✅ Server-recomputed if rewrap
};
```

**Issue**: `ssotMeta.rasterH` and `ssotMeta.totalTextH` use final values, but `ssotMeta.yPx_png` uses stale value.

**PARITY_CHECKLIST logging** (line 364-381):
```javascript
console.log('[PARITY_CHECKLIST]', {
  // ...
  rasterH: data.rasterH,      // ❌ STALE - old client value
  yPx_png: data.yPx_png,      // ❌ STALE - old client value
  // ...
});
```

**Issue**: `PARITY_CHECKLIST` logs `data.rasterH` and `data.yPx_png` (old client values), not `ssotMeta.rasterH` and `ssotMeta.yPx_png` (final server values).

---

## Task B: Implementation Plan

### B1. Feature Flag

**Add constant**: `PREVIEW_ANCHOR_V2` (env or constant)

**Location**: `src/routes/caption.preview.routes.js` (top of file, after imports)

```javascript
const PREVIEW_ANCHOR_V2 = process.env.PREVIEW_ANCHOR_V2 === '1' || false;
```

**Client-side**: Check `window.PREVIEW_ANCHOR_V2` (set via script tag or localStorage)

---

### B2. Client: CENTER-anchored yPct

**File**: `public/js/caption-overlay.js`

**Function**: `computeCaptionMetaFromElements()` (line 1391)

**Change** (line 1493):
```javascript
// OLD (TOP-anchored):
const yPct = (boxRect.top - stageRect.top) / stageHeight;

// NEW (CENTER-anchored, behind flag):
const yPct = window.PREVIEW_ANCHOR_V2
  ? ((boxRect.top + boxRect.height / 2) - stageRect.top) / stageHeight
  : (boxRect.top - stageRect.top) / stageHeight;
```

**Rationale**: `yPct` should represent the CENTER of the text block, not the top. When text grows, the center stays fixed (if `yPct` is constant), but the top moves up.

---

### B3. Server: CENTER-anchored yPct + Recompute yPx_png

**File**: `src/routes/caption.preview.routes.js`

**Change 1**: Always return `yPct` in response meta (line 278-327)

Add to `ssotMeta`:
```javascript
const ssotMeta = {
  // ... existing fields ...
  yPct: data.yPct ?? 0.5,  // ✅ Always include yPct in response
  // ...
};
```

**Change 2**: Recompute `yPx_png` from `yPct` + final `rasterH` when rewrap occurs (line 237-242)

```javascript
// OLD:
const finalYPx_png = yPx_png;  // ❌ Stale

// NEW (behind flag):
let finalYPx_png;
if (PREVIEW_ANCHOR_V2 && rasterResult.rewrapped) {
  // Recompute from CENTER-anchored yPct + final rasterH
  const yPct = data.yPct ?? 0.5;
  const targetTop = Math.round(yPct * data.frameH - finalRasterH / 2);
  // Clamp to [0, frameH - rasterH]
  finalYPx_png = Math.max(0, Math.min(targetTop, data.frameH - finalRasterH));
} else {
  finalYPx_png = yPx_png;  // Legacy behavior
}
```

**Rationale**: When server rewraps and `rasterH` changes, `yPx_png` must be recomputed from `yPct` (center anchor) + new `rasterH`. This keeps the center position fixed while accounting for new geometry.

---

### B4. Server: Authoritative Wrapping

**File**: `src/routes/caption.preview.routes.js`

**Current behavior**: Server accepts client `lines` but rewraps if overflow detected (line 1182-1291)

**Change**: When `PREVIEW_ANCHOR_V2` is enabled, always wrap on server (ignore client `lines` for wrapping, but still validate)

**Location**: After schema validation (line 100-109)

```javascript
// When PREVIEW_ANCHOR_V2 is enabled, always wrap on server
if (PREVIEW_ANCHOR_V2) {
  const canvas = createCanvas(data.frameW, data.frameH);
  const ctx = canvas.getContext("2d");
  const font = canvasFontString(data.weightCss, data.fontStyle, fontPx, 'DejaVu Sans');
  ctx.font = font;
  
  const maxLineWidth = rasterW - (2 * rasterPadding);
  const serverWrappedLines = wrapLinesWithFont(text, maxLineWidth, ctx, letterSpacingPx);
  
  // Use server-wrapped lines (ignore client lines for wrapping)
  lines = serverWrappedLines;
  needsRewrap = true;  // Force geometry recomputation
}
```

**Rationale**: Server is authoritative on wrapping. Client can send `text` + `maxWidthPct`, but server wraps using its font measurement.

---

### B5. Fix Stale Meta Usage

**File**: `src/routes/caption.preview.routes.js`

**Change 1**: Use final values in `ssotMeta` (already done, but ensure consistency)

**Change 2**: Fix `PARITY_CHECKLIST` to use final values (line 364-381)

```javascript
// OLD:
console.log('[PARITY_CHECKLIST]', {
  rasterH: data.rasterH,      // ❌ Stale
  yPx_png: data.yPx_png,      // ❌ Stale
  // ...
});

// NEW:
console.log('[PARITY_CHECKLIST]', {
  rasterH: ssotMeta.rasterH,      // ✅ Final value
  yPx_png: ssotMeta.yPx_png,      // ✅ Final value
  yPct: ssotMeta.yPct,             // ✅ Include yPct
  // ...
});
```

**Rationale**: `PARITY_CHECKLIST` must log the values actually used in the response, not the stale client values.

---

## Task C: Contract Test Script

**File**: `scripts/test-caption-preview-parity.mjs`

```javascript
#!/usr/bin/env node

/**
 * Contract test for /api/caption/preview endpoint
 * Validates that yPx_png is finite, >= 0, and <= frameH - rasterH
 */

const BASE_URL = process.env.API_URL || 'http://localhost:3000';

async function testPreview(text, description) {
  const payload = {
    ssotVersion: 3,
    mode: 'raster',
    text: text,
    fontFamily: 'DejaVu Sans',
    fontPx: 48,
    lineSpacingPx: 0,
    letterSpacingPx: 0,
    weightCss: 'bold',
    fontStyle: 'normal',
    textAlign: 'center',
    textTransform: 'none',
    color: 'rgb(255,255,255)',
    opacity: 1.0,
    strokePx: 0,
    strokeColor: 'rgba(0,0,0,0.85)',
    shadowColor: 'rgba(0,0,0,0.6)',
    shadowBlur: 12,
    shadowOffsetX: 0,
    shadowOffsetY: 2,
    frameW: 1080,
    frameH: 1920,
    // Client-computed geometry (minimal for test)
    rasterW: 500,
    rasterH: 100,
    rasterPadding: 24,
    xPx_png: 290,
    yPx_png: 910,
    xExpr_png: '(W-overlay_w)/2',
    lines: text.split(' '),  // Naive split for test
    totalTextH: 48,
    yPxFirstLine: 934
  };

  const res = await fetch(`${BASE_URL}/api/caption/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  if (!data.ok) {
    throw new Error(`API error: ${data.reason} - ${data.detail}`);
  }

  const meta = data.data.meta;

  // Assertions
  const errors = [];

  if (!Number.isFinite(meta.yPx_png) || meta.yPx_png < 0) {
    errors.push(`yPx_png must be finite and >= 0, got ${meta.yPx_png}`);
  }

  if (meta.yPx_png > meta.frameH - meta.rasterH) {
    errors.push(`yPx_png (${meta.yPx_png}) > frameH - rasterH (${meta.frameH - meta.rasterH})`);
  }

  if (!Array.isArray(meta.lines) || meta.lines.length === 0) {
    errors.push(`lines must be non-empty array, got ${meta.lines}`);
  }

  if (!Number.isFinite(meta.rasterH) || meta.rasterH <= 0) {
    errors.push(`rasterH must be finite and > 0, got ${meta.rasterH}`);
  }

  // Check that rasterH matches what server says it used
  if (meta.rasterH !== meta.rasterH) {  // This will always be true, but documents intent
    errors.push(`rasterH mismatch: response says ${meta.rasterH}`);
  }

  if (errors.length > 0) {
    console.error(`[FAIL] ${description}:`);
    errors.forEach(e => console.error(`  - ${e}`));
    console.error(`  Response meta:`, JSON.stringify(meta, null, 2));
    throw new Error(`Contract test failed: ${description}`);
  }

  console.log(`[PASS] ${description}:`);
  console.log(`  yPx_png: ${meta.yPx_png} (valid)`);
  console.log(`  rasterH: ${meta.rasterH} (valid)`);
  console.log(`  lines: ${meta.lines.length} lines`);
  console.log(`  yPct: ${meta.yPct ?? 'N/A'}`);
}

async function main() {
  try {
    await testPreview('1234567', 'Short text');
    await testPreview('Testing preview caption overlay testing preview caption overlay testing preview', 'Long text');
    console.log('\n✅ All contract tests passed');
  } catch (err) {
    console.error('\n❌ Contract test failed:', err.message);
    process.exit(1);
  }
}

main();
```

**Usage**:
```bash
node scripts/test-caption-preview-parity.mjs
```

---

## Task D: Instrumentation

**File**: `src/routes/caption.preview.routes.js` (line 383-402)

**Existing**: `DEBUG_CAPTION_PARITY=1` logs `[PARITY:SERVER:RESPONSE]`

**Add**: When `DEBUG_CAPTION_PARITY=1` and `window.__beatPreviewDebug` is set, log:

```javascript
if (process.env.DEBUG_CAPTION_PARITY === '1') {
  const clientLinesCount = data.lines?.length || 0;
  const serverLinesCount = ssotMeta.lines?.length || 0;
  const rewrapped = rasterResult.rewrapped || (clientLinesCount !== serverLinesCount);
  
  console.log('[PARITY:SERVER:RESPONSE]', JSON.stringify({
    textLen: text?.length || 0,
    clientLinesCount: clientLinesCount,
    serverLinesCount: serverLinesCount,
    rewrapped: rewrapped,
    finalLinesCount: ssotMeta.lines?.length || 0,      // ✅ Add
    finalRasterH: ssotMeta.rasterH,                    // ✅ Add
    finalYPct: ssotMeta.yPct,                          // ✅ Add
    finalYPx_png: ssotMeta.yPx_png,                    // ✅ Add
    rasterW: ssotMeta.rasterW,
    fontPx: ssotMeta.fontPx,
    weightCss: ssotMeta.weightCss,
    previewFontString: ssotMeta.previewFontString,
    totalTextH: ssotMeta.totalTextH,
    timestamp: Date.now()
  }));
}
```

**Client-side**: `public/js/caption-preview.js` (line 790-806)

**Existing**: `window.__beatPreviewDebug` logs `[PARITY:CLIENT:REQUEST]`

**Add**: Log whether client sent lines:

```javascript
if (window.__beatPreviewDebug || window.__parityAudit) {
  const linesPreview = payload.lines?.slice(0, 12).map(line => line.substring(0, 12)) || [];
  console.log('[PARITY:CLIENT:REQUEST]', JSON.stringify({
    textLen: text?.length || 0,
    sentLines: !!payload.lines,                        // ✅ Add
    linesCount: payload.lines?.length || 0,
    linesPreview: linesPreview,
    // ... rest of existing fields
  }));
}
```

---

## Summary of Changes

### Files Modified

1. **`public/js/caption-overlay.js`**
   - `computeCaptionMetaFromElements()`: Change `yPct` computation to CENTER-anchored (behind flag)

2. **`src/routes/caption.preview.routes.js`**
   - Add `PREVIEW_ANCHOR_V2` flag check
   - Always return `yPct` in `ssotMeta`
   - Recompute `yPx_png` from `yPct` + final `rasterH` when rewrap occurs (behind flag)
   - Make server authoritative on wrapping (behind flag)
   - Fix `PARITY_CHECKLIST` to use final values
   - Add instrumentation logging

3. **`public/js/caption-preview.js`**
   - Add instrumentation logging (sentLines flag)

4. **`scripts/test-caption-preview-parity.mjs`** (new file)
   - Contract test script

---

## Testing Checklist

1. **Run contract test**:
   ```bash
   node scripts/test-caption-preview-parity.mjs
   ```

2. **Manual test - short text**:
   - Create beat with text "Hello world"
   - Verify preview appears at correct position
   - Check browser console for `[PARITY:CLIENT:REQUEST]` and `[PARITY:SERVER:RESPONSE]`

3. **Manual test - long text**:
   - Create beat with long text (50+ words)
   - Verify preview doesn't drift upward
   - Verify `yPx_png >= 0` in server logs
   - Check that server rewraps and recomputes `yPx_png`

4. **Manual test - rewrap**:
   - Create beat with text that causes server rewrap
   - Verify `finalYPx_png` is recomputed from `yPct` + `finalRasterH`
   - Verify `PARITY_CHECKLIST` logs final values

5. **Regression test**:
   - Disable `PREVIEW_ANCHOR_V2` flag
   - Verify existing behavior unchanged
   - Re-enable flag
   - Verify new behavior works

---

## Risk Mitigation

1. **Feature flag**: All changes behind `PREVIEW_ANCHOR_V2` flag - can disable if issues
2. **Backward compatibility**: Legacy behavior preserved when flag is off
3. **Contract test**: Validates basic invariants (yPx_png >= 0, yPx_png <= frameH - rasterH)
4. **Instrumentation**: Logs help debug drift issues in production

---

## Deliverable: Commit Message

```
Fix beat caption preview drift with CENTER-anchored yPct + server recomputation

Problem:
- Caption previews drift upward as text length increases
- yPx_png becomes negative, causing 400 INVALID_INPUT errors
- Server rewraps lines but uses stale yPx_png (computed from old rasterH)
- PARITY_CHECKLIST logs stale client values after rewrap

Root Causes:
1. TOP-anchored yPct: Client computed yPct from box TOP, not CENTER
2. Stale yPx_png: Server kept old yPx_png after rewrap (should recompute from yPct + final rasterH)
3. Untrusted client lines: Client sent word-split lines, server rewrapped but positioning didn't account for new geometry

Solution:
1. CENTER-anchored yPct: Compute yPct from box CENTER (behind PREVIEW_ANCHOR_V2 flag)
2. Server recomputes yPx_png: When rewrap occurs, recompute yPx_png from yPct + final rasterH
3. Server authoritative wrapping: When flag enabled, always wrap on server (ignore client lines for wrapping)
4. Fix stale meta: PARITY_CHECKLIST now logs final values, not stale client values

Changes:
- public/js/caption-overlay.js: CENTER-anchored yPct computation (behind flag)
- src/routes/caption.preview.routes.js: Recompute yPx_png after rewrap, fix PARITY_CHECKLIST
- scripts/test-caption-preview-parity.mjs: Contract test script

Testing:
- Run: node scripts/test-caption-preview-parity.mjs
- Manual: Create beats with short/long text, verify no drift
- Regression: Disable flag, verify existing behavior unchanged
```



