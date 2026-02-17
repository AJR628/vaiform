import { Router } from 'express';
import rateLimit from 'express-rate-limit';

const r = Router();

const MAX_REDIRECTS = 2;

// Rate limit /cdn: max 300 requests per minute
const cdnRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * GET /cdn?u=<downloadUrl>
 * Same-origin proxy for Firebase download URLs.
 * Buffered with timeout to avoid hanging requests.
 */
r.get('/', cdnRateLimit, async (req, res) => {
  const u = String(req.query?.u || '').trim();
  const ts = new Date().toISOString();
  console.log('[cdn]', ts, 'GET', u.slice(0, 160));

  // URL parsing validation (replaces regex)
  let url;
  try {
    url = new URL(u);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  // Require https protocol
  if (url.protocol !== 'https:') {
    return res.status(400).json({ error: 'Bad origin' });
  }

  // Require hostname === firebasestorage.googleapis.com
  if (url.hostname !== 'firebasestorage.googleapis.com') {
    return res.status(400).json({ error: 'Bad origin' });
  }

  // Require pathname startsWith /v0/b/
  if (!url.pathname.startsWith('/v0/b/')) {
    return res.status(400).json({ error: 'Bad origin' });
  }

  // Reject if username/password present
  if (url.username || url.password) {
    return res.status(400).json({ error: 'Bad origin' });
  }

  // alt=media is SOFT: if missing, console.warn but DO NOT reject
  if (!url.searchParams.has('alt') || url.searchParams.get('alt') !== 'media') {
    console.warn('[cdn] missing alt=media parameter');
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10_000);
  try {
    // Manual redirect handling with MAX_REDIRECTS
    let currentUrl = u;
    let redirectCount = 0;

    while (redirectCount <= MAX_REDIRECTS) {
      const up = await fetch(currentUrl, {
        redirect: 'manual',
        signal: ac.signal,
        headers: { Accept: 'image/*' },
      });

      // Handle redirect
      if (up.status >= 300 && up.status < 400) {
        redirectCount++;
        if (redirectCount > MAX_REDIRECTS) {
          clearTimeout(timer);
          return res.status(502).json({ error: 'Too many redirects' });
        }

        const location = up.headers.get('location');
        if (!location) {
          clearTimeout(timer);
          return res.status(502).json({ error: 'Redirect missing location' });
        }

        // Validate redirect target
        let redirectUrl;
        try {
          redirectUrl = new URL(location, currentUrl);
        } catch (e) {
          clearTimeout(timer);
          return res.status(502).json({ error: 'Invalid redirect URL' });
        }

        // Enforce redirect target protocol https
        if (redirectUrl.protocol !== 'https:') {
          clearTimeout(timer);
          return res.status(502).json({ error: 'Bad redirect' });
        }

        // Enforce redirect target hostname firebasestorage.googleapis.com
        if (redirectUrl.hostname !== 'firebasestorage.googleapis.com') {
          clearTimeout(timer);
          return res.status(502).json({ error: 'Bad redirect' });
        }

        currentUrl = redirectUrl.toString();
        continue; // Follow redirect
      }

      // Non-redirect response
      clearTimeout(timer);
      if (!up.ok) {
        console.error('[cdn] upstream status', up.status);
        return res.status(up.status).end();
      }

      // Buffer body (some hosts stall with piping)
      const ab = await up.arrayBuffer();
      const buf = Buffer.from(ab);

      const ct = up.headers.get('content-type') || 'image/png';
      const cc = up.headers.get('cache-control') || 'public, max-age=3600, immutable';

      res.set('Content-Type', ct);
      res.set('Cache-Control', cc);
      res.set('Content-Length', String(buf.length));
      res.set('Access-Control-Allow-Origin', process.env.FRONTEND_URL || 'https://vaiform.com');
      res.set('Cross-Origin-Resource-Policy', 'cross-origin');
      return res.status(200).end(buf);
    }

    clearTimeout(timer);
    return res.status(502).json({ error: 'Too many redirects' });
  } catch (e) {
    clearTimeout(timer);
    const name = e?.name || '';
    console.error('[cdn] error', name, e?.message || e);
    if (name === 'AbortError') return res.status(504).json({ error: 'Upstream timeout' });
    return res.status(502).json({ error: 'Upstream fetch failed' });
  }
});

export default r;
