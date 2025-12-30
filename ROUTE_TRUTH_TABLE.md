# Route Truth Table

**Generated from codebase analysis** - Complete inventory of all mounted routes with middleware chains, validation, and security characteristics.

**Global Configuration:**
- Body size limit: `10mb` (express.json, line 79 in `src/app.js`)
- Upload limit: `8mb` (multer, line 20 in `src/routes/uploads.routes.js`)
- Server timeout: `600000ms` (10 minutes, line 33 in `server.js`)
- No global rate limiting middleware found
- CORS: Restricted to allowed origins (lines 55-69 in `src/app.js`)

---

## A. Health & Diagnostics Routes

| Method | Full Path | Handler | Middleware Chain | Auth | Validation | Rate Limit | Idempotency | Body Size | External APIs | File:Line |
|--------|-----------|---------|------------------|------|------------|------------|-------------|-----------|---------------|-----------|
| GET | `/health` | Inline handler | `reqId` → CORS → JSON parser → handler | ❌ Public | ❌ None | ❌ None | ❌ None | N/A | ❌ None | `src/app.js:115` |
| HEAD | `/health` | Inline handler | `reqId` → CORS → JSON parser → handler | ❌ Public | ❌ None | ❌ None | ❌ None | N/A | ❌ None | `src/app.js:120` |
| GET | `/api/health` | `healthRoutes.get("/")` | `reqId` → CORS → JSON parser → `healthRoutes` | ❌ Public | ❌ None | ❌ None | ❌ None | N/A | ✅ Firebase Storage (bucket.exists) | `src/app.js:161` → `src/routes/health.routes.js:10` |
| GET | `/healthz` | `healthRoutes.get("/healthz")` | `reqId` → CORS → JSON parser → `healthRoutes` | ❌ Public | ❌ None | ❌ None | ❌ None | N/A | ❌ None | `src/app.js:153` → `src/routes/health.routes.js:30` |
| GET | `/version` | `healthRoutes.get("/version")` | `reqId` → CORS → JSON parser → `healthRoutes` | ❌ Public | ❌ None | ❌ None | ❌ None | N/A | ❌ None | `src/app.js:153` → `src/routes/health.routes.js:33` |
| POST | `/health/register` | `register` controller | `reqId` → CORS → JSON parser → `healthRoutes` → `validate(registerSchema)` | ❌ Public | ✅ Zod (`registerSchema`) | ❌ None | ❌ None | 10mb | ❌ None | `src/app.js:153` → `src/routes/health.routes.js:42` |
| POST | `/diag/echo` | Inline handler | `reqId` → CORS → JSON parser → handler | ❌ Public | ❌ None | ❌ None | ❌ None | 10mb | ❌ None | `src/app.js:123` |
| GET | `/diag` | `diagRoutes` (various) | `reqId` → CORS → JSON parser → `diagRoutes` (if `NODE_ENV !== "production"`) | ❌ Public | ❌ None | ❌ None | ❌ None | N/A | ✅ TTS service, Canvas rendering | `src/app.js:158` → `src/routes/diag.routes.js` |
| GET | `/api/diag/headers` | `diagHeadersRoutes.get("/diag/headers")` | `reqId` → CORS → JSON parser → `diagHeadersRoutes` (if `VAIFORM_DEBUG=1`) | ❌ Public | ❌ None | ❌ None | ❌ None | N/A | ❌ None | `src/app.js:168` → `src/routes/diag.headers.routes.js:6` |

---

## B. Auth & Session Routes

| Method | Full Path | Handler | Middleware Chain | Auth | Validation | Rate Limit | Idempotency | Body Size | External APIs | File:Line |
|--------|-----------|---------|------------------|------|------------|------------|-------------|-----------|---------------|-----------|
| GET | `/whoami` | `whoamiRoutes.get("/")` | `reqId` → CORS → JSON parser → `whoamiRoutes` → `requireAuth` | ✅ `requireAuth` | ❌ None | ❌ None | ❌ None | N/A | ✅ Firebase Auth (verifyIdToken) | `src/app.js:154` → `src/routes/whoami.routes.js:10` |
| GET | `/api/whoami` | `whoamiRoutes.get("/")` | `reqId` → CORS → JSON parser → `whoamiRoutes` → `requireAuth` | ✅ `requireAuth` | ❌ None | ❌ None | ❌ None | N/A | ✅ Firebase Auth (verifyIdToken) | `src/app.js:162` → `src/routes/whoami.routes.js:10` |
| POST | `/api/user/setup` | Inline handler (legacy no-op) | `reqId` → CORS → JSON parser → handler | ❌ Public | ❌ None | ❌ None | ❌ None | 10mb | ❌ None | `src/app.js:270` |
| GET | `/api/user/me` | `userRoutes.get("/me")` | `reqId` → CORS → JSON parser → `userRoutes` → `requireAuth` | ✅ `requireAuth` | ❌ None | ❌ None | ❌ None | N/A | ✅ Firestore (getUserData) | `src/app.js:260` → `src/routes/user.routes.js:40` |
| POST | `/api/users/ensure` | `usersRoutes.post("/ensure")` | `reqId` → CORS → JSON parser → `usersRoutes` → `requireAuth` | ✅ `requireAuth` | ❌ None | ❌ None | ❌ None | 10mb | ✅ Firestore (create/update user doc) | `src/app.js:265` → `src/routes/users.routes.js:14` |

---

## C. Credits & Payments Routes

| Method | Full Path | Handler | Middleware Chain | Auth | Validation | Rate Limit | Idempotency | Body Size | External APIs | File:Line |
|--------|-----------|---------|------------------|------|------------|------------|-------------|-----------|---------------|-----------|
| GET | `/credits` | `getCreditsHandler` | `reqId` → CORS → JSON parser → handler | ✅ `requireAuth` | ❌ None | ❌ None | ❌ None | N/A | ✅ Firestore (getCredits) | `src/app.js:157` → `src/handlers/credits.get.js` |
| GET | `/api/credits` | `getCreditsHandler` | `reqId` → CORS → JSON parser → handler | ✅ `requireAuth` | ❌ None | ❌ None | ❌ None | N/A | ✅ Firestore (getCredits) | `src/app.js:164` → `src/handlers/credits.get.js` |
| GET | `/api/credits` | `creditsRoutes.get("/")` | `reqId` → CORS → JSON parser → `creditsRoutes` → `requireAuth` | ✅ `requireAuth` | ❌ None | ❌ None | ❌ None | N/A | ✅ Firestore (getCredits) | `src/app.js:163` → `src/routes/credits.routes.js:17` |
| POST | `/checkout/start` | `startPlanCheckout` | `reqId` → CORS → JSON parser → `checkoutRoutes` → `requireAuth` | ✅ `requireAuth` | ❌ None | ❌ None | ❌ None | 10mb | ✅ Stripe API (createCheckoutSession) | `src/app.js:189` → `src/routes/checkout.routes.js:16` |
| POST | `/api/checkout/start` | `startPlanCheckout` | `reqId` → CORS → JSON parser → `checkoutRoutes` → `requireAuth` | ✅ `requireAuth` | ❌ None | ❌ None | ❌ None | 10mb | ✅ Stripe API (createCheckoutSession) | `src/app.js:190` → `src/routes/checkout.routes.js:16` |
| POST | `/checkout/session` | `createCheckoutSession` | `reqId` → CORS → JSON parser → `checkoutRoutes` → `requireAuth` → `validate(checkoutSessionSchema)` | ✅ `requireAuth` | ✅ Zod (`checkoutSessionSchema`) | ❌ None | ❌ None | 10mb | ✅ Stripe API | `src/app.js:189` → `src/routes/checkout.routes.js:20` |
| POST | `/checkout/subscription` | `createSubscriptionSession` | `reqId` → CORS → JSON parser → `checkoutRoutes` → `requireAuth` → `validate(subscriptionSessionSchema)` | ✅ `requireAuth` | ✅ Zod (`subscriptionSessionSchema`) | ❌ None | ❌ None | 10mb | ✅ Stripe API | `src/app.js:189` → `src/routes/checkout.routes.js:23` |
| POST | `/checkout/portal` | `createBillingPortalSession` | `reqId` → CORS → JSON parser → `checkoutRoutes` → `requireAuth` | ✅ `requireAuth` | ❌ None | ❌ None | ❌ None | 10mb | ✅ Stripe API | `src/app.js:189` → `src/routes/checkout.routes.js:26` |
| POST | `/stripe/webhook` | Webhook handler | `reqId` → CORS → `express.raw({ type: "application/json" })` → `stripeWebhook` | ❌ Public (Stripe signature verification) | ✅ Stripe webhook signature | ❌ None | ✅ Idempotent (Firestore event tracking) | Raw body | ✅ Stripe API (webhook verification) | `src/app.js:75` → `src/routes/stripe.webhook.js:12` |
| GET | `/stripe/webhook` | Alive check | `reqId` → CORS → `stripeWebhook` | ❌ Public | ❌ None | ❌ None | ❌ None | N/A | ❌ None | `src/app.js:75` → `src/routes/stripe.webhook.js:144` |

---

## D. Quote & Script Generation Routes

| Method | Full Path | Handler | Middleware Chain | Auth | Validation | Rate Limit | Idempotency | Body Size | External APIs | File:Line |
|--------|-----------|---------|------------------|------|------------|------------|-------------|-----------|---------------|-----------|
| POST | `/generate` | `generate` controller | `reqId` → CORS → JSON parser → `generateRoutes` → `requireAuth` → `idempotency()` → `validate(GenerateSchema)` | ✅ `requireAuth` | ✅ Zod (`GenerateSchema`) | ❌ None | ✅ `X-Idempotency-Key` (Firestore) | 10mb | ✅ Replicate API, OpenAI API | `src/app.js:159` → `src/routes/generate.routes.js:11` |
| POST | `/api/generate` | `generate` controller | `reqId` → CORS → JSON parser → `generateRoutes` → `requireAuth` → `idempotency()` → `validate(GenerateSchema)` | ✅ `requireAuth` | ✅ Zod (`GenerateSchema`) | ❌ None | ✅ `X-Idempotency-Key` (Firestore) | 10mb | ✅ Replicate API, OpenAI API | `src/app.js:165` → `src/routes/generate.routes.js:11` |
| GET | `/job/:jobId` | `jobStatus` controller | `reqId` → CORS → JSON parser → `generateRoutes` → `requireAuth` | ✅ `requireAuth` | ❌ None | ❌ None | ❌ None | N/A | ✅ Replicate API (poll status) | `src/app.js:159` → `src/routes/generate.routes.js:12` |
| POST | `/api/quotes/ai` | `generateQuote` | `reqId` → CORS → JSON parser → `quotesRoutes` → `requireAuth` → `blockAIQuotesForFree()` | ✅ `requireAuth` | ❌ None | ❌ None | ❌ None | 10mb | ✅ OpenAI API (LLM) | `src/routes/quotes.routes.js:10` |
| POST | `/api/quotes/generate-quote` | `generateQuote` | `reqId` → CORS → JSON parser → `quotesRoutes` → `requireAuth` → `validate(GenerateQuoteSchema)` | ✅ `requireAuth` | ✅ Zod (`GenerateQuoteSchema`) | ❌ None | ❌ None | 10mb | ✅ OpenAI API (LLM) or curated pool | `src/routes/quotes.routes.js:11` |
| POST | `/api/quotes/remix` | `remixQuote` | `reqId` → CORS → JSON parser → `quotesRoutes` → `requireAuth` → `validate(RemixQuoteSchema)` | ✅ `requireAuth` | ✅ Zod (`RemixQuoteSchema`) | ❌ None | ❌ None | 10mb | ✅ OpenAI API (LLM) | `src/routes/quotes.routes.js:12` |
| POST | `/api/quotes/save` | `saveQuote` | `reqId` → CORS → JSON parser → `quotesRoutes` → `requireAuth` → `validate(SaveQuoteSchema)` | ✅ `requireAuth` | ✅ Zod (`SaveQuoteSchema`) | ❌ None | ❌ None | 10mb | ✅ Firestore (save quote) | `src/routes/quotes.routes.js:13` |

---

## E. Story & Beat Editor Routes

| Method | Full Path | Handler | Middleware Chain | Auth | Validation | Rate Limit | Idempotency | Body Size | External APIs | File:Line |
|--------|-----------|---------|------------------|------|------------|------------|-------------|-----------|---------------|-----------|
| POST | `/api/story/start` | Inline handler | `reqId` → CORS → JSON parser → `storyRoutes` → `requireAuth` → inline Zod (`StartSchema`) | ✅ `requireAuth` | ✅ Zod (`StartSchema`, inline) | ❌ None | ❌ None | 10mb | ✅ Firestore (create session) | `src/app.js:244` → `src/routes/story.routes.js:46` |
| POST | `/api/story/generate` | Inline handler | `reqId` → CORS → JSON parser → `storyRoutes` → `requireAuth` → `enforceScriptDailyCap(300)` → inline Zod (`GenerateSchema`) | ✅ `requireAuth` | ✅ Zod (`GenerateSchema`, inline) | ✅ Daily cap: 300/day | ❌ None | 10mb | ✅ OpenAI API (LLM), Firestore | `src/app.js:244` → `src/routes/story.routes.js:77` |
| POST | `/api/story/update-script` | Inline handler | `reqId` → CORS → JSON parser → `storyRoutes` → `requireAuth` → inline Zod (`UpdateScriptSchema`) | ✅ `requireAuth` | ✅ Zod (`UpdateScriptSchema`, inline) | ❌ None | ❌ None | 10mb | ✅ Firestore (update session) | `src/app.js:244` → `src/routes/story.routes.js:108` |
| POST | `/api/story/plan` | Inline handler | `reqId` → CORS → JSON parser → `storyRoutes` → `requireAuth` → `enforceScriptDailyCap(300)` → inline Zod (`SessionSchema`) | ✅ `requireAuth` | ✅ Zod (`SessionSchema`, inline) | ✅ Daily cap: 300/day | ❌ None | 10mb | ✅ OpenAI API (LLM), Firestore | `src/app.js:244` → `src/routes/story.routes.js:143` |
| POST | `/api/story/search` | Inline handler | `reqId` → CORS → JSON parser → `storyRoutes` → `requireAuth` → inline Zod (`SessionSchema`) | ✅ `requireAuth` | ✅ Zod (`SessionSchema`, inline) | ❌ None | ❌ None | 10mb | ✅ Pexels API, Firestore | `src/app.js:244` → `src/routes/story.routes.js:172` |
| POST | `/api/story/update-shot` | Inline handler | `reqId` → CORS → JSON parser → `storyRoutes` → `requireAuth` → inline Zod (`UpdateShotSchema`) | ✅ `requireAuth` | ✅ Zod (`UpdateShotSchema`, inline) | ❌ None | ❌ None | 10mb | ✅ Firestore (update shot) | `src/app.js:244` → `src/routes/story.routes.js:201` |
| POST | `/api/story/search-shot` | Inline handler | `reqId` → CORS → JSON parser → `storyRoutes` → `requireAuth` → inline Zod (`SearchShotSchema`) | ✅ `requireAuth` | ✅ Zod (`SearchShotSchema`, inline) | ❌ None | ❌ None | 10mb | ✅ Pexels API (no timeout found) | `src/app.js:244` → `src/routes/story.routes.js:238` |
| POST | `/api/story/insert-beat` | Inline handler | `reqId` → CORS → JSON parser → `storyRoutes` → `requireAuth` → inline Zod (`InsertBeatSchema`) | ✅ `requireAuth` | ✅ Zod (`InsertBeatSchema`, inline) | ❌ None | ❌ None | 10mb | ✅ Pexels API, Firestore | `src/app.js:244` → `src/routes/story.routes.js:284` |
| POST | `/api/story/delete-beat` | Inline handler | `reqId` → CORS → JSON parser → `storyRoutes` → `requireAuth` → inline Zod (`DeleteBeatSchema`) | ✅ `requireAuth` | ✅ Zod (`DeleteBeatSchema`, inline) | ❌ None | ❌ None | 10mb | ✅ Firestore (update session) | `src/app.js:244` → `src/routes/story.routes.js:321` |
| POST | `/api/story/update-beat-text` | Inline handler | `reqId` → CORS → JSON parser → `storyRoutes` → `requireAuth` → inline Zod (`UpdateBeatTextSchema`) | ✅ `requireAuth` | ✅ Zod (`UpdateBeatTextSchema`, inline) | ❌ None | ❌ None | 10mb | ✅ Firestore (update session) | `src/app.js:244` → `src/routes/story.routes.js:362` |
| POST | `/api/story/timeline` | Inline handler | `reqId` → CORS → JSON parser → `storyRoutes` → `requireAuth` → inline Zod (`SessionSchema`) | ✅ `requireAuth` | ✅ Zod (`SessionSchema`, inline) | ❌ None | ❌ None | 10mb | ✅ Firestore (update session) | `src/app.js:244` → `src/routes/story.routes.js:396` |
| POST | `/api/story/captions` | Inline handler | `reqId` → CORS → JSON parser → `storyRoutes` → `requireAuth` → inline Zod (`SessionSchema`) | ✅ `requireAuth` | ✅ Zod (`SessionSchema`, inline) | ❌ None | ❌ None | 10mb | ✅ Firestore (update session) | `src/app.js:244` → `src/routes/story.routes.js:425` |
| POST | `/api/story/render` | Inline handler | `reqId` → CORS → JSON parser → `storyRoutes` → `requireAuth` → inline Zod (`SessionSchema`) | ✅ `requireAuth` | ✅ Zod (`SessionSchema`, inline) | ❌ None | ❌ None | 10mb | ✅ FFmpeg rendering, Firestore | `src/app.js:244` → `src/routes/story.routes.js:454` |
| POST | `/api/story/finalize` | Inline handler | `reqId` → CORS → JSON parser → `storyRoutes` → `requireAuth` → `enforceCreditsForRender()` → inline Zod (`SessionSchema`) | ✅ `requireAuth` | ✅ Zod (`SessionSchema`, inline) | ❌ None | ❌ None | 10mb | ✅ FFmpeg rendering, Firestore, credit service | `src/app.js:244` → `src/routes/story.routes.js:483` |
| POST | `/api/story/manual` | Inline handler | `reqId` → CORS → JSON parser → `storyRoutes` → `requireAuth` → inline Zod (`ManualSchema`) | ✅ `requireAuth` | ✅ Zod (`ManualSchema`, inline, max 850 chars) | ❌ None | ❌ None | 10mb | ✅ Firestore (create session) | `src/app.js:244` → `src/routes/story.routes.js:528` |
| POST | `/api/story/create-manual-session` | Inline handler | `reqId` → CORS → JSON parser → `storyRoutes` → `requireAuth` → inline Zod (`CreateManualSessionSchema`, max 8 beats) | ✅ `requireAuth` | ✅ Zod (`CreateManualSessionSchema`, inline) | ❌ None | ❌ None | 10mb | ✅ Firestore (create session) | `src/app.js:244` → `src/routes/story.routes.js:562` |
| GET | `/api/story/:sessionId` | Inline handler | `reqId` → CORS → JSON parser → `storyRoutes` → `requireAuth` | ✅ `requireAuth` | ❌ None | ❌ None | ❌ None | N/A | ✅ Firestore (get session) | `src/app.js:244` → `src/routes/story.routes.js:669` |

---

## F. Caption Preview & Render Routes

| Method | Full Path | Handler | Middleware Chain | Auth | Validation | Rate Limit | Idempotency | Body Size | External APIs | File:Line |
|--------|-----------|---------|------------------|------|------------|------------|-------------|-----------|---------------|-----------|
| POST | `/api/caption/preview` | Inline handler | `reqId` → CORS → JSON parser → `captionPreviewRoutes` → `express.json()` | ❌ **PUBLIC** | ✅ Zod (`RasterSchema`, V3 raster mode only) | ❌ None | ❌ None | 10mb | ✅ Canvas rendering (no timeout) | `src/app.js:251` → `src/routes/caption.preview.routes.js:65` |
| POST | `/api/caption/render` | Inline handler | `reqId` → CORS → JSON parser → `captionRenderRoutes` → `express.json()` | ❌ **PUBLIC** | ✅ Zod (`CaptionMetaSchema`) | ❌ None | ❌ None | 10mb | ✅ Canvas rendering (no timeout) | `src/app.js:256` → `src/routes/caption.render.routes.js:8` |
| GET | `/api/diag/caption-smoke` | Inline handler | `reqId` → CORS → JSON parser → `captionPreviewRoutes` | ❌ Public | ❌ None | ❌ None | ❌ None | N/A | ✅ Canvas rendering | `src/app.js:251` → `src/routes/caption.preview.routes.js:1052` |

**⚠️ SECURITY CONCERN:** Both `/api/caption/preview` and `/api/caption/render` are **public** (no auth) and accept large payloads (10mb). Canvas rendering has no timeout, making them vulnerable to DoS.

---

## G. TTS & Voice Routes

| Method | Full Path | Handler | Middleware Chain | Auth | Validation | Rate Limit | Idempotency | Body Size | External APIs | File:Line |
|--------|-----------|---------|------------------|------|------------|------------|-------------|-----------|---------------|-----------|
| POST | `/api/tts/preview` | `ttsPreview` controller | `reqId` → CORS → JSON parser → `ttsRoutes` | ❌ **PUBLIC** | ❌ None | ❌ None | ❌ None | 10mb | ✅ OpenAI TTS API or ElevenLabs API (with retry, no explicit timeout) | `src/app.js:241` → `src/routes/tts.routes.js:5` |
| GET | `/api/voice/voices` | `getVoices` controller | `reqId` → CORS → JSON parser → `voiceRoutes` → `requireAuth` | ✅ `requireAuth` | ❌ None | ❌ None | ❌ None | N/A | ✅ OpenAI API or ElevenLabs API | `src/app.js:226` → `src/routes/voice.routes.js:7` |
| POST | `/api/voice/preview` | `previewVoice` controller | `reqId` → CORS → JSON parser → `voiceRoutes` → `requireAuth` | ✅ `requireAuth` | ❌ None | ❌ None | ❌ None | 10mb | ✅ OpenAI TTS API or ElevenLabs API | `src/app.js:226` → `src/routes/voice.routes.js:8` |

**⚠️ SECURITY CONCERN:** `/api/tts/preview` is **public** (no auth) and calls external TTS APIs with retry logic but no explicit timeout, making it vulnerable to cost amplification attacks.

---

## H. Asset Search Routes

| Method | Full Path | Handler | Middleware Chain | Auth | Validation | Rate Limit | Idempotency | Body Size | External APIs | File:Line |
|--------|-----------|---------|------------------|------|------------|------------|-------------|-----------|---------------|-----------|
| POST | `/api/assets/options` | `getAssetsOptions` | `reqId` → CORS → JSON parser → `assetsRoutes` → `requireAuth` → `validate(AssetsOptionsSchema)` | ✅ `requireAuth` | ✅ Zod (`AssetsOptionsSchema`) | ❌ None | ❌ None | 10mb | ✅ Pexels API (no timeout found) | `src/app.js:217` → `src/routes/assets.routes.js:10` |
| POST | `/api/assets/ai-images` | Disabled handler (410) | `reqId` → CORS → JSON parser → `assetsRoutes` → `requireAuth` → `planGuard('pro')` → `validate(AiImagesSchema)` | ✅ `requireAuth` | ✅ Zod (`AiImagesSchema`) | ❌ None | ❌ None | 10mb | ❌ Disabled | `src/app.js:217` → `src/routes/assets.routes.js:12` |

---

## I. Upload Routes

| Method | Full Path | Handler | Middleware Chain | Auth | Validation | Rate Limit | Idempotency | Body Size | External APIs | File:Line |
|--------|-----------|---------|------------------|------|------------|------------|-------------|-----------|---------------|-----------|
| POST | `/api/uploads/image` | Inline handler | `reqId` → CORS → JSON parser → `uploadsRoutes` → `requireAuth` → `multer.single("file")` (8MB limit) | ✅ `requireAuth` | ✅ MIME type check (image/jpeg, image/png, image/webp) | ❌ None | ❌ None | **8mb** (multer) | ✅ Firebase Storage (uploadPublic) | `src/app.js:202` → `src/routes/uploads.routes.js:25` |
| POST | `/api/uploads/register` | Inline handler | `reqId` → CORS → JSON parser → `uploadsRoutes` → `requireAuth` | ✅ `requireAuth` | ✅ URL validation (https?://) | ❌ None | ❌ None | 10mb | ✅ External fetch (imageUrl), Firebase Storage | `src/app.js:202` → `src/routes/uploads.routes.js:61` |

---

## J. Shorts & Studio Routes

| Method | Full Path | Handler | Middleware Chain | Auth | Validation | Rate Limit | Idempotency | Body Size | External APIs | File:Line |
|--------|-----------|---------|------------------|------|------------|------------|-------------|-----------|---------------|-----------|
| GET | `/api/shorts/mine` | `getMyShorts` | `reqId` → CORS → JSON parser → `shortsRoutes` → `requireAuth` | ✅ `requireAuth` | ❌ None | ❌ None | ❌ None | N/A | ✅ Firestore (query shorts) | `src/app.js:195` → `src/routes/shorts.routes.js:12` |
| GET | `/api/shorts/:jobId` | `getShortById` | `reqId` → CORS → JSON parser → `shortsRoutes` → `requireAuth` | ✅ `requireAuth` | ❌ None | ❌ None | ❌ None | N/A | ✅ Firestore (get short) | `src/app.js:195` → `src/routes/shorts.routes.js:13` |
| POST | `/api/studio/start` | `startStudio` | `reqId` → CORS → JSON parser → `studioRoutes` → `requireAuth` → inline Zod (`StartSchema`) | ✅ `requireAuth` | ✅ Zod (`StartSchema`, inline) | ❌ None | ❌ None | 10mb | ✅ Firestore (create studio) | `src/routes/studio.routes.js:66` |
| POST | `/api/studio/quote` | `generateQuoteCandidates` | `reqId` → CORS → JSON parser → `studioRoutes` → `requireAuth` → `ensureStudio(true)` → inline Zod (`QuoteSchema`) | ✅ `requireAuth` | ✅ Zod (`QuoteSchema`, inline) | ❌ None | ❌ None | 10mb | ✅ OpenAI API (LLM) or curated pool | `src/routes/studio.routes.js:90` |
| POST | `/api/studio/image` | `generateImageCandidates` | `reqId` → CORS → JSON parser → `studioRoutes` → `requireAuth` → `ensureStudio(true)` → inline Zod (`ImageSchema`) | ✅ `requireAuth` | ✅ Zod (`ImageSchema`, inline) | ❌ None | ❌ None | 10mb | ✅ Pexels API, Replicate API | `src/routes/studio.routes.js:132` |
| POST | `/api/studio/video` | `generateVideoCandidates` | `reqId` → CORS → JSON parser → `studioRoutes` → `requireAuth` → `ensureStudio(true)` → inline Zod (`VideoSchema`) | ✅ `requireAuth` | ✅ Zod (`VideoSchema`, inline) | ❌ None | ❌ None | 10mb | ✅ Pexels API | `src/routes/studio.routes.js:78` |
| POST | `/api/studio/choose` | `chooseCandidate` | `reqId` → CORS → JSON parser → `studioRoutes` → `requireAuth` → `ensureStudio(true)` → inline Zod (`ChooseSchema`) | ✅ `requireAuth` | ✅ Zod (`ChooseSchema`, inline) | ❌ None | ❌ None | 10mb | ✅ Firestore (update studio) | `src/routes/studio.routes.js:144` |
| POST | `/api/studio/finalize` | `finalizeStudio` or `finalizeStudioMulti` | `reqId` → CORS → JSON parser → `studioRoutes` → `requireAuth` → `ensureStudio(true)` → `enforceCreditsForRender()` → inline Zod (`FinalizeSchema`) | ✅ `requireAuth` | ✅ Zod (`FinalizeSchema`, inline) | ❌ None | ❌ None | 10mb | ✅ FFmpeg rendering (multi-format), Firestore, credit service | `src/routes/studio.routes.js:157` |
| GET | `/api/studio/events/:studioId` | SSE handler | `reqId` → CORS → JSON parser → `studioRoutes` → `requireAuth` | ✅ `requireAuth` | ❌ None | ❌ None | ❌ None | N/A | ❌ Server-Sent Events (in-memory bus) | `src/routes/studio.routes.js:214` |
| POST | `/api/studio/remix` | `createRemix` | `reqId` → CORS → JSON parser → `studioRoutes` → `requireAuth` → inline Zod (`RemixSchema`) | ✅ `requireAuth` | ✅ Zod (`RemixSchema`, inline) | ❌ None | ❌ None | 10mb | ✅ FFmpeg rendering, Firestore | `src/routes/studio.routes.js:238` |
| GET | `/api/studio/:renderId/remixes` | `listRemixes` | `reqId` → CORS → JSON parser → `studioRoutes` → `requireAuth` | ✅ `requireAuth` | ❌ None | ❌ None | ❌ None | N/A | ✅ Firestore (query remixes) | `src/routes/studio.routes.js:253` |
| POST | `/api/studio/social-image` | `generateSocialImage` | `reqId` → CORS → JSON parser → `studioRoutes` → `requireAuth` → inline Zod (`SocialImageSchema`) | ✅ `requireAuth` | ✅ Zod (`SocialImageSchema`, inline) | ❌ None | ❌ None | 10mb | ✅ Canvas rendering | `src/routes/studio.routes.js:266` |
| POST | `/api/studio/caption` | `generateCaption` | `reqId` → CORS → JSON parser → `studioRoutes` → `requireAuth` → inline Zod (`CaptionSchema`) | ✅ `requireAuth` | ✅ Zod (`CaptionSchema`, inline) | ❌ None | ❌ None | 10mb | ✅ OpenAI API (LLM) | `src/routes/studio.routes.js:280` |
| GET | `/api/studio/:studioId` | `getStudio` | `reqId` → CORS → JSON parser → `studioRoutes` → `requireAuth` | ✅ `requireAuth` | ❌ None | ❌ None | ❌ None | N/A | ✅ Firestore (get studio) | `src/routes/studio.routes.js:292` |
| GET | `/api/studio` | `listStudios` | `reqId` → CORS → JSON parser → `studioRoutes` → `requireAuth` | ✅ `requireAuth` | ❌ None | ❌ None | ❌ None | N/A | ✅ Firestore (query studios) | `src/routes/studio.routes.js:305` |
| POST | `/api/studio/resume` | `getStudio` | `reqId` → CORS → JSON parser → `studioRoutes` → `requireAuth` → inline Zod (`ResumeSchema`) | ✅ `requireAuth` | ✅ Zod (`ResumeSchema`, inline) | ❌ None | ❌ None | 10mb | ✅ Firestore (get studio) | `src/routes/studio.routes.js:326` |
| POST | `/api/studio/delete` | `deleteStudio` | `reqId` → CORS → JSON parser → `studioRoutes` → `requireAuth` → inline Zod (`DeleteSchema`) | ✅ `requireAuth` | ✅ Zod (`DeleteSchema`, inline) | ❌ None | ❌ None | 10mb | ✅ Firestore (delete studio) | `src/routes/studio.routes.js:340` |

---

## K. Limits Routes

| Method | Full Path | Handler | Middleware Chain | Auth | Validation | Rate Limit | Idempotency | Body Size | External APIs | File:Line |
|--------|-----------|---------|------------------|------|------------|------------|-------------|-----------|---------------|-----------|
| GET | `/api/limits/usage` | `getUsageLimits` | `reqId` → CORS → JSON parser → `limitsRoutes` → `requireAuth` | ✅ `requireAuth` | ❌ None | ❌ None | ❌ None | N/A | ✅ Firestore (query user limits) | `src/app.js:221` → `src/routes/limits.routes.js:7` |
| GET | `/limits/usage` | `getUsageLimits` | `reqId` → CORS → JSON parser → `limitsRoutes` → `requireAuth` | ✅ `requireAuth` | ❌ None | ❌ None | ❌ None | N/A | ✅ Firestore (query user limits) | `src/app.js:222` → `src/routes/limits.routes.js:7` |

---

## L. Enhance Routes

| Method | Full Path | Handler | Middleware Chain | Auth | Validation | Rate Limit | Idempotency | Body Size | External APIs | File:Line |
|--------|-----------|---------|------------------|------|------------|------------|-------------|-----------|---------------|-----------|
| POST | `/enhance` | `enhance` controller | `reqId` → CORS → JSON parser → `enhanceRoutes` → `requireAuth` → `validate(EnhanceSchema)` | ✅ `requireAuth` | ✅ Zod (`EnhanceSchema`) | ❌ None | ❌ None | 10mb | ✅ Replicate API, OpenAI API | `src/app.js:184` → `src/routes/enhance.routes.js:28` |
| POST | `/api/enhance` | `enhance` controller | `reqId` → CORS → JSON parser → `enhanceRoutes` → `requireAuth` → `validate(EnhanceSchema)` | ✅ `requireAuth` | ✅ Zod (`EnhanceSchema`) | ❌ None | ❌ None | 10mb | ✅ Replicate API, OpenAI API | `src/app.js:185` → `src/routes/enhance.routes.js:28` |

---

## M. CDN Proxy Routes

| Method | Full Path | Handler | Middleware Chain | Auth | Validation | Rate Limit | Idempotency | Body Size | External APIs | File:Line |
|--------|-----------|---------|------------------|------|------------|------------|-------------|-----------|---------------|-----------|
| GET | `/cdn` | Inline handler | `reqId` → CORS → JSON parser → `cdnRoutes` | ❌ Public | ✅ Origin check (Firebase Storage only) | ❌ None | ❌ None | N/A | ✅ Firebase Storage (10s timeout via AbortController) | `src/app.js:199` → `src/routes/cdn.routes.js:10` |

---

## N. Creative Page Routes

| Method | Full Path | Handler | Middleware Chain | Auth | Validation | Rate Limit | Idempotency | Body Size | External APIs | File:Line |
|--------|-----------|---------|------------------|------|------------|------------|-------------|-----------|---------------|-----------|
| GET | `/creative` | Serves HTML file | `reqId` → CORS → JSON parser → `creativeRoutes` | ❌ Public | ❌ None | ❌ None | ❌ None | N/A | ❌ None | `src/app.js:231` → `src/routes/creative.routes.js:11` |

---

## O. Static & SPA Routes

| Method | Full Path | Handler | Middleware Chain | Auth | Validation | Rate Limit | Idempotency | Body Size | External APIs | File:Line |
|--------|-----------|---------|------------------|------|------------|------------|-------------|-----------|---------------|-----------|
| GET | `/assets/*` | Static file serving | `reqId` → CORS → `express.static("assets")` | ❌ Public | ❌ None | ❌ None | ❌ None | N/A | ❌ None | `src/app.js:132` |
| GET | `/*` (SPA fallback) | Serves `web/dist/index.html` | `reqId` → CORS → JSON parser → static middleware → SPA handler | ❌ Public | ❌ None | ❌ None | ❌ None | N/A | ❌ None | `src/app.js:284` |
| GET | `/*` (public static) | Serves `public/*` files | `reqId` → CORS → JSON parser → static middleware | ❌ Public | ❌ None | ❌ None | ❌ None | N/A | ❌ None | `src/app.js:306` |

---

## Security Summary

### 🔴 Critical: Public Routes That Should Be Protected

1. **`POST /api/caption/preview`** (`src/routes/caption.preview.routes.js:65`)
   - **Issue**: No authentication required
   - **Risk**: Accepts 10mb payloads, performs canvas rendering (CPU-intensive), no timeout
   - **Impact**: DoS via large payloads, cost amplification via rendering
   - **Recommendation**: Add `requireAuth` middleware

2. **`POST /api/caption/render`** (`src/routes/caption.render.routes.js:8`)
   - **Issue**: No authentication required
   - **Risk**: Accepts 10mb payloads, performs canvas rendering, no timeout
   - **Impact**: DoS via large payloads, cost amplification
   - **Recommendation**: Add `requireAuth` middleware

3. **`POST /api/tts/preview`** (`src/routes/tts.routes.js:5`)
   - **Issue**: No authentication required
   - **Risk**: Calls external TTS APIs (OpenAI/ElevenLabs), has retry logic but no explicit timeout
   - **Impact**: Cost amplification attacks, API quota exhaustion
   - **Recommendation**: Add `requireAuth` middleware and explicit timeout

### 🟡 Warning: Large Payload Routes Without Specific Limits

1. **`POST /api/caption/preview`** - 10mb global limit, but no text length validation beyond schema
2. **`POST /api/story/*`** - 10mb global limit, accepts arrays of beats (max 8 beats, 850 chars total enforced in Zod)
3. **`POST /api/studio/finalize`** - 10mb global limit, accepts `renderSpec` object (no size validation)

### 🟡 Warning: External API Calls Without Timeouts

1. **`POST /api/caption/preview`** - Canvas rendering (no timeout, relies on server timeout of 10min)
2. **`POST /api/story/generate`** - LLM calls via OpenAI API (no explicit timeout found)
3. **`POST /api/quotes/ai`** - LLM calls via OpenAI API (no explicit timeout found)
4. **`POST /api/assets/options`** - Pexels API calls (no timeout found in codebase search)
5. **`POST /api/story/search-shot`** - Pexels API calls (no timeout found)
6. **`POST /api/studio/image`** - Pexels API, Replicate API (no timeout found)
7. **`POST /api/studio/video`** - Pexels API (no timeout found)

**Note**: Some services have retry logic (TTS service has `fetchWithRetry` with 2 attempts), but no explicit timeout wrappers found for most external API calls.

### 🟡 Warning: Cost Amplification Risks

1. **`POST /api/caption/preview`** (Public)
   - No auth, no rate limit, canvas rendering (CPU)
   - **Risk**: High - can be spammed to exhaust CPU

2. **`POST /api/tts/preview`** (Public)
   - No auth, no rate limit, external TTS API calls
   - **Risk**: High - can exhaust TTS API quota

3. **`POST /api/story/generate`** (Protected)
   - Has daily cap (300/day), but LLM calls are expensive
   - **Risk**: Medium - authenticated users can still generate costs

4. **`POST /api/story/finalize`** (Protected)
   - Credit check enforced, but render costs (FFmpeg)
   - **Risk**: Low - credits act as rate limit

5. **`POST /api/studio/finalize`** (Protected)
   - Credit check enforced, but multi-format rendering (3 formats = 3x cost)
   - **Risk**: Low - credits act as rate limit, but cost per request is high

### ✅ Good Practices Found

1. **Idempotency**: `/generate` routes use `X-Idempotency-Key` header with Firestore tracking
2. **Rate Limiting**: Script generation has daily cap (300/day) via `enforceScriptDailyCap`
3. **Credit Enforcement**: Render routes check credits before processing
4. **Validation**: Most routes use Zod schemas for input validation
5. **File Upload Limits**: Multer enforces 8MB limit on image uploads
6. **CDN Proxy Timeout**: `/cdn` route has 10s timeout via AbortController

### 📋 Recommendations

1. **Add authentication** to `/api/caption/preview`, `/api/caption/render`, and `/api/tts/preview`
2. **Add explicit timeouts** to all external API calls (OpenAI, Pexels, Replicate, TTS)
3. **Add rate limiting** middleware (e.g., `express-rate-limit`) for public or expensive routes
4. **Add request size validation** beyond global 10mb limit for specific routes (e.g., text length limits)
5. **Add timeout wrappers** for canvas rendering operations
6. **Consider IP-based rate limiting** for public routes to prevent abuse
7. **Add monitoring/alerting** for cost amplification patterns (e.g., TTS API quota exhaustion)

---

**Generated**: 2024-12-19  
**Total Routes Documented**: 80+  
**Routes with Auth**: 60+  
**Public Routes**: 20+  
**Routes with Validation**: 50+  
**Routes with Rate Limiting**: 2 (script generation daily cap, free daily short limit)
