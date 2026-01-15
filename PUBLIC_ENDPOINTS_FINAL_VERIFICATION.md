# Final Pre-Implementation Verification

**Date**: Final verification before implementation  
**Purpose**: Verify remaining assumptions to prevent implementation errors

---

## 1. /cdn URL Validation Security Audit

### Current Implementation Analysis

**Location**: `src/routes/cdn.routes.js:15-17`

**Current Code**:
```javascript
if (!/^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\//.test(u)) {
  return res.status(400).json({ error: 'Bad origin' });
}
```

**Security Issues Found**: ⚠️ **WEAK VALIDATION - Multiple Bypass Scenarios**

1. **Uses regex test, not URL parsing**:
   - ❌ No `new URL()` validation
   - ❌ Vulnerable to encoding tricks (`https://firebasestorage.googleapis.com@evil.com`)
   - ❌ No protocol enforcement via URL object

2. **Allows redirects to other domains**:
   - **Line 22**: `redirect: 'follow'` - ⚠️ **CRITICAL ISSUE**
   - If Firebase Storage redirects to another domain, proxy will follow
   - Could proxy arbitrary domains via redirect chains

3. **No explicit hostname check**:
   - Regex only checks prefix match
   - Could be bypassed with carefully crafted URLs

**Bypass Scenarios**:
- `https://firebasestorage.googleapis.com@evil.com/v0/b/...` (userinfo injection)
- `https://firebasestorage.googleapis.com.evil.com/v0/b/...` (subdomain confusion)
- Redirect chain: Firebase → evil.com (if redirect: 'follow' allows it)

**Risk Assessment**: **HIGH** - Current implementation could allow open proxy abuse.

**Recommended Fix**:
```javascript
// src/routes/cdn.routes.js:15-17
try {
  const urlObj = new URL(u);
  if (urlObj.protocol !== 'https:') {
    return res.status(400).json({ error: 'Bad origin: must use HTTPS' });
  }
  if (urlObj.hostname !== 'firebasestorage.googleapis.com') {
    return res.status(400).json({ error: 'Bad origin: hostname mismatch' });
  }
  if (!urlObj.pathname.startsWith('/v0/b/')) {
    return res.status(400).json({ error: 'Bad origin: invalid path' });
  }
} catch (err) {
  return res.status(400).json({ error: 'Bad origin: invalid URL' });
}

// Prevent redirects to other domains
const up = await fetch(u, { 
  redirect: 'error',  // ✅ CHANGE: 'error' instead of 'follow'
  signal: ac.signal, 
  headers: { Accept: 'image/*' } 
});
```

**Conclusion**: ⚠️ **MUST FIX** - Current validation is weak. Use `new URL()` parsing + `redirect: 'error'`.

---

## 2. Trust Proxy Configuration

### Deployment Proxy Hop Count

**Finding**: ✅ **RECOMMEND ENV-CONFIGURABLE**

**Evidence**:
- **Deployment**: Replit (single proxy layer expected)
- **No existing config**: No `TRUST_PROXY_HOPS` or similar found
- **Risk**: Hardcoding `1` assumes single proxy, but deployment may change

**Recommended Fix** (Minimal-diff, future-proof):
```javascript
// src/app.js (after line 35, before routes)
// Trust proxy for rate limiting (configurable via env)
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 1));
```

**Rationale**:
- Defaults to `1` (safe for Replit)
- Configurable if deployment changes (Netlify, multiple proxies, etc.)
- Minimal diff, no breaking changes

**Conclusion**: ✅ Use env-configurable version to avoid hardcoding assumptions.

---

## 3. VAIFORM_DEBUG Production Safety

### Configuration Audit

**Finding**: ✅ **SAFE - Not set in production by default**

**Evidence**:

1. **No production env files**:
   - `web/.env.production` exists but is gitignored (not committed)
   - No `.env` files in repo

2. **Deployment configs**:
   - **`.replit`**: No `VAIFORM_DEBUG` set
   - **`netlify.toml`**: No env vars set
   - **GitHub workflows**: Only sets `NODE_ENV: test` (not `VAIFORM_DEBUG`)

3. **Code usage**:
   - All checks use strict equality: `process.env.VAIFORM_DEBUG === "1"`
   - Only enables debug routes when explicitly set to `"1"`

4. **Existing pattern**:
   - `src/app.js:177` - Already gates diag headers behind `VAIFORM_DEBUG=1`
   - Consistent pattern throughout codebase

**Risk Assessment**: **LOW** - Not set in production by default. Gating endpoints behind this flag is safe.

**Conclusion**: ✅ **SAFE TO GATE** - `VAIFORM_DEBUG` is not set in production, so gating endpoints is correct.

---

## Summary of Final Verifications

| Check | Finding | Risk | Action Required |
|-------|---------|------|-----------------|
| 1. /cdn URL validation | ⚠️ **WEAK** (regex, allows redirects) | **HIGH** | **MUST FIX** - Use `new URL()` + `redirect: 'error'` |
| 2. Trust proxy | ✅ Recommend env-configurable | Low | Use `TRUST_PROXY_HOPS` env var |
| 3. VAIFORM_DEBUG | ✅ Not set in production | None | Safe to gate endpoints |

---

## Updated Implementation Checklist

### Critical Fix (Must Do First)
1. **Fix /cdn URL validation** (`src/routes/cdn.routes.js:15-22`):
   - Replace regex with `new URL()` parsing
   - Change `redirect: 'follow'` to `redirect: 'error'`
   - Add explicit protocol and hostname checks

### Priority 1 (Required for Rate Limiting)
2. **Set trust proxy** (`src/app.js:35`):
   - Use env-configurable: `app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 1))`

### Priority 2 (Gate Unused Endpoints)
3. **Gate `/health/register`** (`src/routes/health.routes.js:42`)
4. **Gate `/api/diag/caption-smoke`** (`src/routes/caption.preview.routes.js:1030`)

### Priority 3 (Rate Limiting)
5. **Add rate limiting to `/cdn`** (`src/routes/cdn.routes.js:10`):
   - Use 300/min limit
   - Enable `standardHeaders: true`

### Priority 4 (Body Size Limits)
6. **Add body size limit to Stripe webhook** (`src/routes/stripe.webhook.js:12`):
   - Use 1mb limit (safer than 50kb for future Stripe events)

---

**End of Final Verification**
