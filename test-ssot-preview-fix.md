# SSOT Preview Fix Test Plan

## Overview
This document outlines the test plan for verifying that the SSOT preview fix resolves the black preview issue after AI "Save & Use".

## Test Scenario: Preview Background State Management

### Prerequisites
1. User is logged in to Creative Studio
2. User has selected a quote
3. User has sufficient credits for AI generation

### Test Steps

#### Test 1: Stock Image Preview (Baseline)
1. Navigate to Creative Studio
2. Select a stock image from the grid
3. **Verify**: Console logs show `[preview] Background set: {kind: 'stock', url: '...'}`
4. **Verify**: Console logs show `[preview] Selected background: stock: https://...`
5. **Verify**: Console logs show `[preview] bg= https://... ov= true`
6. **Verify**: Preview canvas shows the stock image with caption overlay
7. **Verify**: Render button is enabled

#### Test 2: AI Remix Preview (Problem Case)
1. Generate an AI remix (select 1-2 stock images, enter prompt, click "20 Credits")
2. Click "Save & Use" on the AI result
3. **Verify**: Console logs show `[preview] Background set: {kind: 'ai', url: '...'}`
4. **Verify**: Console logs show `[preview] Selected background: ai: https://...`
5. **Verify**: Console logs show `[preview] bg= https://... ov= true`
6. **Verify**: Preview canvas shows the exact AI remix image with caption overlay
7. **Verify**: No black background - AI image should be visible
8. **Verify**: Render button is enabled

#### Test 3: Switch Back to Stock (Recovery Test)
1. After AI "Save & Use", click a different stock image
2. **Verify**: Console logs show `[preview] Background set: {kind: 'stock', url: '...'}`
3. **Verify**: Console logs show `[preview] Selected background: stock: https://...`
4. **Verify**: Preview canvas shows the new stock image with caption overlay
5. **Verify**: No black background - stock image should be visible
6. **Verify**: Render button is enabled

#### Test 4: Missing Background (Error Case)
1. Clear the background state (if possible) or trigger a state loss
2. **Verify**: Console logs show `[preview] Selected background: none`
3. **Verify**: Console logs show `[preview] MISSING bg url - showing caption overlay only`
4. **Verify**: Toast message appears: "Background not set — showing caption overlay only."
5. **Verify**: Preview shows black background with caption overlay only
6. **Verify**: Render button is disabled with tooltip "Please select a background image"

### Expected Console Logs

#### Successful Background Set
```
[preview] Background set: {kind: 'stock', url: 'https://example.com/image.jpg'}
[preview] Selected background: stock: https://example.com/image.jpg...
[preview] bg= https://example.com/image.jpg ov= true
[preview] state.bg= {kind: 'stock', url: 'https://example.com/image.jpg'}
[preview] Background loaded: {width: 1920, height: 1080, canvasW: 1080, canvasH: 1920}
```

#### AI Remix Success
```
[preview] Background set: {kind: 'ai', url: 'https://example.com/ai-image.jpg'}
[preview] Selected background: ai: https://example.com/ai-image.jpg...
[preview] bg= https://example.com/ai-image.jpg ov= true
[preview] state.bg= {kind: 'ai', url: 'https://example.com/ai-image.jpg'}
[preview] Background loaded: {width: 1920, height: 1080, canvasW: 1080, canvasH: 1920}
```

#### Missing Background
```
[preview] Selected background: none
[preview] bg= null ov= true
[preview] state.bg= undefined
[preview] MISSING bg url - showing caption overlay only
```

### Success Criteria
1. ✅ Stock image preview works initially
2. ✅ AI "Save & Use" shows AI image in preview (not black)
3. ✅ Switching back to stock works after AI
4. ✅ Console logs show proper background state management
5. ✅ Render button is enabled when background is present
6. ✅ Render button is disabled when background is missing
7. ✅ Toast message appears for missing background

### Failure Scenarios to Test
1. **State loss after AI**: Background state becomes undefined
2. **Invalid background URL**: Image fails to load
3. **CORS issues**: Cross-origin image loading fails
4. **Canvas sizing issues**: Canvas dimensions are wrong

### Debugging Tips
- If preview is still black, check console for `[preview] Selected background: none`
- If background is set but not showing, check for CORS errors
- If state is lost after AI, check that `setPreviewBackground()` is called
- If stock selection doesn't work after AI, check that `useAsset()` calls `setPreviewBackground()`

### Quick Test Script (Manual)
1. Open Creative Studio
2. Open browser console
3. Select a stock image → verify logs and preview
4. Generate AI remix → Save & Use → verify logs and preview
5. Select different stock image → verify logs and preview
6. Check render button state throughout

### Expected Network Payload
When the preview is working correctly, the `/api/preview` request should include:
```json
{
  "style": { "text": "...", "fontPx": 97, "yPct": 0.8, ... },
  "background": { "kind": "ai|stock|upload", "url": "https://..." }
}
```

If the background is missing, the payload will only contain:
```json
{
  "style": { "text": "...", "fontPx": 97, "yPct": 0.8, ... }
}
```
