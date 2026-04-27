import admin, { db } from '../config/firebase.js';
import logger from '../observability/logger.js';
import {
  FINALIZE_EVENTS,
  FINALIZE_SOURCE_ROLES,
  FINALIZE_STAGES,
  describeFinalizeError,
  emitFinalizeEvent,
  markFinalizeQueueSnapshot,
} from '../observability/finalize-observability.js';
import {
  applyUsageDelta,
  billingMsToSeconds,
  buildCanonicalUsageState,
  computeRenderChargeMs,
  getAvailableMs,
  secondsToBillingMs,
} from './usage.service.js';
import {
  buildRenderRecoveryProjection,
  persistStoryRenderRecovery,
  sanitizeStorySessionForClient,
} from './story.service.js';
import { isOutboundPolicyError } from '../utils/outbound.fetch.js';
import { shouldRejectFinalizeAdmissionForBackpressure } from './finalize-control.service.js';

const ATTEMPTS_COLLECTION = 'idempotency';
const SESSION_LOCKS_COLLECTION = 'storyFinalizeSessions';
const FLOW = 'story.finalize';
const TEST_MODE = process.env.NODE_ENV === 'test' && process.env.VAIFORM_TEST_MODE === '1';
export const FINALIZE_JOB_SCHEMA_VERSION = 3;
export const FINALIZE_COMPATIBILITY_TOP_LEVEL_FIELDS = Object.freeze([
  'flow',
  'uid',
  'attemptId',
  'sessionId',
  'state',
  'status',
  'isActive',
  'shortId',
  'requestId',
  'usageReservation',
  'billingSettlement',
  'failure',
  'createdAt',
  'updatedAt',
  'enqueuedAt',
  'startedAt',
  'finishedAt',
  'expiresAt',
  'availableAfter',
  'leaseHeartbeatAt',
  'leaseExpiresAt',
  'runnerId',
]);

const numberFromEnv = (name, fallback) => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};
const FINALIZE_QUEUE_METRICS_JOB_STATES = Object.freeze([
  'queued',
  'claimed',
  'started',
  'retry_scheduled',
]);
const FINALIZE_QUEUE_METRICS_QUERY_LIMIT = numberFromEnv('FINALIZE_QUEUE_METRICS_QUERY_LIMIT', 100);

export const FINALIZE_ACCEPTED_STATUS = 202;
export const FINALIZE_ACTIVE_STATES = new Set(['queued', 'running']);
export const FINALIZE_FLOW = FLOW;
export const FINALIZE_RUNNER_HEARTBEAT_MS = numberFromEnv(
  'STORY_FINALIZE_RUNNER_HEARTBEAT_MS',
  TEST_MODE ? 25 : 5000
);
export const FINALIZE_RUNNER_LEASE_MS = numberFromEnv(
  'STORY_FINALIZE_RUNNER_LEASE_MS',
  TEST_MODE ? 120 : 20000
);
export const FINALIZE_RUNNER_POLL_MS = numberFromEnv(
  'STORY_FINALIZE_RUNNER_POLL_MS',
  TEST_MODE ? 25 : 1000
);
export const FINALIZE_REAPER_INTERVAL_MS = numberFromEnv(
  'STORY_FINALIZE_REAPER_INTERVAL_MS',
  TEST_MODE ? 50 : 5000
);
export const FINALIZE_BUSY_RETRY_MS = numberFromEnv(
  'STORY_FINALIZE_BUSY_RETRY_MS',
  TEST_MODE ? 60 : 30000
);

const requestIdOf = (req) => req?.id ?? null;
const attemptDocId = (uid, attemptId) => `${uid}:${attemptId}`;
const attemptRef = (uid, attemptId) =>
  db.collection(ATTEMPTS_COLLECTION).doc(attemptDocId(uid, attemptId));
const sessionLockRef = (uid, sessionId) =>
  db.collection(SESSION_LOCKS_COLLECTION).doc(`${uid}:${sessionId}`);
const buildExecutionAttemptId = (jobId, attemptNumber) => `${jobId}:exec:${attemptNumber}`;

const toMillis = (value) => {
  if (value == null) return null;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toIso = (value) => {
  const ms = toMillis(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};

const cloneValue = (value) => {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item));
  if (value && typeof value === 'object') return { ...value };
  return value ?? null;
};

const deepCloneValue = (value) => {
  if (Array.isArray(value)) return value.map((item) => deepCloneValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, deepCloneValue(item)])
    );
  }
  return value ?? null;
};

const jobStateFromCompatState = (data = {}) => {
  const current = typeof data?.jobState === 'string' ? data.jobState : null;
  if (current) return current;
  switch (data?.state) {
    case 'queued':
      return Number.isFinite(toMillis(data?.availableAfter)) &&
        toMillis(data.availableAfter) > Date.now()
        ? 'retry_scheduled'
        : 'queued';
    case 'running':
      return toMillis(data?.startedAt) ? 'started' : 'claimed';
    case 'done':
      return 'settled';
    case 'failed':
    case 'expired':
      return 'failed_terminal';
    default:
      return 'queued';
  }
};

const executionStateFromCompatState = (data = {}) => {
  if (typeof data?.currentExecution?.state === 'string') return data.currentExecution.state;
  switch (data?.state) {
    case 'queued':
      return Number.isFinite(toMillis(data?.startedAt)) ? 'claimed' : 'created';
    case 'running':
      return 'running';
    case 'done':
      return 'succeeded';
    case 'failed':
    case 'expired':
      return 'failed_terminal';
    default:
      return 'created';
  }
};

const normalizeExecutionAttempt = (execution, { jobId, attemptNumber, compat = {} } = {}) => {
  const number =
    Number.isFinite(Number(execution?.attemptNumber)) && Number(execution.attemptNumber) > 0
      ? Number(execution.attemptNumber)
      : attemptNumber;
  const executionAttemptId =
    typeof execution?.executionAttemptId === 'string' &&
    execution.executionAttemptId.trim().length > 0
      ? execution.executionAttemptId.trim()
      : buildExecutionAttemptId(jobId, number);
  return {
    executionAttemptId,
    attemptNumber: number,
    state:
      typeof execution?.state === 'string' && execution.state.trim().length > 0
        ? execution.state.trim()
        : executionStateFromCompatState(compat),
    workerId: execution?.workerId || compat.runnerId || null,
    createdAt: execution?.createdAt ?? compat.createdAt ?? compat.enqueuedAt ?? null,
    claimedAt: execution?.claimedAt ?? null,
    startedAt: execution?.startedAt ?? compat.startedAt ?? null,
    finishedAt: execution?.finishedAt ?? compat.finishedAt ?? null,
    failure: cloneValue(execution?.failure ?? null),
    stageTimings: deepCloneValue(execution?.stageTimings ?? {}),
    lease: {
      heartbeatAt: execution?.lease?.heartbeatAt ?? compat.leaseHeartbeatAt ?? null,
      expiresAt: execution?.lease?.expiresAt ?? compat.leaseExpiresAt ?? null,
    },
  };
};

const deriveLegacyExecutionAttempts = (data, jobId) => {
  const derived = normalizeExecutionAttempt(
    {
      executionAttemptId:
        typeof data?.currentExecution?.executionAttemptId === 'string'
          ? data.currentExecution.executionAttemptId
          : null,
      attemptNumber:
        Number.isFinite(Number(data?.currentExecution?.attemptNumber)) &&
        Number(data.currentExecution.attemptNumber) > 0
          ? Number(data.currentExecution.attemptNumber)
          : 1,
      state: executionStateFromCompatState(data),
      workerId: data?.runnerId || null,
      createdAt: data?.createdAt ?? data?.enqueuedAt ?? null,
      claimedAt: data?.startedAt ?? null,
      startedAt: data?.startedAt ?? null,
      finishedAt: data?.finishedAt ?? null,
      failure: data?.failure || null,
      lease: {
        heartbeatAt: data?.leaseHeartbeatAt ?? null,
        expiresAt: data?.leaseExpiresAt ?? null,
      },
    },
    { jobId, attemptNumber: 1, compat: data }
  );
  return [derived];
};

const normalizeExecutionAttempts = (data, jobId) => {
  if (Array.isArray(data?.executionAttempts) && data.executionAttempts.length > 0) {
    return data.executionAttempts.map((execution, index) =>
      normalizeExecutionAttempt(execution, {
        jobId,
        attemptNumber: index + 1,
        compat: data,
      })
    );
  }
  return deriveLegacyExecutionAttempts(data, jobId);
};

const getCurrentExecutionAttempt = (attempt) => {
  const currentExecutionId =
    typeof attempt?.currentExecution?.executionAttemptId === 'string'
      ? attempt.currentExecution.executionAttemptId
      : null;
  if (currentExecutionId) {
    const existing = attempt?.executionAttempts?.find(
      (execution) => execution.executionAttemptId === currentExecutionId
    );
    if (existing) return existing;
  }
  return attempt?.executionAttempts?.[attempt.executionAttempts.length - 1] || null;
};

const buildCurrentExecutionSummary = (execution) => {
  if (!execution) return null;
  return {
    executionAttemptId: execution.executionAttemptId,
    attemptNumber: execution.attemptNumber,
    state: execution.state,
    workerId: execution.workerId || null,
    createdAt: execution.createdAt ?? null,
    claimedAt: execution.claimedAt ?? null,
    startedAt: execution.startedAt ?? null,
    finishedAt: execution.finishedAt ?? null,
    lease: {
      heartbeatAt: execution?.lease?.heartbeatAt ?? null,
      expiresAt: execution?.lease?.expiresAt ?? null,
    },
  };
};

const buildProjectionState = ({ state, compatState, jobState }) => {
  if (state) return state;
  if (compatState === 'done' || jobState === 'settled') return 'done';
  if (compatState === 'failed' || compatState === 'expired' || jobState === 'failed_terminal') {
    return 'failed';
  }
  return 'pending';
};

const buildCanonicalProjection = ({
  attempt,
  state = null,
  shortId = null,
  error = null,
  previous = null,
}) => {
  const prior =
    (previous && typeof previous === 'object' ? previous : null) ||
    (attempt?.projection?.renderRecovery && typeof attempt.projection.renderRecovery === 'object'
      ? attempt.projection.renderRecovery
      : {});
  return buildRenderRecoveryProjection({
    state: buildProjectionState({
      state,
      compatState: attempt?.state ?? null,
      jobState: attempt?.jobState ?? null,
    }),
    attemptId: attempt?.attemptId ?? attempt?.jobId ?? null,
    previous: prior,
    shortId: shortId ?? attempt?.shortId ?? null,
    error: error ?? attempt?.failure ?? null,
  });
};

const buildCanonicalJobRecord = (data, id = null) => {
  const compat = data && typeof data === 'object' ? data : {};
  const jobId =
    typeof compat.jobId === 'string' && compat.jobId.trim().length > 0
      ? compat.jobId.trim()
      : typeof compat.attemptId === 'string' && compat.attemptId.trim().length > 0
        ? compat.attemptId.trim()
        : null;
  const executionAttempts = normalizeExecutionAttempts(compat, jobId);
  const currentExecution = getCurrentExecutionAttempt({
    currentExecution: compat.currentExecution,
    executionAttempts,
  });
  const jobState = jobStateFromCompatState(compat);
  const projection =
    compat.projection && typeof compat.projection === 'object'
      ? deepCloneValue(compat.projection)
      : {};
  if (!projection.renderRecovery) {
    projection.renderRecovery = buildCanonicalProjection({
      attempt: {
        ...compat,
        attemptId: compat.attemptId ?? jobId,
        jobId,
        jobState,
        executionAttempts,
        currentExecution,
      },
    });
  }
  return {
    id,
    schemaVersion:
      Number.isFinite(Number(compat.schemaVersion)) && Number(compat.schemaVersion) > 0
        ? Number(compat.schemaVersion)
        : FINALIZE_JOB_SCHEMA_VERSION,
    flow: compat.flow || null,
    uid: compat.uid || null,
    attemptId: compat.attemptId || null,
    jobId,
    externalAttemptId: compat.externalAttemptId || compat.attemptId || jobId || null,
    sessionId: compat.sessionId || null,
    state: compat.state || null,
    jobState,
    status: Number.isFinite(Number(compat.status)) ? Number(compat.status) : null,
    isActive: compat.isActive === true,
    shortId: compat.shortId ?? null,
    requestId: compat.requestId ?? null,
    usageReservation: cloneValue(compat.usageReservation),
    billingSettlement: cloneValue(compat.billingSettlement),
    failure: cloneValue(compat.failure),
    createdAt: toIso(compat.createdAt),
    updatedAt: toIso(compat.updatedAt),
    enqueuedAt: toIso(compat.enqueuedAt),
    startedAt: toIso(compat.startedAt),
    finishedAt: toIso(compat.finishedAt),
    expiresAt: toIso(compat.expiresAt),
    availableAfter: toIso(compat.availableAfter),
    leaseHeartbeatAt: toIso(compat.leaseHeartbeatAt),
    leaseExpiresAt: toIso(compat.leaseExpiresAt),
    runnerId: compat.runnerId || null,
    currentStage: compat.currentStage || null,
    queue: {
      ...(deepCloneValue(compat.queue) || {}),
      enqueuedAt: toIso(compat?.queue?.enqueuedAt ?? compat.enqueuedAt),
      availableAfter: toIso(compat?.queue?.availableAfter ?? compat.availableAfter),
      expiresAt: toIso(compat?.queue?.expiresAt ?? compat.expiresAt),
      claimedAt: toIso(compat?.queue?.claimedAt ?? currentExecution?.claimedAt ?? null),
      lastQueuedAt: toIso(compat?.queue?.lastQueuedAt ?? compat.enqueuedAt ?? compat.createdAt),
    },
    retry: {
      count:
        Number.isFinite(Number(compat?.retry?.count)) && Number(compat.retry.count) >= 0
          ? Number(compat.retry.count)
          : Math.max(0, executionAttempts.length - 1),
      scheduledAt: toIso(compat?.retry?.scheduledAt ?? compat.availableAfter),
      lastFailure: cloneValue(compat?.retry?.lastFailure ?? null),
    },
    billing: {
      reservation: cloneValue(compat?.billing?.reservation ?? compat.usageReservation ?? null),
      settlement: cloneValue(compat?.billing?.settlement ?? compat.billingSettlement ?? null),
    },
    result: {
      ...(deepCloneValue(compat.result) || {}),
      shortId: compat?.result?.shortId ?? compat.shortId ?? null,
      status: Number.isFinite(Number(compat?.result?.status))
        ? Number(compat.result.status)
        : Number.isFinite(Number(compat.status))
          ? Number(compat.status)
          : null,
      failure: cloneValue(compat?.result?.failure ?? compat.failure ?? null),
    },
    projection,
    currentExecution: buildCurrentExecutionSummary(currentExecution),
    executionAttempts,
    executionAttemptId: currentExecution?.executionAttemptId ?? null,
  };
};

const toStoredDate = (value) => {
  const ms = toMillis(value);
  return Number.isFinite(ms) ? new Date(ms) : null;
};

const serializeExecutionAttempt = (execution) => ({
  executionAttemptId: execution.executionAttemptId,
  attemptNumber: execution.attemptNumber,
  state: execution.state,
  workerId: execution.workerId || null,
  createdAt: toStoredDate(execution.createdAt),
  claimedAt: toStoredDate(execution.claimedAt),
  startedAt: toStoredDate(execution.startedAt),
  finishedAt: toStoredDate(execution.finishedAt),
  failure: cloneValue(execution.failure),
  stageTimings: deepCloneValue(execution.stageTimings),
  lease: {
    heartbeatAt: toStoredDate(execution?.lease?.heartbeatAt),
    expiresAt: toStoredDate(execution?.lease?.expiresAt),
  },
});

const serializeCanonicalFields = (attempt) => ({
  schemaVersion: FINALIZE_JOB_SCHEMA_VERSION,
  jobId: attempt.jobId,
  externalAttemptId: attempt.externalAttemptId,
  jobState: attempt.jobState,
  currentStage: attempt.currentStage ?? null,
  queue: {
    ...(deepCloneValue(attempt.queue) || {}),
    enqueuedAt: toStoredDate(attempt?.queue?.enqueuedAt),
    availableAfter: toStoredDate(attempt?.queue?.availableAfter),
    expiresAt: toStoredDate(attempt?.queue?.expiresAt),
    claimedAt: toStoredDate(attempt?.queue?.claimedAt),
    lastQueuedAt: toStoredDate(attempt?.queue?.lastQueuedAt),
  },
  retry: {
    ...(deepCloneValue(attempt.retry) || {}),
    count: Number.isFinite(Number(attempt?.retry?.count)) ? Number(attempt.retry.count) : 0,
    scheduledAt: toStoredDate(attempt?.retry?.scheduledAt),
  },
  billing: {
    reservation: cloneValue(attempt?.billing?.reservation ?? null),
    settlement: cloneValue(attempt?.billing?.settlement ?? null),
  },
  result: {
    ...(deepCloneValue(attempt.result) || {}),
    shortId: attempt?.result?.shortId ?? null,
    status: Number.isFinite(Number(attempt?.result?.status)) ? Number(attempt.result.status) : null,
    failure: cloneValue(attempt?.result?.failure ?? null),
  },
  projection: {
    ...(deepCloneValue(attempt.projection) || {}),
    renderRecovery: cloneValue(attempt?.projection?.renderRecovery ?? null),
  },
  currentExecution: {
    ...(buildCurrentExecutionSummary(attempt.currentExecution) || {}),
    createdAt: toStoredDate(attempt?.currentExecution?.createdAt),
    claimedAt: toStoredDate(attempt?.currentExecution?.claimedAt),
    startedAt: toStoredDate(attempt?.currentExecution?.startedAt),
    finishedAt: toStoredDate(attempt?.currentExecution?.finishedAt),
    lease: {
      heartbeatAt: toStoredDate(attempt?.currentExecution?.lease?.heartbeatAt),
      expiresAt: toStoredDate(attempt?.currentExecution?.lease?.expiresAt),
    },
  },
  executionAttempts: Array.isArray(attempt.executionAttempts)
    ? attempt.executionAttempts.map((execution) => serializeExecutionAttempt(execution))
    : [],
});

const updateExecutionAttempt = (attempt, executionAttemptId, updater) =>
  attempt.executionAttempts.map((execution) => {
    if (execution.executionAttemptId !== executionAttemptId) return execution;
    return normalizeExecutionAttempt(updater(deepCloneValue(execution)), {
      jobId: attempt.jobId,
      attemptNumber: execution.attemptNumber,
      compat: attempt,
    });
  });

const appendExecutionAttempt = (attempt, patch = {}) => {
  const nextAttemptNumber =
    Math.max(0, ...attempt.executionAttempts.map((execution) => execution.attemptNumber || 0)) + 1;
  const execution = normalizeExecutionAttempt(
    {
      executionAttemptId: buildExecutionAttemptId(attempt.jobId, nextAttemptNumber),
      attemptNumber: nextAttemptNumber,
      createdAt: patch.createdAt ?? new Date(),
      ...patch,
    },
    { jobId: attempt.jobId, attemptNumber: nextAttemptNumber, compat: attempt }
  );
  return {
    attempt: {
      ...attempt,
      executionAttempts: [...attempt.executionAttempts, execution],
      currentExecution: buildCurrentExecutionSummary(execution),
      executionAttemptId: execution.executionAttemptId,
    },
    execution,
  };
};

const getVoiceSyncAdmissionError = (session) => {
  const state =
    typeof session?.voiceSync?.state === 'string' ? session.voiceSync.state : 'never_synced';
  if (state === 'never_synced') {
    return {
      status: 409,
      error: 'VOICE_SYNC_REQUIRED',
      detail: 'Sync voice and timing before render.',
    };
  }
  if (state !== 'current') {
    return {
      status: 409,
      error: 'VOICE_SYNC_STALE',
      detail: 'Voice timing is stale. Re-sync before render.',
    };
  }
  return null;
};

const getEstimatedMsFromSession = (session) => {
  const estimatedMs = secondsToBillingMs(session?.billingEstimate?.estimatedSec ?? 0);
  return estimatedMs > 0 ? estimatedMs : null;
};

const getBilledMsFromSession = (session) => {
  const durationMs = secondsToBillingMs(session?.finalVideo?.durationSec ?? 0);
  const billedMs = computeRenderChargeMs(durationMs);
  return billedMs > 0 ? billedMs : null;
};

const requestBillingOf = (settlement) => {
  if (!settlement) return null;
  const billedSec = Number(settlement?.billedSec);
  if (!Number.isFinite(billedSec) || billedSec <= 0) return null;
  return {
    billedSec,
    settledAt: toIso(settlement?.settledAt),
  };
};

export const attachBillingToSession = (session, settlement) => {
  if (!session || typeof session !== 'object') return session;
  const safeSession = sanitizeStorySessionForClient(session);
  const billing = requestBillingOf(settlement);
  if (!billing) return safeSession;
  return {
    ...safeSession,
    billing,
  };
};

export const finalizeMeta = ({ attemptId, pollSessionId, state = 'pending' }) => ({
  state,
  attemptId: typeof attemptId === 'string' && attemptId.trim().length > 0 ? attemptId.trim() : null,
  pollSessionId:
    typeof pollSessionId === 'string' && pollSessionId.trim().length > 0
      ? pollSessionId.trim()
      : null,
});

export const finalizeSuccessEnvelope = (req, session, shortId) => ({
  success: true,
  data: sanitizeStorySessionForClient(session),
  shortId,
  requestId: requestIdOf(req),
});

export const finalizeAcceptedEnvelope = (req, session, { attemptId, pollSessionId }) => ({
  success: true,
  data: sanitizeStorySessionForClient(session),
  shortId: null,
  requestId: requestIdOf(req),
  finalize: finalizeMeta({ attemptId, pollSessionId, state: 'pending' }),
});

export const finalizeConflictEnvelope = (
  req,
  { attemptId, pollSessionId, detail = 'Finalize already active for this session.' }
) => ({
  success: false,
  error: 'FINALIZE_ALREADY_ACTIVE',
  detail,
  requestId: requestIdOf(req),
  finalize: finalizeMeta({ attemptId, pollSessionId, state: 'pending' }),
});

export const finalizeFailureReplayEnvelope = (req, attempt) => ({
  success: false,
  error: attempt?.failure?.error || 'STORY_FINALIZE_FAILED',
  detail: attempt?.failure?.detail || 'Failed to finalize story',
  requestId: requestIdOf(req),
  finalize: finalizeMeta({
    attemptId: attempt?.attemptId || null,
    pollSessionId: attempt?.sessionId || null,
    state: attempt?.state === 'expired' ? 'failed' : attempt?.state || 'failed',
  }),
});

function safeRefreshFinalizeQueueMetrics() {
  void refreshFinalizeQueueMetrics().catch((error) => {
    logger.warn('finalize.metrics.refresh_failed', {
      error,
    });
  });
}

function normalizeAttempt(data, id = null) {
  if (!data || typeof data !== 'object') return null;
  return buildCanonicalJobRecord(data, id);
}

export async function captureFinalizeQueueMetricsSnapshot({ now = Date.now() } = {}) {
  const snapshot = await db
    .collection(ATTEMPTS_COLLECTION)
    .where('flow', '==', FLOW)
    .where('isActive', '==', true)
    .where('jobState', 'in', FINALIZE_QUEUE_METRICS_JOB_STATES)
    .limit(FINALIZE_QUEUE_METRICS_QUERY_LIMIT)
    .get();

  let queueDepth = 0;
  let jobsRunning = 0;
  let jobsRetryScheduled = 0;
  let oldestQueuedAtMs = null;
  let billingUnsettledJobs = 0;
  const jobStateCounts = {};
  for (const doc of snapshot.docs) {
    const attempt = normalizeAttempt(doc.data(), doc.id);
    if (!attempt) continue;
    if (attempt.jobState) {
      jobStateCounts[attempt.jobState] = (jobStateCounts[attempt.jobState] || 0) + 1;
    }
    billingUnsettledJobs += 1;
    if (attempt.jobState === 'queued' || attempt.jobState === 'retry_scheduled') {
      queueDepth += 1;
      const createdAtMs = toMillis(
        attempt.queue?.lastQueuedAt ?? attempt.enqueuedAt ?? attempt.createdAt
      );
      if (Number.isFinite(createdAtMs)) {
        oldestQueuedAtMs =
          oldestQueuedAtMs == null ? createdAtMs : Math.min(oldestQueuedAtMs, createdAtMs);
      }
      const availableAfterMs = toMillis(attempt.queue?.availableAfter ?? attempt.availableAfter);
      if (
        attempt.jobState === 'retry_scheduled' ||
        (Number.isFinite(availableAfterMs) && availableAfterMs > now)
      ) {
        jobsRetryScheduled += 1;
      }
    }
    if (attempt.jobState === 'claimed' || attempt.jobState === 'started') {
      jobsRunning += 1;
    }
  }

  logger.info('finalize.queue_metrics.snapshot', {
    metricType: 'finalize_queue_metrics',
    returnedDocCount: snapshot.docs.length,
    queryLimit: FINALIZE_QUEUE_METRICS_QUERY_LIMIT,
    queueDepth,
    jobsRunning,
    jobsRetryScheduled,
    billingUnsettledJobs,
  });

  return {
    queueDepth,
    queueOldestAgeSeconds:
      oldestQueuedAtMs == null ? 0 : Math.max(0, Math.floor((now - oldestQueuedAtMs) / 1000)),
    jobsRunning,
    jobsRetryScheduled,
    billingUnsettledJobs,
    jobStateCounts,
  };
}

export async function refreshFinalizeQueueMetrics() {
  const snapshot = await captureFinalizeQueueMetricsSnapshot();
  markFinalizeQueueSnapshot(snapshot);
  return snapshot;
}

export async function getFinalizeAttempt({ uid, attemptId }) {
  const snap = await attemptRef(uid, attemptId).get();
  if (!snap.exists) return null;
  return normalizeAttempt(snap.data(), snap.id);
}

export async function getFinalizeSessionLock({ uid, sessionId }) {
  const snap = await sessionLockRef(uid, sessionId).get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  return {
    uid: data.uid || uid || null,
    sessionId: data.sessionId || sessionId || null,
    attemptId:
      typeof data.attemptId === 'string' && data.attemptId.trim().length > 0
        ? data.attemptId.trim()
        : null,
    state: data.state || null,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    expiresAt: toIso(data.expiresAt),
  };
}

export async function getLatestFinalizeAttemptForSession({ uid, sessionId }) {
  const snapshot = await db
    .collection(ATTEMPTS_COLLECTION)
    .where('flow', '==', FLOW)
    .where('uid', '==', uid)
    .where('sessionId', '==', sessionId)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  const doc = snapshot.docs[0];
  if (!doc) return null;
  return normalizeAttempt(doc.data(), doc.id);
}

async function getActiveFinalizeAttemptForSession({ uid, sessionId, attemptId }) {
  const lockSnap = await sessionLockRef(uid, sessionId).get();
  if (!lockSnap.exists) return null;
  const lock = lockSnap.data() || {};
  const activeAttemptId =
    typeof lock.attemptId === 'string' && lock.attemptId.trim().length > 0
      ? lock.attemptId.trim()
      : null;
  if (!activeAttemptId || activeAttemptId === attemptId) {
    return null;
  }
  const activeAttempt = await getFinalizeAttempt({ uid, attemptId: activeAttemptId });
  return FINALIZE_ACTIVE_STATES.has(activeAttempt?.state) ? activeAttempt : null;
}

export function mapFinalizeFailureFromError(error) {
  if (isOutboundPolicyError(error)) {
    return {
      status: error?.status || 400,
      error: error?.code || 'OUTBOUND_URL_REJECTED',
      detail: error?.message || 'Outbound URL rejected',
    };
  }

  switch (error?.code) {
    case 'LINK_EXTRACT_TOO_LARGE':
    case 'VIDEO_SIZE':
    case 'VIDEO_TYPE':
      return {
        status: error?.status || 400,
        error: error.code,
        detail: error?.message || 'Invalid outbound media',
      };
    case 'LINK_EXTRACT_TIMEOUT':
    case 'VIDEO_DOWNLOAD_TIMEOUT':
      return {
        status: 504,
        error: error.code,
        detail: error?.message || 'Outbound fetch timed out',
      };
    case 'VIDEO_FETCH_BODY_MISSING':
      return {
        status: error?.status || 502,
        error: error.code,
        detail: error?.message || 'Remote video fetch failed',
      };
    case 'STORY_GENERATE_BUSY':
    case 'STORY_GENERATE_TIMEOUT':
    case 'STORY_PLAN_BUSY':
    case 'STORY_PLAN_TIMEOUT':
    case 'STORY_SEARCH_BUSY':
    case 'STORY_SEARCH_TEMPORARILY_UNAVAILABLE':
      return {
        status: 503,
        error: 'SERVER_BUSY',
        detail: error?.message || 'Server is busy. Please retry shortly.',
      };
    case 'SESSION_NOT_FOUND':
      return {
        status: 404,
        error: 'SESSION_NOT_FOUND',
        detail: 'Session not found',
      };
    case 'PLAN_REQUIRED':
      return {
        status: 400,
        error: 'PLAN_REQUIRED',
        detail: 'Story plan required before clip search',
      };
    case 'STORY_REQUIRED':
      return {
        status: 400,
        error: 'STORY_REQUIRED',
        detail: 'Story required',
      };
    case 'SHOTS_REQUIRED':
      return {
        status: 400,
        error: 'SHOTS_REQUIRED',
        detail: 'Shots required',
      };
    case 'INVALID_SENTENCE_INDEX':
      return {
        status: 400,
        error: 'INVALID_SENTENCE_INDEX',
        detail: 'Sentence index out of range',
      };
    case 'SHOT_NOT_FOUND':
      return {
        status: 404,
        error: 'SHOT_NOT_FOUND',
        detail: 'Shot not found',
      };
    case 'NO_SEARCH_QUERY_AVAILABLE':
      return {
        status: 400,
        error: 'NO_SEARCH_QUERY_AVAILABLE',
        detail: 'Search query required',
      };
    case 'NO_CANDIDATES_AVAILABLE':
      return {
        status: 400,
        error: 'NO_CANDIDATES_AVAILABLE',
        detail: 'No candidates available for shot',
      };
    case 'CLIP_NOT_FOUND_IN_CANDIDATES':
      return {
        status: 400,
        error: 'CLIP_NOT_FOUND_IN_CANDIDATES',
        detail: 'Clip not found in current candidates',
      };
    default:
      if (typeof error?.code === 'string' && error.code.startsWith('VIDEO_FETCH_')) {
        return {
          status: error?.status || 502,
          error: error.code,
          detail: error?.message || 'Remote video fetch failed',
        };
      }
      if (typeof error?.message === 'string' && error.message.startsWith('SHOT_NOT_FOUND:')) {
        return {
          status: 404,
          error: 'SHOT_NOT_FOUND',
          detail: `Shot not found (${error.message.slice('SHOT_NOT_FOUND:'.length).trim()})`,
        };
      }
      return {
        status: Number.isFinite(Number(error?.status)) ? Number(error.status) : 500,
        error: typeof error?.code === 'string' ? error.code : 'STORY_FINALIZE_FAILED',
        detail:
          typeof error?.message === 'string' && error.message.trim().length > 0
            ? error.message
            : 'Failed to finalize story',
      };
  }
}

async function loadReplaySession({ uid, attempt, fallbackSessionId, getSession }) {
  const sessionId = attempt?.sessionId || fallbackSessionId;
  if (!sessionId) return null;
  return await getSession({ uid, sessionId });
}

export async function prepareFinalizeAttempt({
  uid,
  attemptId,
  sessionId,
  requestId = null,
  ttlMinutes = 60,
  getSession,
}) {
  const existingAttempt = await getFinalizeAttempt({ uid, attemptId });
  if (existingAttempt) {
    switch (existingAttempt.state) {
      case 'done':
        return { kind: 'done_same_key', attempt: existingAttempt };
      case 'failed':
      case 'expired':
        return { kind: 'failed_same_key', attempt: existingAttempt };
      case 'queued':
      case 'running':
        return { kind: 'active_same_key', attempt: existingAttempt };
      default:
        break;
    }
  }

  const reservationSession = await getSession({ uid, sessionId });
  if (reservationSession == null) {
    return {
      kind: 'error',
      status: 404,
      error: 'SESSION_NOT_FOUND',
      detail: 'Session not found',
    };
  }

  const syncGateError = getVoiceSyncAdmissionError(reservationSession);
  if (syncGateError) {
    return {
      kind: 'error',
      status: syncGateError.status,
      error: syncGateError.error,
      detail: syncGateError.detail,
    };
  }

  const estimatedMs = getEstimatedMsFromSession(reservationSession);
  if (!estimatedMs) {
    return {
      kind: 'error',
      status: 409,
      error: 'BILLING_ESTIMATE_UNAVAILABLE',
      detail: 'Render-time estimate is unavailable for this session.',
    };
  }

  const activeSessionAttempt = await getActiveFinalizeAttemptForSession({
    uid,
    sessionId,
    attemptId,
  });
  if (activeSessionAttempt) {
    return { kind: 'active_other_key', attempt: activeSessionAttempt };
  }

  const overloadDecision = await shouldRejectFinalizeAdmissionForBackpressure();
  if (overloadDecision.reject) {
    return {
      kind: 'overloaded',
      retryAfterSec: overloadDecision.retryAfterSec,
      backlog: overloadDecision,
    };
  }

  const now = Date.now();
  const createdAt = new Date(now);
  const expiresAt = new Date(now + ttlMinutes * 60 * 1000);
  const availableAfter = new Date(now);

  try {
    const txResult = await db.runTransaction(async (tx) => {
      const currentAttemptSnap = await tx.get(attemptRef(uid, attemptId));
      if (currentAttemptSnap.exists) {
        return {
          kind: 'replay_same_key',
          attempt: normalizeAttempt(currentAttemptSnap.data(), currentAttemptSnap.id),
        };
      }

      const lockRef = sessionLockRef(uid, sessionId);
      const lockSnap = await tx.get(lockRef);
      if (lockSnap.exists) {
        const lock = lockSnap.data() || {};
        const activeAttemptId =
          typeof lock.attemptId === 'string' && lock.attemptId.trim().length > 0
            ? lock.attemptId.trim()
            : null;
        if (activeAttemptId && activeAttemptId !== attemptId) {
          const activeAttemptSnap = await tx.get(attemptRef(uid, activeAttemptId));
          if (activeAttemptSnap.exists) {
            const activeAttempt = normalizeAttempt(activeAttemptSnap.data(), activeAttemptSnap.id);
            if (FINALIZE_ACTIVE_STATES.has(activeAttempt?.state)) {
              return { kind: 'conflict', attempt: activeAttempt };
            }
          }
        }
        tx.delete(lockRef);
      }

      const userRef = db.collection('users').doc(uid);
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) {
        const err = new Error('User account not found.');
        err.code = 'USER_NOT_FOUND';
        err.status = 404;
        throw err;
      }

      const userData = userSnap.data() || {};
      const accountState = buildCanonicalUsageState(userData);
      const usage = accountState.usage;
      if (getAvailableMs(usage, accountState.plan) < estimatedMs) {
        const err = new Error(
          `Insufficient render time. You need ${billingMsToSeconds(estimatedMs)} seconds to render.`
        );
        err.code = 'INSUFFICIENT_RENDER_TIME';
        err.status = 402;
        throw err;
      }

      const executionAttempt = normalizeExecutionAttempt(
        {
          executionAttemptId: buildExecutionAttemptId(attemptId, 1),
          attemptNumber: 1,
          state: 'created',
          createdAt,
          workerId: null,
          lease: {
            heartbeatAt: null,
            expiresAt: null,
          },
        },
        {
          jobId: attemptId,
          attemptNumber: 1,
          compat: {
            attemptId,
            sessionId,
            createdAt,
            enqueuedAt: createdAt,
          },
        }
      );
      const queuedAttempt = normalizeAttempt(
        {
          flow: FLOW,
          uid,
          attemptId,
          sessionId,
          requestId,
          state: 'queued',
          isActive: true,
          status: FINALIZE_ACCEPTED_STATUS,
          shortId: null,
          createdAt,
          updatedAt: createdAt,
          enqueuedAt: createdAt,
          expiresAt,
          availableAfter,
          usageReservation: {
            estimatedSec: billingMsToSeconds(estimatedMs),
            reservedSec: billingMsToSeconds(estimatedMs),
            estimatedMs,
            reservedMs: estimatedMs,
          },
          billingSettlement: null,
          failure: null,
          runnerId: null,
          leaseHeartbeatAt: null,
          leaseExpiresAt: null,
          schemaVersion: FINALIZE_JOB_SCHEMA_VERSION,
          jobId: attemptId,
          externalAttemptId: attemptId,
          jobState: 'queued',
          currentStage: FINALIZE_STAGES.QUEUE_ENQUEUE,
          queue: {
            enqueuedAt: createdAt,
            availableAfter,
            expiresAt,
            claimedAt: null,
            lastQueuedAt: createdAt,
          },
          retry: {
            count: 0,
            scheduledAt: null,
            lastFailure: null,
          },
          billing: {
            reservation: {
              estimatedSec: billingMsToSeconds(estimatedMs),
              reservedSec: billingMsToSeconds(estimatedMs),
              estimatedMs,
              reservedMs: estimatedMs,
            },
            settlement: null,
          },
          result: {
            shortId: null,
            status: FINALIZE_ACCEPTED_STATUS,
            failure: null,
          },
          projection: {
            renderRecovery: buildRenderRecoveryProjection({
              state: 'pending',
              attemptId,
              previous:
                reservationSession?.renderRecovery &&
                typeof reservationSession.renderRecovery === 'object'
                  ? reservationSession.renderRecovery
                  : {},
              shortId: null,
              error: null,
            }),
          },
          currentExecution: buildCurrentExecutionSummary(executionAttempt),
          executionAttempts: [serializeExecutionAttempt(executionAttempt)],
        },
        attemptDocId(uid, attemptId)
      );

      tx.set(attemptRef(uid, attemptId), {
        flow: FLOW,
        uid,
        attemptId,
        sessionId,
        requestId,
        state: 'queued',
        isActive: true,
        status: FINALIZE_ACCEPTED_STATUS,
        shortId: null,
        createdAt,
        updatedAt: createdAt,
        enqueuedAt: createdAt,
        expiresAt,
        availableAfter,
        usageReservation: {
          estimatedSec: billingMsToSeconds(estimatedMs),
          reservedSec: billingMsToSeconds(estimatedMs),
          estimatedMs,
          reservedMs: estimatedMs,
        },
        billingSettlement: null,
        failure: null,
        runnerId: null,
        leaseHeartbeatAt: null,
        leaseExpiresAt: null,
        ...serializeCanonicalFields(queuedAttempt),
      });

      tx.set(lockRef, {
        flow: FLOW,
        uid,
        sessionId,
        attemptId,
        state: 'queued',
        createdAt,
        updatedAt: createdAt,
        expiresAt,
      });

      tx.set(
        userRef,
        {
          plan: accountState.plan,
          membership: accountState.membership,
          usage: {
            ...applyUsageDelta(
              usage,
              {
                reservedDeltaMs: estimatedMs,
              },
              accountState.plan
            ),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return {
        kind: 'enqueued',
        attempt: queuedAttempt,
      };
    });

    if (txResult?.kind === 'conflict') {
      return { kind: 'active_other_key', attempt: txResult.attempt };
    }

    if (txResult?.kind === 'replay_same_key') {
      switch (txResult.attempt?.state) {
        case 'done':
          return { kind: 'done_same_key', attempt: txResult.attempt };
        case 'failed':
        case 'expired':
          return { kind: 'failed_same_key', attempt: txResult.attempt };
        default:
          return { kind: 'active_same_key', attempt: txResult.attempt };
      }
    }

    return {
      kind: 'enqueued',
      session: reservationSession,
      attempt: txResult.attempt,
    };
  } catch (error) {
    if (error?.status === 402 || error?.code === 'INSUFFICIENT_RENDER_TIME') {
      return {
        kind: 'error',
        status: 402,
        error: error?.code || 'INSUFFICIENT_RENDER_TIME',
        detail: error?.message || 'Insufficient render time for render.',
      };
    }
    if (error?.status === 404 || error?.code === 'USER_NOT_FOUND') {
      return {
        kind: 'error',
        status: 404,
        error: error?.code || 'USER_NOT_FOUND',
        detail: error?.message || 'User account not found.',
      };
    }
    throw error;
  }
}

export async function buildFinalizeHttpReply({ req, uid, sessionId, getSession, prepared }) {
  if (!prepared) return null;

  switch (prepared.kind) {
    case 'enqueued': {
      return {
        status: FINALIZE_ACCEPTED_STATUS,
        body: finalizeAcceptedEnvelope(req, prepared.session, {
          attemptId: prepared.attempt.attemptId,
          pollSessionId: sessionId,
        }),
      };
    }
    case 'active_same_key': {
      const session = await loadReplaySession({
        uid,
        attempt: prepared.attempt,
        fallbackSessionId: sessionId,
        getSession,
      });
      if (session == null) {
        return {
          status: 404,
          body: {
            success: false,
            error: 'SESSION_NOT_FOUND',
            detail: 'Session no longer available for replay.',
            requestId: requestIdOf(req),
          },
        };
      }
      return {
        status: FINALIZE_ACCEPTED_STATUS,
        body: finalizeAcceptedEnvelope(req, session, {
          attemptId: prepared.attempt.attemptId,
          pollSessionId: prepared.attempt.sessionId || sessionId,
        }),
      };
    }
    case 'active_other_key': {
      return {
        status: 409,
        body: finalizeConflictEnvelope(req, {
          attemptId: prepared.attempt.attemptId,
          pollSessionId: prepared.attempt.sessionId || sessionId,
        }),
      };
    }
    case 'done_same_key': {
      const session = await loadReplaySession({
        uid,
        attempt: prepared.attempt,
        fallbackSessionId: sessionId,
        getSession,
      });
      if (session == null) {
        return {
          status: 404,
          body: {
            success: false,
            error: 'SESSION_NOT_FOUND',
            detail: 'Session no longer available for replay.',
            requestId: requestIdOf(req),
          },
        };
      }
      return {
        status: prepared.attempt.status || 200,
        body: finalizeSuccessEnvelope(
          req,
          attachBillingToSession(session, prepared.attempt.billingSettlement),
          prepared.attempt.shortId ?? null
        ),
      };
    }
    case 'failed_same_key': {
      return {
        status: prepared.attempt.status || 500,
        body: finalizeFailureReplayEnvelope(req, prepared.attempt),
      };
    }
    case 'overloaded': {
      return {
        status: 503,
        headers: {
          'Retry-After': String(prepared.retryAfterSec || FINALIZE_BUSY_RETRY_MS / 1000),
        },
        body: {
          success: false,
          error: 'SERVER_BUSY',
          detail: 'Finalize backlog is busy. Please retry shortly.',
          requestId: requestIdOf(req),
        },
      };
    }
    default:
      return null;
  }
}

export async function finalizeAttemptFailure({
  uid,
  attemptId,
  status,
  error,
  detail,
  state = 'failed',
  stage = FINALIZE_STAGES.PERSIST_RECOVERY,
  executionState = 'failed_terminal',
  failureReason = null,
  emitObservability = true,
}) {
  const now = new Date();
  const currentAttempt = await getFinalizeAttempt({ uid, attemptId });
  if (!currentAttempt) return null;
  if (!FINALIZE_ACTIVE_STATES.has(currentAttempt.state)) {
    return currentAttempt;
  }

  await db.runTransaction(async (tx) => {
    const docRef = attemptRef(uid, attemptId);
    const currentSnap = await tx.get(docRef);
    if (!currentSnap.exists) return;
    const current = normalizeAttempt(currentSnap.data(), currentSnap.id);
    if (!FINALIZE_ACTIVE_STATES.has(current?.state)) return;
    const activeExecution = getCurrentExecutionAttempt(current);
    const failurePayload = {
      error,
      detail,
      failedAt: now,
    };
    const executionAttempts = activeExecution
      ? updateExecutionAttempt(current, activeExecution.executionAttemptId, (execution) => ({
          ...execution,
          state: executionState,
          workerId: current.runnerId || execution.workerId || null,
          finishedAt: now,
          failure: failurePayload,
          lease: {
            heartbeatAt: null,
            expiresAt: null,
          },
        }))
      : current.executionAttempts;
    const currentExecution =
      executionAttempts.find(
        (execution) => execution.executionAttemptId === activeExecution?.executionAttemptId
      ) || activeExecution;
    const updatedAttempt = {
      ...current,
      state,
      isActive: false,
      status,
      failure: failurePayload,
      finishedAt: now.toISOString(),
      updatedAt: now.toISOString(),
      runnerId: null,
      leaseHeartbeatAt: null,
      leaseExpiresAt: null,
      jobState: 'failed_terminal',
      currentStage: stage,
      retry: {
        ...(current.retry || {}),
        lastFailure: {
          error,
          detail,
          failedAt: now.toISOString(),
          executionAttemptId: activeExecution?.executionAttemptId ?? null,
        },
      },
      result: {
        ...(current.result || {}),
        shortId: current.shortId ?? null,
        status,
        failure: failurePayload,
      },
      projection: {
        ...(current.projection || {}),
        renderRecovery: buildCanonicalProjection({
          attempt: current,
          state: 'failed',
          error: { code: error, message: detail },
        }),
      },
      currentExecution: buildCurrentExecutionSummary(currentExecution),
      executionAttempts,
      executionAttemptId: currentExecution?.executionAttemptId ?? null,
    };

    const reservedMs = secondsToBillingMs(
      current?.usageReservation?.reservedSec ?? current?.usageReservation?.reservedMs ?? 0
    );
    const userRef = db.collection('users').doc(uid);
    const userSnap = await tx.get(userRef);
    if (userSnap.exists) {
      const userData = userSnap.data() || {};
      const accountState = buildCanonicalUsageState(userData);
      tx.set(
        userRef,
        {
          plan: accountState.plan,
          membership: accountState.membership,
          usage: {
            ...applyUsageDelta(
              accountState.usage,
              {
                reservedDeltaMs: -reservedMs,
              },
              accountState.plan
            ),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    tx.set(
      docRef,
      {
        state: updatedAttempt.state,
        isActive: updatedAttempt.isActive,
        status: updatedAttempt.status,
        failure: updatedAttempt.failure,
        finishedAt: now,
        updatedAt: now,
        runnerId: null,
        leaseHeartbeatAt: null,
        leaseExpiresAt: null,
        ...serializeCanonicalFields(updatedAttempt),
      },
      { merge: true }
    );
    tx.delete(sessionLockRef(uid, current.sessionId));
  });

  logger.warn('story.finalize.attempt.released', {
    attemptId,
    sessionId: currentAttempt.sessionId,
    status,
    error,
  });
  const attempt = await getFinalizeAttempt({ uid, attemptId });
  const failureDetails = describeFinalizeError(
    { code: error, status, message: detail },
    {
      errorCode: error,
      httpStatus: status,
      retryable: false,
      failureReason: state === 'expired' ? 'attempt_expired' : 'terminal_failure',
    }
  );
  if (emitObservability) {
    emitFinalizeEvent('warn', FINALIZE_EVENTS.JOB_FAILED, {
      sourceRole: FINALIZE_SOURCE_ROLES.WORKER,
      requestId: attempt?.requestId ?? currentAttempt.requestId ?? null,
      uid,
      sessionId: attempt?.sessionId ?? currentAttempt.sessionId,
      attemptId,
      finalizeJobId: attempt?.jobId ?? attemptId,
      executionAttemptId: attempt?.executionAttemptId ?? currentAttempt.executionAttemptId ?? null,
      jobState: attempt?.jobState ?? 'failed_terminal',
      stage,
      shortId: attempt?.shortId ?? null,
      durationMs:
        Number.isFinite(toMillis(attempt?.finishedAt)) &&
        Number.isFinite(toMillis(attempt?.enqueuedAt))
          ? toMillis(attempt.finishedAt) - toMillis(attempt.enqueuedAt)
          : null,
      ...failureDetails,
      failureReason: failureReason || failureDetails.failureReason,
    });
  }
  safeRefreshFinalizeQueueMetrics();
  return attempt;
}

export async function settleFinalizeAttemptSuccess({
  uid,
  attemptId,
  session,
  shortId,
  status = 200,
}) {
  const currentAttempt = await getFinalizeAttempt({ uid, attemptId });
  if (!currentAttempt) {
    throw Object.assign(new Error('FINALIZE_ATTEMPT_NOT_FOUND'), {
      code: 'FINALIZE_ATTEMPT_NOT_FOUND',
      status: 500,
    });
  }
  if (currentAttempt.state === 'done') {
    return {
      attempt: currentAttempt,
      session: attachBillingToSession(session, currentAttempt.billingSettlement),
    };
  }
  if (!FINALIZE_ACTIVE_STATES.has(currentAttempt.state)) {
    throw Object.assign(new Error('FINALIZE_ATTEMPT_NOT_ACTIVE'), {
      code: 'FINALIZE_ATTEMPT_NOT_ACTIVE',
      status: 409,
    });
  }

  const estimatedMs = secondsToBillingMs(
    currentAttempt?.usageReservation?.estimatedSec ??
      currentAttempt?.usageReservation?.estimatedMs ??
      0
  );
  const billedMs = getBilledMsFromSession(session);
  if (!billedMs) {
    throw Object.assign(new Error('BILLING_DURATION_UNAVAILABLE'), {
      code: 'BILLING_DURATION_UNAVAILABLE',
      status: 500,
    });
  }
  const estimatedSec = billingMsToSeconds(estimatedMs);
  const billedSec = billingMsToSeconds(billedMs);
  if (estimatedMs > 0 && billedMs > estimatedMs) {
    emitFinalizeEvent('error', FINALIZE_EVENTS.JOB_FAILED, {
      sourceRole: FINALIZE_SOURCE_ROLES.WORKER,
      requestId: currentAttempt.requestId ?? null,
      uid,
      sessionId: currentAttempt.sessionId,
      attemptId,
      jobState: currentAttempt.state,
      stage: FINALIZE_STAGES.BILLING_SETTLE,
      estimatedSec,
      reservedSec: billingMsToSeconds(
        secondsToBillingMs(
          currentAttempt?.usageReservation?.reservedSec ??
            currentAttempt?.usageReservation?.reservedMs ??
            0
        )
      ),
      billedSec,
      settlementState: 'mismatch',
      usageLedgerApplied: false,
      billingMismatch: true,
      ...describeFinalizeError(
        { code: 'BILLING_ESTIMATE_TOO_LOW', status: 500 },
        {
          retryable: false,
          failureReason: 'billing_estimate_too_low',
        }
      ),
    });
    throw Object.assign(
      new Error(`Billed render time ${billedSec}s exceeded reserved estimate ${estimatedSec}s.`),
      {
        code: 'BILLING_ESTIMATE_TOO_LOW',
        status: 500,
      }
    );
  }

  const settledAt = new Date();
  const shortRef = shortId ? db.collection('shorts').doc(shortId) : null;
  await db.runTransaction(async (tx) => {
    const docRef = attemptRef(uid, attemptId);
    const docSnap = await tx.get(docRef);
    if (!docSnap.exists) {
      const err = new Error('FINALIZE_ATTEMPT_NOT_FOUND');
      err.code = 'FINALIZE_ATTEMPT_NOT_FOUND';
      err.status = 500;
      throw err;
    }
    const attempt = normalizeAttempt(docSnap.data(), docSnap.id);
    if (attempt.state === 'done') return;
    if (!FINALIZE_ACTIVE_STATES.has(attempt.state)) {
      const err = new Error('FINALIZE_ATTEMPT_NOT_ACTIVE');
      err.code = 'FINALIZE_ATTEMPT_NOT_ACTIVE';
      err.status = 409;
      throw err;
    }

    const userRef = db.collection('users').doc(uid);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) {
      const err = new Error('User not found');
      err.code = 'USER_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    const userData = userSnap.data() || {};
    const accountState = buildCanonicalUsageState(userData);
    const reservedMs = secondsToBillingMs(
      attempt?.usageReservation?.reservedSec ?? attempt?.usageReservation?.reservedMs ?? 0
    );
    const activeExecution = getCurrentExecutionAttempt(attempt);
    const executionAttempts = activeExecution
      ? updateExecutionAttempt(attempt, activeExecution.executionAttemptId, (execution) => ({
          ...execution,
          state: 'succeeded',
          workerId: attempt.runnerId || execution.workerId || null,
          finishedAt: settledAt,
          failure: null,
          lease: {
            heartbeatAt: null,
            expiresAt: null,
          },
        }))
      : attempt.executionAttempts;
    const currentExecution =
      executionAttempts.find(
        (execution) => execution.executionAttemptId === activeExecution?.executionAttemptId
      ) || activeExecution;
    const settlement = {
      billedSec,
      billedMs,
      settledAt,
    };
    const updatedAttempt = {
      ...attempt,
      state: 'done',
      isActive: false,
      status,
      shortId: shortId ?? null,
      billingSettlement: settlement,
      failure: null,
      finishedAt: settledAt.toISOString(),
      updatedAt: settledAt.toISOString(),
      runnerId: null,
      leaseHeartbeatAt: null,
      leaseExpiresAt: null,
      jobState: 'settled',
      currentStage: FINALIZE_STAGES.BILLING_SETTLE,
      billing: {
        ...(attempt.billing || {}),
        reservation: cloneValue(attempt?.billing?.reservation ?? attempt.usageReservation ?? null),
        settlement,
      },
      result: {
        ...(attempt.result || {}),
        shortId: shortId ?? null,
        status,
        failure: null,
      },
      projection: {
        ...(attempt.projection || {}),
        renderRecovery: buildCanonicalProjection({
          attempt,
          state: 'done',
          shortId: shortId ?? null,
        }),
      },
      currentExecution: buildCurrentExecutionSummary(currentExecution),
      executionAttempts,
      executionAttemptId: currentExecution?.executionAttemptId ?? null,
    };
    tx.set(
      userRef,
      {
        plan: accountState.plan,
        membership: accountState.membership,
        usage: {
          ...applyUsageDelta(
            accountState.usage,
            {
              usedDeltaMs: billedMs,
              reservedDeltaMs: -reservedMs,
            },
            accountState.plan
          ),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.set(
      docRef,
      {
        state: updatedAttempt.state,
        isActive: updatedAttempt.isActive,
        status: updatedAttempt.status,
        shortId: updatedAttempt.shortId,
        billingSettlement: updatedAttempt.billingSettlement,
        failure: null,
        finishedAt: settledAt,
        updatedAt: settledAt,
        runnerId: null,
        leaseHeartbeatAt: null,
        leaseExpiresAt: null,
        ...serializeCanonicalFields(updatedAttempt),
      },
      { merge: true }
    );

    tx.delete(sessionLockRef(uid, attempt.sessionId));

    if (shortRef) {
      tx.set(
        shortRef,
        {
          finalizeAttemptId: attemptId,
          billing: {
            estimatedSec: billingMsToSeconds(reservedMs),
            billedSec,
            settledAt: admin.firestore.FieldValue.serverTimestamp(),
            source: 'finalVideo.durationSec*0.5',
          },
        },
        { merge: true }
      );
    }
  });

  const attempt = await getFinalizeAttempt({ uid, attemptId });
  logger.info('story.finalize.idempotency.settled', {
    sessionId: currentAttempt.sessionId,
    attemptId,
    estimatedSec,
    billedSec,
    shortId: shortId ?? null,
  });
  emitFinalizeEvent('info', FINALIZE_EVENTS.JOB_SETTLED, {
    sourceRole: FINALIZE_SOURCE_ROLES.WORKER,
    requestId: attempt?.requestId ?? currentAttempt.requestId ?? null,
    uid,
    sessionId: currentAttempt.sessionId,
    attemptId,
    shortId: shortId ?? null,
    finalizeJobId: attempt?.jobId ?? attemptId,
    executionAttemptId: attempt?.executionAttemptId ?? currentAttempt.executionAttemptId ?? null,
    jobState: attempt?.jobState ?? 'settled',
    stage: FINALIZE_STAGES.BILLING_SETTLE,
    estimatedSec,
    reservedSec: billingMsToSeconds(
      secondsToBillingMs(
        currentAttempt?.usageReservation?.reservedSec ??
          currentAttempt?.usageReservation?.reservedMs ??
          0
      )
    ),
    billedSec,
    settlementState: 'settled',
    usageLedgerApplied: true,
    billingMismatch: false,
    durationMs:
      Number.isFinite(toMillis(attempt?.finishedAt)) &&
      Number.isFinite(toMillis(attempt?.enqueuedAt))
        ? toMillis(attempt.finishedAt) - toMillis(attempt.enqueuedAt)
        : null,
  });
  safeRefreshFinalizeQueueMetrics();
  return {
    attempt,
    session: attachBillingToSession(session, attempt?.billingSettlement),
  };
}

export async function markFinalizeAttemptQueuedForRetry({
  uid,
  attemptId,
  runnerId,
  retryAfterMs = FINALIZE_BUSY_RETRY_MS,
}) {
  const retryAt = new Date(Date.now() + retryAfterMs);
  await db.runTransaction(async (tx) => {
    const docRef = attemptRef(uid, attemptId);
    const docSnap = await tx.get(docRef);
    if (!docSnap.exists) return;
    const attempt = normalizeAttempt(docSnap.data(), docSnap.id);
    if (attempt.state !== 'running') return;
    if (attempt.runnerId && runnerId && attempt.runnerId !== runnerId) return;
    const currentExecution = getCurrentExecutionAttempt(attempt);
    const executionAttempts = currentExecution
      ? updateExecutionAttempt(attempt, currentExecution.executionAttemptId, (execution) => ({
          ...execution,
          state: 'failed_retryable',
          workerId: runnerId ?? execution.workerId ?? null,
          finishedAt: new Date(),
          failure: {
            error: 'SERVER_BUSY',
            detail: 'Finalize worker was busy and rescheduled the job.',
            failedAt: new Date(),
          },
          lease: {
            heartbeatAt: null,
            expiresAt: null,
          },
        }))
      : attempt.executionAttempts;
    const appended = appendExecutionAttempt(
      {
        ...attempt,
        executionAttempts,
      },
      {
        state: 'created',
        createdAt: new Date(),
        workerId: null,
        lease: {
          heartbeatAt: null,
          expiresAt: null,
        },
      }
    );
    const updatedAttempt = {
      ...appended.attempt,
      state: 'queued',
      updatedAt: new Date().toISOString(),
      availableAfter: retryAt.toISOString(),
      runnerId: null,
      leaseHeartbeatAt: null,
      leaseExpiresAt: null,
      jobState: 'retry_scheduled',
      currentStage: FINALIZE_STAGES.QUEUE_WAIT,
      queue: {
        ...(attempt.queue || {}),
        availableAfter: retryAt.toISOString(),
        lastQueuedAt: new Date().toISOString(),
      },
      retry: {
        ...(attempt.retry || {}),
        count: Number(attempt?.retry?.count || 0) + 1,
        scheduledAt: retryAt.toISOString(),
        lastFailure: {
          error: 'SERVER_BUSY',
          detail: 'Finalize worker was busy and rescheduled the job.',
          failedAt: new Date().toISOString(),
          executionAttemptId: currentExecution?.executionAttemptId ?? null,
        },
      },
      result: {
        ...(attempt.result || {}),
        status: attempt.status,
      },
      projection: {
        ...(attempt.projection || {}),
        renderRecovery: buildCanonicalProjection({
          attempt,
          state: 'pending',
        }),
      },
      executionAttemptId: appended.execution.executionAttemptId,
    };

    tx.set(
      docRef,
      {
        state: updatedAttempt.state,
        updatedAt: new Date(),
        availableAfter: retryAt,
        runnerId: null,
        leaseHeartbeatAt: null,
        leaseExpiresAt: null,
        ...serializeCanonicalFields(updatedAttempt),
      },
      { merge: true }
    );
    tx.set(
      sessionLockRef(uid, attempt.sessionId),
      {
        flow: FLOW,
        uid,
        sessionId: attempt.sessionId,
        attemptId,
        state: 'queued',
        updatedAt: new Date(),
        expiresAt: attempt.expiresAt ? new Date(attempt.expiresAt) : null,
      },
      { merge: true }
    );
  });
  const attempt = await getFinalizeAttempt({ uid, attemptId });
  emitFinalizeEvent('warn', FINALIZE_EVENTS.JOB_RETRY_SCHEDULED, {
    sourceRole: FINALIZE_SOURCE_ROLES.WORKER,
    requestId: attempt?.requestId ?? null,
    uid,
    sessionId: attempt?.sessionId ?? null,
    attemptId,
    finalizeJobId: attempt?.jobId ?? attemptId,
    executionAttemptId: attempt?.executionAttemptId ?? null,
    workerId: runnerId ?? null,
    jobState: attempt?.jobState ?? 'retry_scheduled',
    stage: FINALIZE_STAGES.QUEUE_WAIT,
    retryAfterMs,
    ...describeFinalizeError(
      { code: 'SERVER_BUSY', status: 503 },
      {
        retryable: true,
        failureReason: 'server_busy',
      }
    ),
  });
  safeRefreshFinalizeQueueMetrics();
}

export async function claimNextFinalizeAttempt({ runnerId, leaseMs = FINALIZE_RUNNER_LEASE_MS }) {
  const snapshot = await db
    .collection(ATTEMPTS_COLLECTION)
    .where('flow', '==', FLOW)
    .where('state', '==', 'queued')
    .orderBy('createdAt', 'asc')
    .limit(10)
    .get();

  for (const doc of snapshot.docs) {
    const attempt = normalizeAttempt(doc.data(), doc.id);
    const availableAfterMs = toMillis(attempt?.availableAfter);
    if (Number.isFinite(availableAfterMs) && availableAfterMs > Date.now()) {
      continue;
    }

    const claimed = await db.runTransaction(async (tx) => {
      const docRef = attemptRef(attempt.uid, attempt.attemptId);
      const currentSnap = await tx.get(docRef);
      if (!currentSnap.exists) return null;
      const current = normalizeAttempt(currentSnap.data(), currentSnap.id);
      if (current.state !== 'queued') return null;

      const now = new Date();
      const leaseExpiresAt = new Date(now.getTime() + leaseMs);
      const activeExecution = getCurrentExecutionAttempt(current);
      const executionAttempts = activeExecution
        ? updateExecutionAttempt(current, activeExecution.executionAttemptId, (execution) => ({
            ...execution,
            state: 'claimed',
            workerId: runnerId,
            claimedAt: now,
            lease: {
              heartbeatAt: now,
              expiresAt: leaseExpiresAt,
            },
          }))
        : current.executionAttempts;
      const currentExecution =
        executionAttempts.find(
          (execution) => execution.executionAttemptId === activeExecution?.executionAttemptId
        ) || activeExecution;
      const claimedAttempt = {
        ...current,
        state: 'running',
        updatedAt: now.toISOString(),
        startedAt: current.startedAt || now.toISOString(),
        runnerId,
        leaseHeartbeatAt: now.toISOString(),
        leaseExpiresAt: leaseExpiresAt.toISOString(),
        availableAfter: null,
        jobState: 'claimed',
        currentStage: FINALIZE_STAGES.WORKER_CLAIM,
        queue: {
          ...(current.queue || {}),
          availableAfter: null,
          claimedAt: now.toISOString(),
        },
        currentExecution: buildCurrentExecutionSummary(currentExecution),
        executionAttempts,
        executionAttemptId: currentExecution?.executionAttemptId ?? null,
      };
      tx.set(
        docRef,
        {
          state: claimedAttempt.state,
          updatedAt: now,
          startedAt: current.startedAt ? new Date(current.startedAt) : now,
          runnerId,
          leaseHeartbeatAt: now,
          leaseExpiresAt,
          availableAfter: null,
          ...serializeCanonicalFields(claimedAttempt),
        },
        { merge: true }
      );
      tx.set(
        sessionLockRef(current.uid, current.sessionId),
        {
          flow: FLOW,
          uid: current.uid,
          sessionId: current.sessionId,
          attemptId: current.attemptId,
          state: 'running',
          updatedAt: now,
          expiresAt: current.expiresAt ? new Date(current.expiresAt) : null,
        },
        { merge: true }
      );
      return claimedAttempt;
    });

    if (claimed) {
      emitFinalizeEvent('info', FINALIZE_EVENTS.JOB_CLAIMED, {
        sourceRole: FINALIZE_SOURCE_ROLES.WORKER,
        requestId: claimed.requestId ?? null,
        uid: claimed.uid,
        sessionId: claimed.sessionId,
        attemptId: claimed.attemptId,
        finalizeJobId: claimed.jobId ?? claimed.attemptId,
        executionAttemptId: claimed.executionAttemptId ?? null,
        workerId: runnerId,
        jobState: claimed.jobState ?? 'claimed',
        stage: FINALIZE_STAGES.WORKER_CLAIM,
        queuedAt: claimed.enqueuedAt,
        startedAt: claimed.startedAt,
        durationMs:
          Number.isFinite(toMillis(claimed.startedAt)) &&
          Number.isFinite(toMillis(claimed.enqueuedAt))
            ? toMillis(claimed.startedAt) - toMillis(claimed.enqueuedAt)
            : null,
      });
      safeRefreshFinalizeQueueMetrics();
      return claimed;
    }
  }

  return null;
}

export async function markFinalizeAttemptStarted({
  uid,
  attemptId,
  runnerId,
  stage = FINALIZE_STAGES.WORKER_CLAIM,
}) {
  const now = new Date();
  await db.runTransaction(async (tx) => {
    const docRef = attemptRef(uid, attemptId);
    const docSnap = await tx.get(docRef);
    if (!docSnap.exists) return;
    const attempt = normalizeAttempt(docSnap.data(), docSnap.id);
    if (attempt.state !== 'running') return;
    if (attempt.runnerId && runnerId && attempt.runnerId !== runnerId) return;
    const activeExecution = getCurrentExecutionAttempt(attempt);
    if (!activeExecution) return;
    const executionAttempts = updateExecutionAttempt(
      attempt,
      activeExecution.executionAttemptId,
      (execution) => ({
        ...execution,
        state: 'running',
        workerId: runnerId ?? execution.workerId ?? null,
        startedAt: execution.startedAt ?? now,
        lease: {
          heartbeatAt: attempt.leaseHeartbeatAt ?? now,
          expiresAt: attempt.leaseExpiresAt ?? null,
        },
      })
    );
    const currentExecution =
      executionAttempts.find(
        (execution) => execution.executionAttemptId === activeExecution.executionAttemptId
      ) || activeExecution;
    const updatedAttempt = {
      ...attempt,
      jobState: 'started',
      currentStage: stage,
      currentExecution: buildCurrentExecutionSummary(currentExecution),
      executionAttempts,
      executionAttemptId: currentExecution.executionAttemptId,
    };
    tx.set(
      docRef,
      {
        startedAt: attempt.startedAt ? new Date(attempt.startedAt) : now,
        updatedAt: now,
        ...serializeCanonicalFields(updatedAttempt),
      },
      { merge: true }
    );
  });
  return await getFinalizeAttempt({ uid, attemptId });
}

export async function heartbeatFinalizeAttempt({
  uid,
  attemptId,
  runnerId,
  leaseMs = FINALIZE_RUNNER_LEASE_MS,
}) {
  await db.runTransaction(async (tx) => {
    const docRef = attemptRef(uid, attemptId);
    const docSnap = await tx.get(docRef);
    if (!docSnap.exists) return;
    const attempt = normalizeAttempt(docSnap.data(), docSnap.id);
    if (attempt.state !== 'running') return;
    if (attempt.runnerId && runnerId && attempt.runnerId !== runnerId) return;

    const now = new Date();
    const activeExecution = getCurrentExecutionAttempt(attempt);
    const executionAttempts =
      activeExecution && activeExecution.executionAttemptId
        ? updateExecutionAttempt(attempt, activeExecution.executionAttemptId, (execution) => ({
            ...execution,
            workerId: runnerId ?? execution.workerId ?? null,
            lease: {
              heartbeatAt: now,
              expiresAt: new Date(now.getTime() + leaseMs),
            },
          }))
        : attempt.executionAttempts;
    const currentExecution =
      executionAttempts.find(
        (execution) => execution.executionAttemptId === activeExecution?.executionAttemptId
      ) || activeExecution;
    const updatedAttempt = {
      ...attempt,
      updatedAt: now.toISOString(),
      leaseHeartbeatAt: now.toISOString(),
      leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
      jobState: attempt.jobState === 'claimed' ? 'started' : attempt.jobState,
      currentExecution: buildCurrentExecutionSummary(currentExecution),
      executionAttempts,
      executionAttemptId: currentExecution?.executionAttemptId ?? null,
    };
    tx.set(
      docRef,
      {
        updatedAt: now,
        leaseHeartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
        ...serializeCanonicalFields(updatedAttempt),
      },
      { merge: true }
    );
  });
  const attempt = await getFinalizeAttempt({ uid, attemptId });
  emitFinalizeEvent('debug', FINALIZE_EVENTS.WORKER_HEARTBEAT, {
    sourceRole: FINALIZE_SOURCE_ROLES.WORKER,
    requestId: attempt?.requestId ?? null,
    uid,
    sessionId: attempt?.sessionId ?? null,
    attemptId,
    finalizeJobId: attempt?.jobId ?? attemptId,
    executionAttemptId: attempt?.executionAttemptId ?? null,
    workerId: runnerId ?? null,
    jobState: attempt?.jobState ?? null,
  });
}

export async function reapStaleFinalizeAttempts() {
  const snapshot = await db
    .collection(ATTEMPTS_COLLECTION)
    .where('flow', '==', FLOW)
    .where('isActive', '==', true)
    .limit(100)
    .get();

  for (const doc of snapshot.docs) {
    const attempt = normalizeAttempt(doc.data(), doc.id);
    if (!attempt) continue;

    const expiresAtMs = toMillis(attempt.expiresAt);
    if (attempt.state === 'queued' && Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
      await finalizeAttemptFailure({
        uid: attempt.uid,
        attemptId: attempt.attemptId,
        status: 500,
        error: 'FINALIZE_ATTEMPT_EXPIRED',
        detail: 'Finalize attempt expired before completion.',
        state: 'expired',
      });
      emitFinalizeEvent('warn', FINALIZE_EVENTS.WORKER_HEARTBEAT_MISSED, {
        sourceRole: FINALIZE_SOURCE_ROLES.WORKER,
        requestId: attempt.requestId ?? null,
        uid: attempt.uid,
        sessionId: attempt.sessionId,
        attemptId: attempt.attemptId,
        finalizeJobId: attempt.jobId ?? attempt.attemptId,
        executionAttemptId: attempt.executionAttemptId ?? null,
        workerId: attempt.runnerId ?? null,
        jobState: attempt.jobState ?? attempt.state,
        stage: FINALIZE_STAGES.QUEUE_WAIT,
        ...describeFinalizeError(
          { code: 'FINALIZE_ATTEMPT_EXPIRED', status: 500 },
          {
            retryable: false,
            failureReason: 'attempt_expired',
          }
        ),
      });
      await persistStoryRenderRecovery({
        uid: attempt.uid,
        sessionId: attempt.sessionId,
        attemptId: attempt.attemptId,
        state: 'failed',
        error: {
          code: 'FINALIZE_ATTEMPT_EXPIRED',
          message: 'Finalize attempt expired before completion.',
        },
      }).catch(() => {});
      continue;
    }

    const leaseExpiresAtMs = toMillis(attempt.leaseExpiresAt);
    if (
      attempt.state === 'running' &&
      Number.isFinite(leaseExpiresAtMs) &&
      leaseExpiresAtMs <= Date.now()
    ) {
      emitFinalizeEvent('warn', FINALIZE_EVENTS.WORKER_HEARTBEAT_MISSED, {
        sourceRole: FINALIZE_SOURCE_ROLES.WORKER,
        requestId: attempt.requestId ?? null,
        uid: attempt.uid,
        sessionId: attempt.sessionId,
        attemptId: attempt.attemptId,
        finalizeJobId: attempt.jobId ?? attempt.attemptId,
        executionAttemptId: attempt.executionAttemptId ?? null,
        workerId: attempt.runnerId ?? null,
        jobState: attempt.jobState ?? attempt.state,
        stage: FINALIZE_STAGES.RENDER_VIDEO,
        ...describeFinalizeError(
          { code: 'FINALIZE_WORKER_LOST', status: 500 },
          {
            retryable: false,
            failureReason: 'worker_lease_expired',
          }
        ),
      });
      await finalizeAttemptFailure({
        uid: attempt.uid,
        attemptId: attempt.attemptId,
        status: 500,
        error: 'FINALIZE_WORKER_LOST',
        detail: 'Finalize worker stopped before completion.',
        executionState: 'abandoned',
      });
      await persistStoryRenderRecovery({
        uid: attempt.uid,
        sessionId: attempt.sessionId,
        attemptId: attempt.attemptId,
        state: 'failed',
        error: {
          code: 'FINALIZE_WORKER_LOST',
          message: 'Finalize worker stopped before completion.',
        },
      }).catch(() => {});
    }
  }
  safeRefreshFinalizeQueueMetrics();
}
