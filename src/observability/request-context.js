import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

function normalizeString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeContextValue(value) {
  if (value == null) return null;
  if (typeof value === 'string') return normalizeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  return null;
}

function mergeContext(base = {}, patch = {}) {
  const next = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const normalized = normalizeContextValue(value);
    if (normalized === null) {
      delete next[key];
    } else {
      next[key] = normalized;
    }
  }
  return next;
}

export function getRequestContext() {
  return storage.getStore() || null;
}

export function runWithRequestContext(seed, callback) {
  return storage.run(mergeContext({}, seed), callback);
}

export function setRequestContext(patch = {}) {
  const current = storage.getStore();
  if (!current) return null;
  const next = mergeContext(current, patch);
  storage.enterWith(next);
  return next;
}

export function setRequestContextFromReq(req, patch = {}) {
  return setRequestContext({
    requestId: req?.id ?? null,
    method: req?.method ?? null,
    route: req?.originalUrl ?? req?.path ?? null,
    uid: req?.user?.uid ?? null,
    ...patch,
  });
}

export default function requestContextMiddleware(req, _res, next) {
  return runWithRequestContext(
    {
      requestId: req?.id ?? null,
      method: req?.method ?? null,
      route: req?.originalUrl ?? req?.path ?? null,
    },
    () => next()
  );
}
