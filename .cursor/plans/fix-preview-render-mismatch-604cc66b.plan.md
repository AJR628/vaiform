<!-- 604cc66b-2e37-4fb3-a1f7-9c8eb9684503 839de1e9-7d37-4c4f-9105-a495be2446e2 -->
# Fix Caption Preview-Render Y-Coordinate and Line Spacing Mismatch

## Investigation Results

### ✅ Confirmed: Preview Rendering Mechanics
1. Preview uses `ctx.textBaseline='top'` (caption.preview.routes.js:290, 430)
2. Preview calculates `textY = anchorY - (totalTextH / 2)` for center alignment (line 455)
3. First line draws at `drawY_topOfFirstLine = textY = anchorY - (totalTextH / 2)`
4. For yPct=0.1, fontPx=54, 2 lines:
   - `anchorY = 192`
   - `lineHeight = 62.1`
   - `totalTextH = 124.2`
   - `textY = 192 - 62 = 130` ✅

### ❌ ROOT CAUSE FOUND: Client-Side Double Multiplication Bug

**File: `public/js/caption-preview.js:76`**

Current (WRONG):
```javascript
const lineSpacingPx = Math.max(24, Math.min(200, Math.round(fontPx * Number(opts.lineHeight || 1.1))));
```

**The bug:** This calculates `lineSpacingPx = fontPx × lineHeight`, but `opts.lineHeight` is often ALREADY in pixels (e.g., 62px), not a multiplier!

When the code path receives `lineHeight=62` (from somewhere upstream), it does:
```
lineSpacingPx = 54 × 62 = 3348 ≈ 3353
```

This explains the log values:
- `fontPx=54` ✅
- `lineSpacingPx=3353` ❌ (should be ~8-12px)
- `totalTextH=6706` ❌ (should be ~124px)

### The Cascade Effect

1. **Client sends:** `lineSpacingPx=3348` (already in "pixels" but wrong magnitude)
2. **Server V2 path (lines 55-57):** IGNORES client's lineSpacingPx, recalculates:
   ```javascript
   const lineHeight = meta.sizePx * 1.15;  // = 54 * 1.15 = 62
   const totalTextH = lines.length * lineHeight;  // = 2 * 62 = 124
   ```
3. **But wait...** the schema allows `lineSpacingPx` to pass through! Let me verify if the server is using the client's wrong value.

Actually, looking at line 61, the server RECALCULATES:
```javascript
const lineSpacingPx = lines.length === 1 ? 0 : Math.round(lineHeight - meta.sizePx);
```

So the server SHOULD be computing correct values! But the logs show wrong values...

**NEW HYPOTHESIS:** The client is also calculating `totalTextH` wrong and sending it! Let me check if there's a client-side `totalTextH` calculation.

## Deeper Investigation Needed

The V2 server path computes locally (lines 56-61), so it shouldn't matter what the client sends. But somehow the logs show the wrong values. 

**Possibilities:**
1. The client is sending `meta.sizePx` as a huge value (not 54)
2. There's a different code path being executed than what I'm reading
3. The calculation at line 56-57 is somehow being skipped
4. The values are correct during calculation but get corrupted before logging

Let me check if the schema allows `totalTextH` or `totalTextHPx` to pass through:

## Updated Fix Strategy

### Priority 1: Fix Client-Side Calculation

**File: `public/js/caption-preview.js:76`**

Current (WRONG - double multiplication):
```javascript
const lineSpacingPx = Math.max(24, Math.min(200, Math.round(fontPx * Number(opts.lineHeight || 1.1))));
```

Fixed:
```javascript
// lineHeight multiplier (e.g., 1.1 or 1.15), not pixels
const lineHeightMultiplier = Number(opts.lineHeight || 1.15);
// Baseline-to-baseline spacing in pixels
const lineHeightPx = Math.round(fontPx * lineHeightMultiplier);
// Spacing between lines (gap) = line height minus font size
const lineSpacingPx = Math.max(0, Math.min(200, lineHeightPx - fontPx));
```

**Rationale:** 
- For fontPx=54, lineHeight=1.15: `lineHeightPx = 62`, `lineSpacingPx = 8` ✅
- This matches FFmpeg's `line_spacing` semantics (extra pixels between lines)

### Priority 2: Server-Side Robustness

**File: `src/routes/caption.preview.routes.js:55-95`**

Add defensive logging to catch where the wrong values come from:

```javascript
// BEFORE calculations
console.log('[caption-preview-input] meta.sizePx:', meta.sizePx, 'payload.sizePx:', payload.sizePx, 'lines.length:', lines.length);

// Calculate metrics
const fontPx = Number(meta.sizePx);
const lineHeightMultiplier = 1.15;
const lineHeight = Math.round(fontPx * lineHeightMultiplier);
const totalTextH = lines.length * lineHeight;
const lineSpacingPx = lines.length === 1 ? 0 : Math.round(lineHeight - fontPx);

console.log('[caption-preview-calc] fontPx:', fontPx, 'lineHeight:', lineHeight, 'totalTextH:', totalTextH, 'lineSpacingPx:', lineSpacingPx);

// Compute block-center positioning
const anchorY = Math.round(payload.yPct * H);
let yPxFirstLine = Math.round(anchorY - (totalTextH / 2));

console.log('[caption-preview-pos] anchorY:', anchorY, 'yPxFirstLine:', yPxFirstLine, 'textY (drawY_topOfFirstLine):', yPxFirstLine);

// Apply safe margins
const SAFE_TOP = Math.max(50, H * 0.05);
const SAFE_BOTTOM = Math.max(50, H * 0.08);

if (yPxFirstLine < SAFE_TOP) {
  console.log('[caption-preview-clamp] clamping yPxFirstLine from', yPxFirstLine, 'to SAFE_TOP:', SAFE_TOP);
  yPxFirstLine = SAFE_TOP;
}
if (yPxFirstLine + totalTextH > H - SAFE_BOTTOM) {
  const newY = H - SAFE_BOTTOM - totalTextH;
  console.log('[caption-preview-clamp] clamping yPxFirstLine from', yPxFirstLine, 'to bottom-safe:', newY);
  yPxFirstLine = newY;
}

// Build SSOT meta
const ssotMeta = {
  xPct: payload.xPct,
  yPct: payload.yPct,
  wPct: payload.wPct,
  placement: 'custom',
  internalPadding: 32,
  splitLines: lines,
  fontPx: fontPx,  // Use computed, not payload
  lineSpacingPx: lineSpacingPx,
  totalTextH: totalTextH,  // Changed from totalTextHPx for consistency
  totalTextHPx: totalTextH,  // Keep both for compatibility
  yPxFirstLine: yPxFirstLine,
  wPx: 1080,
  hPx: 1920,
};

console.log('[caption-preview] SSOT meta:', JSON.stringify(ssotMeta));
```

### Priority 3: Render-Side Verification

**File: `src/utils/ffmpeg.video.js:595-600`**

Verify the values before using them in drawtext:

```javascript
console.log('[ffmpeg] overlayCaption SSOT values:', {
  fontPx: overlayFontPx,
  lineSpacingPx: lineSpacingPx,
  totalTextH: totalTextH,
  y: y,
  splitLines: splitLines?.length,
  xExpr: xExpr
});

// Build drawtext filter
drawCaption = `drawtext=${[
  `fontfile='${fontFile}'`,
  `text='${escapeForDrawtext(textToRender)}'`,
  `x=${xExpr}`,
  `y=${y}`,  // Should be ~130 for yPct=0.1, not -3129
  `fontsize=${overlayFontPx}`,  // Should be 54
  `fontcolor=${overlayColor}@${overlayOpacity}`,
  supportsLineSpacing && lineSpacingPx > 0 ? `line_spacing=${lineSpacingPx}` : null,  // Should be ~8
  ...
].filter(Boolean).join(':')}`
```

## Expected Results After Fix

### Client Calculation
```
fontPx=54, lineHeightMultiplier=1.15, lineHeightPx=62, lineSpacingPx=8
```

### Server V2 Path
```
[caption-preview-input] meta.sizePx: 54, lines.length: 2
[caption-preview-calc] fontPx: 54, lineHeight: 62, totalTextH: 124, lineSpacingPx: 8
[caption-preview-pos] anchorY: 192, yPxFirstLine: 130
[caption-preview] SSOT meta: {"fontPx":54,"lineSpacingPx":8,"totalTextH":124,"yPxFirstLine":130,...}
```

### Render Path
```
[ffmpeg] overlayCaption SSOT values: { fontPx: 54, lineSpacingPx: 8, totalTextH: 124, y: 130, ... }
drawtext=...:y=130:fontsize=54:line_spacing=8:...
```

### Visual Result
- Text renders at ~10% from top (matching yPct=0.1)
- Preview and render match exactly
- Text is fully visible in frame

## Verification Checklist

- [ ] Client logs show `lineSpacingPx ≈ 8` (not 3353)
- [ ] Server logs show `totalTextH ≈ 124` (not 6706)
- [ ] Server logs show `yPxFirstLine ≈ 130` (not -3129)
- [ ] FFmpeg filter shows `y=130:line_spacing=8`
- [ ] Rendered video matches preview position
- [ ] Text is visible and properly positioned