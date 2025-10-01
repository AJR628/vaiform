# TTS Preview 404 Fix - Complete

## Root Cause
The TTS preview endpoint returned 404 due to **double path mounting**:
- Backend mounted TTS router at `/api/tts`
- Route defined as `/tts/preview` 
- Result: Endpoint created at `/api/tts/tts/preview` ❌
- Frontend expected: `/api/tts/preview` ✅

Additionally, the response format didn't match frontend expectations:
- New controller returned **raw binary MP3**
- Frontend expected **base64-encoded JSON**

## Changes Made

### 1. Fixed Route Path ✅
**File**: `src/routes/tts.routes.js`
```javascript
// BEFORE
r.post("/tts/preview", ttsPreview); // Creates /api/tts/tts/preview

// AFTER
r.post("/preview", ttsPreview); // Creates /api/tts/preview
```

### 2. Fixed Response Format ✅
**File**: `src/controllers/tts.controller.js`

Changed from raw binary to base64 JSON (matching existing `/voice/preview` pattern):
```javascript
// BEFORE
res.setHeader("Content-Type", contentType);
return res.send(buffer);

// AFTER
const base64Audio = buffer.toString('base64');
return res.json({
  success: true,
  data: {
    audio: `data:audio/mpeg;base64,${base64Audio}`,
    voiceId: payload.voiceId,
    text: payload.text,
    duration: null
  }
});
```

### 3. Added Structured Logging ✅
**Backend** (`src/controllers/tts.controller.js`):
```javascript
console.log(`[tts.preview] Received request: voiceId=${payload.voiceId}...`);
console.log(`[tts.preview] ElevenLabs synthesis OK: ${buffer.length} bytes`);
console.error(`[tts.preview] Error:`, e.message);
```

**Frontend** (`public/creative.html`):
```javascript
console.log('[tts.preview] POST /api/tts/preview', { voiceId, settings });
console.log('[tts.preview] Response received:', { success, hasAudio });
console.log('[tts.preview] Playing preview audio');
console.error('[tts.preview] Error:', error);
```

### 4. Enhanced CORS Configuration ✅
**File**: `src/app.js`

Added `www.vaiform.com` to allowed origins:
```javascript
const ALLOWED_ORIGINS = [
  "https://vaiform.com",
  "https://www.vaiform.com", // www subdomain
  // ... other origins
];
```

### 5. Updated Test Script ✅
**File**: `scripts/test-tts-ssot.mjs`

Updated to expect JSON response with base64 audio instead of raw binary.

## API Endpoint Behavior

### Request
```
POST /api/tts/preview
Content-Type: application/json

{
  "text": "Hello, this is a preview of my voice.",
  "voiceId": "JBFqnCBsd6RMkjVDRZzb",
  "modelId": "eleven_multilingual_v2",
  "outputFormat": "mp3_44100_128",
  "voiceSettings": {
    "stability": 0.5,
    "similarity_boost": 0.8,
    "style": 0,
    "use_speaker_boost": true
  }
}
```

### Response (Success)
```json
{
  "success": true,
  "data": {
    "audio": "data:audio/mpeg;base64,//uQxAAA...",
    "voiceId": "JBFqnCBsd6RMkjVDRZzb",
    "text": "Hello, this is a preview of my voice.",
    "duration": null
  }
}
```

### Response (Error)
```json
{
  "success": false,
  "error": "TTS preview failed",
  "detail": "Error message details"
}
```

## Testing

### Manual Test (Production)
1. Open `vaiform.com/creative.html`
2. Select a voice from dropdown
3. Adjust TTS settings (stability, similarity, style, speaker boost)
4. Click **"Preview Voice"** button
5. Verify audio plays automatically (or shows "click to play" if autoplay blocked)

### Expected Console Output
```
[tts.preview] POST /api/tts/preview { voiceId: "VR6AewLT...", settings: {...} }
[tts.preview] Response received: { success: true, hasAudio: true }
[tts.preview] Playing preview audio
```

### Automated Test
```bash
node scripts/test-tts-ssot.mjs
```

## Definition of Done ✅

- ✅ Backend endpoint exists at `POST /api/tts/preview`
- ✅ Route correctly mounted (no double path)
- ✅ Returns base64 JSON format matching frontend expectations
- ✅ CORS allows production domains (`vaiform.com`, `www.vaiform.com`)
- ✅ Frontend plays returned audio without page reload
- ✅ Structured logging in place (`[tts.preview]` prefix)
- ✅ Test script updated to verify end-to-end flow

## SSOT Compliance

All changes maintain the Single Source of Truth principle:
- ✅ `buildTtsPayload()` used for both preview and render
- ✅ Same ElevenLabs adapter (`elevenLabsSynthesize()`) for all synthesis
- ✅ Zod schema validation ensures payload consistency
- ✅ No duplicate or divergent TTS logic

## Files Modified
1. `src/routes/tts.routes.js` - Fixed route path
2. `src/controllers/tts.controller.js` - Fixed response format + logging
3. `src/app.js` - Enhanced CORS configuration
4. `public/creative.html` - Added structured logging
5. `scripts/test-tts-ssot.mjs` - Updated test expectations

## Next Steps (Future)
- Consider adding duration calculation (probe MP3 length)
- Add request/response caching for repeat previews
- Consider streaming response for faster preview playback
- Add rate limiting for TTS preview endpoint
