# Preview Fix Test Plan

## Overview
This document outlines the test plan for verifying that the preview background image fix works correctly.

## Test Scenario: Preview Background Image Display

### Prerequisites
1. User is logged in to Creative Studio
2. User has selected a quote
3. User has sufficient credits for AI generation (if testing AI remix)

### Test Steps

#### Test 1: Stock Image Preview
1. Navigate to Creative Studio
2. Select a stock image from the grid
3. **Verify**: Console logs show `[preview] bg=` with the stock image URL
4. **Verify**: Console logs show `[preview] state.bg=` with correct background state
5. **Verify**: Preview canvas shows the stock image with caption overlay
6. **Verify**: No black background - image should be visible

#### Test 2: AI Remix Preview
1. Generate an AI remix (select 1-2 stock images, enter prompt, click "20 Credits")
2. Click "Save & Use" on the AI result
3. **Verify**: Console logs show `[preview] bg=` with the AI image URL
4. **Verify**: Console logs show `[preview] state.bg=` with `kind: 'ai'`
5. **Verify**: Preview canvas shows the exact AI remix image with caption overlay
6. **Verify**: No black background - AI image should be visible

#### Test 3: Upload Image Preview
1. Upload an image file
2. Select the uploaded image
3. **Verify**: Console logs show `[preview] bg=` with the uploaded image URL
4. **Verify**: Console logs show `[preview] state.bg=` with `kind: 'upload'`
5. **Verify**: Preview canvas shows the uploaded image with caption overlay
6. **Verify**: No black background - uploaded image should be visible

### Expected Console Logs

#### Successful Background Load
```
[preview] bg= https://example.com/image.jpg ov= true
[preview] state.bg= {kind: 'stock', url: 'https://example.com/image.jpg'}
[preview] selectedAsset= {id: '...', provider: 'stock', fileUrl: 'https://example.com/image.jpg', ...}
[preview] Background loaded: {width: 1920, height: 1080, canvasW: 1080, canvasH: 1920}
```

#### Missing Background URL
```
[preview] bg= null ov= true
[preview] state.bg= undefined
[preview] selectedAsset= {id: '...', provider: 'stock', fileUrl: undefined, ...}
[preview] MISSING bg url
```

### Success Criteria
1. ✅ Preview shows background image (not black)
2. ✅ Caption overlay appears on top of background
3. ✅ Console logs show correct background URL
4. ✅ Console logs show correct state.bg object
5. ✅ No CORS errors in console
6. ✅ No image decode errors

### Failure Scenarios to Test
1. **Invalid image URL**: Should log error and show black background
2. **CORS issues**: Should log CORS error in console
3. **Missing state.bg**: Should fall back to selectedAsset properties
4. **Canvas sizing issues**: Should show canvas dimensions in logs

### Quick Test Script (Manual)
1. Open Creative Studio
2. Open browser console
3. Select a stock image
4. Check console for `[preview]` logs
5. Verify preview shows image (not black)
6. Generate AI remix and repeat
7. Upload image and repeat

### Debugging Tips
- If preview is still black, check console for `[preview] MISSING bg url`
- If CORS errors, check that images have `crossOrigin='anonymous'`
- If canvas is wrong size, check that `canvas.width=1080` and `canvas.height=1920`
- If state.bg is undefined, check that `useAsset()` and AI "Save & Use" set `window.state.bg`
