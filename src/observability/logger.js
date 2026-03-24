import { getRequestContext } from './request-context.js';
import { redactForLogs } from './redact.js';

function serializeError(error) {
  if (!error) return undefined;
  if (error instanceof Error) {
    return redactForLogs(error, 'error');
  }
  return redactForLogs(error, 'error');
}

function compact(entry) {
  return Object.fromEntries(
    Object.entries(entry).filter(([, value]) => value !== undefined && value !== null)
  );
}

function emit(level, event, details = {}) {
  const context = getRequestContext() || {};
  const rawError = Object.prototype.hasOwnProperty.call(details, 'error') ? details.error : undefined;
  const safeDetails = { ...details };
  delete safeDetails.error;

  const entry = compact({
    ts: new Date().toISOString(),
    level,
    event,
    requestId: context.requestId ?? undefined,
    method: context.method ?? undefined,
    route: context.route ?? undefined,
    uid: context.uid ?? undefined,
    sessionId: context.sessionId ?? undefined,
    attemptId: context.attemptId ?? undefined,
    shortId: context.shortId ?? undefined,
    ...redactForLogs(safeDetails),
    ...(rawError !== undefined ? { error: serializeError(rawError) } : {}),
  });

  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

export const logger = {
  debug(event, details) {
    emit('debug', event, details);
  },
  info(event, details) {
    emit('info', event, details);
  },
  warn(event, details) {
    emit('warn', event, details);
  },
  error(event, details) {
    emit('error', event, details);
  },
};

export default logger;
