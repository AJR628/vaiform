# Media Type SSOT Fix Test Plan

## Overview
This document outlines the test plan for verifying that the media type SSOT fix resolves the video/image loading issues in the Creative Studio preview.

## Problem Fixed
- **Video files treated as images**: `.mp4` files were being loaded with `new Image()`, causing `EncodingError`
- **Missing media type detection**: System couldn't distinguish between images and videos
- **State not reset on failure**: Once a video failed to load as an image, preview stayed black
- **AI images not showing**: After "Save & Use", AI images weren't appearing in preview

## Solution Implemented

### **1. SSOT Media Type Detection**
- **`inferMediaType(url, mime)`**: Detects media type from URL extension and MIME type
- **Normalized background objects**: All backgrounds now have `mediaType: 'image'|'video'`
- **Proper MIME detection**: Handles both explicit MIME types and URL-based inference

### **2. Correct Loader Routing**
- **`loadBackgroundImage(bg)`**: CORS-safe image loading with proper error handling
- **`loadBackgroundVideo(bg)`**: Video loading with first frame capture
- **`drawFrame(ctx, media, W, H)`**: Unified drawing for both images and videos
- **Media type routing**: `bg.mediaType === 'video'` determines which loader to use

### **3. State Management**
- **Failure recovery**: State is reset on load failure to prevent stuck black canvas
- **AI image handling**: AI "Save & Use" sets `mediaType: 'image'` explicitly
- **Asset selection**: Stock/upload assets include MIME type information

## Test Scenarios

### **Test 1: Stock Image Preview**
1. Select a stock image (`.jpg`, `.png`, etc.)
2. **Verify**: Console shows `[preview] bg SSOT {"kind":"stock","url":"...","mediaType":"image",...}`
3. **Verify**: Console shows `[preview] loader image https://...`
4. **Verify**: Preview shows the image with caption overlay
5. **Verify**: No `EncodingError` in console

### **Test 2: Stock Video Preview**
1. Select a stock video (`.mp4`)
2. **Verify**: Console shows `[preview] bg SSOT {"kind":"stock","url":"...","mediaType":"video",...}`
3. **Verify**: Console shows `[preview] loader video https://...`
4. **Verify**: Preview shows the first frame of the video with caption overlay
5. **Verify**: No `EncodingError` in console

### **Test 3: AI Image Preview**
1. Generate an AI remix
2. Click "Save & Use"
3. **Verify**: Console shows `[preview] bg SSOT {"kind":"ai","url":"...","mediaType":"image",...}`
4. **Verify**: Console shows `[preview] loader image https://...`
5. **Verify**: Preview shows the AI image with caption overlay
6. **Verify**: No `EncodingError` in console

### **Test 4: Failure Recovery**
1. Select a video that fails to load
2. **Verify**: Console shows `[preview] Background load failed: ...`
3. **Verify**: Toast appears: "Background failed to load — please try another image or video."
4. **Verify**: `window.state.background` is reset to `undefined`
5. Select a different image/video
6. **Verify**: New selection works (no stuck black canvas)

### **Test 5: Mixed Media Switching**
1. Select a stock image → verify preview works
2. Select a stock video → verify preview shows video frame
3. Generate AI image → "Save & Use" → verify AI image appears
4. Select different stock image → verify preview updates
5. **Verify**: No `EncodingError` throughout the process

## Expected Console Logs

### **Successful Image Load**
```
[preview] bg SSOT {"kind":"stock","url":"https://example.com/image.jpg","mediaType":"image","mime":"image/jpeg","w":1920,"h":1080}
[preview] loader image https://example.com/image.jpg
[preview] Background loaded: {width: 1920, height: 1080, canvasW: 1080, canvasH: 1920}
```

### **Successful Video Load**
```
[preview] bg SSOT {"kind":"stock","url":"https://example.com/video.mp4","mediaType":"video","mime":"video/mp4","w":1920,"h":1080}
[preview] loader video https://example.com/video.mp4
[preview] Background loaded: {width: 1920, height: 1080, canvasW: 1080, canvasH: 1920}
```

### **AI Image Load**
```
[preview] bg SSOT {"kind":"ai","url":"https://firebase.../image_0.png","mediaType":"image","mime":"image/png","w":1080,"h":1920}
[preview] loader image https://firebase.../image_0.png
[preview] Background loaded: {width: 1080, height: 1920, canvasW: 1080, canvasH: 1920}
```

### **Load Failure**
```
[preview] Background load failed: DOMException: Image decode failed
Background failed to load — please try another image or video.
```

## Success Criteria

✅ **Stock images**: Preview shows image with caption overlay  
✅ **Stock videos**: Preview shows first frame with caption overlay  
✅ **AI images**: Preview shows AI image with caption overlay  
✅ **No EncodingError**: Videos are loaded as videos, images as images  
✅ **Failure recovery**: Failed loads don't break subsequent selections  
✅ **Media type detection**: URLs are correctly identified as image/video  
✅ **State management**: Background state is properly maintained  

## Debugging Tips

- **If video shows EncodingError**: Check that `mediaType` is set to `'video'`
- **If image shows EncodingError**: Check that `mediaType` is set to `'image'`
- **If preview stays black**: Check that `window.state.background` is not `undefined`
- **If AI image doesn't show**: Check that `mediaType: 'image'` is set in AI handler
- **If switching doesn't work**: Check that state is reset on failure

## Quick Test Script

1. Open Creative Studio
2. Open browser console
3. Select stock image → verify logs and preview
4. Select stock video → verify logs and preview
5. Generate AI remix → Save & Use → verify logs and preview
6. Try switching between different media types
7. Check for any `EncodingError` messages

## Expected Behavior

- **Images**: Load with `new Image()`, draw with `drawImage()`
- **Videos**: Load with `new Video()`, draw first frame with `drawImage()`
- **Cover-fit cropping**: Both images and videos are cropped to 9:16 aspect ratio
- **Error handling**: Failed loads show toast and reset state
- **State persistence**: Successful loads maintain background state
- **Media type routing**: Correct loader is chosen based on `mediaType`
