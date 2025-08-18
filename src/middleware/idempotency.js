// Simple in-memory idempotency middleware
// - Header: X-Idempotency-Key (required)
// - Keyed by user uid + header value
// - While first request is in-flight → 409 IDEMPOTENT_IN_PROGRESS
// - After completion, returns cached response for TTL (2xx/4xx only)
// - 5xx responses are NOT cached (so callers can retry)

const store = new Map(); // key -> { state: 'pending' | 'done', status, body, timeout }

export default function idempotency({ ttlMs = 10 * 60 * 1000 } = {}) {
  return function idempotencyMiddleware(req, res, next) {
    const hdr =
      req.get?.('X-Idempotency-Key') ||
      req.headers['x-idempotency-key'] ||
      req.headers['X-Idempotency-Key'];

    if (!hdr || typeof hdr !== 'string') {
      return res.status(400).json({
        error: 'MISSING_IDEMPOTENCY_KEY',
        message: 'Provide X-Idempotency-Key header.',
      });
    }

    const uid = req.user?.uid || 'anon';
    const key = `${uid}:${hdr}`;

    const existing = store.get(key);
    if (existing) {
      if (existing.state === 'pending') {
        return res.status(409).json({
          error: 'IDEMPOTENT_IN_PROGRESS',
          message: 'A request with this idempotency key is already processing.',
        });
      }
      if (existing.state === 'done') {
        return res.status(existing.status).json(existing.body);
      }
    }

    // mark as pending
    store.set(key, { state: 'pending' });

    // capture res.json to cache successful/definitive responses
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      try {
        const status = res.statusCode || 200;
        // Cache only non-5xx responses
        if (status < 500) {
          const timeout = setTimeout(() => store.delete(key), ttlMs);
          store.set(key, { state: 'done', status, body, timeout });
        } else {
          // clear on server error to allow retries
          store.delete(key);
        }
      } catch {
        /* ignore */
      }
      return originalJson(body);
    };

    // If handler finishes without calling res.json (e.g., res.send),
    // still finalize the entry with a lightweight body.
    res.on('finish', () => {
      const entry = store.get(key);
      if (!entry || entry.state !== 'pending') return;
      const status = res.statusCode || 200;
      if (status < 500) {
        const timeout = setTimeout(() => store.delete(key), ttlMs);
        store.set(key, { state: 'done', status, body: { ok: true }, timeout });
      } else {
        store.delete(key);
      }
    });

    next();
  };
}