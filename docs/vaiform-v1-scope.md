# Vaiform v1 Launch Scope - Single Source of Truth

**Purpose**: This document defines what Vaiform v1 *is* at launch. Everything documented here should be preserved. Anything not listed can be safely removed later.

**Last Updated**: December 8, 2025

---

## Core Feature: Article Explainer / Shorts Studio Pipeline

### Story Generation & Planning

**POST /api/story/start**
- **File**: `src/routes/story.routes.js`
- **Handler**: `createStorySession`
- **Services**: `story.service.js → createStorySession()`
- **Middleware**: `requireAuth`
- **Purpose**: Create new story session from article/link/idea

**POST /api/story/generate**
- **File**: `src/routes/story.routes.js`
- **Handler**: `generateStory`
- **Services**: 
  - `story.service.js → generateStory()`
  - `story.llm.service.js → generateStoryFromInput()` (OpenAI)
  - `link.extract.js → extractContentFromUrl()` (for links)
- **Middleware**: `requireAuth`, `enforceScriptDailyCap(300)`
- **Purpose**: Generate 4-8 sentence script from input

**POST /api/story/update-script**
- **File**: `src/routes/story.routes.js`
- **Handler**: `updateStorySentences`
- **Services**: `story.service.js → updateStorySentences()`
- **Purpose**: User edits script manually

**POST /api/story/plan**
- **File**: `src/routes/story.routes.js`
- **Handler**: `planShots`
- **Services**: 
  - `story.service.js → planShots()`
  - `story.llm.service.js → planVisualShots()` (OpenAI)
- **Middleware**: `requireAuth`, `enforceScriptDailyCap(300)`
- **Purpose**: Generate visual plan (search queries per sentence)

### Clip Search & Selection

**POST /api/story/search**
- **File**: `src/routes/story.routes.js`
- **Handler**: `searchShots`
- **Services**:
  - `story.service.js → searchShots()`
  - `stock.video.provider.js → resolveStockVideo()`
  - `pexels.videos.provider.js → pexelsSearchVideos()`
  - `nasa.videos.provider.js → nasaSearchVideos()`
  - `pixabay.videos.provider.js` (fallback)
- **Purpose**: Search clips for all shots

**POST /api/story/search-shot**
- **File**: `src/routes/story.routes.js`
- **Handler**: `searchClipsForShot`
- **Services**: `story.service.js → searchClipsForShot()`
- **Query**: `{ sessionId, sentenceIndex, query?, page? }`
- **Purpose**: Search/paginate clips for single shot

**POST /api/story/update-shot**
- **File**: `src/routes/story.routes.js`
- **Handler**: `updateShotSelectedClip`
- **Services**: `story.service.js → updateShotSelectedClip()`
- **Purpose**: User swaps clip for a shot

### Beat Editing

**POST /api/story/insert-beat**
- **File**: `src/routes/story.routes.js`
- **Handler**: `insertBeatWithSearch`
- **Services**: `story.service.js → insertBeatWithSearch()`
- **Purpose**: Insert new sentence + auto-search clips

**POST /api/story/delete-beat**
- **File**: `src/routes/story.routes.js`
- **Handler**: `deleteBeat`
- **Services**: `story.service.js → deleteBeat()`
- **Purpose**: Delete sentence + shot

**POST /api/story/update-beat-text**
- **File**: `src/routes/story.routes.js`
- **Handler**: `updateBeatText`
- **Services**: `story.service.js → updateBeatText()`
- **Purpose**: Edit sentence text

### Timeline & Captions

**POST /api/story/timeline**
- **File**: `src/routes/story.routes.js`
- **Handler**: `buildTimeline`
- **Services**: `story.service.js → buildTimeline()`
- **Purpose**: Build stitched timeline

**POST /api/story/captions**
- **File**: `src/routes/story.routes.js`
- **Handler**: `generateCaptionTimings`
- **Services**: `story.service.js → generateCaptionTimings()`
- **Purpose**: Generate word-level caption timings

### Final Render

**POST /api/story/render**
- **File**: `src/routes/story.routes.js`
- **Handler**: `renderStory`
- **Services**: 
  - `story.service.js → renderStory()`
  - `ffmpeg.video.js → renderShortVideo()`
  - `tts.service.js → synthVoice()` (ElevenLabs/OpenAI)
- **Purpose**: Render individual segments

**POST /api/story/finalize**
- **File**: `src/routes/story.routes.js`
- **Handler**: `finalizeStory`
- **Services**: `story.service.js → finalizeStory()` (runs full pipeline)
- **Middleware**: `requireAuth`, `enforceCreditsForRender()`
- **Credit Cost**: 1 credit per render
- **Purpose**: One-click render from any state

**GET /api/story/:sessionId**
- **File**: `src/routes/story.routes.js`
- **Handler**: `getStorySession`
- **Services**: `story.service.js → getStorySession()`
- **Purpose**: Fetch session state

---

## Core Feature: Quote-to-Short Studio

**POST /api/studio/start**
- **File**: `src/routes/studio.routes.js`
- **Handler**: `startStudio`
- **Services**: `studio.service.js → startStudio()`
- **Purpose**: Create studio session

**POST /api/studio/quote**
- **File**: `src/routes/studio.routes.js`
- **Handler**: `generateQuoteCandidates`
- **Services**:
  - `studio.service.js → generateQuoteCandidates()`
  - `quote.engine.js → getQuote()`
  - `llmQuotes.service.js → llmQuotesByFeeling()` (OpenAI)
  - `quotes.curated.js → curatedByFeeling()` (fallback)
- **Middleware**: `requireAuth`, `ensureStudio(true)`
- **Purpose**: Generate quote candidates

**POST /api/studio/image**
- **File**: `src/routes/studio.routes.js`
- **Handler**: `generateImageCandidates`
- **Services**:
  - `studio.service.js → generateImageCandidates()`
  - `pexels.service.js → searchStockImagesPortrait()`
  - `ai.image.provider.js` (for AI-generated)
- **Middleware**: `requireAuth`, `ensureStudio(true)`
- **Purpose**: Generate background image candidates

**POST /api/studio/video**
- **File**: `src/routes/studio.routes.js`
- **Handler**: `generateVideoCandidates`
- **Services**:
  - `studio.service.js → generateVideoCandidates()`
  - `pexels.service.js → searchStockVideosPortrait()`
- **Middleware**: `requireAuth`, `ensureStudio(true)`
- **Purpose**: Generate background video candidates

**POST /api/studio/choose**
- **File**: `src/routes/studio.routes.js`
- **Handler**: `chooseCandidate`
- **Services**: `studio.service.js → chooseCandidate()`
- **Purpose**: User selects quote/image/video

**POST /api/studio/finalize**
- **File**: `src/routes/studio.routes.js`
- **Handler**: `finalizeStudio` or `finalizeStudioMulti`
- **Services**:
  - `studio.service.js → finalizeStudioMulti()`
  - `shorts.service.js → createShortService()`
  - `ffmpeg.video.js → renderAllFormats()`
  - `tts.service.js → synthVoice()`
- **Middleware**: `requireAuth`, `ensureStudio(true)`, `enforceCreditsForRender()`
- **Credit Cost**: 1 credit per render
- **Purpose**: Render final short (9:16, 1:1, 16:9)

**POST /api/studio/remix**
- **File**: `src/routes/studio.routes.js`
- **Handler**: `createRemix`
- **Services**: `studio.service.js → createRemix()`
- **Purpose**: Create remix from existing render

**GET /api/studio/:studioId**
- **File**: `src/routes/studio.routes.js`
- **Handler**: `getStudio`
- **Services**: `studio.service.js → getStudio()`
- **Purpose**: Fetch studio session

**GET /api/studio/events/:studioId**
- **File**: `src/routes/studio.routes.js`
- **Purpose**: Server-Sent Events for progress updates

---

## Core Feature: Karaoke Captions (Overlay System)

**POST /api/caption/preview**
- **File**: `src/routes/caption.preview.routes.js`
- **Handler**: V3 Raster mode (SSOT)
- **Services**: `renderCaptionRaster()` (in-file)
- **Purpose**: Generate caption PNG for preview
- **Schema**: V3 raster mode with `ssotVersion: 3`, `mode: 'raster'`
- **Returns**: PNG data URL + positioning metadata

**POST /api/caption/render**
- **File**: `src/routes/caption.render.routes.js`
- **Handler**: Render route (delegates to preview)
- **Purpose**: Final caption render (currently redirects to preview)

**POST /api/preview/caption**
- **File**: `src/routes/preview.routes.js`
- **Handler**: Legacy preview endpoint
- **Services**: `caption/renderCaptionImage.js`
- **Middleware**: `requireAuth`
- **Purpose**: Generate caption PNG (v1/v2 legacy formats)

---

## Core Feature: Text-to-Speech (Voiceover)

**POST /api/tts/preview**
- **File**: `src/routes/tts.routes.js`
- **Handler**: `ttsPreview`
- **Controller**: `tts.controller.js → ttsPreview()`
- **Services**: 
  - `tts.service.js → synthVoice()`
  - `elevenlabs.adapter.js → elevenLabsSynthesize()`
  - OpenAI TTS (fallback)
- **Purpose**: Generate TTS audio preview

**GET /api/voice/voices**
- **File**: `src/routes/voice.routes.js`
- **Handler**: `getVoices`
- **Controller**: `voice.controller.js → getVoices()`
- **Purpose**: List available voices

**POST /api/voice/preview**
- **File**: `src/routes/voice.routes.js`
- **Handler**: `previewVoice`
- **Controller**: `voice.controller.js → previewVoice()`
- **Purpose**: Preview voice with sample text

---

## Core Feature: Payments & Credits

### Checkout

**POST /checkout/start**
- **File**: `src/routes/checkout.routes.js`
- **Handler**: `startPlanCheckout`
- **Controller**: `checkout.controller.js → startPlanCheckout()`
- **Services**: Stripe API
- **Middleware**: `requireAuth`
- **Purpose**: Start checkout for Creator/Pro plans
- **Plans**: `creator` or `pro`, `monthly` or `onetime`

**POST /checkout/session** (Legacy)
- **File**: `src/routes/checkout.routes.js`
- **Handler**: `createCheckoutSession`
- **Controller**: `checkout.controller.js → createCheckoutSession()`
- **Purpose**: One-time credit pack purchase

**POST /checkout/subscription** (Legacy)
- **File**: `src/routes/checkout.routes.js`
- **Handler**: `createSubscriptionSession`
- **Controller**: `checkout.controller.js → createSubscriptionSession()`
- **Purpose**: Recurring subscription

**POST /checkout/portal**
- **File**: `src/routes/checkout.routes.js`
- **Handler**: `createBillingPortalSession`
- **Controller**: `checkout.controller.js → createBillingPortalSession()`
- **Purpose**: Stripe billing portal link

### Webhook

**POST /stripe/webhook**
- **File**: `src/routes/stripe.webhook.js`
- **Handler**: Webhook handler (raw body)
- **Services**: `credit.service.js → grantCreditsAndUpdatePlan()`
- **Events**:
  - `checkout.session.completed` → Grant credits + update plan
  - `invoice.payment_succeeded` → Subscription renewal
  - `customer.subscription.deleted` → Cancel subscription
- **Purpose**: Process Stripe events

### Credits

**GET /credits**
- **File**: `src/routes/credits.routes.js`
- **Handler**: `getCredits`
- **Controller**: `credits.controller.js → getCredits()`
- **Middleware**: `requireAuth`
- **Purpose**: Get user credit balance

**GET /credits/balance** (Legacy)
- **File**: `src/routes/credits.routes.js`
- **Handler**: `balance`
- **Purpose**: Query balance by email

**POST /credits/grant** (Legacy/Admin)
- **File**: `src/routes/credits.routes.js`
- **Handler**: `grant`
- **Purpose**: Grant credits manually

---

## Core Feature: Auth & User Management

**POST /api/users/ensure**
- **File**: `src/routes/users.routes.js`
- **Handler**: Ensure user doc exists
- **Middleware**: `requireAuth`
- **Purpose**: Create user doc on first login (100 welcome credits)
- **Security**: Only trusts auth token (not request body)

**POST /api/user/setup**
- **File**: `src/routes/user.routes.js`
- **Handler**: `ensureFreeUser`
- **Services**: `user.service.js → ensureFreeUser()`
- **Middleware**: `requireAuth`
- **Purpose**: Setup user after signup

**GET /api/user/me**
- **File**: `src/routes/user.routes.js`
- **Handler**: `getUserData`
- **Services**: `user.service.js → getUserData()`
- **Middleware**: `requireAuth`
- **Purpose**: Get current user data

---

## Core Feature: Asset & Quote Helpers

**POST /api/assets/options**
- **File**: `src/routes/assets.routes.js`
- **Handler**: `getAssetsOptions`
- **Controller**: `assets.controller.js → getAssetsOptions()`
- **Middleware**: `requireAuth`
- **Purpose**: Get asset options for quote

**POST /api/assets/ai-images**
- **File**: `src/routes/assets.routes.js`
- **Handler**: `generateAiImages`
- **Controller**: `assets.controller.js → generateAiImages()`
- **Middleware**: `requireAuth`, `planGuard('pro')`
- **Purpose**: Generate AI images (Pro only)

**POST /api/quotes/generate-quote**
- **File**: `src/routes/quotes.routes.js`
- **Handler**: `generateQuote`
- **Controller**: `quotes.controller.js → generateQuote()`
- **Middleware**: `requireAuth`
- **Purpose**: Generate quote candidates

**POST /api/quotes/remix**
- **File**: `src/routes/quotes.routes.js`
- **Handler**: `remixQuote`
- **Controller**: `quotes.controller.js → remixQuote()`
- **Middleware**: `requireAuth`
- **Purpose**: Remix existing quote

---

## Core Feature: Legacy Shorts (Deprecated but Active)

**POST /api/shorts/create**
- **File**: `src/routes/shorts.routes.js`
- **Handler**: `createShort`
- **Controller**: `shorts.controller.js → createShort()`
- **Services**: `shorts.service.js → createShortService()`
- **Middleware**: `requireAuth`, `enforceCreditsForRender()`, `enforceWatermarkFlag()`
- **Purpose**: Legacy short creation endpoint

**GET /api/shorts/mine**
- **File**: `src/routes/shorts.routes.js`
- **Handler**: `getMyShorts`
- **Controller**: `shorts.controller.js → getMyShorts()`
- **Purpose**: List user's shorts

**GET /api/shorts/:jobId**
- **File**: `src/routes/shorts.routes.js`
- **Handler**: `getShortById`
- **Purpose**: Get short by ID

**DELETE /api/shorts/:jobId**
- **File**: `src/routes/shorts.routes.js`
- **Handler**: `deleteShort`
- **Purpose**: Delete short

---

## Middleware (Critical Guards)

**requireAuth** (`src/middleware/requireAuth.js`)
- Verifies Firebase Auth token
- Sets `req.user = { uid, email }`

**enforceCreditsForRender()** (`src/middleware/planGuards.js`)
- Checks user has >= 1 credit before render
- Does NOT spend credits (spending happens after success)
- Returns 402 if insufficient

**enforceScriptDailyCap(300)** (`src/middleware/planGuards.js`)
- Limits script generation to 300/day per user
- Uses Firestore transaction for atomic increment
- Returns 429 if limit reached

**enforceWatermarkFlag()** (`src/middleware/planGuards.js`)
- Forces watermark for free users
- Sets `req.body.forceWatermark = true`

**blockAIQuotesForFree()** (`src/middleware/planGuards.js`)
- Blocks AI quote generation for free users
- Requires `req.user.isMember = true`

**planGuard('pro')** (`src/middleware/planGuard.js`)
- Requires specific plan tier
- Used for Pro-only features (AI images)

---

## Key Services (Business Logic)

**story.service.js**
- `createStorySession()` - Initialize session
- `generateStory()` - LLM script generation
- `planShots()` - LLM visual planning
- `searchShots()` - Multi-provider clip search
- `renderStory()` - FFmpeg rendering
- `finalizeStory()` - Full pipeline orchestration

**studio.service.js**
- `startStudio()` - Create studio session
- `generateQuoteCandidates()` - Quote generation
- `generateImageCandidates()` - Image search
- `generateVideoCandidates()` - Video search
- `finalizeStudioMulti()` - Multi-format rendering

**shorts.service.js**
- `createShortService()` - Legacy short creation (used by studio)

**tts.service.js**
- `synthVoice()` - TTS synthesis (ElevenLabs/OpenAI)
- In-memory caching (15min TTL)
- Rate limit handling (429 backoff)

**credit.service.js**
- `spendCredits(uid, amount)` - Atomic credit deduction
- `grantCredits(uid, amount)` - Add credits
- `getCreditsForPlan(plan)` - Plan → credits mapping
- `RENDER_CREDIT_COST = 1` - Cost per render

**quote.engine.js**
- `getQuote()` - Quote generation orchestrator
- LLM → curated fallback

**stock.video.provider.js**
- `resolveStockVideo()` - Multi-provider video search
- Pexels → NASA → Pixabay fallback

**story.llm.service.js**
- `generateStoryFromInput()` - Script generation (OpenAI)
- `planVisualShots()` - Visual planning (OpenAI)
- Link extraction for article mode

---

## FFmpeg Pipeline (Critical Path)

**ffmpeg.video.js**
- `renderShortVideo()` - Main render orchestrator
- `renderAllFormats()` - Multi-format (9:16, 1:1, 16:9)
- `exportSocialImage()` - Static social image
- Portrait video normalization (`scale`+`pad` to 1080×1920)
- Audio mixing: BG music + voiceover + video audio
- Caption overlay: V3 raster PNG mode
- Filter graph labels: `[0:v]...[vout]`, `[aout]`

**Filter Complexity Rules**:
- Video chain: `[0:v]` → `[vout]`
- Audio chain: `[bg][tts]amix→[aout]` (BG+VO) or `[tts1][sil]concat→[aout]` (VO only) or `anullsrc→[aout]` (silence)
- Never remove labels
- Never emit empty segments (`,,`)

---

## Constants & Limits

**Font Ranges**:
- `ABS_MIN_FONT = 32px`
- `ABS_MAX_FONT = 120px` (preview), `200px` (render)

**Safe Margins**:
- Top: 10% (0.10)
- Bottom: 10% (0.10)

**Canvas Dimensions**:
- Portrait: 1080×1920

**Credit Costs**:
- Render: 1 credit (`RENDER_CREDIT_COST`)
- Welcome credits: 100 (new users)

**Rate Limits**:
- Script generation: 300/day per user
- Free shorts: 4 lifetime (legacy)

**Plan Tiers**:
- `free` - 100 welcome credits, watermarked
- `creator` - Monthly/one-time, no watermark
- `pro` - Monthly/one-time, AI features

**Plan Credits** (`PLAN_CREDITS_MAP`):
- `creator`: 50 credits
- `pro`: 200 credits

---

## Environment Variables (Required)

**Auth**:
- `FIREBASE_PROJECT_ID`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_CLIENT_EMAIL`

**Payments**:
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_CREATOR_SUB`
- `STRIPE_PRICE_CREATOR_PASS`
- `STRIPE_PRICE_PRO_SUB`
- `STRIPE_PRICE_PRO_PASS`

**LLM**:
- `OPENAI_API_KEY`
- `OPENAI_MODEL` (default: `gpt-4o-mini`)

**TTS**:
- `TTS_PROVIDER` (`openai` or `elevenlabs`)
- `ELEVENLABS_API_KEY`
- `OPENAI_TTS_MODEL` (default: `gpt-4o-mini-tts`)

**Media Providers**:
- `PEXELS_API_KEY`
- `NASA_API_KEY`

**Frontend**:
- `FRONTEND_URL` (default: `https://vaiform.com`)

---

## Response Envelope (API Standard)

**Success (200)**:
```json
{
  "success": true,
  "data": { ... }
}
```

**Error (4xx/5xx)**:
```json
{
  "success": false,
  "error": "ERROR_CODE",
  "detail": "Human-readable message"
}
```

**Common Error Codes**:
- `AUTH_REQUIRED` (401)
- `INSUFFICIENT_CREDITS` (402)
- `MEMBERSHIP_REQUIRED` (402)
- `FREE_LIMIT_REACHED` (403/429)
- `SCRIPT_LIMIT_REACHED` (429)
- `INVALID_INPUT` (400)
- `RENDER_FAILED` (500)

---

## What NOT to Delete (Summary)

✅ **Keep**:
- All `/api/story/*` routes (article explainer)
- All `/api/studio/*` routes (quote studio)
- `/api/caption/preview` (V3 raster mode)
- `/api/tts/preview` (voiceover)
- `/checkout/*`, `/stripe/webhook` (payments)
- `/credits`, `/api/users/ensure` (auth/credits)
- `requireAuth`, `enforceCreditsForRender`, `enforceScriptDailyCap` (middleware)
- `ffmpeg.video.js` (render pipeline)
- `story.llm.service.js`, `tts.service.js`, `credit.service.js` (core services)

❌ **Can Delete Later** (not documented above):
- Old experimental routes
- Unused middleware
- Legacy caption modes (non-V3 raster)
- Test/debug routes (unless in production)

---

**End of Vaiform v1 Scope Document**

