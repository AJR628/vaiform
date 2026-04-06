import dotenv from 'dotenv';
import * as Sentry from '@sentry/node';

dotenv.config();

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'proxy-authorization',
]);

const SENSITIVE_FIELD_PATTERN = /(authorization|cookie|token|secret|password|api[-_]?key|session)/i;
const REDACTED = '[Filtered]';

function normalizeString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveTracesSampleRate() {
  const fromEnv = normalizeString(process.env.SENTRY_TRACES_SAMPLE_RATE);
  if (fromEnv != null) {
    const parsed = Number(fromEnv);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
      return parsed;
    }
  }

  const environment = normalizeString(process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV);
  return environment === 'production' ? 0.1 : 1.0;
}

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return headers;
  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => {
      const normalizedKey = key.toLowerCase();
      if (SENSITIVE_HEADER_NAMES.has(normalizedKey) || SENSITIVE_FIELD_PATTERN.test(normalizedKey)) {
        return [key, REDACTED];
      }
      return [key, value];
    })
  );
}

function sanitizeValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (SENSITIVE_FIELD_PATTERN.test(key)) {
        return [key, REDACTED];
      }
      return [key, sanitizeValue(entry)];
    })
  );
}

function sanitizeEventRequest(event) {
  if (!event?.request) return event;

  const request = {
    ...event.request,
    headers: sanitizeHeaders(event.request.headers),
  };

  if (request.cookies != null) {
    request.cookies = REDACTED;
  }

  if (request.data != null) {
    request.data = sanitizeValue(request.data);
  }

  return {
    ...event,
    request,
  };
}

const dsn = normalizeString(process.env.SENTRY_DSN);

if (dsn) {
  Sentry.init({
    dsn,
    environment:
      normalizeString(process.env.SENTRY_ENVIRONMENT) ??
      normalizeString(process.env.NODE_ENV) ??
      'development',
    release: normalizeString(process.env.SENTRY_RELEASE) ?? undefined,
    sendDefaultPii: false,
    tracesSampleRate: resolveTracesSampleRate(),
    beforeSend(event) {
      return sanitizeEventRequest(event);
    },
    beforeSendTransaction(event) {
      return sanitizeEventRequest(event);
    },
  });
}
