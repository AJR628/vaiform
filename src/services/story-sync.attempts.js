import admin, { db } from '../config/firebase.js';
import logger from '../observability/logger.js';
import {
  applyUsageDelta,
  billingMsToSeconds,
  buildCanonicalUsageState,
  getAvailableMs,
  secondsToBillingMs,
} from './usage.service.js';

const ATTEMPTS_COLLECTION = 'storySyncAttempts';
const SESSION_LOCKS_COLLECTION = 'storySyncSessions';
const FLOW = 'story.sync';
const ACTIVE_STATES = new Set(['running']);

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
  const millis = toMillis(value);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
};

const cloneValue = (value) => {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item));
  if (value && typeof value === 'object') return { ...value };
  return value ?? null;
};

const normalizeReservation = (reservation = {}) => {
  const estimatedMs = secondsToBillingMs(reservation?.estimatedSec ?? reservation?.estimatedMs ?? 0);
  const reservedMs = secondsToBillingMs(reservation?.reservedSec ?? reservation?.reservedMs ?? 0);
  return {
    estimatedSec: billingMsToSeconds(estimatedMs),
    reservedSec: billingMsToSeconds(reservedMs),
    estimatedMs,
    reservedMs,
  };
};

const normalizeSettlement = (settlement = {}) => {
  const billedMs = secondsToBillingMs(settlement?.billedSec ?? settlement?.billedMs ?? 0);
  return {
    billedSec: billingMsToSeconds(billedMs),
    billedMs,
    settledAt: toIso(settlement?.settledAt),
    cached: settlement?.cached === true,
  };
};

function normalizeAttempt(data = {}, id = null) {
  return {
    id,
    flow: data?.flow || FLOW,
    uid: data?.uid || null,
    attemptId: data?.attemptId || null,
    sessionId: data?.sessionId || null,
    requestId: data?.requestId || null,
    requestFingerprint: data?.requestFingerprint || null,
    state: data?.state || 'running',
    isActive: data?.isActive === true,
    status: Number.isFinite(Number(data?.status)) ? Number(data.status) : 202,
    createdAt: toIso(data?.createdAt),
    updatedAt: toIso(data?.updatedAt),
    startedAt: toIso(data?.startedAt),
    finishedAt: toIso(data?.finishedAt),
    expiresAt: toIso(data?.expiresAt),
    usageReservation: normalizeReservation(data?.usageReservation),
    billingSettlement: data?.billingSettlement ? normalizeSettlement(data.billingSettlement) : null,
    failure: cloneValue(data?.failure ?? null),
    result: cloneValue(data?.result ?? null),
    request: cloneValue(data?.request ?? null),
  };
}

export async function getStorySyncAttempt({ uid, attemptId }) {
  const snap = await attemptRef(uid, attemptId).get();
  if (!snap.exists) return null;
  return normalizeAttempt(snap.data(), snap.id);
}

export async function prepareStorySyncAttempt({
  uid,
  attemptId,
  sessionId,
  requestId = null,
  requestFingerprint,
  estimatedSec = 0,
  ttlMinutes = 30,
  getSession,
  request = {},
}) {
  if (typeof getSession !== 'function') {
    throw new Error('prepareStorySyncAttempt requires getSession');
  }

  const estimatedMs = secondsToBillingMs(estimatedSec);
  const reservation = {
    estimatedSec: billingMsToSeconds(estimatedMs),
    reservedSec: billingMsToSeconds(estimatedMs),
    estimatedMs,
    reservedMs: estimatedMs,
  };
  const session = await getSession({ uid, sessionId });
  if (!session) {
    return {
      kind: 'error',
      status: 404,
      error: 'SESSION_NOT_FOUND',
      detail: 'Session not found',
    };
  }

  try {
    const now = Date.now();
    const createdAt = new Date(now);
    const expiresAt = new Date(now + ttlMinutes * 60 * 1000);
    const txResult = await db.runTransaction(async (tx) => {
      const docRef = attemptRef(uid, attemptId);
      const currentAttemptSnap = await tx.get(docRef);
      if (currentAttemptSnap.exists) {
        const existing = normalizeAttempt(currentAttemptSnap.data(), currentAttemptSnap.id);
        if (
          existing.requestFingerprint &&
          requestFingerprint &&
          existing.requestFingerprint !== requestFingerprint
        ) {
          return {
            kind: 'error',
            status: 409,
            error: 'IDEMPOTENCY_KEY_REUSED',
            detail: 'Idempotency key was already used for a different sync request.',
          };
        }
        if (existing.state === 'done') return { kind: 'done_same_key', attempt: existing };
        if (existing.state === 'failed') return { kind: 'failed_same_key', attempt: existing };
        return { kind: 'active_same_key', attempt: existing };
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
            if (ACTIVE_STATES.has(activeAttempt.state)) {
              return { kind: 'active_other_key', attempt: activeAttempt };
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

      const accountState = buildCanonicalUsageState(userSnap.data() || {});
      if (getAvailableMs(accountState.usage, accountState.plan) < estimatedMs) {
        const err = new Error(
          `Insufficient sync time. You need ${billingMsToSeconds(estimatedMs)} seconds to sync.`
        );
        err.code = 'INSUFFICIENT_SYNC_TIME';
        err.status = 402;
        throw err;
      }

      const usage = applyUsageDelta(
        accountState.usage,
        {
          reservedDeltaMs: estimatedMs,
        },
        accountState.plan
      );
      const storedAttempt = {
        flow: FLOW,
        uid,
        attemptId,
        sessionId,
        requestId,
        requestFingerprint: requestFingerprint || null,
        state: 'running',
        isActive: true,
        status: 202,
        createdAt,
        updatedAt: createdAt,
        startedAt: createdAt,
        finishedAt: null,
        expiresAt,
        usageReservation: reservation,
        billingSettlement: null,
        failure: null,
        result: null,
        request: cloneValue(request),
      };

      tx.set(docRef, storedAttempt);
      tx.set(lockRef, {
        flow: FLOW,
        uid,
        sessionId,
        attemptId,
        state: 'running',
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
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return {
        kind: 'started',
        attempt: normalizeAttempt(storedAttempt, attemptDocId(uid, attemptId)),
      };
    });

    if (txResult?.kind === 'error') return txResult;
    if (txResult?.kind === 'active_other_key') return txResult;
    if (txResult?.kind === 'active_same_key') return txResult;
    if (txResult?.kind === 'done_same_key') return txResult;
    if (txResult?.kind === 'failed_same_key') return txResult;

    logger.info('story.sync.attempt.started', {
      sessionId,
      attemptId,
      estimatedSec: reservation.estimatedSec,
    });
    return {
      kind: 'started',
      session,
      attempt: txResult.attempt,
    };
  } catch (error) {
    if (error?.status === 402 || error?.code === 'INSUFFICIENT_SYNC_TIME') {
      return {
        kind: 'error',
        status: 402,
        error: error.code || 'INSUFFICIENT_SYNC_TIME',
        detail: error.message || 'Insufficient sync time for this request.',
      };
    }
    if (error?.status === 404 || error?.code === 'USER_NOT_FOUND') {
      return {
        kind: 'error',
        status: 404,
        error: error.code || 'USER_NOT_FOUND',
        detail: error.message || 'User account not found.',
      };
    }
    throw error;
  }
}

export async function settleStorySyncAttemptSuccess({
  uid,
  attemptId,
  billedSec = 0,
  cached = false,
  status = 200,
  result = {},
}) {
  const billedMs = secondsToBillingMs(billedSec);
  await db.runTransaction(async (tx) => {
    const docRef = attemptRef(uid, attemptId);
    const docSnap = await tx.get(docRef);
    if (!docSnap.exists) {
      const err = new Error('STORY_SYNC_ATTEMPT_NOT_FOUND');
      err.code = 'STORY_SYNC_ATTEMPT_NOT_FOUND';
      err.status = 500;
      throw err;
    }

    const attempt = normalizeAttempt(docSnap.data(), docSnap.id);
    if (attempt.state === 'done') return;
    if (!ACTIVE_STATES.has(attempt.state)) {
      const err = new Error('STORY_SYNC_ATTEMPT_NOT_ACTIVE');
      err.code = 'STORY_SYNC_ATTEMPT_NOT_ACTIVE';
      err.status = 409;
      throw err;
    }

    const userRef = db.collection('users').doc(uid);
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) {
      const err = new Error('USER_NOT_FOUND');
      err.code = 'USER_NOT_FOUND';
      err.status = 404;
      throw err;
    }

    const accountState = buildCanonicalUsageState(userSnap.data() || {});
    const reservedMs = attempt.usageReservation?.reservedMs || 0;
    const usage = applyUsageDelta(
      accountState.usage,
      {
        usedDeltaMs: billedMs,
        reservedDeltaMs: -reservedMs,
      },
      accountState.plan
    );
    const settledAt = new Date();
    tx.set(
      userRef,
      {
        plan: accountState.plan,
        membership: accountState.membership,
        usage: {
          ...usage,
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
        updatedAt: settledAt,
        finishedAt: settledAt,
        billingSettlement: {
          billedSec: billingMsToSeconds(billedMs),
          billedMs,
          settledAt,
          cached: cached === true,
        },
        failure: null,
        result: {
          ...cloneValue(result),
          billedSec: billingMsToSeconds(billedMs),
          billedMs,
          cached: cached === true,
        },
      },
      { merge: true }
    );
    tx.delete(sessionLockRef(uid, attempt.sessionId));
  });
}

export async function failStorySyncAttempt({
  uid,
  attemptId,
  status = 500,
  error = 'STORY_SYNC_FAILED',
  detail = 'Failed to sync story voice.',
}) {
  await db.runTransaction(async (tx) => {
    const docRef = attemptRef(uid, attemptId);
    const docSnap = await tx.get(docRef);
    if (!docSnap.exists) return;

    const attempt = normalizeAttempt(docSnap.data(), docSnap.id);
    if (attempt.state === 'done' || attempt.state === 'failed') return;

    const userRef = db.collection('users').doc(uid);
    const userSnap = await tx.get(userRef);
    if (userSnap.exists) {
      const accountState = buildCanonicalUsageState(userSnap.data() || {});
      const reservedMs = attempt.usageReservation?.reservedMs || 0;
      const usage = applyUsageDelta(
        accountState.usage,
        {
          reservedDeltaMs: -reservedMs,
        },
        accountState.plan
      );
      tx.set(
        userRef,
        {
          plan: accountState.plan,
          membership: accountState.membership,
          usage: {
            ...usage,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    const failedAt = new Date();
    tx.set(
      docRef,
      {
        state: 'failed',
        isActive: false,
        status,
        updatedAt: failedAt,
        finishedAt: failedAt,
        failure: {
          error,
          detail,
          failedAt,
        },
      },
      { merge: true }
    );
    tx.delete(sessionLockRef(uid, attempt.sessionId));
  });
}

