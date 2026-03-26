import logger from './logger.js';
import { createMetricsRegistry } from './metrics-registry.js';
import {
  getRequestContext,
  runWithRequestContext,
  setRequestContext,
} from './request-context.js';

const RECENT_EVENT_LIMIT = 200;

export const FINALIZE_SOURCE_ROLES = Object.freeze({
  API: 'api',
  WORKER: 'worker',
  MOBILE: 'mobile',
});

export const FINALIZE_STAGES = Object.freeze({
  ADMISSION_VALIDATE: 'admission_validate',
  ADMISSION_RESERVE_USAGE: 'admission_reserve_usage',
  QUEUE_ENQUEUE: 'queue_enqueue',
  QUEUE_WAIT: 'queue_wait',
  WORKER_CLAIM: 'worker_claim',
  HYDRATE_SESSION: 'hydrate_session',
  STORY_GENERATE: 'story_generate',
  PLAN_SHOTS: 'plan_shots',
  CLIP_SEARCH: 'clip_search',
  CAPTION_GENERATE: 'caption_generate',
  RENDER_VIDEO: 'render_video',
  UPLOAD_ARTIFACTS: 'upload_artifacts',
  WRITE_SHORT: 'write_short',
  PERSIST_RECOVERY: 'persist_recovery',
  BILLING_SETTLE: 'billing_settle',
  CLIENT_RECOVERY_POLL: 'client_recovery_poll',
  SHORT_DETAIL_READBACK: 'short_detail_readback',
  LIBRARY_FALLBACK_READBACK: 'library_fallback_readback',
});

export const FINALIZE_STAGE_SEQUENCE = Object.freeze(Object.values(FINALIZE_STAGES));

export const FINALIZE_EVENTS = Object.freeze({
  API_REQUESTED: 'finalize.api.requested',
  API_REJECTED: 'finalize.api.rejected',
  API_ACCEPTED: 'finalize.api.accepted',
  API_REPLAYED_PENDING: 'finalize.api.replayed_pending',
  API_REPLAYED_DONE: 'finalize.api.replayed_done',
  API_REPLAYED_FAILED: 'finalize.api.replayed_failed',
  API_CONFLICT_ACTIVE: 'finalize.api.conflict_active',
  JOB_CREATED: 'finalize.job.created',
  JOB_QUEUED: 'finalize.job.queued',
  JOB_CLAIMED: 'finalize.job.claimed',
  JOB_STARTED: 'finalize.job.started',
  JOB_STAGE_STARTED: 'finalize.job.stage.started',
  JOB_STAGE_COMPLETED: 'finalize.job.stage.completed',
  JOB_RETRY_SCHEDULED: 'finalize.job.retry.scheduled',
  JOB_FAILED: 'finalize.job.failed',
  JOB_COMPLETED: 'finalize.job.completed',
  JOB_SETTLED: 'finalize.job.settled',
  WORKER_STARTED: 'finalize.worker.started',
  WORKER_STOPPED: 'finalize.worker.stopped',
  WORKER_HEARTBEAT: 'finalize.worker.heartbeat',
  WORKER_HEARTBEAT_MISSED: 'finalize.worker.heartbeat_missed',
  WORKER_CLAIM_LOOP_ERROR: 'finalize.worker.claim_loop_error',
  RECOVERY_PROJECTED: 'finalize.recovery.projected',
  RECOVERY_POLL: 'finalize.recovery.poll',
  READBACK_SHORT_DETAIL_PENDING: 'finalize.readback.short_detail_pending',
  READBACK_SHORT_DETAIL_READY: 'finalize.readback.short_detail_ready',
  READBACK_LIBRARY_FALLBACK_HIT: 'finalize.readback.library_fallback_hit',
  READBACK_LIBRARY_FALLBACK_MISS: 'finalize.readback.library_fallback_miss',
  PROVIDER_REQUEST: 'finalize.provider.request',
  PROVIDER_RETRYABLE_FAILURE: 'finalize.provider.retryable_failure',
  PROVIDER_TERMINAL_FAILURE: 'finalize.provider.terminal_failure',
  PROVIDER_COOLDOWN_STARTED: 'finalize.provider.cooldown_started',
  PROVIDER_COOLDOWN_CLEARED: 'finalize.provider.cooldown_cleared',
});

export const FINALIZE_EVENT_NAMES = Object.freeze(Object.values(FINALIZE_EVENTS));

export const FINALIZE_EVENT_REQUIRED_FIELDS = Object.freeze({
  all: ['ts', 'sourceRole', 'requestId', 'uid', 'sessionId', 'finalizeJobId'],
  stage: [
    'ts',
    'sourceRole',
    'requestId',
    'uid',
    'sessionId',
    'finalizeJobId',
    'workerId',
    'jobState',
    'stage',
    'stageOrdinal',
  ],
  failure: [
    'ts',
    'sourceRole',
    'requestId',
    'uid',
    'sessionId',
    'finalizeJobId',
    'workerId',
    'jobState',
    'stage',
    'errorCode',
    'errorClass',
    'retryable',
  ],
  billing: [
    'ts',
    'sourceRole',
    'requestId',
    'uid',
    'sessionId',
    'finalizeJobId',
    'estimatedSec',
    'reservedSec',
    'billedSec',
    'settlementState',
    'usageLedgerApplied',
    'billingMismatch',
  ],
});

export const FINALIZE_METRIC_DEFINITIONS = Object.freeze([
  {
    name: 'finalize_api_requests_total',
    type: 'counter',
    labels: ['outcome'],
    description: 'Total finalize API requests by outcome.',
  },
  {
    name: 'finalize_jobs_created_total',
    type: 'counter',
    labels: [],
    description: 'Total finalize jobs created.',
  },
  {
    name: 'finalize_job_retries_total',
    type: 'counter',
    labels: ['reason'],
    description: 'Total finalize job retries by reason.',
  },
  {
    name: 'finalize_job_failures_total',
    type: 'counter',
    labels: ['stage', 'error_code'],
    description: 'Total finalize job failures by stage and error code.',
  },
  {
    name: 'finalize_dead_letters_total',
    type: 'counter',
    labels: ['reason'],
    description: 'Reserved for later dead-letter transitions.',
  },
  {
    name: 'finalize_worker_claims_total',
    type: 'counter',
    labels: [],
    description: 'Total finalize worker claims.',
  },
  {
    name: 'finalize_worker_lease_expirations_total',
    type: 'counter',
    labels: [],
    description: 'Total finalize lease expirations.',
  },
  {
    name: 'finalize_provider_failures_total',
    type: 'counter',
    labels: ['provider', 'error_code'],
    description: 'Total finalize provider failures.',
  },
  {
    name: 'finalize_billing_mismatches_total',
    type: 'counter',
    labels: ['type'],
    description: 'Total finalize billing mismatches.',
  },
  {
    name: 'finalize_readback_retries_total',
    type: 'counter',
    labels: ['surface'],
    description: 'Total finalize readback retries by surface.',
  },
  {
    name: 'finalize_queue_depth',
    type: 'gauge',
    labels: [],
    description: 'Current finalize queue depth.',
  },
  {
    name: 'finalize_queue_oldest_age_seconds',
    type: 'gauge',
    labels: [],
    description: 'Age in seconds of the oldest queued finalize job.',
  },
  {
    name: 'finalize_jobs_running',
    type: 'gauge',
    labels: [],
    description: 'Current number of finalize jobs running.',
  },
  {
    name: 'finalize_jobs_retry_scheduled',
    type: 'gauge',
    labels: [],
    description: 'Current number of finalize jobs waiting for retry.',
  },
  {
    name: 'finalize_dead_letter_depth',
    type: 'gauge',
    labels: [],
    description: 'Reserved for later dead-letter depth.',
  },
  {
    name: 'finalize_workers_active',
    type: 'gauge',
    labels: [],
    description: 'Current number of active finalize workers.',
  },
  {
    name: 'finalize_worker_saturation_ratio',
    type: 'gauge',
    labels: [],
    description: 'Current finalize worker saturation ratio.',
  },
  {
    name: 'finalize_provider_cooldown_active',
    type: 'gauge',
    labels: ['provider'],
    description: 'Whether a finalize provider cooldown is active.',
  },
  {
    name: 'finalize_billing_unsettled_jobs',
    type: 'gauge',
    labels: [],
    description: 'Current number of finalize jobs that are not yet settled.',
  },
  {
    name: 'finalize_api_admission_duration_ms',
    type: 'histogram',
    labels: [],
    description: 'Finalize API admission duration.',
  },
  {
    name: 'finalize_queue_wait_duration_ms',
    type: 'histogram',
    labels: [],
    description: 'Finalize queue wait duration.',
  },
  {
    name: 'finalize_job_total_duration_ms',
    type: 'histogram',
    labels: [],
    description: 'Finalize total duration.',
  },
  {
    name: 'finalize_stage_duration_ms',
    type: 'histogram',
    labels: ['stage'],
    description: 'Finalize stage duration.',
  },
  {
    name: 'finalize_provider_request_duration_ms',
    type: 'histogram',
    labels: ['provider', 'stage'],
    description: 'Finalize provider request duration.',
  },
  {
    name: 'finalize_readback_completion_lag_ms',
    type: 'histogram',
    labels: ['surface'],
    description: 'Finalize readback completion lag.',
  },
]);

const finalizeMetricsRegistry = createMetricsRegistry();
for (const definition of FINALIZE_METRIC_DEFINITIONS) {
  finalizeMetricsRegistry.registerDefinition(definition);
}

const finalizeEventSinks = new Set();
const recentFinalizeEvents = [];

function normalizeNonEmptyString(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toIso(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  return null;
}

function inferSourceRole(context) {
  if (normalizeNonEmptyString(context?.sourceRole)) {
    return context.sourceRole;
  }
  if (normalizeNonEmptyString(context?.workerId)) {
    return FINALIZE_SOURCE_ROLES.WORKER;
  }
  if (normalizeNonEmptyString(context?.route)) {
    return FINALIZE_SOURCE_ROLES.API;
  }
  return null;
}

function normalizeFinalizeIdentity(source = {}) {
  const attemptId = normalizeNonEmptyString(source.attemptId ?? source.externalAttemptId ?? null);
  const finalizeJobId = normalizeNonEmptyString(source.finalizeJobId ?? source.jobId ?? attemptId);
  return {
    attemptId,
    finalizeJobId,
  };
}

function normalizeEventPayload(event, details = {}) {
  const context = getRequestContext() || {};
  const identity = normalizeFinalizeIdentity({
    ...context,
    ...details,
  });
  return {
    ts: new Date().toISOString(),
    event,
    sourceRole: inferSourceRole({
      ...context,
      ...details,
    }),
    requestId: normalizeNonEmptyString(details.requestId ?? context.requestId ?? null),
    route: normalizeNonEmptyString(details.route ?? context.route ?? null),
    uid: normalizeNonEmptyString(details.uid ?? context.uid ?? null),
    sessionId: normalizeNonEmptyString(details.sessionId ?? context.sessionId ?? null),
    attemptId: identity.attemptId,
    finalizeJobId: identity.finalizeJobId,
    executionAttemptId: normalizeNonEmptyString(
      details.executionAttemptId ?? context.executionAttemptId ?? null
    ),
    workerId: normalizeNonEmptyString(details.workerId ?? context.workerId ?? null),
    jobState: normalizeNonEmptyString(details.jobState ?? context.jobState ?? null),
    stage: normalizeNonEmptyString(details.stage ?? context.stage ?? null),
    stageOrdinal: Number.isFinite(Number(details.stageOrdinal ?? context.stageOrdinal))
      ? Number(details.stageOrdinal ?? context.stageOrdinal)
      : null,
    queuedAt: toIso(details.queuedAt ?? context.queuedAt ?? null),
    startedAt: toIso(details.startedAt ?? context.startedAt ?? null),
    finishedAt: toIso(details.finishedAt ?? context.finishedAt ?? null),
    durationMs: Number.isFinite(Number(details.durationMs)) ? Number(details.durationMs) : null,
    errorCode: normalizeNonEmptyString(details.errorCode ?? null),
    errorClass: normalizeNonEmptyString(details.errorClass ?? null),
    retryable: typeof details.retryable === 'boolean' ? details.retryable : null,
    failureReason: normalizeNonEmptyString(details.failureReason ?? null),
    retryAfterMs: Number.isFinite(Number(details.retryAfterMs)) ? Number(details.retryAfterMs) : null,
    provider: normalizeNonEmptyString(details.provider ?? null),
    httpStatus: Number.isFinite(Number(details.httpStatus)) ? Number(details.httpStatus) : null,
    estimatedSec: Number.isFinite(Number(details.estimatedSec)) ? Number(details.estimatedSec) : null,
    reservedSec: Number.isFinite(Number(details.reservedSec)) ? Number(details.reservedSec) : null,
    billedSec: Number.isFinite(Number(details.billedSec)) ? Number(details.billedSec) : null,
    settlementState: normalizeNonEmptyString(details.settlementState ?? null),
    usageLedgerApplied:
      typeof details.usageLedgerApplied === 'boolean' ? details.usageLedgerApplied : null,
    billingMismatch: typeof details.billingMismatch === 'boolean' ? details.billingMismatch : null,
    readbackLagMs: Number.isFinite(Number(details.readbackLagMs)) ? Number(details.readbackLagMs) : null,
    surface: normalizeNonEmptyString(details.surface ?? null),
    queueDepth: Number.isFinite(Number(details.queueDepth)) ? Number(details.queueDepth) : null,
    queueOldestAgeSeconds: Number.isFinite(Number(details.queueOldestAgeSeconds))
      ? Number(details.queueOldestAgeSeconds)
      : null,
    jobsRunning: Number.isFinite(Number(details.jobsRunning)) ? Number(details.jobsRunning) : null,
    jobsRetryScheduled: Number.isFinite(Number(details.jobsRetryScheduled))
      ? Number(details.jobsRetryScheduled)
      : null,
    workersActive: Number.isFinite(Number(details.workersActive)) ? Number(details.workersActive) : null,
    workerSaturationRatio: Number.isFinite(Number(details.workerSaturationRatio))
      ? Number(details.workerSaturationRatio)
      : null,
    ...details,
    attemptId: identity.attemptId,
    finalizeJobId: identity.finalizeJobId,
  };
}

function pushRecentEvent(payload) {
  recentFinalizeEvents.push(payload);
  if (recentFinalizeEvents.length > RECENT_EVENT_LIMIT) {
    recentFinalizeEvents.splice(0, recentFinalizeEvents.length - RECENT_EVENT_LIMIT);
  }
}

function emitToEventSinks(payload) {
  for (const sink of finalizeEventSinks) {
    sink(payload);
  }
}

function recordEventMetrics(payload) {
  switch (payload.event) {
    case FINALIZE_EVENTS.API_REQUESTED:
      finalizeMetricsRegistry.incrementCounter('finalize_api_requests_total', 1, {
        outcome: 'requested',
      });
      break;
    case FINALIZE_EVENTS.API_REJECTED:
      finalizeMetricsRegistry.incrementCounter('finalize_api_requests_total', 1, {
        outcome: 'rejected',
      });
      break;
    case FINALIZE_EVENTS.API_ACCEPTED:
      finalizeMetricsRegistry.incrementCounter('finalize_api_requests_total', 1, {
        outcome: 'accepted',
      });
      break;
    case FINALIZE_EVENTS.API_REPLAYED_PENDING:
      finalizeMetricsRegistry.incrementCounter('finalize_api_requests_total', 1, {
        outcome: 'replayed_pending',
      });
      break;
    case FINALIZE_EVENTS.API_REPLAYED_DONE:
      finalizeMetricsRegistry.incrementCounter('finalize_api_requests_total', 1, {
        outcome: 'replayed_done',
      });
      break;
    case FINALIZE_EVENTS.API_REPLAYED_FAILED:
      finalizeMetricsRegistry.incrementCounter('finalize_api_requests_total', 1, {
        outcome: 'replayed_failed',
      });
      break;
    case FINALIZE_EVENTS.API_CONFLICT_ACTIVE:
      finalizeMetricsRegistry.incrementCounter('finalize_api_requests_total', 1, {
        outcome: 'conflict_active',
      });
      break;
    case FINALIZE_EVENTS.JOB_CREATED:
      finalizeMetricsRegistry.incrementCounter('finalize_jobs_created_total');
      break;
    case FINALIZE_EVENTS.JOB_CLAIMED:
      finalizeMetricsRegistry.incrementCounter('finalize_worker_claims_total');
      if (Number.isFinite(payload.durationMs)) {
        finalizeMetricsRegistry.observeHistogram(
          'finalize_queue_wait_duration_ms',
          payload.durationMs
        );
      }
      break;
    case FINALIZE_EVENTS.JOB_RETRY_SCHEDULED:
      finalizeMetricsRegistry.incrementCounter('finalize_job_retries_total', 1, {
        reason: payload.failureReason || payload.errorCode || 'retry_scheduled',
      });
      break;
    case FINALIZE_EVENTS.JOB_FAILED:
      finalizeMetricsRegistry.incrementCounter('finalize_job_failures_total', 1, {
        stage: payload.stage || 'unknown',
        error_code: payload.errorCode || 'UNKNOWN_ERROR',
      });
      if (payload.billingMismatch) {
        finalizeMetricsRegistry.incrementCounter('finalize_billing_mismatches_total', 1, {
          type: payload.failureReason || payload.errorCode || 'billing_mismatch',
        });
      }
      if (Number.isFinite(payload.durationMs)) {
        finalizeMetricsRegistry.observeHistogram(
          'finalize_job_total_duration_ms',
          payload.durationMs
        );
      }
      break;
    case FINALIZE_EVENTS.JOB_SETTLED:
      if (payload.billingMismatch) {
        finalizeMetricsRegistry.incrementCounter('finalize_billing_mismatches_total', 1, {
          type: payload.failureReason || 'settlement_mismatch',
        });
      }
      if (Number.isFinite(payload.durationMs)) {
        finalizeMetricsRegistry.observeHistogram(
          'finalize_job_total_duration_ms',
          payload.durationMs
        );
      }
      break;
    case FINALIZE_EVENTS.WORKER_HEARTBEAT_MISSED:
      finalizeMetricsRegistry.incrementCounter('finalize_worker_lease_expirations_total');
      break;
    case FINALIZE_EVENTS.PROVIDER_RETRYABLE_FAILURE:
    case FINALIZE_EVENTS.PROVIDER_TERMINAL_FAILURE:
      finalizeMetricsRegistry.incrementCounter('finalize_provider_failures_total', 1, {
        provider: payload.provider || 'unknown',
        error_code: payload.errorCode || 'UNKNOWN_ERROR',
      });
      break;
    case FINALIZE_EVENTS.PROVIDER_COOLDOWN_STARTED:
      finalizeMetricsRegistry.setGauge('finalize_provider_cooldown_active', 1, {
        provider: payload.provider || 'unknown',
      });
      break;
    case FINALIZE_EVENTS.PROVIDER_COOLDOWN_CLEARED:
      finalizeMetricsRegistry.setGauge('finalize_provider_cooldown_active', 0, {
        provider: payload.provider || 'unknown',
      });
      break;
    case FINALIZE_EVENTS.READBACK_SHORT_DETAIL_PENDING:
      finalizeMetricsRegistry.incrementCounter('finalize_readback_retries_total', 1, {
        surface: 'short_detail',
      });
      break;
    case FINALIZE_EVENTS.READBACK_SHORT_DETAIL_READY:
      if (Number.isFinite(payload.readbackLagMs)) {
        finalizeMetricsRegistry.observeHistogram(
          'finalize_readback_completion_lag_ms',
          payload.readbackLagMs,
          { surface: 'short_detail' }
        );
      }
      break;
    default:
      break;
  }

  if (payload.event === FINALIZE_EVENTS.JOB_STAGE_COMPLETED && Number.isFinite(payload.durationMs)) {
    finalizeMetricsRegistry.observeHistogram('finalize_stage_duration_ms', payload.durationMs, {
      stage: payload.stage || 'unknown',
    });
  }

  if (
    payload.event === FINALIZE_EVENTS.PROVIDER_REQUEST &&
    Number.isFinite(payload.durationMs) &&
    payload.provider
  ) {
    finalizeMetricsRegistry.observeHistogram(
      'finalize_provider_request_duration_ms',
      payload.durationMs,
      {
        provider: payload.provider,
        stage: payload.stage || 'unknown',
      }
    );
  }

  if (payload.event === FINALIZE_EVENTS.API_ACCEPTED && Number.isFinite(payload.durationMs)) {
    finalizeMetricsRegistry.observeHistogram('finalize_api_admission_duration_ms', payload.durationMs);
  }

  if (Number.isFinite(payload.queueDepth)) {
    finalizeMetricsRegistry.setGauge('finalize_queue_depth', payload.queueDepth);
  }
  if (Number.isFinite(payload.queueOldestAgeSeconds)) {
    finalizeMetricsRegistry.setGauge(
      'finalize_queue_oldest_age_seconds',
      payload.queueOldestAgeSeconds
    );
  }
  if (Number.isFinite(payload.jobsRunning)) {
    finalizeMetricsRegistry.setGauge('finalize_jobs_running', payload.jobsRunning);
  }
  if (Number.isFinite(payload.jobsRetryScheduled)) {
    finalizeMetricsRegistry.setGauge('finalize_jobs_retry_scheduled', payload.jobsRetryScheduled);
  }
  if (Number.isFinite(payload.workersActive)) {
    finalizeMetricsRegistry.setGauge('finalize_workers_active', payload.workersActive);
  }
  if (Number.isFinite(payload.workerSaturationRatio)) {
    finalizeMetricsRegistry.setGauge(
      'finalize_worker_saturation_ratio',
      payload.workerSaturationRatio
    );
  }
}

export function finalizeJobIdFromAttemptId(attemptId) {
  return normalizeNonEmptyString(attemptId);
}

export function describeFinalizeError(error, overrides = {}) {
  const retryableByStatus =
    Number.isFinite(Number(error?.status)) &&
    Number(error.status) >= 500 &&
    Number(error.status) < 600;
  return {
    errorCode:
      normalizeNonEmptyString(overrides.errorCode ?? error?.code ?? null) || 'STORY_FINALIZE_FAILED',
    errorClass:
      normalizeNonEmptyString(overrides.errorClass ?? error?.name ?? error?.constructor?.name ?? null) ||
      'Error',
    retryable:
      typeof overrides.retryable === 'boolean'
        ? overrides.retryable
        : Boolean(error?.retryable === true || retryableByStatus),
    httpStatus: Number.isFinite(Number(overrides.httpStatus ?? error?.status))
      ? Number(overrides.httpStatus ?? error?.status)
      : null,
    failureReason:
      normalizeNonEmptyString(overrides.failureReason ?? error?.code ?? error?.message ?? null) ||
      'STORY_FINALIZE_FAILED',
  };
}

export function getFinalizeMetricsRegistry() {
  return finalizeMetricsRegistry;
}

export function addFinalizeEventSink(listener) {
  if (typeof listener !== 'function') {
    throw new Error('Finalize event sink must be a function.');
  }
  finalizeEventSinks.add(listener);
  return () => finalizeEventSinks.delete(listener);
}

export function resetFinalizeObservabilityForTests() {
  recentFinalizeEvents.splice(0, recentFinalizeEvents.length);
  finalizeMetricsRegistry.reset();
}

export function snapshotFinalizeObservability() {
  return {
    generatedAt: new Date().toISOString(),
    metrics: finalizeMetricsRegistry.snapshot(),
    recentEvents: recentFinalizeEvents.map((event) => ({
      ...event,
    })),
  };
}

export function setFinalizeObservabilityContext(patch = {}) {
  const identity = normalizeFinalizeIdentity(patch);
  return setRequestContext({
    sourceRole: patch.sourceRole ?? null,
    workerId: patch.workerId ?? null,
    executionAttemptId: patch.executionAttemptId ?? null,
    jobState: patch.jobState ?? null,
    stage: patch.stage ?? null,
    stageOrdinal: patch.stageOrdinal ?? null,
    queuedAt: patch.queuedAt ?? null,
    startedAt: patch.startedAt ?? null,
    finalizeJobId: identity.finalizeJobId,
    attemptId: identity.attemptId,
    sessionId: patch.sessionId ?? null,
    shortId: patch.shortId ?? null,
  });
}

export function runWithFinalizeObservabilityContext(seed = {}, callback) {
  const current = getRequestContext() || {};
  const identity = normalizeFinalizeIdentity({
    ...current,
    ...seed,
  });
  return runWithRequestContext(
    {
      ...current,
      sourceRole: seed.sourceRole ?? current.sourceRole ?? null,
      workerId: seed.workerId ?? current.workerId ?? null,
      executionAttemptId: seed.executionAttemptId ?? current.executionAttemptId ?? null,
      jobState: seed.jobState ?? current.jobState ?? null,
      stage: seed.stage ?? current.stage ?? null,
      stageOrdinal: seed.stageOrdinal ?? current.stageOrdinal ?? null,
      queuedAt: seed.queuedAt ?? current.queuedAt ?? null,
      startedAt: seed.startedAt ?? current.startedAt ?? null,
      requestId: seed.requestId ?? current.requestId ?? null,
      route: seed.route ?? current.route ?? null,
      uid: seed.uid ?? current.uid ?? null,
      sessionId: seed.sessionId ?? current.sessionId ?? null,
      shortId: seed.shortId ?? current.shortId ?? null,
      attemptId: identity.attemptId,
      finalizeJobId: identity.finalizeJobId,
    },
    callback
  );
}

export function emitFinalizeEvent(level, event, details = {}) {
  if (!FINALIZE_EVENT_NAMES.includes(event)) {
    throw new Error(`Unknown finalize event: ${event}`);
  }
  const normalizedLevel = ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info';
  const payload = normalizeEventPayload(event, details);
  logger[normalizedLevel](event, payload);
  pushRecentEvent(payload);
  recordEventMetrics(payload);
  emitToEventSinks(payload);
  return payload;
}

export async function withFinalizeStage(stage, details, callback) {
  const context = getRequestContext() || {};
  const hasFinalizeIdentity = Boolean(
    normalizeNonEmptyString(details?.attemptId ?? details?.finalizeJobId ?? null) ||
      normalizeNonEmptyString(context.attemptId ?? context.finalizeJobId ?? null)
  );
  if (!hasFinalizeIdentity) {
    return await callback();
  }
  const startedAt = Date.now();
  const stageOrdinal = FINALIZE_STAGE_SEQUENCE.indexOf(stage) + 1;
  emitFinalizeEvent('info', FINALIZE_EVENTS.JOB_STAGE_STARTED, {
    ...details,
    stage,
    stageOrdinal: stageOrdinal > 0 ? stageOrdinal : null,
  });
  try {
    const result = await callback();
    const durationMs = Date.now() - startedAt;
    emitFinalizeEvent('info', FINALIZE_EVENTS.JOB_STAGE_COMPLETED, {
      ...details,
      stage,
      stageOrdinal: stageOrdinal > 0 ? stageOrdinal : null,
      durationMs,
    });
    return result;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    error.finalizeStage = error.finalizeStage || stage;
    error.finalizeStageDurationMs =
      error.finalizeStageDurationMs == null ? durationMs : error.finalizeStageDurationMs;
    throw error;
  }
}

export function markFinalizeQueueSnapshot(snapshot = {}) {
  if (Number.isFinite(Number(snapshot.queueDepth))) {
    finalizeMetricsRegistry.setGauge('finalize_queue_depth', Number(snapshot.queueDepth));
  }
  if (Number.isFinite(Number(snapshot.queueOldestAgeSeconds))) {
    finalizeMetricsRegistry.setGauge(
      'finalize_queue_oldest_age_seconds',
      Number(snapshot.queueOldestAgeSeconds)
    );
  }
  if (Number.isFinite(Number(snapshot.jobsRunning))) {
    finalizeMetricsRegistry.setGauge('finalize_jobs_running', Number(snapshot.jobsRunning));
  }
  if (Number.isFinite(Number(snapshot.jobsRetryScheduled))) {
    finalizeMetricsRegistry.setGauge(
      'finalize_jobs_retry_scheduled',
      Number(snapshot.jobsRetryScheduled)
    );
  }
  if (Number.isFinite(Number(snapshot.billingUnsettledJobs))) {
    finalizeMetricsRegistry.setGauge(
      'finalize_billing_unsettled_jobs',
      Number(snapshot.billingUnsettledJobs)
    );
  }
}

export default {
  FINALIZE_EVENT_NAMES,
  FINALIZE_EVENTS,
  FINALIZE_EVENT_REQUIRED_FIELDS,
  FINALIZE_METRIC_DEFINITIONS,
  FINALIZE_SOURCE_ROLES,
  FINALIZE_STAGE_SEQUENCE,
  FINALIZE_STAGES,
  addFinalizeEventSink,
  describeFinalizeError,
  emitFinalizeEvent,
  finalizeJobIdFromAttemptId,
  getFinalizeMetricsRegistry,
  markFinalizeQueueSnapshot,
  resetFinalizeObservabilityForTests,
  runWithFinalizeObservabilityContext,
  setFinalizeObservabilityContext,
  snapshotFinalizeObservability,
  withFinalizeStage,
};
