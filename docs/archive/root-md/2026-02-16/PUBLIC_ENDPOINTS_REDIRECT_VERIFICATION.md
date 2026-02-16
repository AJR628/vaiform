# Firebase Storage Redirect Behavior Verification

**Date**: Final verification before /cdn redirect hardening  
**Purpose**: Verify whether Firebase Storage URLs redirect before changing `redirect: 'follow'` to `redirect: 'error'`

---

## Firebase Storage URL Pattern Analysis

### URL Format Found in Codebase

**Evidence**: `src/utils/storage.js:42`, `src/services/storage.service.js:29`

**Pattern**:
```
https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media&token=${token}
```

**Key Observations**:
1. **All URLs include `?alt=media`** - This is Firebase's direct download parameter
2. **Token-based authentication** - URLs use download tokens, not signed URLs
3. **Direct object access** - `/v0/b/{bucket}/o/{path}` is the direct object API endpoint

---

## Redirect Behavior Assessment

### Firebase Storage API Behavior

**Expected Behavior** (based on Firebase Storage API documentation):
- URLs with `?alt=media` are **direct download URLs** - they return the file directly (200 OK)
- Firebase Storage does **not** redirect these URLs to other domains
- The `/v0/b/{bucket}/o/{path}` endpoint serves files directly from Google's CDN

**Risk Assessment**: **LOW** - Firebase Storage direct download URLs (`?alt=media`) do not redirect.

**However**: Cannot verify without testing actual URLs. Safe approach is to handle redirects defensively.

---

## Recommended Safe Implementation

### Option 1: Use `redirect: 'manual'` with Allowlist Check (Safest)

**If redirects occur** (unlikely but possible), only follow if Location hostname is allowlisted:

```javascript
// src/routes/cdn.routes.js:21-40
const ac = new AbortController();
const timer = setTimeout(() => ac.abort(), 10_000);
try {
  let up = await fetch(u, { 
    redirect: 'manual',  // ✅ Don't auto-follow, check Location header
    signal: ac.signal, 
    headers: { Accept: 'image/*' } 
  });
  
  // Handle redirects manually (if any)
  if (up.status >= 300 && up.status < 400) {
    const location = up.headers.get('Location');
    if (!location) {
      return res.status(502).json({ error: 'Redirect without Location header' });
    }
    
    // Parse redirect location
    try {
      const redirectUrl = new URL(location, u); // Resolve relative URLs
      // Only allow redirects to same hostname (Firebase Storage)
      if (redirectUrl.hostname !== 'firebasestorage.googleapis.com') {
        return res.status(400).json({ error: 'Bad origin: redirect to non-Firebase host' });
      }
      // Follow redirect to same hostname
      up = await fetch(redirectUrl.toString(), { 
        redirect: 'manual',
        signal: ac.signal, 
        headers: { Accept: 'image/*' } 
      });
    } catch (err) {
      return res.status(400).json({ error: 'Bad origin: invalid redirect URL' });
    }
  }
  
  clearTimeout(timer);
  if (!up.ok) {
    console.error('[cdn] upstream status', up.status);
    return res.status(up.status).end();
  }
  // ... rest of handler
```

**Pros**: 
- Handles redirects if they occur
- Only allows redirects to same hostname
- Prevents open proxy abuse

**Cons**: 
- More complex code
- Handles edge case that likely never occurs

---

### Option 2: Use `redirect: 'error'` (Simpler, if redirects never occur)

**If Firebase Storage never redirects** (most likely), use simpler approach:

```javascript
const up = await fetch(u, { 
  redirect: 'error',  // ✅ Fail on redirect (prevents open proxy)
  signal: ac.signal, 
  headers: { Accept: 'image/*' } 
});
```

**Pros**:
- Simpler code
- Prevents open proxy abuse
- Fails fast if unexpected redirect occurs

**Cons**:
- Will break if Firebase Storage ever redirects (unlikely but possible)

---

## Recommendation

**Use Option 1 (`redirect: 'manual'` with allowlist)** for maximum safety:

1. **Defensive**: Handles edge case if Firebase Storage ever redirects
2. **Secure**: Only allows redirects to same hostname
3. **Minimal diff**: Still a small change from current code
4. **Future-proof**: Works even if Firebase Storage behavior changes

**Alternative**: If testing confirms Firebase Storage never redirects, Option 2 is acceptable.

---

## Micro-Tweaks for Bulletproof Validation

### Additional Security Checks

1. **Block credentials in URL** (prevents `user@host` tricks):
```javascript
if (urlObj.username || urlObj.password) {
  return res.status(400).json({ error: 'Bad origin: credentials not allowed' });
}
```

2. **Require `alt=media` parameter** (tightens what we proxy):
```javascript
if (urlObj.searchParams.get('alt') !== 'media') {
  return res.status(400).json({ error: 'Bad origin: must include alt=media' });
}
```

**Rationale**:
- All legitimate Firebase Storage URLs in codebase include `?alt=media`
- This further restricts what can be proxied
- Prevents proxying other Firebase Storage API endpoints (metadata, etc.)

---

## Trust Proxy IP Spoofing Risk

### Current State

**Finding**: ✅ **SAFE - No X-Forwarded-For usage found**

**Evidence**:
- No code reads `req.ip` or `req.ips` directly
- No custom IP extraction logic found
- Rate limiting will be first use of `req.ip`

**Deployment Context**:
- **Replit**: Single trusted proxy layer
- **Netlify**: Single trusted proxy layer (if used)
- **Risk**: Low - proxies are trusted infrastructure

**Recommendation**: 
- Use `app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS || 1))`
- Default to `1` (safe for Replit/Netlify)
- Only increase if explicitly configured (when moving to multi-proxy setup)

**Conclusion**: ✅ **SAFE** - Trust proxy setting is safe. Default to 1, configurable via env.

---

## Final Implementation Recommendation

### /cdn URL Validation (Complete Fix)

```javascript
// src/routes/cdn.routes.js:15-40
// Robust URL validation with new URL() parsing
try {
  const urlObj = new URL(u);
  
  // Protocol check
  if (urlObj.protocol !== 'https:') {
    return res.status(400).json({ error: 'Bad origin: must use HTTPS' });
  }
  
  // Hostname check (exact match)
  if (urlObj.hostname !== 'firebasestorage.googleapis.com') {
    return res.status(400).json({ error: 'Bad origin: hostname mismatch' });
  }
  
  // Path check
  if (!urlObj.pathname.startsWith('/v0/b/')) {
    return res.status(400).json({ error: 'Bad origin: invalid path' });
  }
  
  // Block credentials (prevents user@host tricks)
  if (urlObj.username || urlObj.password) {
    return res.status(400).json({ error: 'Bad origin: credentials not allowed' });
  }
  
  // Require alt=media (tightens what we proxy)
  if (urlObj.searchParams.get('alt') !== 'media') {
    return res.status(400).json({ error: 'Bad origin: must include alt=media' });
  }
} catch (err) {
  return res.status(400).json({ error: 'Bad origin: invalid URL' });
}

// Fetch with manual redirect handling (safest)
const ac = new AbortController();
const timer = setTimeout(() => ac.abort(), 10_000);
try {
  let up = await fetch(u, { 
    redirect: 'manual',  // ✅ Don't auto-follow redirects
    signal: ac.signal, 
    headers: { Accept: 'image/*' } 
  });
  
  // Handle redirects manually (if any) - only allow same hostname
  if (up.status >= 300 && up.status < 400) {
    const location = up.headers.get('Location');
    if (!location) {
      return res.status(502).json({ error: 'Redirect without Location header' });
    }
    try {
      const redirectUrl = new URL(location, u);
      if (redirectUrl.hostname !== 'firebasestorage.googleapis.com') {
        return res.status(400).json({ error: 'Bad origin: redirect to non-Firebase host' });
      }
      // Follow redirect to same hostname
      up = await fetch(redirectUrl.toString(), { 
        redirect: 'manual',
        signal: ac.signal, 
        headers: { Accept: 'image/*' } 
      });
    } catch (err) {
      return res.status(400).json({ error: 'Bad origin: invalid redirect URL' });
    }
  }
  
  clearTimeout(timer);
  if (!up.ok) {
    console.error('[cdn] upstream status', up.status);
    return res.status(up.status).end();
  }
  // ... rest of handler (buffer, set headers, return)
```

---

**End of Redirect Verification**
