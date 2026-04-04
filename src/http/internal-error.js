import { fail } from './respond.js';

export const DEFAULT_INTERNAL_ERROR_DETAIL = 'Unexpected server error';

function normalizedString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function failInternalServerError(
  req,
  res,
  errorCode = 'INTERNAL_ERROR',
  detail = DEFAULT_INTERNAL_ERROR_DETAIL
) {
  return fail(
    req,
    res,
    500,
    normalizedString(errorCode) || 'INTERNAL_ERROR',
    normalizedString(detail) || DEFAULT_INTERNAL_ERROR_DETAIL
  );
}

export function failSafeError(
  req,
  res,
  error,
  { fallbackStatus = 500, fallbackError = 'INTERNAL_ERROR', safeDetail } = {}
) {
  const status =
    Number.isInteger(error?.status) && error.status >= 400 ? error.status : fallbackStatus;
  const errorCode = normalizedString(error?.code) || normalizedString(fallbackError) || 'INTERNAL_ERROR';

  if (status >= 500) {
    return fail(
      req,
      res,
      status,
      errorCode,
      normalizedString(safeDetail) || DEFAULT_INTERNAL_ERROR_DETAIL
    );
  }

  return fail(
    req,
    res,
    status,
    errorCode,
    normalizedString(error?.message) ||
      normalizedString(safeDetail) ||
      DEFAULT_INTERNAL_ERROR_DETAIL
  );
}
