// src/middleware/error.middleware.js
import { fail } from '../http/respond.js';

function fieldsFromZodIssues(issues) {
  if (!issues || !Array.isArray(issues)) return undefined;
  const fields = {};
  for (const i of issues) {
    const path = Array.isArray(i.path) ? i.path : (i.path != null ? [i.path] : []);
    const key = path.length ? path.join('.') : '_root';
    fields[key] = i.message;
  }
  return Object.keys(fields).length > 0 ? fields : undefined;
}

export default function errorHandler(err, req, res, _next) {
  const isZod = err?.name === 'ZodError' || err?.code === 'ZOD_ERROR' || Array.isArray(err?.issues);

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

  const log = {
    level: status >= 500 ? 'error' : 'warn',
    status,
    name: err?.name,
    message: err?.message,
    requestId: req?.id || req?.reqId || req?.headers?.['x-request-id'] || req?.headers?.['X-Request-Id'],
    route: `${req?.method} ${req?.originalUrl}`,
  };
  console.error('❌', JSON.stringify(log));

  if (isZod && err?.issues) {
    const fields = fieldsFromZodIssues(err.issues);
    return fail(req, res, status, 'VALIDATION_FAILED', 'Invalid request', fields);
  }

  const error = String(err?.code ?? err?.name ?? 'INTERNAL_ERROR');
  const detail = String(err?.message ?? 'Unexpected error');
  fail(req, res, status, error, detail);
}
