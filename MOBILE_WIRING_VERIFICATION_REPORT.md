# Mobile Backend Wiring Verification Report

**Date**: 2025-01-XX  
**Purpose**: Verify story API routes and finalize response shape for mobile React Native integration  
**Status**: ✅ VERIFICATION COMPLETE - NO CODE CHANGES

---

## 1. Backend Story Routes Verification

All routes are mounted at `/api/story` (see `src/app.js:299`). Verified against `src/routes/story.routes.js`.

### ✅ Route Status

| Requested Route | Method | Actual Route | Status | Notes |
|----------------|--------|--------------|--------|-------|
| `/api/story/start` | POST | ✅ `POST /api/story/start` | **EXISTS** | Line 48 |
| `/api/story/generate` | POST | ✅ `POST /api/story/generate` | **EXISTS** | Line 79, Rate limit: 300/day |
| `/api/story/plan` | POST | ✅ `POST /api/story/plan` | **EXISTS** | Line 387, Rate limit: 300/day |
| `/api/story/search` | POST | ✅ `POST /api/story/search` | **EXISTS** | Line 416 |
| `/api/story/search-shot` | POST | ✅ `POST /api/story/search-shot` | **EXISTS** | Line 482 |
| `/api/story/update-shot` | POST | ✅ `POST /api/story/update-shot` | **EXISTS** | Line 445 |
| `/api/story/update-beat-text` | POST | ✅ `POST /api/story/update-beat-text` | **EXISTS** | Line 606 |
| `/api/story/finalize` | POST | ✅ `POST /api/story/finalize` | **EXISTS** | Line 727, Credit cost: 20 |
| `/api/story/:sessionId` | GET | ✅ `GET /api/story/:sessionId` | **EXISTS** | Line 936 |

### ⚠️ Additional Routes Available (Not Requested)

The following routes exist but were not in your list. Consider if needed:

- `POST /api/story/update-script` (Line 110) - Update all sentences at once
- `POST /api/story/update-caption-style` (Line 145) - Update caption styling
- `POST /api/story/update-caption-meta` (Line 226) - Save caption metadata
- `POST /api/story/insert-beat` (Line 528) - Insert new beat with auto-search
- `POST /api/story/delete-beat` (Line 565) - Delete a beat
- `POST /api/story/timeline` (Line 639) - Build stitched timeline
- `POST /api/story/captions` (Line 669) - Generate caption timings
- `POST /api/story/render` (Line 698) - Render segments (Phase 6)
- `POST /api/story/manual` (Line 795) - Create session from manual script
- `POST /api/story/create-manual-session` (Line 829) - Create session from draft beats

---

## 2. Finalize Response Shape

### ✅ Response Structure

**Endpoint**: `POST /api/story/finalize`  
**Source**: `src/routes/story.routes.js:762-766`

```typescript
{
  success: boolean;           // true on success
  data: {                     // Full session object
    id: string;               // Session ID
    status: "rendered";       // Session status
    finalVideo: {
      url: string;            // Public video URL (Firebase Storage)
      durationSec: number;    // Video duration in seconds
      jobId: string;          // Job ID (use for /api/shorts/:jobId)
    };
    // ... other session fields (story, shots, captions, etc.)
  };
  shortId: string | null;     // Convenience field = finalVideo.jobId
}
```

### Response Example

```json
{
  "success": true,
  "data": {
    "id": "story-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "rendered",
    "finalVideo": {
      "url": "https://firebasestorage.googleapis.com/v0/b/vaiform.appspot.com/o/artifacts%2Fabc123%2Fshort-xyz%2Fshort.mp4?alt=media&token=xxx",
      "durationSec": 32,
      "jobId": "short-xyz-123"
    }
  },
  "shortId": "short-xyz-123"
}
```

### Key Fields for Mobile Client

1. **`shortId`** (top-level) - Use this for navigation to `/api/shorts/:jobId` or display
2. **`data.finalVideo.url`** - Direct video URL for playback/download
3. **`data.finalVideo.durationSec`** - Video duration for UI display
4. **`data.finalVideo.jobId`** - Same as `shortId`, stored in Firestore shorts collection

### Error Response Shape

```typescript
{
  success: false;
  error: string;              // Error code (e.g., "STORY_FINALIZE_FAILED", "INVALID_INPUT", "SERVER_BUSY")
  detail?: string;            // Human-readable error message
  retryAfter?: number;        // Present on 503 (SERVER_BUSY), seconds to wait
}
```

### HTTP Status Codes

| Status | Error Code | When |
|--------|------------|------|
| 200 | N/A | Success |
| 400 | `INVALID_INPUT` | Validation failed (missing/invalid sessionId) |
| 401 | `AUTH_REQUIRED` | Missing/invalid Bearer token |
| 402 | `INSUFFICIENT_CREDITS` | User has < 20 credits |
| 404 | `SESSION_NOT_FOUND` | Session doesn't exist or expired |
| 500 | `STORY_FINALIZE_FAILED` | Render pipeline error |
| 503 | `SERVER_BUSY` | Max concurrent renders reached (retry after 30s) |

---

## 3. Additional Integration Notes

### Authentication

- **All `/api/story/*` routes require authentication**
- Use Bearer token in `Authorization` header: `Authorization: Bearer <token>`
- Middleware: `requireAuth` (see `src/routes/story.routes.js:29`)

### Request Format

All POST routes expect JSON body with `Content-Type: application/json`.

**Common Schema**:
```typescript
{
  sessionId: string;  // min 3 chars, required for most routes
}
```

**Specific Schemas**:
- `/api/story/start`: `{ input: string, inputType?: "link" | "idea" | "paragraph", styleKey?: "default" | "hype" | "cozy" }`
- `/api/story/generate`: `{ sessionId: string, input?: string, inputType?: string }`
- `/api/story/update-shot`: `{ sessionId: string, sentenceIndex: number, clipId: string }`
- `/api/story/update-beat-text`: `{ sessionId: string, sentenceIndex: number, text: string }`
- `/api/story/search-shot`: `{ sessionId: string, sentenceIndex: number, query?: string, page?: number }`

### Finalize Behavior

- **Synchronous blocking call** - Can take 2-10 minutes
- **Server timeout**: 15 minutes (configured in server)
- **Credit cost**: 20 credits per render (checked by `enforceCreditsForRender()` middleware)
- **Concurrency limit**: Uses `withRenderSlot()` semaphore to limit concurrent renders
- **Retry logic**: On 503 (SERVER_BUSY), wait `Retry-After` seconds before retry

### Session State

After finalize, session status becomes `"rendered"` and includes:
- `finalVideo` object with `url`, `durationSec`, `jobId`
- `renderedSegments` array (paths to rendered segment files)
- Full session data available via `GET /api/story/:sessionId`

### Related Endpoints

- `GET /api/shorts/:jobId` - Get short details by jobId (from `finalVideo.jobId`)
- `GET /api/shorts/mine` - List user's rendered shorts

---

## 4. Verification Summary

✅ **All requested routes exist exactly as specified**  
✅ **Finalize returns `{ success, data, shortId }` with `data.finalVideo.url` and `data.finalVideo.jobId`**  
✅ **GET session route exists at `/api/story/:sessionId`**  
✅ **All routes require authentication (Bearer token)**  
✅ **Error responses follow consistent `{ success: false, error, detail }` shape**

**No code changes required** - Backend is ready for mobile integration.
