// src/middleware/error.middleware.js
import { fail } from '../http/respond.js';
import logger from '../observability/logger.js';

function fieldsFromZodIssues(issues) {
  if (!issues || !Array.isArray(issues)) return undefined;
  const fields = {};
  for (const i of issues) {
    const path = Array.isArray(i.path) ? i.path : i.path != null ? [i.path] : [];
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

  const fields = isZod && err?.issues ? fieldsFromZodIssues(err.issues) : undefined;
  const log = {
    status,
    name: err?.name,
    code: err?.code,
    message: err?.message,
    routeStatus: `${req?.method} ${req?.originalUrl}`,
    fields,
    error: err,
  };

  if (status >= 500) {
    logger.error('request.error', log);
  } else {
    logger.warn('request.error', log);
  }

  if (fields) {
    return fail(req, res, status, 'VALIDATION_FAILED', 'Invalid request', fields);
  }

  const error = String(err?.code ?? err?.name ?? 'INTERNAL_ERROR');
  const detail = String(err?.message ?? 'Unexpected error');
  return fail(req, res, status, error, detail);
}
