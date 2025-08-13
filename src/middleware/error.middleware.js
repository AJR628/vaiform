// src/middleware/error.middleware.js
export default function errorHandler(err, req, res, _next) {
  // Detect common cases
  const isZod =
    err?.name === "ZodError" || err?.code === "ZOD_ERROR" || Array.isArray(err?.issues);

  // Choose status code (override-able via err.status)
  const status =
    err?.status ??
    (isZod ? 400
      : err?.name === "DUPLICATE" ? 409
      : err?.name === "UNAUTHENTICATED" ? 401
      : err?.name === "FORBIDDEN" ? 403
      // Stripe signature errors often come through with this type
      : err?.type === "StripeSignatureVerificationError" ? 400
      : 500);

  // Shape response
  const payload = {
    success: false,
    error: err?.name || "ERROR",
    message: err?.message || (status === 500 ? "Unexpected server error" : "Request failed"),
    reqId: req?.reqId,
  };

  // Include Zod issue details (helpful for the frontend)
  if (isZod && err?.issues) {
    payload.issues = err.issues.map(i => ({
      path: Array.isArray(i.path) ? i.path.join(".") : String(i.path ?? ""),
      message: i.message,
    }));
  }

  // Structured log (minimal PII)
  const log = {
    level: status >= 500 ? "error" : "warn",
    status,
    name: err?.name,
    message: err?.message,
    reqId: req?.reqId,
    route: `${req?.method} ${req?.originalUrl}`,
  };
  console.error("❌", JSON.stringify(log));

  // Only expose stack in non-production
  if (process.env.NODE_ENV !== "production" && err?.stack) {
    payload.stack = err.stack;
  }

  res.status(status).json(payload);
}