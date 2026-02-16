# Backend Beat Insert/Delete Contract Audit (SSOT)

**Date**: 2025-01-XX  
**Purpose**: Extract exact contract for mobile React Native integration  
**Status**: ✅ READ-ONLY AUDIT COMPLETE - NO CODE CHANGES

---

## 1. Endpoint Locations

### ✅ Insert Beat Endpoint
- **Method**: `POST`
- **Path**: `/api/story/insert-beat`
- **Route File**: `src/routes/story.routes.js:528`
- **Service Function**: `src/services/story.service.js:498` → `insertBeatWithSearch()`

### ✅ Delete Beat Endpoint
- **Method**: `POST`
- **Path**: `/api/story/delete-beat`
- **Route File**: `src/routes/story.routes.js:565`
- **Service Function**: `src/services/story.service.js:564` → `deleteBeat()`

---

## 2. Auth + Session Binding

### ✅ Authentication
- **Both endpoints require `requireAuth` middleware** (see `src/routes/story.routes.js:29`)
- Uses Bearer token: `Authorization: Bearer <token>`
- `uid` extracted from `req.user.uid` (set by `requireAuth`)

### ✅ Session Ownership Validation
- **Session binding**: `sessionId` validated via Firebase Storage path structure
- **Path pattern**: `drafts/{uid}/{sessionId}/story.json` (see `src/utils/json.store.js:3-14`)
- **Validation mechanism**: `loadStorySession({ uid, sessionId })` uses `loadJSON({ uid, studioId: sessionId })`
- **Result**: If `uid` doesn't match path, `loadJSON` returns `null` → `SESSION_NOT_FOUND` error
- **SessionId source**: Read from request body (not params or query)

---

## 3. Insert Beat Request Schema

**Source**: `src/routes/story.routes.js:530-534` (Zod schema)

```typescript
{
  sessionId: string;          // Required, min 3 chars
  insertAfterIndex: number;   // Required, integer >= -1
  text: string;               // Required, min 1 char
}
```

### Field Details

| Field | Type | Required | Constraints | Notes |
|-------|------|----------|-------------|-------|
| `sessionId` | string | ✅ Yes | `min(3)` | Session identifier |
| `insertAfterIndex` | number | ✅ Yes | `int`, `min(-1)` | `-1` = insert at beginning (index 0) |
| `text` | string | ✅ Yes | `min(1)` | Beat text (trimmed server-side) |

### Insert Position Logic

- **`insertAfterIndex = -1`**: Inserts at beginning (index 0)
- **`insertAfterIndex = 0`**: Inserts after first beat (new index = 1)
- **`insertAfterIndex = N`**: Inserts after beat N (new index = N + 1)
- **Formula**: `newIndex = insertAfterIndex < 0 ? 0 : insertAfterIndex + 1`

---

## 4. Delete Beat Request Schema

**Source**: `src/routes/story.routes.js:567-570` (Zod schema)

```typescript
{
  sessionId: string;      // Required, min 3 chars
  sentenceIndex: number;  // Required, integer >= 0
}
```

### Field Details

| Field | Type | Required | Constraints | Notes |
|-------|------|----------|-------------|-------|
| `sessionId` | string | ✅ Yes | `min(3)` | Session identifier |
| `sentenceIndex` | number | ✅ Yes | `int`, `min(0)` | **Note**: Uses `sentenceIndex` (not `beatIndex`) |

### Validation

- **Range check**: `sentenceIndex >= 0 && sentenceIndex < sentences.length`
- **Error**: `INVALID_SENTENCE_INDEX` if out of range

---

## 5. Response Schema (SSOT)

### ✅ Insert Beat Response

**Source**: `src/routes/story.routes.js:553` + `src/services/story.service.js:555-558`

```typescript
{
  success: boolean;  // true on success
  data: {
    sentences: string[];           // Updated sentences array
    shots: Array<{                 // Updated shots array
      sentenceIndex: number;       // Reindexed to match array position
      searchQuery: string;
      durationSec: number;
      selectedClip: object | null;
      candidates: object[];
    }>;
  }
}
```

**⚠️ Note**: Response does NOT include `insertedIndex` field (despite MOBILE_SPEC_PACK.md suggesting it). Calculate from `insertAfterIndex`: `insertedIndex = insertAfterIndex < 0 ? 0 : insertAfterIndex + 1`

### ✅ Delete Beat Response

**Source**: `src/routes/story.routes.js:588` + `src/services/story.service.js:595-597`

```typescript
{
  success: boolean;  // true on success
  data: {
    sentences: string[];  // Updated sentences array (one removed)
    shots: Array<{         // Updated shots array (matching shot removed)
      sentenceIndex: number;
      searchQuery: string;
      durationSec: number;
      selectedClip: object | null;
      candidates: object[];
    }>;
  }
}
```

### Error Response Shape

```typescript
{
  success: false;
  error: string;    // Error code (e.g., "INVALID_INPUT", "SESSION_NOT_FOUND", "STORY_INSERT_BEAT_FAILED")
  detail?: string;  // Human-readable error message or Zod validation details
}
```

---

## 6. Renumbering Behavior

### ✅ Yes - Automatic Renumbering

**Both insert and delete renumber all shots** to maintain invariant: `shots[i].sentenceIndex === i`

**Insert Logic** (`src/services/story.service.js:526-529`):
```javascript
// After inserting new shot at newIndex
for (let i = 0; i < session.shots.length; i++) {
  session.shots[i].sentenceIndex = i;
}
```

**Delete Logic** (`src/services/story.service.js:584-587`):
```javascript
// After removing shot
for (let i = 0; i < session.shots.length; i++) {
  session.shots[i].sentenceIndex = i;
}
```

**Implication**: Client must update all beat indices after insert/delete operations.

---

## 7. Shots/Clips Behavior (Side-Effects)

### ✅ Insert Beat Behavior

**If session already has shots/clips**:
- **Action**: **KEEPS existing shots** (does not clear or reject)
- **Process**:
  1. Creates new shot object with `sentenceIndex: newIndex`
  2. Auto-searches clips using `text` as query (Pexels API)
  3. Inserts new shot at `newIndex` position
  4. Reindexes ALL shots (existing + new)
  5. Saves session

**New Shot Structure**:
```javascript
{
  sentenceIndex: newIndex,
  searchQuery: text.trim(),
  durationSec: calculateReadingDuration(text),
  selectedClip: best || null,  // Auto-selected from search
  candidates: candidates || []  // Up to 12 results
}
```

**Search Behavior**:
- Uses `searchSingleShot()` helper
- Searches with `perPage: 12`
- If search fails, continues with empty candidates (logs warning)

### ✅ Delete Beat Behavior

**If session already has shots/clips**:
- **Action**: **KEEPS remaining shots** (does not clear or reject)
- **Process**:
  1. Removes sentence at `sentenceIndex`
  2. Finds matching shot by `sentenceIndex`
  3. Removes matching shot
  4. Reindexes ALL remaining shots
  5. Saves session

**No validation** that shots/clips exist before delete.

---

## 8. Max/Min Beats Limits

### Max Beats

- **Constant defined**: `MAX_BEATS = 8` (see `src/services/story.service.js:32`)
- **⚠️ NOT enforced in `insertBeatWithSearch()`**: No validation check exists
- **Enforced only in**: `createManualStorySession()` (line 1161-1163)
- **Recommendation**: Client should enforce max 8 beats before calling insert

### Min Beats

- **No minimum enforced**: Can delete all beats (session can have 0 sentences)
- **Validation**: Only checks `sentenceIndex` is in range
- **No error** if deleting last beat

---

## 9. Additional Constraints

### Text Constraints

- **Min length**: 1 character (enforced by Zod)
- **Max length**: No explicit limit in `insertBeatWithSearch()` (but `MAX_BEAT_CHARS = 160` exists for manual mode)
- **Trimming**: Server trims text: `text.trim()`

### Session State Requirements

**Insert**:
- Requires `session.story` exists (throws `STORY_REQUIRED` if missing)
- Initializes `session.story.sentences = []` if missing
- Initializes `session.shots = []` if missing

**Delete**:
- Requires `session.story?.sentences` exists (throws `STORY_REQUIRED` if missing)
- Requires `session.shots` exists (throws `SHOTS_REQUIRED` if missing)

---

## 10. Example Request/Response

### Insert Beat Example

**Request**:
```json
{
  "sessionId": "story-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "insertAfterIndex": 1,
  "text": "This marks a turning point in AI history."
}
```

**Response** (Success):
```json
{
  "success": true,
  "data": {
    "sentences": [
      "First beat text.",
      "Second beat text.",
      "This marks a turning point in AI history.",
      "Fourth beat text."
    ],
    "shots": [
      {
        "sentenceIndex": 0,
        "searchQuery": "First beat text.",
        "durationSec": 3.5,
        "selectedClip": { "id": "...", "url": "..." },
        "candidates": [...]
      },
      {
        "sentenceIndex": 1,
        "searchQuery": "Second beat text.",
        "durationSec": 4.2,
        "selectedClip": { "id": "...", "url": "..." },
        "candidates": [...]
      },
      {
        "sentenceIndex": 2,
        "searchQuery": "This marks a turning point in AI history.",
        "durationSec": 5.1,
        "selectedClip": { "id": "...", "url": "..." },
        "candidates": [...]
      },
      {
        "sentenceIndex": 3,
        "searchQuery": "Fourth beat text.",
        "durationSec": 3.8,
        "selectedClip": { "id": "...", "url": "..." },
        "candidates": [...]
      }
    ]
  }
}
```

**Response** (Error):
```json
{
  "success": false,
  "error": "INVALID_INPUT",
  "detail": {
    "fieldErrors": {
      "text": ["String must contain at least 1 character(s)"]
    }
  }
}
```

### Delete Beat Example

**Request**:
```json
{
  "sessionId": "story-a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "sentenceIndex": 2
}
```

**Response** (Success):
```json
{
  "success": true,
  "data": {
    "sentences": [
      "First beat text.",
      "Second beat text.",
      "Fourth beat text."
    ],
    "shots": [
      {
        "sentenceIndex": 0,
        "searchQuery": "First beat text.",
        "durationSec": 3.5,
        "selectedClip": { "id": "...", "url": "..." },
        "candidates": [...]
      },
      {
        "sentenceIndex": 1,
        "searchQuery": "Second beat text.",
        "durationSec": 4.2,
        "selectedClip": { "id": "...", "url": "..." },
        "candidates": [...]
      },
      {
        "sentenceIndex": 2,
        "searchQuery": "Fourth beat text.",
        "durationSec": 3.8,
        "selectedClip": { "id": "...", "url": "..." },
        "candidates": [...]
      }
    ]
  }
}
```

**Response** (Error):
```json
{
  "success": false,
  "error": "STORY_DELETE_BEAT_FAILED",
  "detail": "INVALID_SENTENCE_INDEX"
}
```

---

## 11. Concise Contract Summary

### Insert Endpoint
- **Method + Path**: `POST /api/story/insert-beat`
- **Request Body**: `{ sessionId: string (min 3), insertAfterIndex: number (int >= -1), text: string (min 1) }`
- **Response**: `{ success: true, data: { sentences: string[], shots: object[] } }`
- **Where updated beats live**: `data.sentences` and `data.shots` (full arrays)

### Delete Endpoint
- **Method + Path**: `POST /api/story/delete-beat`
- **Request Body**: `{ sessionId: string (min 3), sentenceIndex: number (int >= 0) }`
- **Response**: `{ success: true, data: { sentences: string[], shots: object[] } }`

### Renumbering Behavior
- **Yes** - All shots reindexed after insert/delete to maintain `shots[i].sentenceIndex === i`
- **Client must update all indices** after operation

### Shot/Clips Behavior if Already Planned
- **Insert**: **KEEPS** existing shots, adds new shot with auto-search, reindexes all
- **Delete**: **KEEPS** remaining shots, removes matching shot, reindexes all
- **No rejection** if shots/clips already exist

### Max Beats + Min Beats
- **Max beats**: 8 (defined but NOT enforced server-side in insert - client should enforce)
- **Min beats**: 0 (no minimum - can delete all beats)

---

## 12. Mobile Integration Checklist

- [ ] Enforce max 8 beats client-side before calling insert
- [ ] Handle renumbering: Update all beat indices after insert/delete
- [ ] Calculate `insertedIndex` from `insertAfterIndex` (response doesn't include it)
- [ ] Handle auto-searched clips: New beat gets `selectedClip` and `candidates` automatically
- [ ] Handle empty candidates: Search may fail silently (check `selectedClip === null`)
- [ ] Use `sentenceIndex` (not `beatIndex`) for delete request
- [ ] Handle `insertAfterIndex = -1` for inserting at beginning
- [ ] Update UI with full `sentences` and `shots` arrays from response (don't try to merge)

---

**No code changes required** - Contract extracted for mobile integration.
