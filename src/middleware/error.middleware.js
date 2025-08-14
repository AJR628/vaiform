// src/middleware/error.middleware.js
export default function errorHandler(err, req, res, _next) {
  // Detect Zod-style validation errors
  const isZod =
    err?.name === 'ZodError' ||
    err?.code === 'ZOD_ERROR' ||
    Array.isArray(err?.issues);

  // Map to status (overridable via err.status)
  const status =
    err?.status ??
    (isZod
      ? 400
      : err?.name === 'DUPLICATE'
        ? 409
        : err?.name === 'UNAUTHENTICATED'
          ? 401
          : err?.name === 'FORBIDDEN'
            ? 403
            : err?.type === 'StripeSignatureVerificationError'
              ? 400
              : 500);

  // Prefer our reqId middleware value; fall back to incoming header
  const requestId =
    req?.id ||
    req?.reqId ||
    req?.headers?.['x-request-id'] ||
    req?.headers?.['X-Request-Id'];

  const payload = {
    success: false,
    error: err?.name || 'ERROR',
    message:
      err?.message || (status === 500 ? 'Unexpected server error' : 'Request failed'),
    requestId,
  };

  // Include Zod issues for client UX
  if (isZod && err?.issues) {
    payload.issues = err.issues.map((i) => ({
      path: Array.isArray(i.path) ? i.path.join('.') : String(i.path ?? ''),
      message: i.message,
    }));
  }

  // Structured log with minimal PII
  const log = {
    level: status >= 500 ? 'error' : 'warn',
    status,
    name: err?.name,
    message: err?.message,
    requestId,
    route: `${req?.method} ${req?.originalUrl}`,
  };
  console.error('❌', JSON.stringify(log));

  // Only expose stack outside production
  if (process.env.NODE_ENV !== 'production' && err?.stack) {
    payload.stack = err.stack;
  }

  res.status(status).json(payload);
}