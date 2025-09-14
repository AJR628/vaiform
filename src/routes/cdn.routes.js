import { Router } from "express";

const r = Router();

/**
 * GET /cdn?u=<downloadUrl>
 * Same-origin proxy for Firebase download URLs.
 * Buffered with timeout to avoid hanging requests.
 */
r.get("/", async (req, res) => {
  const u = String(req.query?.u || "").trim();
  const ts = new Date().toISOString();
  console.log('[cdn]', ts, 'GET', u.slice(0, 160));

  if (!/^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\//.test(u)) {
    return res.status(400).json({ error: 'Bad origin' });
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10_000);
  try {
    const up = await fetch(u, { redirect: 'follow', signal: ac.signal, headers: { Accept: 'image/*' } });
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
  } catch (e) {
    clearTimeout(timer);
    const name = e?.name || '';
    console.error('[cdn] error', name, e?.message || e);
    if (name === 'AbortError') return res.status(504).json({ error: 'Upstream timeout' });
    return res.status(502).json({ error: 'Upstream fetch failed' });
  }
});

export default r;


