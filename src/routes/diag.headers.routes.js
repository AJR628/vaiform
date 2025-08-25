import { Router } from "express";
const r = Router();

// GET /api/diag/headers → sanitized echo of request headers
// Enabled only when VAIFORM_DEBUG=1 to avoid noise.
r.get("/diag/headers", (req, res) => {
  const h = req.headers || {};
  const auth = h["authorization"] || "";
  const masked =
    auth && /^Bearer\s+(.+)$/.test(auth)
      ? "Bearer " + auth.replace(/^Bearer\s+/, "").slice(0, 12) + "…"
      : "";
  res.json({
    success: true,
    method: req.method,
    path: req.path,
    hasAuth: !!auth,
    authMasked: masked,
    contentType: h["content-type"] || null,
    userAgent: h["user-agent"] || null,
  });
});

export default r;
