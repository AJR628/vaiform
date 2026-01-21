# Vaiform Mobile Spec Pack

> **Target**: Expo (React Native) client consuming existing Vaiform backend  
> **Generated**: January 2026  
> **Source**: Codebase audit of `vaiform-1` repository

---

## 1. Overview

This document specifies the complete API contract for building a native mobile client (Expo/React Native) that consumes the existing Vaiform backend. The mobile app is **client-only**; all business logic, rendering, and storage remain on the server.

**In Scope (Mobile V1)**:
- Firebase Authentication (Google Sign-In)
- Article Explainer pipeline (story creation, editing, rendering)
- My Shorts library (view, play, share rendered videos)
- Credit balance display
- Voice selection and TTS preview

**Out of Scope (Mobile V1)**:
- In-app payments (no Stripe SDK / IAP) - users deep-link to web checkout
- Push notifications
- Offline mode
- Caption style editor (simplified preset selection only)

---

## 2. Base Configuration

### API Base URL

```
API_BASE_URL = "https://your-backend-domain.com"
```

All endpoints are relative to this base. Example: `POST ${API_BASE_URL}/api/story/start`

### Required Headers

Every API request MUST include:

```http
Authorization: Bearer <firebase_id_token>
Content-Type: application/json
x-client: mobile
```

| Header | Value | Required | Notes |
|--------|-------|----------|-------|
| `Authorization` | `Bearer <idToken>` | Yes (except health) | Firebase ID token from `auth().currentUser.getIdToken()` |
| `Content-Type` | `application/json` | Yes (POST/PUT) | All request bodies are JSON |
| `x-client` | `mobile` | Yes | Identifies mobile client for analytics/debugging |

### Authentication Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Mobile App     │     │  Firebase Auth   │     │  Vaiform API    │
└────────┬────────┘     └────────┬─────────┘     └────────┬────────┘
         │                       │                        │
         │  1. signInWithGoogle()│                        │
         │──────────────────────>│                        │
         │                       │                        │
         │  2. UserCredential    │                        │
         │<──────────────────────│                        │
         │                       │                        │
         │  3. getIdToken()      │                        │
         │──────────────────────>│                        │
         │                       │                        │
         │  4. idToken (JWT)     │                        │
         │<──────────────────────│                        │
         │                       │                        │
         │  5. POST /api/users/ensure                     │
         │  Authorization: Bearer <idToken>               │
         │───────────────────────────────────────────────>│
         │                       │                        │
         │                       │  6. verifyIdToken()    │
         │                       │<───────────────────────│
         │                       │                        │
         │                       │  7. decoded token      │
         │                       │───────────────────────>│
         │                       │                        │
         │  8. { success: true, data: { uid, credits } }  │
         │<───────────────────────────────────────────────│
```

**Backend Middleware**: `requireAuth` ([src/middleware/requireAuth.js:4-29](src/middleware/requireAuth.js))
- Extracts token from `Authorization: Bearer <token>`
- Calls `admin.auth().verifyIdToken(idToken)`
- Sets `req.user = { uid, email }`
- Returns 401 on invalid/missing token

**On 401 Response**:
1. Clear local token storage
2. Sign out from Firebase Auth
3. Navigate to login screen
4. Show toast: "Session expired. Please sign in again."

### CORS Notes

The backend allows requests from configured origins. Mobile apps typically don't send `Origin` headers, so CORS should not block requests. If issues arise, ensure the backend's CORS config includes mobile or allows null origins.

---

## 3. Canonical Endpoints Table

### Authentication & User

| Method | Path | Auth | Purpose | Source |
|--------|------|------|---------|--------|
| `POST` | `/api/users/ensure` | Yes | Create/update user doc on login | [src/routes/users.routes.js:14](src/routes/users.routes.js) |
| `GET` | `/api/user/me` | Yes | Get current user profile | [src/routes/user.routes.js:40](src/routes/user.routes.js) |
| `GET` | `/credits` | Yes | Get credit balance | [src/routes/credits.routes.js:11](src/routes/credits.routes.js) |

### Story Pipeline (Core Feature)

| Method | Path | Auth | Purpose | Rate Limit | Source |
|--------|------|------|---------|------------|--------|
| `POST` | `/api/story/start` | Yes | Create new story session | - | [src/routes/story.routes.js:48](src/routes/story.routes.js) |
| `POST` | `/api/story/generate` | Yes | Generate script from input | 300/day | [src/routes/story.routes.js:79](src/routes/story.routes.js) |
| `POST` | `/api/story/plan` | Yes | Generate visual shot plan | 300/day | [src/routes/story.routes.js:387](src/routes/story.routes.js) |
| `POST` | `/api/story/search` | Yes | Search clips for all shots | - | [src/routes/story.routes.js:416](src/routes/story.routes.js) |
| `POST` | `/api/story/search-shot` | Yes | Search clips for single shot | - | [src/routes/story.routes.js:482](src/routes/story.routes.js) |
| `POST` | `/api/story/update-shot` | Yes | Swap selected clip for shot | - | [src/routes/story.routes.js:445](src/routes/story.routes.js) |
| `POST` | `/api/story/update-script` | Yes | Update all sentences | - | [src/routes/story.routes.js:110](src/routes/story.routes.js) |
| `POST` | `/api/story/update-beat-text` | Yes | Edit single beat text | - | [src/routes/story.routes.js:606](src/routes/story.routes.js) |
| `POST` | `/api/story/insert-beat` | Yes | Insert new beat with clip search | - | [src/routes/story.routes.js:528](src/routes/story.routes.js) |
| `POST` | `/api/story/delete-beat` | Yes | Delete beat (sentence + shot) | - | [src/routes/story.routes.js:565](src/routes/story.routes.js) |
| `POST` | `/api/story/finalize` | Yes | Render final video | 20 credits | [src/routes/story.routes.js:727](src/routes/story.routes.js) |
| `GET` | `/api/story/:sessionId` | Yes | Get session state | - | [src/routes/story.routes.js:936](src/routes/story.routes.js) |

### Shorts Library

| Method | Path | Auth | Purpose | Source |
|--------|------|------|---------|--------|
| `GET` | `/api/shorts/mine` | Yes | List user's rendered shorts | [src/routes/shorts.routes.js:12](src/routes/shorts.routes.js) |
| `GET` | `/api/shorts/:jobId` | Yes | Get single short details | [src/routes/shorts.routes.js:13](src/routes/shorts.routes.js) |

### Voice & TTS

| Method | Path | Auth | Purpose | Rate Limit | Source |
|--------|------|------|---------|------------|--------|
| `GET` | `/api/voice/voices` | Yes | List available voices | - | [src/routes/voice.routes.js:7](src/routes/voice.routes.js) |
| `POST` | `/api/voice/preview` | Yes | Preview voice with sample | - | [src/routes/voice.routes.js:8](src/routes/voice.routes.js) |
| `POST` | `/api/tts/preview` | Yes | Generate TTS audio | 5/min | [src/routes/tts.routes.js:24](src/routes/tts.routes.js) |

### Health (No Auth)

| Method | Path | Auth | Purpose | Source |
|--------|------|------|---------|--------|
| `GET` | `/health` | No | Health check | [src/routes/health.routes.js:10](src/routes/health.routes.js) |

---

## 4. Detailed Endpoint Contracts

### 4.1 POST /api/users/ensure

**When to call**: Immediately after successful Firebase sign-in (Google, email, etc.)

**Request Schema** (Zod from [src/routes/users.routes.js:14-101](src/routes/users.routes.js)):
```typescript
// No request body required - user info derived from auth token
{}
```

**Request Example**:
```json
{}
```

**Response Schema**:
```typescript
{
  success: boolean;
  data: {
    uid: string;
    email: string | null;
    plan: "free" | "creator" | "pro";
    isMember: boolean;
    subscriptionStatus: string | null;
    credits: number;
    freeShortsUsed: number;
  }
}
```

**Response Example (New User)**:
```json
{
  "success": true,
  "data": {
    "uid": "abc123xyz",
    "email": "user@example.com",
    "plan": "free",
    "isMember": false,
    "subscriptionStatus": null,
    "credits": 100,
    "freeShortsUsed": 0
  }
}
```

**Response Example (Existing User)**:
```json
{
  "success": true,
  "data": {
    "uid": "abc123xyz",
    "email": "user@example.com",
    "isMember": true,
    "subscriptionStatus": "active",
    "credits": 2340,
    "freeShortsUsed": 4
  }
}
```

**Error Codes**:
| Status | Error Code | When |
|--------|------------|------|
| 400 | `INVALID_REQUEST` | UID not found in auth token |
| 401 | `AUTH_REQUIRED` | Missing/invalid Bearer token |
| 500 | `ENSURE_FAILED` | Firestore write failed |

**Error Example**:
```json
{
  "success": false,
  "error": "AUTH_REQUIRED",
  "code": "UNAUTHENTICATED",
  "message": "You need to sign in to create shorts."
}
```

**Notes**:
- Creates user doc with 100 welcome credits if new
- Preserves existing credits/membership for returning users
- Safe to call multiple times (idempotent)

---

### 4.2 GET /api/user/me

**When to call**: On app launch (after auth), to refresh user profile

**Request**: No body

**Response Schema**:
```typescript
{
  ok: boolean;
  data: {
    uid: string;
    email: string;
    plan: "free" | "creator" | "pro";
    isMember: boolean;
    credits: number;
    membership: object | null;
  }
}
```

**Response Example**:
```json
{
  "ok": true,
  "data": {
    "uid": "abc123xyz",
    "email": "user@example.com",
    "plan": "creator",
    "isMember": true,
    "credits": 2500,
    "membership": {
      "kind": "subscription",
      "startedAt": "2025-01-15T00:00:00Z"
    }
  }
}
```

**Error Codes**:
| Status | Error Code | When |
|--------|------------|------|
| 401 | `AUTH_REQUIRED` | Missing/invalid Bearer token |
| 404 | `USER_NOT_FOUND` | User doc doesn't exist |
| 500 | `FETCH_FAILED` | Firestore read failed |

---

### 4.3 GET /credits

**When to call**: To display credit balance, before render operations

**Request**: No body

**Response Schema**:
```typescript
{
  success: boolean;
  uid: string;
  email: string;
  credits: number;
}
```

**Response Example**:
```json
{
  "success": true,
  "uid": "abc123xyz",
  "email": "user@example.com",
  "credits": 80
}
```

**Error Codes**:
| Status | Error Code | When |
|--------|------------|------|
| 401 | `AUTH_REQUIRED` | Missing/invalid Bearer token |
| 500 | `CREDITS_ERROR` | Firestore error |

---

### 4.4 POST /api/story/start

**When to call**: User taps "Create" and enters input (link, idea, or paragraph)

**Request Schema** (Zod from [src/routes/story.routes.js:31-35](src/routes/story.routes.js)):
```typescript
{
  input: string;           // 1-2000 chars, required
  inputType: "link" | "idea" | "paragraph";  // default: "paragraph"
  styleKey?: "default" | "hype" | "cozy";    // default: "default"
}
```

**Request Example**:
```json
{
  "input": "https://techcrunch.com/2025/01/15/ai-breakthrough",
  "inputType": "link",
  "styleKey": "default"
}
```

**Response Schema**:
```typescript
{
  success: boolean;
  data: {
    id: string;              // Session ID (e.g., "story-uuid")
    uid: string;
    input: {
      text: string;
      type: string;
      url?: string;
    };
    styleKey: string;
    status: "draft";
    createdAt: string;       // ISO 8601
    updatedAt: string;
    expiresAt: string;       // Session expires after 48 hours
  }
}
```

**Response Example**:
```json
{
  "success": true,
  "data": {
    "id": "story-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "uid": "abc123xyz",
    "input": {
      "text": "https://techcrunch.com/2025/01/15/ai-breakthrough",
      "type": "link",
      "url": "https://techcrunch.com/2025/01/15/ai-breakthrough"
    },
    "styleKey": "default",
    "status": "draft",
    "createdAt": "2025-01-20T10:30:00.000Z",
    "updatedAt": "2025-01-20T10:30:00.000Z",
    "expiresAt": "2025-01-22T10:30:00.000Z"
  }
}
```

**Error Codes**:
| Status | Error Code | When |
|--------|------------|------|
| 400 | `INVALID_INPUT` | Validation failed (empty input, too long) |
| 401 | `AUTH_REQUIRED` | Missing/invalid Bearer token |
| 500 | `STORY_START_FAILED` | Session creation failed |

---

### 4.5 POST /api/story/generate

**When to call**: After `/start`, to generate the script from input

**Request Schema** (Zod from [src/routes/story.routes.js:41-45](src/routes/story.routes.js)):
```typescript
{
  sessionId: string;         // min 3 chars, required
  input?: string;            // Optional override (1-2000 chars)
  inputType?: "link" | "idea" | "paragraph";
}
```

**Request Example**:
```json
{
  "sessionId": "story-a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

**Response Schema**:
```typescript
{
  success: boolean;
  data: {
    id: string;
    status: "story_generated";
    story: {
      sentences: string[];   // 4-8 sentences
    };
    // ... other session fields
  }
}
```

**Response Example**:
```json
{
  "success": true,
  "data": {
    "id": "story-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "story_generated",
    "story": {
      "sentences": [
        "A groundbreaking AI model has just shattered previous benchmarks.",
        "Researchers at OpenAI unveiled GPT-5 with unprecedented reasoning capabilities.",
        "The model can now solve complex math problems that stumped earlier versions.",
        "Industry experts predict this will transform how we interact with technology.",
        "But concerns about AI safety remain at the forefront of the conversation."
      ]
    },
    "input": {
      "text": "https://techcrunch.com/2025/01/15/ai-breakthrough",
      "type": "link"
    },
    "updatedAt": "2025-01-20T10:31:15.000Z"
  }
}
```

**Error Codes**:
| Status | Error Code | When |
|--------|------------|------|
| 400 | `INVALID_INPUT` | Validation failed |
| 401 | `AUTH_REQUIRED` | Missing/invalid Bearer token |
| 429 | `SCRIPT_LIMIT_REACHED` | Daily script generation limit (300/day) |
| 500 | `STORY_GENERATE_FAILED` | LLM or processing error |

**Rate Limit**: 300 script generations per day per user ([src/middleware/planGuards.js:204-282](src/middleware/planGuards.js))

---

### 4.6 POST /api/story/plan

**When to call**: After `/generate`, to create visual shot plan

**Request Schema**:
```typescript
{
  sessionId: string;  // min 3 chars, required
}
```

**Request Example**:
```json
{
  "sessionId": "story-a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

**Response Schema**:
```typescript
{
  success: boolean;
  data: {
    id: string;
    status: "plan_generated";
    plan: {
      shots: Array<{
        sentenceIndex: number;
        visualDescription: string;
        searchQuery: string;
        durationSec: number;
      }>;
    };
    // ... other session fields
  }
}
```

**Response Example**:
```json
{
  "success": true,
  "data": {
    "id": "story-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "plan_generated",
    "plan": {
      "shots": [
        {
          "sentenceIndex": 0,
          "visualDescription": "Futuristic AI neural network visualization",
          "searchQuery": "artificial intelligence neural network",
          "durationSec": 4
        },
        {
          "sentenceIndex": 1,
          "visualDescription": "OpenAI office or tech laboratory",
          "searchQuery": "tech company office modern",
          "durationSec": 5
        }
      ]
    }
  }
}
```

**Error Codes**:
| Status | Error Code | When |
|--------|------------|------|
| 400 | `INVALID_INPUT` | Validation failed |
| 429 | `SCRIPT_LIMIT_REACHED` | Daily limit exceeded |
| 500 | `STORY_PLAN_FAILED` | LLM or processing error |

---

### 4.7 POST /api/story/search

**When to call**: After `/plan`, to search clips for all shots at once

**Request Schema**:
```typescript
{
  sessionId: string;  // min 3 chars, required
}
```

**Response Schema**:
```typescript
{
  success: boolean;
  data: {
    id: string;
    status: "clips_searched";
    shots: Array<{
      sentenceIndex: number;
      searchQuery: string;
      candidates: Array<{
        id: string;
        url: string;
        thumbUrl: string;
        duration: number;
        photographer?: string;
        provider: string;
      }>;
      selectedClip: object | null;
      durationSec: number;
    }>;
  }
}
```

**Response Example**:
```json
{
  "success": true,
  "data": {
    "id": "story-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": "clips_searched",
    "shots": [
      {
        "sentenceIndex": 0,
        "searchQuery": "artificial intelligence neural network",
        "candidates": [
          {
            "id": "pexels-12345",
            "url": "https://videos.pexels.com/video-files/12345/12345-hd.mp4",
            "thumbUrl": "https://images.pexels.com/videos/12345/preview.jpg",
            "duration": 15,
            "photographer": "John Doe",
            "provider": "pexels"
          },
          {
            "id": "pexels-67890",
            "url": "https://videos.pexels.com/video-files/67890/67890-hd.mp4",
            "thumbUrl": "https://images.pexels.com/videos/67890/preview.jpg",
            "duration": 12,
            "photographer": "Jane Smith",
            "provider": "pexels"
          }
        ],
        "selectedClip": null,
        "durationSec": 4
      }
    ]
  }
}
```

---

### 4.8 POST /api/story/search-shot

**When to call**: User wants to search for different clips for a specific shot

**Request Schema** (Zod from [src/routes/story.routes.js:484-489](src/routes/story.routes.js)):
```typescript
{
  sessionId: string;         // min 3 chars, required
  sentenceIndex: number;     // int >= 0, required
  query?: string;            // Custom search query
  page?: number;             // int >= 1, default 1
}
```

**Request Example**:
```json
{
  "sessionId": "story-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "sentenceIndex": 0,
  "query": "futuristic technology",
  "page": 1
}
```

**Response Schema**:
```typescript
{
  success: boolean;
  data: {
    shot: {
      sentenceIndex: number;
      candidates: Array<{
        id: string;
        url: string;
        thumbUrl: string;
        duration: number;
        photographer?: string;
        provider: string;
      }>;
      selectedClip: object | null;
    };
    page: number;
    hasMore: boolean;
  }
}
```

**Response Example**:
```json
{
  "success": true,
  "data": {
    "shot": {
      "sentenceIndex": 0,
      "candidates": [
        {
          "id": "pexels-99999",
          "url": "https://videos.pexels.com/video-files/99999/99999-hd.mp4",
          "thumbUrl": "https://images.pexels.com/videos/99999/preview.jpg",
          "duration": 10,
          "photographer": "Tech Videos",
          "provider": "pexels"
        }
      ],
      "selectedClip": null
    },
    "page": 1,
    "hasMore": true
  }
}
```

---

### 4.9 POST /api/story/update-shot

**When to call**: User selects a different clip for a shot

**Request Schema** (Zod from [src/routes/story.routes.js:447-451](src/routes/story.routes.js)):
```typescript
{
  sessionId: string;         // min 3 chars, required
  sentenceIndex: number;     // int >= 0, required
  clipId: string;            // min 1 char, required
}
```

**Request Example**:
```json
{
  "sessionId": "story-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "sentenceIndex": 0,
  "clipId": "pexels-99999"
}
```

**Response Schema**:
```typescript
{
  success: boolean;
  data: {
    shot: {
      sentenceIndex: number;
      selectedClip: {
        id: string;
        url: string;
        thumbUrl: string;
        // ...
      };
    };
  }
}
```

---

### 4.10 POST /api/story/update-beat-text

**When to call**: User edits a single beat's text

**Request Schema** (Zod from [src/routes/story.routes.js:600-604](src/routes/story.routes.js)):
```typescript
{
  sessionId: string;         // min 3 chars, required
  sentenceIndex: number;     // int >= 0, required
  text: string;              // min 1 char, required
}
```

**Request Example**:
```json
{
  "sessionId": "story-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "sentenceIndex": 2,
  "text": "The revolutionary model solves complex problems with ease."
}
```

**Response Schema**:
```typescript
{
  success: boolean;
  data: {
    sentences: string[];
    shots: Array<object>;
  }
}
```

---

### 4.11 POST /api/story/insert-beat

**When to call**: User adds a new beat to the story

**Request Schema** (Zod from [src/routes/story.routes.js:530-534](src/routes/story.routes.js)):
```typescript
{
  sessionId: string;         // min 3 chars, required
  insertAfterIndex: number;  // int >= -1 (-1 = insert at beginning)
  text: string;              // min 1 char, required
}
```

**Request Example**:
```json
{
  "sessionId": "story-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "insertAfterIndex": 1,
  "text": "This marks a turning point in AI history."
}
```

**Response Schema**:
```typescript
{
  success: boolean;
  data: {
    sentences: string[];
    shots: Array<object>;
    insertedIndex: number;
  }
}
```

---

### 4.12 POST /api/story/delete-beat

**When to call**: User removes a beat from the story

**Request Schema** (Zod from [src/routes/story.routes.js:567-570](src/routes/story.routes.js)):
```typescript
{
  sessionId: string;         // min 3 chars, required
  sentenceIndex: number;     // int >= 0, required
}
```

**Request Example**:
```json
{
  "sessionId": "story-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "sentenceIndex": 3
}
```

**Response Schema**:
```typescript
{
  success: boolean;
  data: {
    sentences: string[];
    shots: Array<object>;
  }
}
```

---

### 4.13 POST /api/story/finalize

**When to call**: User taps "Render" to create final video

**IMPORTANT**: This is a **synchronous blocking call** that can take 2-10 minutes. Show a loading screen with progress indication.

**Request Schema**:
```typescript
{
  sessionId: string;         // min 3 chars, required
  options?: {
    // Future: voice selection, caption style, etc.
  }
}
```

**Request Example**:
```json
{
  "sessionId": "story-a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

**Response Schema**:
```typescript
{
  success: boolean;
  data: {
    id: string;
    status: "rendered";
    finalVideo: {
      url: string;           // Public video URL
      durationSec: number;
      jobId: string;         // Use this for /api/shorts/:jobId
    };
  };
  shortId: string;           // Convenience field = finalVideo.jobId
}
```

**Response Example**:
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

**Error Codes**:
| Status | Error Code | When |
|--------|------------|------|
| 400 | `INVALID_INPUT` | Validation failed |
| 401 | `AUTH_REQUIRED` | Missing/invalid Bearer token |
| 402 | `INSUFFICIENT_CREDITS` | User has < 20 credits |
| 404 | `SESSION_NOT_FOUND` | Session doesn't exist or expired |
| 500 | `STORY_FINALIZE_FAILED` | Render pipeline error |
| 503 | `SERVER_BUSY` | Max concurrent renders reached (retry after 30s) |

**Credit Cost**: 20 credits per render ([src/services/credit.service.js:73](src/services/credit.service.js))

**Retry Header**: On 503, response includes `Retry-After: 30` header

**Notes**:
- Set HTTP timeout to at least 15 minutes
- Show "Rendering..." spinner with estimated time
- On success, navigate to short detail screen using `shortId`

---

### 4.14 GET /api/story/:sessionId

**When to call**: Resume editing a session, or poll for status

**Request**: No body. Session ID in URL path.

**Response Schema**:
```typescript
{
  success: boolean;
  data: {
    id: string;
    uid: string;
    status: "draft" | "story_generated" | "plan_generated" | "clips_searched" | "rendered";
    input: object;
    story?: { sentences: string[] };
    plan?: { shots: Array<object> };
    shots?: Array<object>;
    finalVideo?: { url: string; durationSec: number; jobId: string };
    createdAt: string;
    updatedAt: string;
    expiresAt: string;
  }
}
```

**Error Codes**:
| Status | Error Code | When |
|--------|------------|------|
| 400 | `INVALID_INPUT` | Empty sessionId |
| 404 | `NOT_FOUND` | Session doesn't exist or expired |

---

### 4.15 GET /api/shorts/mine

**When to call**: Load "My Shorts" library screen

**Query Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | 24 | Max items per page (capped at 100) |
| `cursor` | string | - | ISO date string for pagination |

**Request Example**:
```
GET /api/shorts/mine?limit=20
GET /api/shorts/mine?limit=20&cursor=2025-01-15T10:00:00.000Z
```

**Response Schema**:
```typescript
{
  success: boolean;
  data: {
    items: Array<{
      id: string;
      ownerId: string;
      status: "ready" | "processing" | "failed";
      videoUrl: string;
      thumbUrl: string;
      coverImageUrl: string;
      durationSec: number;
      quoteText: string;
      mode: string;
      template: string;
      voiceover: boolean;
      createdAt: string;      // ISO date
      completedAt: string;
    }>;
    nextCursor: string | null;
    hasMore: boolean;
    note?: string;            // "INDEX_FALLBACK" if using fallback query
  }
}
```

**Response Example**:
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "short-xyz-123",
        "ownerId": "abc123xyz",
        "status": "ready",
        "videoUrl": "https://firebasestorage.googleapis.com/.../short.mp4?...",
        "thumbUrl": "https://firebasestorage.googleapis.com/.../cover.jpg?...",
        "coverImageUrl": "https://firebasestorage.googleapis.com/.../cover.jpg?...",
        "durationSec": 32,
        "quoteText": "A groundbreaking AI model has just shattered...",
        "mode": "story",
        "template": "story",
        "voiceover": true,
        "createdAt": "2025-01-20T10:45:00.000Z",
        "completedAt": "2025-01-20T10:47:30.000Z"
      }
    ],
    "nextCursor": "2025-01-20T10:45:00.000Z",
    "hasMore": true
  }
}
```

---

### 4.16 GET /api/shorts/:jobId

**When to call**: View short detail, play video

**Request**: No body. Job ID in URL path.

**Response Schema**:
```typescript
{
  success: boolean;
  data: {
    jobId: string;
    videoUrl: string;
    coverImageUrl: string | null;
    durationSec: number | null;
    usedTemplate: string | null;
    usedQuote: string | null;
    credits: number | null;
    createdAt: string | null;
  }
}
```

**Response Example**:
```json
{
  "success": true,
  "data": {
    "jobId": "short-xyz-123",
    "videoUrl": "https://firebasestorage.googleapis.com/.../short.mp4?alt=media&token=xxx",
    "coverImageUrl": "https://firebasestorage.googleapis.com/.../cover.jpg?alt=media&token=xxx",
    "durationSec": 32,
    "usedTemplate": "story",
    "usedQuote": "A groundbreaking AI model has just shattered previous benchmarks...",
    "credits": 20,
    "createdAt": "2025-01-20T10:45:00.000Z"
  }
}
```

**Error Codes**:
| Status | Error Code | When |
|--------|------------|------|
| 400 | `INVALID_INPUT` | Empty jobId |
| 404 | `NOT_FOUND` | Short doesn't exist |

---

### 4.17 GET /api/voice/voices

**When to call**: Load voice picker UI

**Response Schema**:
```typescript
{
  success: boolean;
  data: {
    voices: Array<{
      id: string;
      name: string;
      description: string;
      category: "male" | "female";
      accent: string;
    }>;
    provider: "elevenlabs";
  }
}
```

**Response Example**:
```json
{
  "success": true,
  "data": {
    "voices": [
      {
        "id": "JBFqnCBsd6RMkjVDRZzb",
        "name": "Adam",
        "description": "Warm, confident male voice",
        "category": "male",
        "accent": "american"
      },
      {
        "id": "EXAVITQu4vr4xnSDxMaL",
        "name": "Bella",
        "description": "Calm, professional female voice",
        "category": "female",
        "accent": "american"
      }
    ],
    "provider": "elevenlabs"
  }
}
```

**Error Codes**:
| Status | Error Code | When |
|--------|------------|------|
| 503 | `ELEVENLABS_NOT_CONFIGURED` | API key not set on server |

---

### 4.18 POST /api/voice/preview

**When to call**: User taps voice to hear sample

**Request Schema** (Zod from [src/controllers/voice.controller.js:3-6](src/controllers/voice.controller.js)):
```typescript
{
  voiceId: string;           // min 1 char, required
  text?: string;             // 1-100 chars, default: "Hello, this is a preview..."
}
```

**Request Example**:
```json
{
  "voiceId": "JBFqnCBsd6RMkjVDRZzb",
  "text": "Welcome to Vaiform!"
}
```

**Response Schema**:
```typescript
{
  success: boolean;
  data: {
    audio: string;           // Base64 data URL: "data:audio/mpeg;base64,..."
    voiceId: string;
    text: string;
    duration: number | null;
  }
}
```

**Response Example**:
```json
{
  "success": true,
  "data": {
    "audio": "data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2...",
    "voiceId": "JBFqnCBsd6RMkjVDRZzb",
    "text": "Welcome to Vaiform!",
    "duration": null
  }
}
```

**Playing Audio in React Native**:
```typescript
import { Audio } from 'expo-av';

const playPreview = async (base64Audio: string) => {
  const { sound } = await Audio.Sound.createAsync(
    { uri: base64Audio },
    { shouldPlay: true }
  );
};
```

---

### 4.19 POST /api/tts/preview

**When to call**: Generate TTS for specific text (advanced use)

**Request Schema** (Zod from [src/schemas/tts.schema.js:10-16](src/schemas/tts.schema.js)):
```typescript
{
  text: string;              // min 1 char, required
  voiceId: string;           // min 1 char, required
  modelId?: string;          // default: "eleven_multilingual_v2"
  outputFormat?: string;     // default: "mp3_44100_128"
  voiceSettings?: {
    stability?: number;      // 0-1, default: 0.5
    similarity_boost?: number; // 0-1, default: 0.75
    style?: number;          // 0-100, default: 0
    use_speaker_boost?: boolean; // default: true
  }
}
```

**Request Example**:
```json
{
  "text": "This is a test of the text to speech system.",
  "voiceId": "JBFqnCBsd6RMkjVDRZzb",
  "voiceSettings": {
    "stability": 0.6,
    "similarity_boost": 0.8
  }
}
```

**Response Schema**:
```typescript
{
  success: boolean;
  data: {
    audio: string;           // Base64 data URL
    voiceId: string;
    text: string;
    duration: number | null;
  }
}
```

**Rate Limit**: 5 requests per minute ([src/routes/tts.routes.js:7-21](src/routes/tts.routes.js))

**Error Codes**:
| Status | Error Code | When |
|--------|------------|------|
| 400 | `INVALID_INPUT` | Validation failed |
| 429 | `RATE_LIMIT_EXCEEDED` | More than 5 req/min |

---

## 5. Mobile Screen Map & Wiring

### 5.1 Auth Screens

#### Login / Signup Screen

**UI Components**:
- Logo/branding
- "Continue with Google" button
- Loading spinner
- Error toast area

**State**:
```typescript
{
  isLoading: boolean;
  error: string | null;
}
```

**Network Calls**:
1. `GoogleSignin.signIn()` → Get Google credential
2. `auth().signInWithCredential(credential)` → Firebase sign-in
3. `user.getIdToken()` → Get ID token
4. `POST /api/users/ensure` → Create/update user doc

**Flow**:
```
User taps "Continue with Google"
  → Show loading
  → Google sign-in popup
  → Firebase auth
  → Get ID token
  → POST /api/users/ensure
  → Store token + user data
  → Navigate to Home
```

**Empty/Loading/Error States**:
- Loading: Full-screen spinner with "Signing in..."
- Error: Toast with retry option

---

### 5.2 Home / Create Screen

**UI Components**:
- Header with credits badge
- Input type selector (Link / Idea / Write)
- Text input area
- "Create" button
- Recent drafts list (optional)

**State**:
```typescript
{
  inputType: "link" | "idea" | "paragraph";
  inputText: string;
  isCreating: boolean;
  credits: number;
  error: string | null;
}
```

**Network Calls**:
1. `GET /credits` → Load credit balance on mount
2. `POST /api/story/start` → Create session
3. `POST /api/story/generate` → Generate script

**Flow**:
```
User enters input + taps "Create"
  → Validate input not empty
  → Show loading
  → POST /api/story/start
  → POST /api/story/generate
  → Navigate to Editor with sessionId
```

**Empty/Loading/Error States**:
- Empty: Show input placeholder text
- Loading: Button shows spinner, input disabled
- Error: Inline error message below input

---

### 5.3 Editor Screen

**UI Components**:
- Back button
- Beat list (scrollable)
  - Each beat: text + clip thumbnail + edit/delete buttons
- "Add Beat" button
- "Search Clips" button per beat
- "Render" button (bottom)
- Credits indicator

**State**:
```typescript
{
  sessionId: string;
  session: StorySession | null;
  isLoading: boolean;
  isRendering: boolean;
  editingBeatIndex: number | null;
  error: string | null;
}
```

**Network Calls**:
1. `GET /api/story/:sessionId` → Load session on mount
2. `POST /api/story/plan` → Generate shot plan (if not done)
3. `POST /api/story/search` → Search clips (if not done)
4. `POST /api/story/update-beat-text` → Edit beat
5. `POST /api/story/insert-beat` → Add beat
6. `POST /api/story/delete-beat` → Remove beat
7. `POST /api/story/search-shot` → Search clips for beat
8. `POST /api/story/update-shot` → Select clip
9. `POST /api/story/finalize` → Render video

**Flow (Initial Load)**:
```
Screen mounts with sessionId
  → GET /api/story/:sessionId
  → If status == "story_generated":
      → POST /api/story/plan
      → POST /api/story/search
  → Display beats with clips
```

**Flow (Render)**:
```
User taps "Render"
  → Check credits >= 20
  → Show full-screen "Rendering..." modal
  → POST /api/story/finalize (long request)
  → On success: Navigate to Short Detail
  → On error: Show error, allow retry
```

**Empty/Loading/Error States**:
- Loading: Skeleton beat cards
- Rendering: Full-screen modal with animation
- Error: Toast + retry button

---

### 5.4 Clip Search Modal

**UI Components**:
- Search input
- Clip grid (2 columns)
- Load more button
- Close button

**State**:
```typescript
{
  beatIndex: number;
  query: string;
  clips: Clip[];
  page: number;
  hasMore: boolean;
  isLoading: boolean;
}
```

**Network Calls**:
1. `POST /api/story/search-shot` → Search clips
2. `POST /api/story/update-shot` → Select clip

**Flow**:
```
User opens modal for beat
  → Load current candidates
  → User types search query
  → POST /api/story/search-shot
  → Display results
  → User taps clip
  → POST /api/story/update-shot
  → Close modal, update beat
```

---

### 5.5 My Shorts (Library) Screen

**UI Components**:
- Header with title
- Grid of short cards (2 columns)
  - Each card: thumbnail, duration badge
- Pull-to-refresh
- Load more on scroll
- Empty state illustration

**State**:
```typescript
{
  shorts: Short[];
  isLoading: boolean;
  isRefreshing: boolean;
  cursor: string | null;
  hasMore: boolean;
  error: string | null;
}
```

**Network Calls**:
1. `GET /api/shorts/mine` → Load shorts
2. `GET /api/shorts/mine?cursor=...` → Load more

**Flow**:
```
Screen mounts
  → GET /api/shorts/mine?limit=20
  → Display grid

User scrolls to bottom (hasMore == true)
  → GET /api/shorts/mine?limit=20&cursor=...
  → Append to list

User pulls to refresh
  → GET /api/shorts/mine?limit=20
  → Replace list
```

**Empty/Loading/Error States**:
- Empty: Illustration + "Create your first short" CTA
- Loading: Skeleton grid
- Error: Retry button

---

### 5.6 Short Detail Screen

**UI Components**:
- Video player (full width, 9:16 aspect)
- Play/pause controls
- Share button
- Download button (if supported)
- Delete button
- Metadata (duration, created date)

**State**:
```typescript
{
  jobId: string;
  short: ShortDetail | null;
  isLoading: boolean;
  isPlaying: boolean;
  error: string | null;
}
```

**Network Calls**:
1. `GET /api/shorts/:jobId` → Load short details

**Flow**:
```
Screen mounts with jobId
  → GET /api/shorts/:jobId
  → Load video player with videoUrl
  → Auto-play or show play button
```

**Video Playback (Expo AV)**:
```typescript
import { Video } from 'expo-av';

<Video
  source={{ uri: short.videoUrl }}
  style={{ width: '100%', aspectRatio: 9/16 }}
  useNativeControls
  resizeMode="contain"
  shouldPlay={isPlaying}
/>
```

---

### 5.7 Profile / Settings Screen

**UI Components**:
- User avatar + email
- Credits balance (large)
- "Buy Credits" button (deep link to web)
- Plan badge
- Sign out button

**State**:
```typescript
{
  user: User | null;
  credits: number;
  isLoading: boolean;
}
```

**Network Calls**:
1. `GET /api/user/me` → Load user profile
2. `GET /credits` → Load credit balance

**Buy Credits Flow**:
```typescript
import { Linking } from 'react-native';

const buyCredits = () => {
  Linking.openURL('https://vaiform.com/pricing');
};
```

---

## 6. Polling & Job Model

### Render Model

The `/api/story/finalize` endpoint is **synchronous** - it blocks until the video is fully rendered. This can take 2-10 minutes depending on video length and server load.

**Recommendations**:

1. **HTTP Timeout**: Set fetch timeout to 15 minutes (900000ms)
```typescript
const response = await fetch(url, {
  method: 'POST',
  headers,
  body: JSON.stringify({ sessionId }),
  signal: AbortSignal.timeout(900000) // 15 minutes
});
```

2. **UI Feedback**: Show a modal with:
   - Animated spinner or progress indicator
   - "Rendering your video..." message
   - Estimated time: "This usually takes 2-5 minutes"
   - Cancel button (note: canceling the request doesn't stop server-side render)

3. **Background Handling**: If user backgrounds the app:
   - Keep the request alive if possible
   - On return, check session status via `GET /api/story/:sessionId`
   - If `status == "rendered"`, navigate to result

### Server Busy (503)

When the server is at max concurrent renders:

```json
{
  "success": false,
  "error": "SERVER_BUSY",
  "retryAfter": 30
}
```

**Handling**:
```typescript
if (response.status === 503) {
  const retryAfter = response.headers.get('Retry-After') || 30;
  showToast(`Server busy. Retrying in ${retryAfter}s...`);
  await delay(retryAfter * 1000);
  return retry();
}
```

### Session Expiration

Sessions expire after 48 hours. If user returns to an expired session:

```json
{
  "success": false,
  "error": "NOT_FOUND"
}
```

**Handling**: Navigate back to Create screen with message "Session expired. Please start a new video."

---

## 7. Error & Toast Conventions

### Error Response Shape

All errors follow this structure ([src/middleware/error.middleware.js](src/middleware/error.middleware.js)):

```typescript
{
  success: false;
  error: string;           // Machine-readable code
  detail?: string;         // Human-readable message
  requestId?: string;      // For support tickets
  issues?: Array<{         // Zod validation errors
    path: string;
    message: string;
  }>;
}
```

### Error Code → User Action Mapping

| Status | Error Code | User Message | Action |
|--------|------------|--------------|--------|
| 401 | `AUTH_REQUIRED` | "Please sign in to continue" | Force logout, navigate to login |
| 402 | `INSUFFICIENT_CREDITS` | "Not enough credits. You need 20 credits to render." | Show "Buy Credits" CTA |
| 403 | `FORBIDDEN` | "You don't have permission to do this" | Show error, no retry |
| 404 | `NOT_FOUND` | "This item no longer exists" | Navigate back |
| 409 | `STALE_META` | "Data is out of sync. Refreshing..." | Auto-refresh data |
| 429 | `RATE_LIMIT_EXCEEDED` | "Too many requests. Please wait a moment." | Disable button for 60s |
| 429 | `SCRIPT_LIMIT_REACHED` | "Daily limit reached. Try again tomorrow." | Show upgrade CTA |
| 500 | Any | "Something went wrong. Please try again." | Show retry button |
| 503 | `SERVER_BUSY` | "Server is busy. Retrying..." | Auto-retry after delay |

### Toast Implementation

```typescript
// types
type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;  // ms, default 4000
  action?: {
    label: string;
    onPress: () => void;
  };
}

// Usage
showToast({
  type: 'error',
  message: 'Not enough credits to render',
  action: {
    label: 'Buy Credits',
    onPress: () => Linking.openURL('https://vaiform.com/pricing')
  }
});
```

### Network Error Handling

```typescript
async function apiRequest<T>(path: string, options: RequestInit): Promise<T> {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${await getIdToken()}`,
        'Content-Type': 'application/json',
        'x-client': 'mobile',
        ...options.headers,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      // Handle specific error codes
      if (response.status === 401) {
        await signOut();
        navigate('Login');
        throw new AuthError('Session expired');
      }
      
      if (response.status === 402) {
        showToast({
          type: 'error',
          message: data.detail || 'Insufficient credits',
          action: { label: 'Buy Credits', onPress: openPricing }
        });
        throw new PaymentError(data.error);
      }

      if (response.status === 429) {
        showToast({
          type: 'warning',
          message: data.detail || 'Rate limit exceeded'
        });
        throw new RateLimitError(data.error);
      }

      throw new ApiError(data.error, data.detail, response.status);
    }

    return data;
  } catch (error) {
    if (error instanceof TypeError && error.message === 'Network request failed') {
      showToast({
        type: 'error',
        message: 'No internet connection',
        action: { label: 'Retry', onPress: () => apiRequest(path, options) }
      });
    }
    throw error;
  }
}
```

---

## 8. TypeScript Types Reference

```typescript
// User & Auth
interface User {
  uid: string;
  email: string;
  plan: 'free' | 'creator' | 'pro';
  isMember: boolean;
  credits: number;
}

// Story Session
interface StorySession {
  id: string;
  uid: string;
  status: 'draft' | 'story_generated' | 'plan_generated' | 'clips_searched' | 'rendered';
  input: {
    text: string;
    type: 'link' | 'idea' | 'paragraph';
    url?: string;
  };
  styleKey: string;
  story?: {
    sentences: string[];
  };
  plan?: {
    shots: ShotPlan[];
  };
  shots?: Shot[];
  finalVideo?: {
    url: string;
    durationSec: number;
    jobId: string;
  };
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

interface ShotPlan {
  sentenceIndex: number;
  visualDescription: string;
  searchQuery: string;
  durationSec: number;
}

interface Shot {
  sentenceIndex: number;
  searchQuery: string;
  candidates: Clip[];
  selectedClip: Clip | null;
  durationSec: number;
}

interface Clip {
  id: string;
  url: string;
  thumbUrl: string;
  duration: number;
  photographer?: string;
  provider: string;
}

// Shorts
interface Short {
  id: string;
  ownerId: string;
  status: 'ready' | 'processing' | 'failed';
  videoUrl: string;
  thumbUrl: string;
  coverImageUrl: string;
  durationSec: number;
  quoteText: string;
  mode: string;
  template: string;
  voiceover: boolean;
  createdAt: string;
  completedAt: string;
}

interface ShortDetail {
  jobId: string;
  videoUrl: string;
  coverImageUrl: string | null;
  durationSec: number | null;
  usedTemplate: string | null;
  usedQuote: string | null;
  credits: number | null;
  createdAt: string | null;
}

// Voice
interface Voice {
  id: string;
  name: string;
  description: string;
  category: 'male' | 'female';
  accent: string;
}

// API Response
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  detail?: string;
  requestId?: string;
}
```

---

## 9. Quick Reference: Endpoint Checklist

### Must Implement for MVP

- [ ] `POST /api/users/ensure` - User setup on login
- [ ] `GET /credits` - Credit balance
- [ ] `POST /api/story/start` - Create session
- [ ] `POST /api/story/generate` - Generate script
- [ ] `POST /api/story/plan` - Plan shots
- [ ] `POST /api/story/search` - Search all clips
- [ ] `POST /api/story/update-shot` - Select clip
- [ ] `POST /api/story/finalize` - Render video
- [ ] `GET /api/story/:sessionId` - Get session
- [ ] `GET /api/shorts/mine` - List shorts
- [ ] `GET /api/shorts/:jobId` - Get short detail

### Nice to Have

- [ ] `POST /api/story/search-shot` - Search clips per shot
- [ ] `POST /api/story/update-beat-text` - Edit beat
- [ ] `POST /api/story/insert-beat` - Add beat
- [ ] `POST /api/story/delete-beat` - Remove beat
- [ ] `GET /api/voice/voices` - Voice list
- [ ] `POST /api/voice/preview` - Voice preview
- [ ] `GET /api/user/me` - Full user profile

---

## 10. Environment Variables (Mobile App)

```env
# Required
API_BASE_URL=https://your-backend-domain.com

# Firebase (from google-services.json / GoogleService-Info.plist)
# These are typically handled by @react-native-firebase/app config

# Optional
SENTRY_DSN=https://xxx@sentry.io/xxx
```

---

**End of Mobile Spec Pack**
