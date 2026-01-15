# Public Endpoints Verification Report

**Date**: Pre-implementation verification  
**Purpose**: Verify assumptions before applying minimal-diff fixes to public endpoints

---

## 1. Verify Actual Public Paths (Mount Prefix Sanity)

### `/api/diag/caption-smoke` Path Verification

**Finding**: ✅ **CORRECT PATH IDENTIFIED**

**Evidence**:
- **Mount point**: `src/app.js:261` - `app.use("/api", captionPreviewRoutes)`
- **Route definition**: `src/routes/caption.preview.routes.js:1030` - `router.get("/diag/caption-smoke", ...)`
- **Resulting full path**: `/api` + `/diag/caption-smoke` = **`/api/diag/caption-smoke`** ✅

**Conclusion**: The audit's path was correct. The route is accessible at `/api/diag/caption-smoke`.

**Fix Location**: `src/routes/caption.preview.routes.js:1030`

---

## 2. Verify Stripe Webhook Middleware Ordering

### Request Body Parsing Order Audit

**Finding**: ✅ **SAFE - Webhook is mounted BEFORE global JSON parser**

**Evidence**:
- **Line 72-76**: Stripe webhook mounted FIRST:
  ```javascript
  // ---------- Stripe webhook FIRST (before JSON parser) ----------
  import stripeWebhook from "./routes/stripe.webhook.js";
  app.use("/stripe/webhook", stripeWebhook);
  ```
- **Line 89**: Global JSON parser mounted AFTER:
  ```javascript
  app.use(express.json({ limit: "10mb" }));
  ```

**Webhook Route Implementation**:
- **Line 12**: Uses `express.raw({ type: "application/json" })` ✅
- **Line 23**: `stripe.webhooks.constructEvent(req.body, sig, ...)` receives raw Buffer ✅

**Risk Assessment**: **ZERO RISK** - Webhook route is correctly mounted before global JSON parser. Adding `limit: "50kb"` to `express.raw()` is safe.

**Recommended Fix**:
```javascript
// src/routes/stripe.webhook.js:12
router.post("/", express.raw({ type: "application/json", limit: "50kb" }), async (req, res) => {
```

**Conclusion**: ✅ Safe to add body size limit without breaking signature verification.

---

## 3. Verify `/cdn` Usage Patterns

### Frontend Call Sites Analysis

**Finding**: ✅ **USED IN AUTHENTICATED CONTEXTS, BUT CALLED BEFORE AUTH MAY BE READY**

**Evidence**:

1. **`public/js/my-shorts.js:157`**:
   ```javascript
   const proxify = (u) => u ? `${PROXY_BASE}/cdn?u=${encodeURIComponent(u)}`;
   ```
   - Used in `resolveCover()` function
   - Called when displaying shorts list (authenticated page)
   - **Pattern**: Per short thumbnail (could be 10-50+ requests on page load)

2. **`public/creative.html:9988`**:
   ```javascript
   const proxied = `${getApiBase()}/cdn?u=${encodeURIComponent(url)}`;
   ```
   - Used for AI-generated image previews
   - Called in authenticated Studio UI
   - **Pattern**: Per image preview (1-3 requests per generation)

3. **`public/creative.html:10045, 10052, 10056`**:
   - Multiple call sites for background image proxying
   - Used in Studio UI (authenticated)
   - **Pattern**: Per background selection (1-5 requests per session)

**Auth Context**:
- All call sites are in authenticated pages (`my-shorts.html`, `creative.html`)
- However, `/cdn` is called during page load, potentially before auth state is fully initialized
- **No explicit auth check before calling `/cdn`**

**Request Volume Estimate**:
- **My Shorts page**: 10-50 requests (one per thumbnail)
- **Studio page**: 1-10 requests (backgrounds + previews)
- **Typical user session**: 20-100 requests per page load

**Risk Assessment**: **MEDIUM** - High request volume, but legitimate use case. Rate limiting must be generous.

**Recommended Fix**:
```javascript
// src/routes/cdn.routes.js
import rateLimit from 'express-rate-limit';
const cdnRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300, // 300 requests per minute (accommodates 50 thumbnails + scrolling)
  message: 'Too many CDN proxy requests'
});
r.get("/", cdnRateLimit, async (req, res) => {
```

**Conclusion**: ✅ Keep public, but use generous rate limit (300/min) to accommodate legitimate browsing.

---

## 4. Verify Trust Proxy Settings

### Express Trust Proxy Configuration

**Finding**: ⚠️ **NOT SET - Rate limiting may not work correctly behind proxies**

**Evidence**:
- **Search result**: No matches for `trust proxy` or `trustProxy` in `src/`
- **Deployment context**: Code references Replit (`janeway.replit.dev` in redirects)
- **Risk**: Behind reverse proxy, all requests may appear from same IP

**Current State**: Express does not trust proxy headers, so `req.ip` will be the proxy's IP, not the client's IP.

**Risk Assessment**: **HIGH** - Rate limiting by IP will rate-limit all users as one IP if behind a single proxy.

**Recommended Fix**:
```javascript
// src/app.js (after line 35, before routes)
// Trust proxy for rate limiting (Replit/Netlify use single proxy)
app.set("trust proxy", 1); // Trust exactly one proxy layer
```

**Alternative** (if behind multiple proxies):
```javascript
app.set("trust proxy", true); // Trust all proxies (less secure, but works with multiple layers)
```

**Conclusion**: ⚠️ **MUST SET** `trust proxy` before implementing IP-based rate limiting.

---

## 5. Verify `/health/register` Usage

### Frontend Call Sites Analysis

**Finding**: ❌ **NOT USED IN PRODUCTION FRONTEND**

**Evidence**:
- **Search result**: No matches for `/health/register` or `health.*register` in `web/` or `public/`
- **Backend only**: Only referenced in `src/routes/health.routes.js:42`

**Endpoint Details**:
- **Schema**: `src/schemas/health.schema.js:3` - Only accepts `{ email: string }`
- **Response shape**: 
  - If exists: `{ success: true, message: 'User already exists.' }`
  - If new: `{ success: true, message: 'New user created.' }`
- **User enumeration risk**: ✅ **PRESENT** - Different messages reveal if email exists

**Risk Assessment**: **MEDIUM-HIGH** - Not used in production, but exposes user enumeration vulnerability.

**Recommended Fix** (Best: Gate behind debug flag):
```javascript
// src/routes/health.routes.js:42
if (process.env.VAIFORM_DEBUG === "1") {
  router.post("/register", validate(registerSchema), register);
} else {
  router.post("/register", (_req, res) => res.status(404).end());
}
```

**Alternative** (If needed in production):
1. Add rate limiting (5/min per IP)
2. Reduce body limit to 1kb
3. **Make response constant-time and constant-shape**:
   ```javascript
   // Always return same response shape
   res.json({ success: true, message: 'Registration processed.' });
   ```

**Conclusion**: ✅ **RECOMMEND GATING** - Not used in production, safest to disable unless explicitly enabled.

---

## 6. Verify `/version` Security

### Response Fields Audit

**Finding**: ✅ **SAFE - No secrets leaked, only boolean flags**

**Evidence**: `src/controllers/health.controller.js:68-80`
```javascript
res.json({
  status: 'ok',
  timestamp: new Date().toISOString(),
  node: process.version,
  environment: process.env.NODE_ENV || 'development',
  replicateKey: !!process.env.REPLICATE_API_TOKEN,        // ✅ Boolean only
  stripeKey: !!process.env.STRIPE_SECRET_KEY,              // ✅ Boolean only
  openaiKey: !!process.env.OPENAI_API_KEY,                 // ✅ Boolean only
  pexelsKey: !!process.env.PEXELS_API_KEY,                // ✅ Boolean only
  firebaseConfigured: !!admin.apps.length,                 // ✅ Boolean only
  commit: process.env.COMMIT_SHA || process.env.GITHUB_SHA || 'dev',
});
```

**Security Analysis**:
- ✅ **No API keys/tokens**: Only boolean flags (`!!envVar`)
- ✅ **No secrets**: No actual credential values
- ✅ **No bucket names**: No storage bucket identifiers
- ⚠️ **Commit SHA**: Exposes git commit (low risk, but reveals deployment info)
- ⚠️ **Environment**: Exposes `NODE_ENV` (low risk)

**Risk Assessment**: **LOW** - No sensitive data exposed. Commit SHA is informational only.

**Conclusion**: ✅ **SAFE** - No changes needed. Boolean flags don't leak secrets.

---

## 7. Check for Existing Rate Limiting Middleware

### Existing Rate Limiting Infrastructure

**Finding**: ❌ **NO EXISTING RATE LIMITING MIDDLEWARE**

**Evidence**:
- **Search result**: No matches for `rateLimit`, `rate-limit`, `throttle`, or `express-rate-limit` in `src/`
- **TTS service**: Has rate limit **response parsing** (reads headers from external API), not request limiting
- **Pixabay provider**: Has rate limit **response parsing**, not request limiting

**Conclusion**: ✅ **NO EXISTING PATTERN** - Need to add `express-rate-limit` package and create per-route limiters.

**Recommended Implementation**:
```javascript
// Install: npm install express-rate-limit
// src/routes/cdn.routes.js
import rateLimit from 'express-rate-limit';
const cdnRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});
```

---

## Summary of Verified Findings

| Check | Finding | Risk | Action Required |
|-------|---------|------|-----------------|
| 1. Mount path | ✅ Correct (`/api/diag/caption-smoke`) | None | Proceed with fix |
| 2. Stripe webhook order | ✅ Safe (mounted before JSON parser) | None | Safe to add limit |
| 3. `/cdn` usage | ✅ Used in auth pages, high volume | Medium | Use generous limit (300/min) |
| 4. Trust proxy | ⚠️ **NOT SET** | **HIGH** | **MUST SET** before rate limiting |
| 5. `/health/register` | ❌ Not used in production | Medium | **RECOMMEND GATING** |
| 6. `/version` security | ✅ Safe (no secrets) | None | No changes needed |
| 7. Rate limiting | ❌ None exists | None | Add `express-rate-limit` |

---

## Recommended Minimal-Diff Fixes (Post-Verification)

### Priority 1 (Critical)
1. **Set trust proxy** (`src/app.js:35`):
   ```javascript
   app.set("trust proxy", 1); // Before any routes
   ```

### Priority 2 (High Risk)
2. **Gate `/health/register`** (`src/routes/health.routes.js:42`):
   ```javascript
   if (process.env.VAIFORM_DEBUG === "1") {
     router.post("/register", validate(registerSchema), register);
   }
   ```

3. **Gate `/api/diag/caption-smoke`** (`src/routes/caption.preview.routes.js:1030`):
   ```javascript
   if (process.env.VAIFORM_DEBUG === "1") {
     router.get("/diag/caption-smoke", requireAuth, async (req, res) => {
   ```

### Priority 3 (Medium Risk)
4. **Add rate limiting to `/cdn`** (`src/routes/cdn.routes.js:10`):
   ```javascript
   import rateLimit from 'express-rate-limit';
   const cdnRateLimit = rateLimit({ windowMs: 60 * 1000, max: 300 });
   r.get("/", cdnRateLimit, async (req, res) => {
   ```

5. **Add body size limit to Stripe webhook** (`src/routes/stripe.webhook.js:12`):
   ```javascript
   router.post("/", express.raw({ type: "application/json", limit: "50kb" }), async (req, res) => {
   ```

---

## Implementation Order

1. **First**: Set `trust proxy` (required for rate limiting to work)
2. **Second**: Gate unused endpoints (`/health/register`, `/api/diag/caption-smoke`)
3. **Third**: Add rate limiting to `/cdn`
4. **Fourth**: Add body size limit to Stripe webhook

---

**End of Verification Report**
