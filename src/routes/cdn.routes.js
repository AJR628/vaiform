import { Router } from "express";

const r = Router();

/**
 * GET /cdn?u=<downloadUrl>
 * Same-origin proxy for remote images (Firebase download URLs, etc.)
 * Avoids edge CORS/canvas taint issues in the browser.
 */
r.get("/", async (req, res) => {
  try {
    const u = String(req.query?.u || "").trim();
    console.log('[cdn] GET', u.slice(0, 140));
    if (!u || !/^https?:\/\//i.test(u)) {
      return res.status(400).json({ success:false, error:"MISSING_OR_INVALID_URL" });
    }
    const up = await fetch(u);
    if (!up.ok) {
      return res.status(up.status).end();
    }
    const cc = up.headers.get("cache-control") || "public, max-age=3600, immutable";
    const ct = up.headers.get("content-type") || "application/octet-stream";
    res.set("Cache-Control", cc);
    // Allow your frontend domain
    res.set("Access-Control-Allow-Origin", process.env.FRONTEND_URL || "https://vaiform.com");
    res.set("Vary", "Origin");
    res.set("Content-Type", ct);
    const len = up.headers.get("content-length");
    if (len) res.set("Content-Length", len);
    // Stream body
    up.body.pipe(res);
  } catch (e) {
    console.error("[cdn] error:", e?.message || e);
    res.status(502).end();
  }
});

export default r;


