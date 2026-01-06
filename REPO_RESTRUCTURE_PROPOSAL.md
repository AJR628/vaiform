# Repository Restructure Proposal - Architecture Audit & Migration Plan

**Date**: 2025-01-XX  
**Purpose**: Baseline proposal for restructuring the pipeline to be safer, easier to reason about, and easier to extend — WITHOUT breaking the currently working system  
**Status**: READ-ONLY PROPOSAL - No Code Changes

---

## 1) AUDIT MAP - Current Architecture

### Entry Points & HTTP Routes

#### Story Pipeline Routes (`src/routes/story.routes.js`)
- **POST `/api/story/start`** → Creates session, no processing
- **POST `/api/story/generate`** → `generateStory()` - LLM script generation (requires `enforceScriptDailyCap(300)`)
- **POST `/api/story/update-script`** → `updateStorySentences()` - User edits script
- **POST `/api/story/plan`** → `planShots()` - Visual shot planning
- **POST `/api/story/search`** → `searchShots()` - Stock video search
- **POST `/api/story/search-shot`** → `searchClipsForShot()` - Search clips for single shot
- **POST `/api/story/update-shot`** → `updateShotSelectedClip()` - User selects clip
- **POST `/api/story/insert-beat`** → `insertBeatWithSearch()` - Add beat + auto-search
- **POST `/api/story/delete-beat`** → `deleteBeat()` - Remove beat
- **POST `/api/story/update-beat-text`** → `updateBeatText()` - Edit beat text
- **POST `/api/story/timeline`** → `buildTimeline()` - Build stitched timeline
- **POST `/api/story/captions`** → `generateCaptionTimings()` - Generate word timings
- **POST `/api/story/render`** → `renderStory()` - Render segments (Phase 6)
- **POST `/api/story/finalize`** → `finalizeStory()` - **Full pipeline orchestration** (requires `enforceCreditsForRender()`)
- **POST `/api/story/manual`** → `createManualStorySession()` - Manual script mode
- **GET `/api/story/:sessionId`** → `getStorySession()` - Load session

#### Studio Pipeline Routes (`src/routes/studio.routes.js`)
- **POST `/api/studio/finalize`** → `finalizeStudioMulti()` - Multi-format render (requires `enforceCreditsForRender()`)

#### Other Critical Routes
- **POST `/api/tts/preview`** → Public route, no auth, no rate limit (TTS API costs)
- **POST `/api/caption/preview`** → Public route, no auth, no rate limit (CPU-intensive)
- **POST `/api/generate`** → AI image generation (uses idempotency middleware)

### Job Creation & Storage

**Current State**: No unified job model
- Story sessions stored in: `src/utils/json.store.js` → Firestore `users/{uid}/studios/{sessionId}/story.json`
- Rendered shorts stored in: Firestore `shorts/{jobId}` collection
- Job IDs generated ad-hoc: `story-${Date.now().toString(36)}` (line 970 in `story.service.js`)

**Credit Charging**:
- Location: `src/routes/story.routes.js:502-509` (after `finalizeStory()` succeeds)
- Pattern: Credits checked by middleware `enforceCreditsForRender()`, then spent AFTER success
- Problem: If render fails, credits not refunded (no refund logic in catch block)
- Existing refund function: `src/services/credit.service.js:214-217` (`refundCredits()`)
- Used in: AI image generation (`src/controllers/generate.controller.js:267, 319`)

### Pipeline Stages Location

1. **Ingest/Extraction**: `src/utils/link.extract.js` - `extractContentFromUrl()` (called from `generateStory()`)
2. **Script Generation**: `src/services/story.llm.service.js` - `generateStoryFromInput()` (called from `generateStory()`)
3. **Storyboard/Planning**: `src/services/story.service.js` - `planShots()`, `searchShots()` (lines 175-355)
4. **TTS Generation**: `src/services/tts.service.js` - `synthVoiceWithTimestamps()` (called from `renderStory()`)
5. **Caption Generation**: `src/services/story.service.js` - `generateCaptionTimings()` (lines 695-737)
6. **Render**: `src/services/story.service.js` - `renderStory()` (lines 743-1042) → `src/utils/ffmpeg.video.js` - `renderVideoQuoteOverlay()`

### Error Handling Current State

**Error Middleware**: `src/middleware/error.middleware.js`
- Maps Zod errors → 400
- Maps error.name → status codes (DUPLICATE→409, UNAUTHENTICATED→401, etc.)
- Response shape: `{ success: false, error: err.name || 'ERROR', detail: err.message, requestId }`

**Error Patterns Found**:
- Inconsistent: Some throw plain `Error('SESSION_NOT_FOUND')`, some use error codes
- No centralized error taxonomy
- No error serialization for logging/monitoring
- Some services log detailed errors (shorts.service.js:540-547), others don't

**Where Errors Are Caught vs Thrown**:
- Routes: Try-catch in route handlers, return JSON responses
- Services: Throw errors, let route handlers catch
- FFmpeg: Throws errors with `err.code`, `err.stderr` (lines 334-335 in `ffmpeg.video.js`)

### Retry/Timeout Logic

**Existing Retry**:
- `src/utils/async.js:22` - `retry()` function (used in some places)
- `src/services/tts.service.js:203` - `fetchWithRetry()` for TTS API calls
- `src/utils/withTimeoutAndRetry.js:11` - `withTimeoutAndRetry()` wrapper

**Existing Timeouts**:
- FFmpeg: 300s (5 minutes) default (`src/utils/ffmpeg.js:80`, `src/utils/ffmpeg.video.js:317`)
- Server HTTP timeout: 600s (10 minutes) (`server.js:33`)
- CDN proxy: 10s via AbortController (`src/routes/cdn.routes.js`)

**Missing Timeouts**:
- External API calls (OpenAI, Pexels, ElevenLabs) - no explicit timeouts
- Video/image downloads - no timeouts
- Storage uploads - no timeouts

**Missing Retries**:
- Video downloads (`src/utils/video.fetch.js`)
- Image downloads (`src/utils/image.fetch.js`)
- Storage uploads (`src/utils/storage.js`)
- Render operations (FFmpeg failures are final)

### Validation Current State

**Zod Schemas**: Used in routes for input validation
- Locations: `src/schemas/` directory + inline schemas in routes
- Pattern: `safeParse()` → return 400 if invalid

**Validation Coverage**:
- Story routes: SessionSchema, GenerateSchema, ManualSchema (inline)
- Studio routes: FinalizeSchema (inline)
- Most routes have validation, but schemas are duplicated/inline

**Missing**:
- No unified schema registry
- No validation of stage outputs (only inputs)
- Some limits enforced in services (`MAX_BEATS = 8`, `MAX_BEAT_CHARS = 160`, `MAX_TOTAL_CHARS = 850` in `story.service.js:29-31`)

### Rate Limiting Current State

**Existing**:
- `src/middleware/planGuards.js:204` - `enforceScriptDailyCap(300)` - Daily script generation cap
- `src/middleware/planGuards.js:31` - `enforceFreeDailyShortLimit(4)` - Free user daily short limit (not wired)
- No global rate limiting middleware

**Missing**:
- No rate limiting on render routes (expensive operations)
- No rate limiting on public routes (`/api/caption/preview`, `/api/tts/preview`)
- No per-user rate limits (only daily caps)

### Idempotency Current State

**Existing**:
- `src/middleware/idempotency.js` - In-memory idempotency (used on `/api/generate`)
- `src/middleware/idempotency.firestore.js` - Firestore-backed idempotency (not used)
- Pattern: Requires `X-Idempotency-Key` header, caches responses for TTL

**Missing**:
- Not used on render routes (`/api/story/finalize`, `/api/studio/finalize`)
- No idempotency key validation/format checks
- In-memory store doesn't survive restarts

---

## 2) PROPOSED TARGET STRUCTURE

### Folder/Module Organization

```
src/
├── core/                          # Single source of truth for guardrails
│   ├── errors.js                  # AppError class, error codes, serializer
│   ├── limits.js                  # All caps/limits constants
│   ├── validate.js                # Shared Zod schemas
│   ├── idempotency.js             # Idempotency key handling
│   ├── timeout.js                 # Timeout wrappers
│   ├── retry.js                   # Retry wrappers with backoff
│   ├── rateLimit.js               # Rate limiting middleware
│   └── credits.js                 # Atomic debit/refund logic
│
├── routes/                        # Thin route handlers (keep existing)
│   ├── story.routes.js            # Minimal changes (add feature flag routing)
│   ├── studio.routes.js           # Minimal changes
│   └── ...
│
├── controllers/                   # Request/response handling (new or refactor existing)
│   ├── story.controller.js        # Extract from story.routes.js (optional)
│   ├── studio.controller.js       # Extract from studio.routes.js (optional)
│   └── ...
│
├── services/                      # Business logic (refactor incrementally)
│   ├── pipeline/                  # NEW: Pipeline stage services
│   │   ├── ingest.service.js      # Extract from link.extract.js
│   │   ├── script.service.js      # Extract from story.llm.service.js
│   │   ├── storyboard.service.js  # Extract from story.service.js (planShots, searchShots)
│   │   ├── tts.service.js         # Keep existing (already modular)
│   │   ├── captions.service.js    # Extract from story.service.js (generateCaptionTimings)
│   │   └── render.service.js      # Extract from story.service.js (renderStory)
│   │
│   ├── story.service.js           # Keep for backward compatibility, route to new services
│   ├── studio.service.js          # Keep for backward compatibility
│   └── ...
│
├── orchestrators/                 # NEW: Pipeline orchestration
│   ├── job.orchestrator.js        # runJob(jobId) - unified orchestrator
│   └── story.orchestrator.js      # Story-specific orchestration (calls job.orchestrator)
│
├── adapters/                      # External provider adapters (keep existing)
│   ├── pexels.videos.provider.js
│   ├── tts.service.js
│   └── ...
│
├── storage/                       # NEW: Job store abstraction
│   ├── job.store.js               # Unified job CRUD operations
│   └── session.store.js           # Story session store (wrap json.store.js)
│
├── models/                        # NEW: Data models/schemas
│   ├── job.model.js               # Job state machine, schemas
│   └── session.model.js           # Story session model
│
└── middleware/                    # Keep existing, add new
    ├── error.middleware.js        # Keep existing
    ├── requireAuth.js             # Keep existing
    ├── planGuards.js              # Keep existing, refactor to use core/limits.js
    └── ...
```

### Strangler Pattern Implementation

**Feature Flag Approach**:
- Environment variable: `PIPELINE_V2=true` (default: `false`)
- Route-level check: If flag enabled, route to new orchestrator; else use existing service functions
- Both paths write to same storage (Firestore) so UI doesn't break

**Example Route Pattern**:
```javascript
// src/routes/story.routes.js (minimal change)
r.post("/finalize", enforceCreditsForRender(), async (req, res) => {
  const parsed = SessionSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ success: false, error: "INVALID_INPUT", detail: parsed.error.flatten() });
  }
  
  const { sessionId } = parsed.data;
  
  // Strangler: Route to new or old based on feature flag
  if (process.env.PIPELINE_V2 === 'true') {
    // NEW: Use orchestrator
    const job = await createJobFromSession({ uid: req.user.uid, sessionId });
    const result = await runJob(job.id);
    return res.json({ success: true, data: result });
  } else {
    // OLD: Use existing service (unchanged)
    const session = await finalizeStory({ uid: req.user.uid, sessionId });
    // ... existing credit spending logic ...
    return res.json({ success: true, data: session });
  }
});
```

**Gradual Migration**:
1. Phase 1: Add new modules alongside existing (no behavior change)
2. Phase 2: Wire feature flag, route to new orchestrator (calls existing services)
3. Phase 3: Move services one by one to new structure
4. Phase 4: Remove old code after all references migrated

---

## 3) CORE GUARDRAILS MODULE

### Module Structure: `src/core/`

#### `src/core/errors.js` - Error Taxonomy & Serialization

```javascript
// Error codes taxonomy
export const ERROR_CODES = {
  // Input validation
  INVALID_INPUT: 'INVALID_INPUT',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  
  // Authentication/Authorization
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  
  // Resources
  INSUFFICIENT_CREDITS: 'INSUFFICIENT_CREDITS',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  
  // Pipeline stages
  INGEST_FAILED: 'INGEST_FAILED',
  SCRIPT_GENERATION_FAILED: 'SCRIPT_GENERATION_FAILED',
  STORYBOARD_FAILED: 'STORYBOARD_FAILED',
  TTS_FAILED: 'TTS_FAILED',
  CAPTION_FAILED: 'CAPTION_FAILED',
  RENDER_FAILED: 'RENDER_FAILED',
  
  // External services
  EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR',
  EXTERNAL_API_TIMEOUT: 'EXTERNAL_API_TIMEOUT',
  
  // System
  TIMEOUT: 'TIMEOUT',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
};

// AppError class with code, status, details
export class AppError extends Error {
  constructor(code, message, { status = 500, details = null, cause = null } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.cause = cause;
  }
  
  // Serialize for API response
  toJSON() {
    return {
      success: false,
      error: this.code,
      detail: this.message,
      ...(this.details && { details: this.details })
    };
  }
  
  // Serialize for logging
  toLog() {
    return {
      code: this.code,
      message: this.message,
      status: this.status,
      details: this.details,
      ...(this.cause && { cause: this.cause.message })
    };
  }
}

// Helper factories
export function invalidInput(message, details = null) {
  return new AppError(ERROR_CODES.INVALID_INPUT, message, { status: 400, details });
}

export function notFound(resource, id = null) {
  return new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, `${resource} not found${id ? `: ${id}` : ''}`, { status: 404 });
}

export function renderFailed(message, details = null) {
  return new AppError(ERROR_CODES.RENDER_FAILED, message, { status: 500, details });
}
```

**Application**: Replace `throw new Error('SESSION_NOT_FOUND')` with `throw notFound('Session', sessionId)` across services.

#### `src/core/limits.js` - Single Source of Truth for Caps

```javascript
// Story pipeline limits
export const STORY_LIMITS = {
  MAX_BEATS: 8,
  MAX_BEAT_CHARS: 160,
  MAX_TOTAL_CHARS: 850,
  MAX_SCRIPT_DAILY: 300,  // Daily script generation cap
  MAX_RENDER_CONCURRENT: 3,  // Max concurrent renders per user
  MAX_RENDER_PER_MINUTE: 5   // Rate limit
};

// TTS limits
export const TTS_LIMITS = {
  MAX_TEXT_LENGTH: 5000,
  MAX_CHARS_PER_REQUEST: 1000
};

// Render limits
export const RENDER_LIMITS = {
  MAX_DURATION_SEC: 120,
  MAX_SEGMENTS: 8,
  TIMEOUT_MS: 600000  // 10 minutes
};

// External API limits
export const API_LIMITS = {
  OPENAI_TIMEOUT_MS: 30000,
  PEXELS_TIMEOUT_MS: 10000,
  ELEVENLABS_TIMEOUT_MS: 30000,
  VIDEO_DOWNLOAD_TIMEOUT_MS: 60000,
  STORAGE_UPLOAD_TIMEOUT_MS: 120000
};

// Retry configuration
export const RETRY_CONFIG = {
  MAX_RETRIES: 2,
  BASE_DELAY_MS: 800,
  MAX_DELAY_MS: 5000,
  JITTER: true
};
```

**Application**: Import from `core/limits.js` instead of defining constants in services. Update `src/services/story.service.js:29-31` to import.

#### `src/core/validate.js` - Shared Zod Schemas

```javascript
import { z } from 'zod';
import { STORY_LIMITS } from './limits.js';

// Story session schemas
export const SessionSchema = z.object({
  sessionId: z.string().min(1)
});

export const GenerateSchema = z.object({
  sessionId: z.string().optional(),
  input: z.string().min(1).max(2000),
  inputType: z.enum(['link', 'paragraph']).optional()
});

export const ManualScriptSchema = z.object({
  scriptText: z.string()
    .min(1)
    .max(STORY_LIMITS.MAX_TOTAL_CHARS)
    .refine(text => {
      const beats = text.split('\n').filter(s => s.trim().length > 0);
      return beats.length <= STORY_LIMITS.MAX_BEATS;
    }, { message: `Maximum ${STORY_LIMITS.MAX_BEATS} beats allowed` })
    .refine(text => {
      const beats = text.split('\n').filter(s => s.trim().length > 0);
      return beats.every(beat => beat.length <= STORY_LIMITS.MAX_BEAT_CHARS);
    }, { message: `Each beat must be ≤ ${STORY_LIMITS.MAX_BEAT_CHARS} characters` })
});

// Job schemas
export const JobInputSchema = z.object({
  type: z.enum(['story', 'studio']),
  sessionId: z.string().optional(),
  options: z.record(z.any()).optional()
});
```

**Application**: Move inline schemas from routes to `core/validate.js`, import in routes.

#### `src/core/idempotency.js` - Idempotency Key Handling

```javascript
import { db } from '../config/firebase.js';
import { AppError, invalidInput } from './errors.js';

// Generate idempotency key if not provided
export function getIdempotencyKey(req) {
  const header = req.get?.('X-Idempotency-Key') || req.headers['x-idempotency-key'];
  if (!header) {
    // Generate key from request (optional - some routes may require explicit key)
    return `${req.user?.uid || 'anon'}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  }
  return header;
}

// Validate idempotency key format
export function validateIdempotencyKey(key) {
  if (!key || typeof key !== 'string' || key.length > 255) {
    throw invalidInput('Invalid idempotency key format');
  }
  return key;
}

// Check if idempotent request already processed (Firestore-backed)
export async function checkIdempotency(uid, key, ttlMinutes = 60) {
  const idempotencyRef = db.collection('idempotency').doc(`${uid}:${key}`);
  const snap = await idempotencyRef.get();
  
  if (snap.exists) {
    const data = snap.data();
    if (data.state === 'pending') {
      throw new AppError('IDEMPOTENT_IN_PROGRESS', 'Request already in progress', { status: 409 });
    }
    if (data.state === 'done' && data.expiresAt > Date.now()) {
      return { cached: true, response: data.response };
    }
  }
  
  return { cached: false };
}

// Mark idempotency as pending
export async function markIdempotencyPending(uid, key, ttlMinutes = 60) {
  const idempotencyRef = db.collection('idempotency').doc(`${uid}:${key}`);
  await idempotencyRef.set({
    state: 'pending',
    expiresAt: Date.now() + (ttlMinutes * 60 * 1000),
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

// Mark idempotency as done with response
export async function markIdempotencyDone(uid, key, response, ttlMinutes = 60) {
  const idempotencyRef = db.collection('idempotency').doc(`${uid}:${key}`);
  await idempotencyRef.set({
    state: 'done',
    response: response,
    expiresAt: Date.now() + (ttlMinutes * 60 * 1000),
    completedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}
```

**Application**: Use in render routes to prevent duplicate credit charges.

#### `src/core/timeout.js` - Timeout Wrappers

```javascript
import { API_LIMITS } from './limits.js';
import { AppError, ERROR_CODES } from './errors.js';

// Wrapper for promises with timeout
export async function withTimeout(promise, timeoutMs, label = 'operation') {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new AppError(ERROR_CODES.TIMEOUT, `${label} timed out after ${timeoutMs}ms`, { status: 504 }));
    }, timeoutMs);
  });
  
  return Promise.race([promise, timeoutPromise]);
}

// AbortController-based timeout for fetch
export function createTimeoutSignal(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, cleanup: () => clearTimeout(timeoutId) };
}

// Pre-configured timeouts for external APIs
export const withOpenAITimeout = (promise) => withTimeout(promise, API_LIMITS.OPENAI_TIMEOUT_MS, 'OpenAI API');
export const withPexelsTimeout = (promise) => withTimeout(promise, API_LIMITS.PEXELS_TIMEOUT_MS, 'Pexels API');
export const withElevenLabsTimeout = (promise) => withTimeout(promise, API_LIMITS.ELEVENLABS_TIMEOUT_MS, 'ElevenLabs API');
```

**Application**: Wrap all external API calls (OpenAI, Pexels, ElevenLabs, video downloads).

#### `src/core/retry.js` - Retry Logic with Exponential Backoff

```javascript
import { RETRY_CONFIG } from './limits.js';
import { AppError, ERROR_CODES } from './errors.js';

// Check if error is retryable
function isRetryableError(error) {
  // Retry on network errors, timeouts, 429, 5xx
  if (error.code === ERROR_CODES.TIMEOUT) return true;
  if (error.code === ERROR_CODES.EXTERNAL_API_TIMEOUT) return true;
  if (error.status >= 500) return true;
  if (error.status === 429) return true;
  // Don't retry on 4xx (except 429)
  if (error.status >= 400 && error.status < 500) return false;
  return true;
}

// Calculate delay with exponential backoff and jitter
function calculateDelay(attempt, baseDelayMs, maxDelayMs, jitter) {
  const exponential = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
  if (jitter) {
    return exponential + Math.random() * 1000; // Add up to 1s jitter
  }
  return exponential;
}

// Retry wrapper with exponential backoff
export async function withRetry(fn, { 
  maxRetries = RETRY_CONFIG.MAX_RETRIES,
  baseDelayMs = RETRY_CONFIG.BASE_DELAY_MS,
  maxDelayMs = RETRY_CONFIG.MAX_DELAY_MS,
  jitter = RETRY_CONFIG.JITTER,
  label = 'operation'
} = {}) {
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Don't retry if error is not retryable
      if (!isRetryableError(error)) {
        throw error;
      }
      
      // Don't retry on last attempt
      if (attempt === maxRetries) {
        break;
      }
      
      // Wait before retry
      const delay = calculateDelay(attempt, baseDelayMs, maxDelayMs, jitter);
      console.log(`[retry] ${label} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${Math.round(delay)}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}
```

**Application**: Wrap video downloads, image downloads, storage uploads, external API calls.

#### `src/core/rateLimit.js` - Rate Limiting Middleware

```javascript
import rateLimit from 'express-rate-limit';
import { STORY_LIMITS, RENDER_LIMITS } from './limits.js';
import { AppError, ERROR_CODES } from './errors.js';

// Per-user rate limit (Firestore-backed)
export function createUserRateLimit({ windowMs, max, keyGenerator }) {
  // Implementation using Firestore to track per-user limits
  // Returns middleware function
  // (Simplified - full implementation would use Firestore)
}

// Render rate limit (5 per minute per user)
export const renderRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: RENDER_LIMITS.MAX_RENDER_PER_MINUTE,
  message: { error: ERROR_CODES.RATE_LIMIT_EXCEEDED, detail: 'Too many render requests' },
  standardHeaders: true,
  legacyHeaders: false
});

// Public API rate limit (IP-based, stricter)
export const publicApiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10,  // 10 requests per minute per IP
  message: { error: ERROR_CODES.RATE_LIMIT_EXCEEDED, detail: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false
});
```

**Application**: Apply to render routes, public preview routes.

#### `src/core/credits.js` - Atomic Debit/Refund Logic

```javascript
import { db } from '../config/firebase.js';
import { AppError, ERROR_CODES } from './errors.js';
import admin from '../config/firebase.js';

// Atomic debit with transaction
export async function debitCredits(uid, amount, reason = 'debit') {
  if (!uid || amount <= 0) {
    throw new AppError(ERROR_CODES.INVALID_INPUT, 'Invalid debit parameters');
  }
  
  return db.runTransaction(async (tx) => {
    const userRef = db.collection('users').doc(uid);
    const snap = await tx.get(userRef);
    
    if (!snap.exists) {
      throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, 'User not found', { status: 404 });
    }
    
    const doc = snap.data() || {};
    const credits = doc.credits || 0;
    
    if (credits < amount) {
      throw new AppError(ERROR_CODES.INSUFFICIENT_CREDITS, 'Insufficient credits', { status: 402 });
    }
    
    tx.update(userRef, {
      credits: admin.firestore.FieldValue.increment(-amount),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    // Log transaction (optional)
    await logCreditTransaction(uid, -amount, reason);
    
    return { before: credits, after: credits - amount };
  });
}

// Atomic refund (no balance check needed)
export async function refundCredits(uid, amount, reason = 'refund') {
  if (!uid || amount <= 0) {
    throw new AppError(ERROR_CODES.INVALID_INPUT, 'Invalid refund parameters');
  }
  
  await db.collection('users').doc(uid).update({
    credits: admin.firestore.FieldValue.increment(amount),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  
  // Log transaction (optional)
  await logCreditTransaction(uid, amount, reason);
}

// Credit transaction logging helper
async function logCreditTransaction(uid, amount, reason) {
  try {
    await db.collection('users').doc(uid).collection('transactions').add({
      amount,
      reason,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) {
    console.warn('[credits] Failed to log transaction:', err);
    // Don't throw - logging is best-effort
  }
}
```

**Application**: Use in orchestrator to charge credits before render, refund on failure.

---

## 4) JOB MODEL + PIPELINE ORCHESTRATOR

### Job State Machine

```javascript
// src/models/job.model.js

export const JOB_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  DONE: 'done',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

export const JOB_STAGE = {
  INGEST: 'ingest',
  SCRIPT: 'script',
  STORYBOARD: 'storyboard',
  CAPTIONS: 'captions',
  TTS: 'tts',
  RENDER: 'render',
  DONE: 'done'
};

// Job document schema
export interface Job {
  id: string;                    // job-{timestamp}-{random}
  ownerUid: string;              // User ID
  type: 'story' | 'studio';      // Job type
  status: JOB_STATUS;            // Current status
  stage: JOB_STAGE;              // Current stage
  sessionId?: string;            // Story/studio session ID (if applicable)
  
  // Inputs
  inputs: {
    [key: string]: any;          // Job-specific inputs
  };
  
  // Credits
  charged: boolean;              // Whether credits were charged
  creditAmount: number;          // Amount charged
  refunded: boolean;             // Whether refund was issued
  
  // Artifacts
  artifacts: {
    videoUrl?: string;
    thumbUrl?: string;
    [key: string]: any;
  };
  
  // Error
  error?: {
    code: string;
    message: string;
    details?: any;
    stage?: JOB_STAGE;           // Stage where error occurred
  };
  
  // Timestamps
  createdAt: string;             // ISO timestamp
  updatedAt: string;             // ISO timestamp
  startedAt?: string;            // When job started running
  completedAt?: string;          // When job completed (done/failed)
  
  // Metadata
  metadata?: {
    [key: string]: any;
  };
}
```

### Pipeline Orchestrator

```javascript
// src/orchestrators/job.orchestrator.js

import { JOB_STATUS, JOB_STAGE } from '../models/job.model.js';
import { AppError, ERROR_CODES } from '../core/errors.js';
import { debitCredits, refundCredits, RENDER_CREDIT_COST } from '../core/credits.js';
import { withRetry, withTimeout } from '../core/retry.js';
import { API_LIMITS } from '../core/limits.js';
import { jobStore } from '../storage/job.store.js';
import { ingestService } from '../services/pipeline/ingest.service.js';
import { scriptService } from '../services/pipeline/script.service.js';
import { storyboardService } from '../services/pipeline/storyboard.service.js';
import { captionsService } from '../services/pipeline/captions.service.js';
import { ttsService } from '../services/pipeline/tts.service.js';
import { renderService } from '../services/pipeline/render.service.js';

// Main orchestrator function
export async function runJob(jobId) {
  const job = await jobStore.get(jobId);
  if (!job) {
    throw new AppError(ERROR_CODES.RESOURCE_NOT_FOUND, `Job not found: ${jobId}`);
  }
  
  // Update status to running
  await jobStore.update(jobId, {
    status: JOB_STATUS.RUNNING,
    startedAt: new Date().toISOString(),
    stage: job.stage || JOB_STAGE.INGEST
  });
  
  let creditsCharged = false;
  
  try {
    // Charge credits before starting (only for render jobs)
    if (job.type === 'story' && !job.charged) {
      await debitCredits(job.ownerUid, RENDER_CREDIT_COST, `job:${jobId}`);
      await jobStore.update(jobId, {
        charged: true,
        creditAmount: RENDER_CREDIT_COST
      });
      creditsCharged = true;
    }
    
    // Run pipeline stages in order
    let currentStage = job.stage || JOB_STAGE.INGEST;
    let stageResult = null;
    
    while (currentStage !== JOB_STAGE.DONE) {
      // Update stage
      await jobStore.update(jobId, { stage: currentStage });
      
      // Run stage with retry/timeout
      stageResult = await runStage(job, currentStage, stageResult);
      
      // Move to next stage
      currentStage = getNextStage(currentStage);
    }
    
    // Job completed successfully
    await jobStore.update(jobId, {
      status: JOB_STATUS.DONE,
      stage: JOB_STAGE.DONE,
      completedAt: new Date().toISOString(),
      artifacts: stageResult?.artifacts || {}
    });
    
    return await jobStore.get(jobId);
    
  } catch (error) {
    // Job failed - refund credits if charged
    if (creditsCharged && !job.refunded) {
      try {
        await refundCredits(job.ownerUid, RENDER_CREDIT_COST, `job:${jobId}:refund`);
        await jobStore.update(jobId, { refunded: true });
      } catch (refundError) {
        console.error(`[orchestrator] Failed to refund credits for job ${jobId}:`, refundError);
        // Continue - error is logged
      }
    }
    
    // Update job with error
    const appError = error instanceof AppError ? error : new AppError(ERROR_CODES.INTERNAL_ERROR, error.message);
    await jobStore.update(jobId, {
      status: JOB_STATUS.FAILED,
      completedAt: new Date().toISOString(),
      error: {
        code: appError.code,
        message: appError.message,
        details: appError.details,
        stage: currentStage
      }
    });
    
    throw error;
  }
}

// Run a single stage
async function runStage(job, stage, previousResult) {
  console.log(`[orchestrator] Running stage ${stage} for job ${job.id}`);
  
  const stageFn = getStageFunction(stage);
  if (!stageFn) {
    throw new AppError(ERROR_CODES.INTERNAL_ERROR, `Unknown stage: ${stage}`);
  }
  
  // Run with retry (only for retryable stages)
  const retryable = [JOB_STAGE.INGEST, JOB_STAGE.TTS, JOB_STAGE.RENDER].includes(stage);
  
  if (retryable) {
    return await withRetry(
      () => withTimeout(stageFn(job, previousResult), getStageTimeout(stage)),
      { label: `stage:${stage}` }
    );
  } else {
    return await withTimeout(stageFn(job, previousResult), getStageTimeout(stage));
  }
}

// Get stage function
function getStageFunction(stage) {
  const stageMap = {
    [JOB_STAGE.INGEST]: ingestService.run,
    [JOB_STAGE.SCRIPT]: scriptService.run,
    [JOB_STAGE.STORYBOARD]: storyboardService.run,
    [JOB_STAGE.CAPTIONS]: captionsService.run,
    [JOB_STAGE.TTS]: ttsService.run,
    [JOB_STAGE.RENDER]: renderService.run
  };
  return stageMap[stage];
}

// Get next stage
function getNextStage(current) {
  const stages = [
    JOB_STAGE.INGEST,
    JOB_STAGE.SCRIPT,
    JOB_STAGE.STORYBOARD,
    JOB_STAGE.CAPTIONS,
    JOB_STAGE.TTS,
    JOB_STAGE.RENDER,
    JOB_STAGE.DONE
  ];
  const currentIdx = stages.indexOf(current);
  return stages[currentIdx + 1] || JOB_STAGE.DONE;
}

// Get stage timeout
function getStageTimeout(stage) {
  const timeouts = {
    [JOB_STAGE.INGEST]: API_LIMITS.OPENAI_TIMEOUT_MS,
    [JOB_STAGE.SCRIPT]: API_LIMITS.OPENAI_TIMEOUT_MS,
    [JOB_STAGE.STORYBOARD]: API_LIMITS.PEXELS_TIMEOUT_MS * 3, // Multiple API calls
    [JOB_STAGE.CAPTIONS]: 10000, // Local computation
    [JOB_STAGE.TTS]: API_LIMITS.ELEVENLABS_TIMEOUT_MS,
    [JOB_STAGE.RENDER]: API_LIMITS.RENDER_TIMEOUT_MS || 600000
  };
  return timeouts[stage] || 60000;
}
```

### Job Store Abstraction

```javascript
// src/storage/job.store.js

import { db } from '../config/firebase.js';
import admin from '../config/firebase.js';
import { JOB_STATUS } from '../models/job.model.js';

export const jobStore = {
  // Create job
  async create(jobData) {
    const jobId = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    const now = new Date().toISOString();
    
    const job = {
      id: jobId,
      status: JOB_STATUS.QUEUED,
      charged: false,
      refunded: false,
      artifacts: {},
      createdAt: now,
      updatedAt: now,
      ...jobData
    };
    
    await db.collection('jobs').doc(jobId).set(job);
    return job;
  },
  
  // Get job
  async get(jobId) {
    const snap = await db.collection('jobs').doc(jobId).get();
    if (!snap.exists) return null;
    return { id: snap.id, ...snap.data() };
  },
  
  // Update job
  async update(jobId, updates) {
    await db.collection('jobs').doc(jobId).update({
      ...updates,
      updatedAt: new Date().toISOString()
    });
  },
  
  // List jobs for user
  async listByUser(uid, { limit = 50, status = null } = {}) {
    let query = db.collection('jobs').where('ownerUid', '==', uid).orderBy('createdAt', 'desc').limit(limit);
    if (status) {
      query = query.where('status', '==', status);
    }
    const snap = await query.get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }
};
```

---

## 5) MIGRATION LADDER

### Commit 1: Add Core Modules (No Behavior Change)

**Goal**: Introduce core modules alongside existing code, no behavior change.

**Files to Create**:
- `src/core/errors.js` - AppError class, error codes
- `src/core/limits.js` - All constants (move from services)
- `src/core/validate.js` - Shared schemas (extract from routes)
- `src/core/timeout.js` - Timeout wrappers
- `src/core/retry.js` - Retry logic
- `src/core/rateLimit.js` - Rate limiting middleware
- `src/core/idempotency.js` - Idempotency helpers
- `src/core/credits.js` - Credit debit/refund (wrap existing)

**Files to Modify**:
- `src/services/story.service.js` - Import limits from `core/limits.js` instead of defining locally
- `src/services/credit.service.js` - Re-export functions from `core/credits.js` (backward compatibility)

**Definition of Done**:
- ✅ All core modules created
- ✅ Existing code imports from core modules (no duplication)
- ✅ All tests pass
- ✅ No behavior changes (same error messages, same limits)

---

### Commit 2: Add Job Model & Store (No Behavior Change)

**Goal**: Add job model and store, but don't use them yet.

**Files to Create**:
- `src/models/job.model.js` - Job interface, status/stage enums
- `src/storage/job.store.js` - Job CRUD operations (Firestore-backed)

**Files to Modify**:
- None (new code only)

**Definition of Done**:
- ✅ Job model defined
- ✅ Job store implemented and tested
- ✅ Can create/read/update jobs in Firestore
- ✅ No existing code uses job store yet

---

### Commit 3: Add Orchestrator Skeleton (Feature Flag Off)

**Goal**: Add orchestrator that calls existing services, but don't route to it yet.

**Files to Create**:
- `src/orchestrators/job.orchestrator.js` - Main orchestrator (calls existing service functions)
- `src/services/pipeline/` - Empty directory (placeholder)

**Files to Modify**:
- `src/routes/story.routes.js` - Add feature flag check (defaults to false, routes to old path)
- `src/services/story.service.js` - No changes (orchestrator calls existing functions)

**Implementation Notes**:
- Orchestrator's `runStage()` calls existing service functions:
  - `ingestService.run()` → calls `extractContentFromUrl()` from `link.extract.js`
  - `scriptService.run()` → calls `generateStoryFromInput()` from `story.llm.service.js`
  - `storyboardService.run()` → calls `planShots()`, `searchShots()` from `story.service.js`
  - `renderService.run()` → calls `renderStory()` from `story.service.js`

**Definition of Done**:
- ✅ Orchestrator created
- ✅ Feature flag defaults to `false` (old code path used)
- ✅ Orchestrator tested in isolation (unit tests)
- ✅ No production code routes to orchestrator yet

---

### Commit 4: Wire Feature Flag (Strangler Pattern)

**Goal**: Enable feature flag routing, orchestrator calls existing services.

**Files to Modify**:
- `src/routes/story.routes.js` - `/finalize` route checks `PIPELINE_V2` env var
- `src/orchestrators/job.orchestrator.js` - Ensure calls existing service functions correctly
- `.env.example` - Add `PIPELINE_V2=false` (default off)

**Definition of Done**:
- ✅ Feature flag works (set `PIPELINE_V2=true` to use orchestrator)
- ✅ Orchestrator calls existing service functions (no refactoring yet)
- ✅ Both paths write to same storage (UI doesn't break)
- ✅ Credit charging/refunding works in orchestrator path
- ✅ Smoke tests pass for both old and new paths

---

### Commit 5: Move Ingest Service

**Goal**: Extract ingest logic to `services/pipeline/ingest.service.js`.

**Files to Create**:
- `src/services/pipeline/ingest.service.js` - Extract from `link.extract.js`

**Files to Modify**:
- `src/utils/link.extract.js` - Re-export from ingest.service.js (backward compatibility)
- `src/orchestrators/job.orchestrator.js` - Call ingest.service.js instead of link.extract.js

**Definition of Done**:
- ✅ Ingest service extracted
- ✅ Existing code still works (re-exports)
- ✅ Orchestrator uses new service
- ✅ Tests pass

---

### Commit 6: Move Script Service

**Goal**: Extract script generation to `services/pipeline/script.service.js`.

**Files to Create**:
- `src/services/pipeline/script.service.js` - Extract from `story.llm.service.js`

**Files to Modify**:
- `src/services/story.llm.service.js` - Re-export from script.service.js (backward compatibility)
- `src/orchestrators/job.orchestrator.js` - Call script.service.js

**Definition of Done**:
- ✅ Script service extracted
- ✅ Existing code still works
- ✅ Orchestrator uses new service
- ✅ Tests pass

---

### Commit 7: Move Remaining Services (Storyboard, Captions, Render)

**Goal**: Extract remaining pipeline stages.

**Files to Create**:
- `src/services/pipeline/storyboard.service.js` - Extract `planShots()`, `searchShots()` from `story.service.js`
- `src/services/pipeline/captions.service.js` - Extract `generateCaptionTimings()` from `story.service.js`
- `src/services/pipeline/render.service.js` - Extract `renderStory()` from `story.service.js`

**Files to Modify**:
- `src/services/story.service.js` - Re-export from new services (backward compatibility)
- `src/orchestrators/job.orchestrator.js` - Call new services

**Definition of Done**:
- ✅ All services extracted
- ✅ Existing code still works (re-exports)
- ✅ Orchestrator uses new services
- ✅ Tests pass

---

### Commit 8: Cleanup (Remove Dead Code)

**Goal**: Remove old code after all references migrated.

**Files to Delete** (only after confirming no references):
- `src/utils/link.extract.js` - If fully replaced by ingest.service.js
- Parts of `src/services/story.service.js` - If functions fully moved to pipeline services

**Definition of Done**:
- ✅ Grep confirms no references to deleted code
- ✅ All tests pass
- ✅ Feature flag can be removed (or kept for rollback safety)

---

## 6) SMOKE TESTS / SAFETY NET

### Minimal Test Script: `scripts/smoke-pipeline.mjs`

```javascript
#!/usr/bin/env node
// scripts/smoke-pipeline.mjs

import fetch from 'node-fetch';

const API_BASE = process.env.API_URL || 'http://localhost:3000';
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';

// Helper: Make authenticated request
async function apiRequest(method, path, body = null) {
  const headers = {
    'Content-Type': 'application/json',
    ...(AUTH_TOKEN && { 'Authorization': `Bearer ${AUTH_TOKEN}` })
  };
  
  const options = {
    method,
    headers,
    ...(body && { body: JSON.stringify(body) })
  };
  
  const res = await fetch(`${API_BASE}${path}`, options);
  const data = await res.json();
  
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
  }
  
  return data;
}

// Test 1: Health check
async function testHealth() {
  console.log('🧪 Test 1: Health check');
  const res = await apiRequest('GET', '/api/health');
  if (res.status !== 'ok') throw new Error('Health check failed');
  console.log('✅ Health check passed');
}

// Test 2: Create job with idea (story pipeline)
async function testCreateJobWithIdea() {
  console.log('\n🧪 Test 2: Create story job with idea');
  
  // Start session
  const startRes = await apiRequest('POST', '/api/story/start', {
    input: 'The future of AI',
    inputType: 'paragraph'
  });
  if (!startRes.success || !startRes.data?.id) {
    throw new Error('Failed to start session');
  }
  const sessionId = startRes.data.id;
  console.log(`✅ Session created: ${sessionId}`);
  
  // Generate story
  const generateRes = await apiRequest('POST', '/api/story/generate', {
    sessionId,
    input: 'The future of AI',
    inputType: 'paragraph'
  });
  if (!generateRes.success || !generateRes.data?.story) {
    throw new Error('Failed to generate story');
  }
  console.log(`✅ Story generated: ${generateRes.data.story.sentences.length} beats`);
  
  return sessionId;
}

// Test 3: Finalize job (full pipeline)
async function testFinalizeJob(sessionId) {
  console.log('\n🧪 Test 3: Finalize job (full pipeline)');
  
  const finalizeRes = await apiRequest('POST', '/api/story/finalize', {
    sessionId
  });
  
  if (!finalizeRes.success) {
    throw new Error(`Finalize failed: ${finalizeRes.error} - ${finalizeRes.detail}`);
  }
  
  if (!finalizeRes.data?.finalVideo?.url) {
    throw new Error('Final video URL missing');
  }
  
  console.log(`✅ Job finalized: ${finalizeRes.data.finalVideo.url}`);
  return finalizeRes.data;
}

// Test 4: Verify error response format
async function testErrorFormat() {
  console.log('\n🧪 Test 4: Verify error response format');
  
  try {
    await apiRequest('POST', '/api/story/finalize', {
      sessionId: 'invalid-session-id'
    });
    throw new Error('Should have thrown error');
  } catch (error) {
    const data = JSON.parse(error.message.match(/\{.*\}/)?.[0] || '{}');
    if (!data.success === false || !data.error || !data.detail) {
      throw new Error(`Invalid error format: ${JSON.stringify(data)}`);
    }
    console.log(`✅ Error format correct: ${data.error} - ${data.detail}`);
  }
}

// Test 5: Verify idempotency (if implemented)
async function testIdempotency() {
  console.log('\n🧪 Test 5: Verify idempotency');
  
  const idempotencyKey = `test-${Date.now()}`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${AUTH_TOKEN}`,
    'X-Idempotency-Key': idempotencyKey
  };
  
  // First request
  const res1 = await fetch(`${API_BASE}/api/story/finalize`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ sessionId: 'test-session' })
  });
  
  // Second request with same key (should return cached response)
  const res2 = await fetch(`${API_BASE}/api/story/finalize`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ sessionId: 'test-session' })
  });
  
  // Check if second request returns 409 (in progress) or cached response
  if (res2.status === 409 || res2.status === 200) {
    console.log('✅ Idempotency working');
  } else {
    console.warn('⚠️  Idempotency not implemented or not working');
  }
}

// Main test runner
async function main() {
  try {
    await testHealth();
    const sessionId = await testCreateJobWithIdea();
    await testFinalizeJob(sessionId);
    await testErrorFormat();
    await testIdempotency();
    
    console.log('\n✅ All smoke tests passed!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Smoke test failed:', error.message);
    process.exit(1);
  }
}

main();
```

### Manual Test Checklist

After each commit, verify:

1. **Health Check**:
   ```bash
   curl http://localhost:3000/api/health
   # Expected: {"status":"ok"}
   ```

2. **Create Job with Idea**:
   ```bash
   curl -X POST http://localhost:3000/api/story/start \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"input":"Test idea","inputType":"paragraph"}'
   # Expected: {"success":true,"data":{"id":"story-..."}}
   ```

3. **Finalize Job**:
   ```bash
   curl -X POST http://localhost:3000/api/story/finalize \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"sessionId":"$SESSION_ID"}'
   # Expected: {"success":true,"data":{"finalVideo":{"url":"..."}}}
   ```

4. **Verify MP4 Artifact**:
   - Check that `finalVideo.url` is accessible
   - Verify video plays correctly
   - Check thumbnail exists

5. **Verify Error Response**:
   ```bash
   curl -X POST http://localhost:3000/api/story/finalize \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"sessionId":"invalid"}'
   # Expected: {"success":false,"error":"SESSION_NOT_FOUND","detail":"..."}
   ```

6. **Verify Idempotency** (if implemented):
   - Send same request twice with `X-Idempotency-Key` header
   - Second request should return cached response or 409

### Continuous Integration

Add to CI pipeline:
```yaml
# .github/workflows/smoke-tests.yml (example)
- name: Run smoke tests
  run: |
    npm run smoke-tests
  env:
    API_URL: http://localhost:3000
    AUTH_TOKEN: ${{ secrets.TEST_AUTH_TOKEN }}
```

---

## Summary

This proposal provides:

1. **Complete audit** of current architecture (entry points, job creation, credits, pipeline stages, errors, retries, validation, rate limiting, idempotency)

2. **Incremental target structure** using strangler pattern with feature flag (`PIPELINE_V2`) to route between old/new code safely

3. **Core guardrails module** (`src/core/`) with single source of truth for errors, limits, validation, idempotency, timeouts, retries, rate limiting, credits

4. **Unified job model** with state machine and orchestrator that applies guardrails consistently, handles credits atomically, supports retries/timeouts, triggers refunds on failure

5. **Migration ladder** (8 commits) that introduces changes incrementally without breaking existing behavior

6. **Smoke tests** script and manual checklist to verify system works after each change

**Key Principles**:
- No big rewrite - incremental refactor
- Strangler pattern - both old and new code coexist
- Feature flag - safe rollout
- Backward compatibility - re-export old functions from new modules
- Single source of truth - core modules prevent drift
- Minimal risk - each commit is small and testable




