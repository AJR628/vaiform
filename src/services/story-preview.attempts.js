import crypto from 'node:crypto';
import { db } from '../config/firebase.js';

const ATTEMPTS_COLLECTION = 'storyPreviewAttempts';
const SESSION_LOCKS_COLLECTION = 'storyPreviewSessions';
const FLOW = 'story.preview';
const ACTIVE_STATES = new Set(['queued', 'running']);

export const STORY_PREVIEW_RUNNER_POLL_MS = Math.max(
  1000,
  Number(process.env.STORY_PREVIEW_RUNNER_POLL_MS || 5000)
);
export const STORY_PREVIEW_RUNNER_HEARTBEAT_MS = Math.max(
  1000,
  Number(process.env.STORY_PREVIEW_RUNNER_HEARTBEAT_MS || 5000)
);
export const STORY_PREVIEW_RUNNER_LEASE_MS = Math.max(
  10000,
  Number(process.env.STORY_PREVIEW_RUNNER_LEASE_MS || 60000)
);
export const STORY_PREVIEW_REAPER_INTERVAL_MS = Math.max(
  10000,
  Number(process.env.STORY_PREVIEW_REAPER_INTERVAL_MS || 30000)
);

const attemptDocId = (uid, attemptId) => `${uid}:${attemptId}`;
const attemptRef = (uid, attemptId) =>
  db.collection(ATTEMPTS_COLLECTION).doc(attemptDocId(uid, attemptId));
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

function normalizeAttempt(data = {}, id = null) {
  return {
    id,
    flow: data.flow || FLOW,
    uid: data.uid || null,
    attemptId: data.attemptId || null,
    previewId: data.previewId || null,
    sessionId: data.sessionId || null,
    requestId: data.requestId || null,
    requestFingerprint: data.requestFingerprint || null,
    state: data.state || 'queued',
    isActive: data.isActive === true,
    runnerId: data.runnerId || null,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    startedAt: toIso(data.startedAt),
    finishedAt: toIso(data.finishedAt),
    expiresAt: toIso(data.expiresAt),
    leaseHeartbeatAt: toIso(data.leaseHeartbeatAt),
    leaseExpiresAt: toIso(data.leaseExpiresAt),
    failure: data.failure || null,
    result: data.result || null,
  };
}

export async function getStoryPreviewAttempt({ uid, attemptId }) {
  const snap = await attemptRef(uid, attemptId).get();
  if (!snap.exists) return null;
  return normalizeAttempt(snap.data(), snap.id);
}

export async function prepareStoryPreviewAttempt({
  uid,
  attemptId,
  sessionId,
  requestId = null,
  requestFingerprint,
  ttlMinutes = 30,
}) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);
  const previewId = `preview-${crypto.randomUUID()}`;

  return await db.runTransaction(async (tx) => {
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
          detail: 'Idempotency key was already used for a different preview request.',
        };
      }
      if (existing.state === 'succeeded') return { kind: 'done_same_key', attempt: existing };
      if (existing.state === 'failed' || existing.state === 'expired') {
        return { kind: 'failed_same_key', attempt: existing };
      }
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
      if (activeAttemptId) {
        const activeSnap = await tx.get(attemptRef(uid, activeAttemptId));
        if (activeSnap.exists) {
          const activeAttempt = normalizeAttempt(activeSnap.data(), activeSnap.id);
          if (
            ACTIVE_STATES.has(activeAttempt.state) &&
            activeAttempt.requestFingerprint === requestFingerprint
          ) {
            return { kind: 'active_same_fingerprint', attempt: activeAttempt };
          }
          if (ACTIVE_STATES.has(activeAttempt.state)) {
            tx.set(
              attemptRef(uid, activeAttemptId),
              {
                state: 'superseded',
                isActive: false,
                finishedAt: now,
                updatedAt: now,
                failure: {
                  error: 'DRAFT_PREVIEW_SUPERSEDED',
                  detail: 'Preview attempt was superseded by a newer request.',
                },
              },
              { merge: true }
            );
          }
        }
      }
      tx.delete(lockRef);
    }

    const storedAttempt = {
      flow: FLOW,
      uid,
      attemptId,
      previewId,
      sessionId,
      requestId,
      requestFingerprint,
      state: 'queued',
      isActive: true,
      runnerId: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
      expiresAt,
      leaseHeartbeatAt: null,
      leaseExpiresAt: null,
      failure: null,
      result: null,
    };
    tx.set(docRef, storedAttempt);
    tx.set(lockRef, {
      flow: FLOW,
      uid,
      sessionId,
      attemptId,
      requestFingerprint,
      state: 'queued',
      createdAt: now,
      updatedAt: now,
      expiresAt,
    });
    return {
      kind: 'enqueued',
      attempt: normalizeAttempt(storedAttempt, attemptDocId(uid, attemptId)),
    };
  });
}

export async function claimNextStoryPreviewAttempt({
  runnerId,
  leaseMs = STORY_PREVIEW_RUNNER_LEASE_MS,
}) {
  const snap = await db
    .collection(ATTEMPTS_COLLECTION)
    .where('flow', '==', FLOW)
    .where('state', '==', 'queued')
    .orderBy('createdAt', 'asc')
    .limit(1)
    .get();
  if (snap.empty) return null;
  const doc = snap.docs[0];
  const attempt = normalizeAttempt(doc.data(), doc.id);
  const now = new Date();
  await doc.ref.set(
    {
      state: 'running',
      runnerId,
      startedAt: attempt.startedAt ? new Date(attempt.startedAt) : now,
      updatedAt: now,
      leaseHeartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
    },
    { merge: true }
  );
  return await getStoryPreviewAttempt({ uid: attempt.uid, attemptId: attempt.attemptId });
}

export async function heartbeatStoryPreviewAttempt({ uid, attemptId, runnerId, leaseMs }) {
  const now = new Date();
  await attemptRef(uid, attemptId).set(
    {
      runnerId,
      updatedAt: now,
      leaseHeartbeatAt: now,
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
    },
    { merge: true }
  );
}

export async function settleStoryPreviewAttemptSuccess({ uid, attemptId, session }) {
  const now = new Date();
  const attempt = await getStoryPreviewAttempt({ uid, attemptId });
  await attemptRef(uid, attemptId).set(
    {
      state: 'succeeded',
      isActive: false,
      updatedAt: now,
      finishedAt: now,
      result: {
        artifactReady: true,
        previewId: attempt?.previewId || session?.draftPreviewV1?.previewId || null,
      },
    },
    { merge: true }
  );
  if (attempt?.sessionId) {
    await sessionLockRef(uid, attempt.sessionId)
      .delete()
      .catch(() => {});
  }
}

export async function failStoryPreviewAttempt({
  uid,
  attemptId,
  error = 'DRAFT_PREVIEW_FAILED',
  detail = 'Failed to generate preview.',
  state = 'failed',
}) {
  const now = new Date();
  const attempt = await getStoryPreviewAttempt({ uid, attemptId });
  await attemptRef(uid, attemptId).set(
    {
      state,
      isActive: false,
      updatedAt: now,
      finishedAt: now,
      failure: {
        error,
        detail,
      },
    },
    { merge: true }
  );
  if (attempt?.sessionId) {
    await sessionLockRef(uid, attempt.sessionId)
      .delete()
      .catch(() => {});
  }
}

export async function reapStaleStoryPreviewAttempts() {
  const nowMs = Date.now();
  const snap = await db
    .collection(ATTEMPTS_COLLECTION)
    .where('flow', '==', FLOW)
    .where('isActive', '==', true)
    .limit(25)
    .get();
  for (const doc of snap.docs) {
    const attempt = normalizeAttempt(doc.data(), doc.id);
    const expiresAtMs = toMillis(attempt.expiresAt);
    const leaseExpiresAtMs = toMillis(attempt.leaseExpiresAt);
    if (
      (attempt.state === 'queued' && Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs) ||
      (attempt.state === 'running' &&
        Number.isFinite(leaseExpiresAtMs) &&
        leaseExpiresAtMs <= nowMs)
    ) {
      await failStoryPreviewAttempt({
        uid: attempt.uid,
        attemptId: attempt.attemptId,
        error: 'DRAFT_PREVIEW_ATTEMPT_EXPIRED',
        detail: 'Draft preview attempt expired before completion.',
        state: 'expired',
      });
    }
  }
}
