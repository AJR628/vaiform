import admin from '../config/firebase.js';
import {
  FINALIZE_ACTIVE_STATES,
  FINALIZE_FLOW,
  getFinalizeAttempt,
  getFinalizeSessionLock,
  getLatestFinalizeAttemptForSession,
} from './story-finalize.attempts.js';

const RESOLUTION_SOURCES = Object.freeze({
  ACTIVE_LOCK: 'active_lock',
  SESSION_HINT: 'session_render_recovery_attempt',
  LATEST_ATTEMPT: 'latest_attempt',
  SESSION_COMPAT: 'session_compat',
  NONE: 'none',
});

function normalizeString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map((entry) => cloneValue(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneValue(entry)]));
  }
  return value ?? null;
}

function cloneSessionRenderRecovery(session) {
  const renderRecovery = session?.renderRecovery;
  if (!renderRecovery || typeof renderRecovery !== 'object') return null;
  return cloneValue(renderRecovery);
}

function cloneSessionForOverlay(session) {
  if (!session || typeof session !== 'object') return session;
  return {
    ...session,
    renderRecovery: cloneSessionRenderRecovery(session),
  };
}

function getSessionAttemptHint(session) {
  return normalizeString(session?.renderRecovery?.attemptId);
}

function isAttemptForSession(attempt, { uid, sessionId }) {
  return Boolean(attempt && attempt.uid === uid && attempt.sessionId === sessionId && attempt.flow === FINALIZE_FLOW);
}

function resolveCanonicalShortId({ attempt, projection, session }) {
  if (!attempt || projection?.state !== 'done') return null;
  return (
    normalizeString(projection?.shortId) ||
    normalizeString(attempt?.result?.shortId) ||
    normalizeString(attempt?.shortId) ||
    normalizeString(session?.finalVideo?.jobId) ||
    normalizeString(session?.renderRecovery?.shortId) ||
    null
  );
}

async function readShortTruth(shortId) {
  const normalizedShortId = normalizeString(shortId);
  if (!normalizedShortId) {
    return {
      shortId: null,
      exists: false,
      finalizeAttemptId: null,
    };
  }
  const snap = await admin.firestore().collection('shorts').doc(normalizedShortId).get();
  return {
    shortId: normalizedShortId,
    exists: snap.exists,
    finalizeAttemptId: normalizeString(snap.data()?.finalizeAttemptId),
  };
}

function buildCanonicalRenderRecovery({ attempt, session, shortTruth }) {
  if (!attempt) {
    return cloneSessionRenderRecovery(session);
  }
  const projection =
    attempt?.projection?.renderRecovery && typeof attempt.projection.renderRecovery === 'object'
      ? cloneValue(attempt.projection.renderRecovery)
      : null;
  if (!projection) return null;

  const state = normalizeString(projection.state) || 'pending';
  const failure = attempt?.result?.failure ?? attempt?.failure ?? null;
  const shortId = resolveCanonicalShortId({ attempt, projection, session });

  return {
    ...projection,
    state,
    attemptId: normalizeString(projection.attemptId) || normalizeString(attempt.attemptId) || normalizeString(attempt.jobId),
    shortId:
      state === 'done'
        ? normalizeString(shortTruth?.shortId) || shortId
        : null,
    finishedAt: state === 'done' ? projection.finishedAt ?? attempt.finishedAt ?? null : null,
    failedAt: state === 'failed' ? projection.failedAt ?? attempt.finishedAt ?? null : null,
    code:
      state === 'failed'
        ? normalizeString(projection.code) || normalizeString(failure?.error) || null
        : null,
    message:
      state === 'failed'
        ? normalizeString(projection.message) || normalizeString(failure?.detail) || null
        : null,
  };
}

async function resolveActiveAttemptFromLock({ uid, sessionId }) {
  const lock = await getFinalizeSessionLock({ uid, sessionId });
  const attemptId = normalizeString(lock?.attemptId);
  if (!attemptId) {
    return { lock, attempt: null };
  }
  const attempt = await getFinalizeAttempt({ uid, attemptId });
  if (!isAttemptForSession(attempt, { uid, sessionId })) {
    return { lock, attempt: null };
  }
  if (!FINALIZE_ACTIVE_STATES.has(attempt.state)) {
    return { lock, attempt: null };
  }
  return { lock, attempt };
}

async function resolveAttemptFromSessionHint({ uid, sessionId, session }) {
  const attemptId = getSessionAttemptHint(session);
  if (!attemptId) return null;
  const attempt = await getFinalizeAttempt({ uid, attemptId });
  return isAttemptForSession(attempt, { uid, sessionId }) ? attempt : null;
}

export async function getCanonicalFinalizeStatusForSession({ uid, sessionId, session = null }) {
  const activeLockResolution = await resolveActiveAttemptFromLock({ uid, sessionId });
  let attempt = activeLockResolution.attempt;
  let source = attempt ? RESOLUTION_SOURCES.ACTIVE_LOCK : RESOLUTION_SOURCES.NONE;
  let usedLatestAttemptFallback = false;

  if (!attempt) {
    attempt = await resolveAttemptFromSessionHint({ uid, sessionId, session });
    if (attempt) {
      source = RESOLUTION_SOURCES.SESSION_HINT;
    }
  }

  if (!attempt) {
    attempt = await getLatestFinalizeAttemptForSession({ uid, sessionId });
    if (isAttemptForSession(attempt, { uid, sessionId })) {
      source = RESOLUTION_SOURCES.LATEST_ATTEMPT;
      usedLatestAttemptFallback = true;
    } else {
      attempt = null;
    }
  }

  if (!attempt) {
    const renderRecovery = cloneSessionRenderRecovery(session);
    return {
      attempt: null,
      lock: activeLockResolution.lock,
      renderRecovery,
      source: renderRecovery ? RESOLUTION_SOURCES.SESSION_COMPAT : RESOLUTION_SOURCES.NONE,
      usedLatestAttemptFallback,
      shortTruth: {
        shortId: normalizeString(renderRecovery?.shortId) || normalizeString(session?.finalVideo?.jobId),
        exists: false,
        finalizeAttemptId: null,
      },
    };
  }

  const shortTruth = await readShortTruth(resolveCanonicalShortId({ attempt, projection: attempt.projection?.renderRecovery, session }));
  return {
    attempt,
    lock: activeLockResolution.lock,
    renderRecovery: buildCanonicalRenderRecovery({ attempt, session, shortTruth }),
    source,
    usedLatestAttemptFallback,
    shortTruth,
  };
}

export function overlayCanonicalFinalizeStatusOnSession(session, finalizeStatus) {
  if (!session || typeof session !== 'object') return session;
  if (!finalizeStatus?.renderRecovery || typeof finalizeStatus.renderRecovery !== 'object') {
    return session;
  }
  const next = cloneSessionForOverlay(session);
  next.renderRecovery = cloneValue(finalizeStatus.renderRecovery);
  return next;
}

export { RESOLUTION_SOURCES as FINALIZE_STATUS_RESOLUTION_SOURCES };
