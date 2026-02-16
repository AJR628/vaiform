# TTS SSOT Implementation

## Overview
Implemented ElevenLabs TTS SSOT (Single Source of Truth) system with unified preview and render payloads.

## Changes Made

### Server-Side
- **src/schemas/tts.schema.js** - Zod schemas for TTS validation
- **src/constants/tts.defaults.js** - Default TTS settings
- **src/builders/tts.builder.js** - SSOT builder for TTS payloads
- **src/adapters/elevenlabs.adapter.js** - ElevenLabs API adapter
- **src/controllers/tts.controller.js** - TTS preview controller
- **src/routes/tts.routes.js** - TTS routes
- **src/services/tts.service.js** - Updated to use SSOT builder
- **src/services/shorts.service.js** - Updated to pass TTS settings
- **src/controllers/shorts.controller.js** - Updated schema and controller

### Frontend
- **public/creative.html** - Added TTS settings controls (stability, similarity, style, speaker boost)
- Updated preview and render functions to use SSOT payloads

## API Endpoints

### TTS Preview
```
POST /api/tts/preview
Content-Type: application/json

{
  "text": "Hello world",
  "voiceId": "JBFqnCBsd6RMkjVDRZzb",
  "modelId": "eleven_multilingual_v2",
  "outputFormat": "mp3_44100_128",
  "voiceSettings": {
    "stability": 0.5,
    "similarity_boost": 0.75,
    "style": 0,
    "use_speaker_boost": true
  }
}
```

### Shorts Creation (with TTS)
```
POST /api/shorts/create
Content-Type: application/json

{
  "text": "Hello world",
  "voiceover": true,
  "voiceId": "JBFqnCBsd6RMkjVDRZzb",
  "modelId": "eleven_multilingual_v2",
  "outputFormat": "mp3_44100_128",
  "voiceSettings": {
    "stability": 0.5,
    "similarity_boost": 0.75,
    "style": 0,
    "use_speaker_boost": true
  }
}
```

## Testing

Run the acceptance tests:
```bash
node scripts/test-tts-ssot.mjs
```

## Key Features

1. **SSOT Compliance**: Preview and render use identical TTS payloads
2. **Voice Settings**: Full control over stability, similarity boost, style, and speaker boost
3. **Validation**: Server-side validation with Zod schemas
4. **Frontend Controls**: UI controls for all TTS settings
5. **Error Handling**: Proper error responses and fallbacks

## Environment Variables

Required:
- `ELEVENLABS_API_KEY` - ElevenLabs API key

Optional:
- `TTS_PROVIDER` - TTS provider (default: "openai")
- `ELEVEN_VOICE_ID` - Default voice ID
- `ELEVEN_TTS_MODEL` - Default model ID
