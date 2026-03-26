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
import { buildCanonicalUsageState, getAvailableSec } from './usage.service.js';
import { persistStoryRenderRecovery, sanitizeStorySessionForClient } from './story.service.js';
import { isOutboundPolicyError } from '../utils/outbound.fetch.js';

const ATTEMPTS_COLLECTION = 'idempotency';
const SESSION_LOCKS_COLLECTION = 'storyFinalizeSessions';
const FLOW = 'story.finalize';
const TEST_MODE = process.env.NODE_ENV === 'test' && process.env.VAIFORM_TEST_MODE === '1';

const numberFromEnv = (name, fallback) => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};

export const FINALIZE_ACCEPTED_STATUS = 202;
export const FINALIZE_ACTIVE_STATES = new Set(['queued', 'running']);
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
const attemptRef = (uid, attemptId) => db.collection(ATTEMPTS_COLLECTION).doc(attemptDocId(uid, attemptId));
const sessionLockRef = (uid, sessionId) =>
  db.collection(SESSION_LOCKS_COLLECTION).doc(`${uid}:${sessionId}`);

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

const getEstimatedSecFromSession = (session) => {
  const estimatedSec = Number(session?.billingEstimate?.estimatedSec);
  return Number.isFinite(estimatedSec) && estimatedSec > 0 ? Math.ceil(estimatedSec) : null;
};

const getBilledSecFromSession = (session) => {
  const durationSec = Number(session?.finalVideo?.durationSec);
  return Number.isFinite(durationSec) && durationSec > 0 ? Math.ceil(durationSec) : null;
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
    typeof pollSessionId === 'string' && pollSessionId.trim().length > 0 ? pollSessionId.trim() : null,
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
  return {
    id,
    flow: data.flow || null,
    uid: data.uid || null,
    attemptId: data.attemptId || null,
    sessionId: data.sessionId || null,
    state: data.state || null,
    status: Number.isFinite(Number(data.status)) ? Number(data.status) : null,
    isActive: data.isActive === true,
    shortId: data.shortId ?? null,
    requestId: data.requestId ?? null,
    usageReservation: data.usageReservation || null,
    billingSettlement: data.billingSettlement || null,
    failure: data.failure || null,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    enqueuedAt: toIso(data.enqueuedAt),
    startedAt: toIso(data.startedAt),
    finishedAt: toIso(data.finishedAt),
    expiresAt: toIso(data.expiresAt),
    availableAfter: toIso(data.availableAfter),
    leaseHeartbeatAt: toIso(data.leaseHeartbeatAt),
    leaseExpiresAt: toIso(data.leaseExpiresAt),
    runnerId: data.runnerId || null,
    };
}

export async function captureFinalizeQueueMetricsSnapshot({ now = Date.now() } = {}) {
  const snapshot = await db
    .collection(ATTEMPTS_COLLECTION)
    .where('flow', '==', FLOW)
    .get();

  let queueDepth = 0;
  let jobsRunning = 0;
  let jobsRetryScheduled = 0;
  let oldestQueuedAtMs = null;
  let billingUnsettledJobs = 0;
  for (const doc of snapshot.docs) {
    const attempt = normalizeAttempt(doc.data(), doc.id);
    if (!attempt) continue;
    if (attempt.isActive !== true) continue;
    billingUnsettledJobs += 1;
    if (attempt.state === 'queued') {
      queueDepth += 1;
      const createdAtMs = toMillis(attempt.createdAt);
      if (Number.isFinite(createdAtMs)) {
        oldestQueuedAtMs =
          oldestQueuedAtMs == null ? createdAtMs : Math.min(oldestQueuedAtMs, createdAtMs);
      }
      const availableAfterMs = toMillis(attempt.availableAfter);
      if (Number.isFinite(availableAfterMs) && availableAfterMs > now) {
        jobsRetryScheduled += 1;
      }
    }
    if (attempt.state === 'running') {
      jobsRunning += 1;
    }
  }

  return {
    queueDepth,
    queueOldestAgeSeconds:
      oldestQueuedAtMs == null ? 0 : Math.max(0, Math.floor((now - oldestQueuedAtMs) / 1000)),
    jobsRunning,
    jobsRetryScheduled,
    billingUnsettledJobs,
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

  const estimatedSec = getEstimatedSecFromSession(reservationSession);
  if (!estimatedSec) {
    return {
      kind: 'error',
      status: 409,
      error: 'BILLING_ESTIMATE_UNAVAILABLE',
      detail: 'Render-time estimate is unavailable for this session.',
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
      if (getAvailableSec(usage) < estimatedSec) {
        const err = new Error(`Insufficient render time. You need ${estimatedSec} seconds to render.`);
        err.code = 'INSUFFICIENT_RENDER_TIME';
        err.status = 402;
        throw err;
      }

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
          estimatedSec,
          reservedSec: estimatedSec,
        },
        billingSettlement: null,
        failure: null,
        runnerId: null,
        leaseHeartbeatAt: null,
        leaseExpiresAt: null,
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
            ...usage,
            cycleReservedSec: usage.cycleReservedSec + estimatedSec,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return {
        kind: 'enqueued',
        attempt: normalizeAttempt(
          {
            flow: FLOW,
            uid,
            attemptId,
            sessionId,
            requestId,
            state: 'queued',
            isActive: true,
            status: FINALIZE_ACCEPTED_STATUS,
            createdAt,
            updatedAt: createdAt,
            enqueuedAt: createdAt,
            expiresAt,
            availableAfter,
            usageReservation: {
              estimatedSec,
              reservedSec: estimatedSec,
            },
          },
          attemptDocId(uid, attemptId)
        ),
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

    const reservedSec = Number(current?.usageReservation?.reservedSec || 0);
    const userRef = db.collection('users').doc(uid);
    const userSnap = await tx.get(userRef);
    if (userSnap.exists) {
      const userData = userSnap.data() || {};
      const accountState = buildCanonicalUsageState(userData);
      const usage = accountState.usage;
      tx.set(
        userRef,
        {
          plan: accountState.plan,
          membership: accountState.membership,
          usage: {
            ...usage,
            cycleReservedSec: Math.max(0, usage.cycleReservedSec - reservedSec),
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
        state,
        isActive: false,
        status,
        failure: {
          error,
          detail,
          failedAt: now,
        },
        finishedAt: now,
        updatedAt: now,
        runnerId: null,
        leaseHeartbeatAt: null,
        leaseExpiresAt: null,
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
      jobState: attempt?.state ?? state,
      stage,
      shortId: attempt?.shortId ?? null,
      durationMs:
        Number.isFinite(toMillis(attempt?.finishedAt)) && Number.isFinite(toMillis(attempt?.enqueuedAt))
          ? toMillis(attempt.finishedAt) - toMillis(attempt.enqueuedAt)
          : null,
      ...failureDetails,
      failureReason: failureReason || failureDetails.failureReason,
    });
  }
  safeRefreshFinalizeQueueMetrics();
  return attempt;
}

export async function settleFinalizeAttemptSuccess({ uid, attemptId, session, shortId, status = 200 }) {
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

  const estimatedSec = Number(currentAttempt?.usageReservation?.estimatedSec || 0);
  const billedSec = getBilledSecFromSession(session);
  if (!billedSec) {
    throw Object.assign(new Error('BILLING_DURATION_UNAVAILABLE'), {
      code: 'BILLING_DURATION_UNAVAILABLE',
      status: 500,
    });
  }
  if (estimatedSec > 0 && billedSec > estimatedSec) {
    emitFinalizeEvent('error', FINALIZE_EVENTS.JOB_FAILED, {
      sourceRole: FINALIZE_SOURCE_ROLES.WORKER,
      requestId: currentAttempt.requestId ?? null,
      uid,
      sessionId: currentAttempt.sessionId,
      attemptId,
      jobState: currentAttempt.state,
      stage: FINALIZE_STAGES.BILLING_SETTLE,
      estimatedSec,
      reservedSec: Number(currentAttempt?.usageReservation?.reservedSec || 0),
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
    const usage = accountState.usage;
    const reservedSec = Number(attempt?.usageReservation?.reservedSec || 0);
    tx.set(
      userRef,
      {
        plan: accountState.plan,
        membership: accountState.membership,
        usage: {
          ...usage,
          cycleUsedSec: usage.cycleUsedSec + billedSec,
          cycleReservedSec: Math.max(0, usage.cycleReservedSec - reservedSec),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.set(
      docRef,
      {
        state: 'done',
        isActive: false,
        status,
        shortId: shortId ?? null,
        billingSettlement: {
          billedSec,
          settledAt,
        },
        failure: null,
        finishedAt: settledAt,
        updatedAt: settledAt,
        runnerId: null,
        leaseHeartbeatAt: null,
        leaseExpiresAt: null,
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
            estimatedSec: reservedSec,
            billedSec,
            settledAt: admin.firestore.FieldValue.serverTimestamp(),
            source: 'finalVideo.durationSec',
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
    jobState: attempt?.state ?? 'done',
    stage: FINALIZE_STAGES.BILLING_SETTLE,
    estimatedSec,
    reservedSec: Number(currentAttempt?.usageReservation?.reservedSec || 0),
    billedSec,
    settlementState: 'settled',
    usageLedgerApplied: true,
    billingMismatch: false,
    durationMs:
      Number.isFinite(toMillis(attempt?.finishedAt)) && Number.isFinite(toMillis(attempt?.enqueuedAt))
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

    tx.set(
      docRef,
      {
        state: 'queued',
        updatedAt: new Date(),
        availableAfter: retryAt,
        runnerId: null,
        leaseHeartbeatAt: null,
        leaseExpiresAt: null,
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
    workerId: runnerId ?? null,
    jobState: attempt?.state ?? 'queued',
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
      tx.set(
        docRef,
        {
          state: 'running',
          updatedAt: now,
          startedAt: current.startedAt ? new Date(current.startedAt) : now,
          runnerId,
          leaseHeartbeatAt: now,
          leaseExpiresAt,
          availableAfter: null,
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
      return normalizeAttempt(
        {
          ...current,
          state: 'running',
          updatedAt: now,
          startedAt: current.startedAt || now.toISOString(),
          runnerId,
          leaseHeartbeatAt: now,
          leaseExpiresAt,
          availableAfter: null,
        },
        current.id
      );
    });

    if (claimed) {
      emitFinalizeEvent('info', FINALIZE_EVENTS.JOB_CLAIMED, {
        sourceRole: FINALIZE_SOURCE_ROLES.WORKER,
        requestId: claimed.requestId ?? null,
        uid: claimed.uid,
        sessionId: claimed.sessionId,
        attemptId: claimed.attemptId,
        workerId: runnerId,
        jobState: claimed.state,
        stage: FINALIZE_STAGES.WORKER_CLAIM,
        queuedAt: claimed.enqueuedAt,
        startedAt: claimed.startedAt,
        durationMs:
          Number.isFinite(toMillis(claimed.startedAt)) && Number.isFinite(toMillis(claimed.enqueuedAt))
            ? toMillis(claimed.startedAt) - toMillis(claimed.enqueuedAt)
            : null,
      });
      safeRefreshFinalizeQueueMetrics();
      return claimed;
    }
  }

  return null;
}

export async function heartbeatFinalizeAttempt({ uid, attemptId, runnerId, leaseMs = FINALIZE_RUNNER_LEASE_MS }) {
  await db.runTransaction(async (tx) => {
    const docRef = attemptRef(uid, attemptId);
    const docSnap = await tx.get(docRef);
    if (!docSnap.exists) return;
    const attempt = normalizeAttempt(docSnap.data(), docSnap.id);
    if (attempt.state !== 'running') return;
    if (attempt.runnerId && runnerId && attempt.runnerId !== runnerId) return;

    const now = new Date();
    tx.set(
      docRef,
      {
        updatedAt: now,
        leaseHeartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + leaseMs),
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
    workerId: runnerId ?? null,
    jobState: attempt?.state ?? null,
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
        workerId: attempt.runnerId ?? null,
        jobState: attempt.state,
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
    if (attempt.state === 'running' && Number.isFinite(leaseExpiresAtMs) && leaseExpiresAtMs <= Date.now()) {
      emitFinalizeEvent('warn', FINALIZE_EVENTS.WORKER_HEARTBEAT_MISSED, {
        sourceRole: FINALIZE_SOURCE_ROLES.WORKER,
        requestId: attempt.requestId ?? null,
        uid: attempt.uid,
        sessionId: attempt.sessionId,
        attemptId: attempt.attemptId,
        workerId: attempt.runnerId ?? null,
        jobState: attempt.state,
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
