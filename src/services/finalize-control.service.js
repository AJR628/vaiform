import { db } from '../config/firebase.js';
import {
  FINALIZE_EVENTS,
  FINALIZE_SOURCE_ROLES,
  describeFinalizeError,
  emitFinalizeEvent,
} from '../observability/finalize-observability.js';
import logger from '../observability/logger.js';
import { getRequestContext } from '../observability/request-context.js';

const ATTEMPTS_COLLECTION = 'idempotency';
const RENDER_SLOTS_COLLECTION = 'finalizeControlRenderSlots';
const PROVIDER_SLOTS_COLLECTION = 'finalizeControlProviderSlots';
const PROVIDER_STATES_COLLECTION = 'finalizeControlProviderStates';
const TEST_MODE = process.env.NODE_ENV === 'test' && process.env.VAIFORM_TEST_MODE === '1';

const BACKLOG_JOB_STATES = new Set(['queued', 'claimed', 'started', 'retry_scheduled']);
const BACKLOG_JOB_STATE_VALUES = Object.freeze([...BACKLOG_JOB_STATES]);
const RUNNING_JOB_STATES = new Set(['claimed', 'started']);
const RETRY_SCHEDULED_JOB_STATES = new Set(['retry_scheduled']);
const DEFAULT_SHARED_RENDER_LIMIT = 3;
const DEFAULT_BACKLOG_LIMIT = 25;
const DEFAULT_OVERLOAD_RETRY_AFTER_SEC = 30;
const DEFAULT_RENDER_LEASE_MS = TEST_MODE ? 120 : 20_000;
const DEFAULT_PROVIDER_LEASE_MS = TEST_MODE ? 120 : 45_000;
const DEFAULT_RENDER_HEARTBEAT_MS = TEST_MODE ? 25 : 5_000;

const PROVIDER_KEYS = Object.freeze({
  OPENAI: 'openai',
  STORY_SEARCH_ADMISSION: 'story-search-admission',
  STORY_SEARCH_PEXELS: 'story-search:pexels',
  STORY_SEARCH_PIXABAY: 'story-search:pixabay',
  STORY_SEARCH_NASA: 'story-search:nasa',
  TTS: 'tts',
});

function numberFromEnv(name, fallback) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function normalizeString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toMillis(value) {
  if (value == null) return null;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIso(value) {
  const ms = toMillis(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = cloneValue(entry);
    }
    return out;
  }
  return value;
}

function getSharedRenderHeartbeatMs() {
  return numberFromEnv('STORY_FINALIZE_RUNNER_HEARTBEAT_MS', DEFAULT_RENDER_HEARTBEAT_MS);
}

function getSharedRenderLimit() {
  return numberFromEnv('STORY_FINALIZE_SHARED_RENDER_LIMIT', DEFAULT_SHARED_RENDER_LIMIT);
}

function getSharedBacklogLimit() {
  return numberFromEnv('STORY_FINALIZE_SHARED_BACKLOG_LIMIT', DEFAULT_BACKLOG_LIMIT);
}

function getSharedOverloadRetryAfterSec() {
  return numberFromEnv('STORY_FINALIZE_OVERLOAD_RETRY_AFTER_SEC', DEFAULT_OVERLOAD_RETRY_AFTER_SEC);
}

function getSharedRenderLeaseMs() {
  return numberFromEnv('STORY_FINALIZE_SHARED_RENDER_LEASE_MS', DEFAULT_RENDER_LEASE_MS);
}

function getSharedProviderLeaseMs() {
  return numberFromEnv('STORY_FINALIZE_SHARED_PROVIDER_LEASE_MS', DEFAULT_PROVIDER_LEASE_MS);
}

function getRenderSlotIds(limit = getSharedRenderLimit()) {
  return Array.from({ length: limit }, (_entry, index) => `render-slot-${index + 1}`);
}

function getProviderSlotIds(providerKey, limit) {
  return Array.from({ length: limit }, (_entry, index) => `${providerKey}:slot-${index + 1}`);
}

function renderSlotRef(slotId) {
  return db.collection(RENDER_SLOTS_COLLECTION).doc(slotId);
}

function providerSlotRef(slotId) {
  return db.collection(PROVIDER_SLOTS_COLLECTION).doc(slotId);
}

function providerStateRef(providerKey) {
  return db.collection(PROVIDER_STATES_COLLECTION).doc(providerKey);
}

function isFinalizeSharedControlContext() {
  const context = getRequestContext() || {};
  return Boolean(
    normalizeString(context.finalizeJobId) ||
      normalizeString(context.executionAttemptId) ||
      normalizeString(context.attemptId)
  );
}

function getFinalizeOwnerIdentity(fallback = null) {
  const context = getRequestContext() || {};
  return (
    normalizeString(context.executionAttemptId) ||
    normalizeString(context.finalizeJobId) ||
    normalizeString(context.attemptId) ||
    normalizeString(fallback)
  );
}

function normalizeRenderLease(data, id) {
  if (!data || typeof data !== 'object') return null;
  const leaseExpiresAtMs = toMillis(data.leaseExpiresAt);
  return {
    slotId: normalizeString(data.slotId) || id,
    state: normalizeString(data.state) || 'available',
    executionAttemptId: normalizeString(data.executionAttemptId),
    workerId: normalizeString(data.workerId),
    leaseExpiresAtMs,
    leaseExpiresAt: toIso(data.leaseExpiresAt),
    leasedAt: toIso(data.leasedAt),
    heartbeatAt: toIso(data.heartbeatAt),
    updatedAt: toIso(data.updatedAt),
    releasedAt: toIso(data.releasedAt),
    expiredAt: toIso(data.expiredAt),
    lastExecutionAttemptId:
      normalizeString(data.lastExecutionAttemptId) || normalizeString(data.executionAttemptId),
  };
}

function isRenderLeaseActive(lease, now = Date.now()) {
  return Boolean(
    lease?.state === 'leased' &&
      lease.executionAttemptId &&
      Number.isFinite(lease.leaseExpiresAtMs) &&
      lease.leaseExpiresAtMs > now
  );
}

function normalizeProviderState(data, providerKey) {
  if (!data || typeof data !== 'object') {
    return {
      providerKey,
      failureCount: 0,
      cooldownUntilMs: null,
      cooldownUntil: null,
      nextAllowedAtMs: null,
      nextAllowedAt: null,
      updatedAt: null,
      lastOwnerId: null,
      lastFailureCode: null,
    };
  }
  const cooldownUntilMs = toMillis(data.cooldownUntil);
  const nextAllowedAtMs = toMillis(data.nextAllowedAt);
  return {
    providerKey,
    failureCount: Number.isFinite(Number(data.failureCount)) ? Number(data.failureCount) : 0,
    cooldownUntilMs,
    cooldownUntil: toIso(data.cooldownUntil),
    nextAllowedAtMs,
    nextAllowedAt: toIso(data.nextAllowedAt),
    updatedAt: toIso(data.updatedAt),
    lastOwnerId: normalizeString(data.lastOwnerId),
    lastFailureCode: normalizeString(data.lastFailureCode),
  };
}

function normalizeProviderLease(data, id) {
  if (!data || typeof data !== 'object') return null;
  const leaseExpiresAtMs = toMillis(data.leaseExpiresAt);
  return {
    slotId: normalizeString(data.slotId) || id,
    providerKey: normalizeString(data.providerKey),
    state: normalizeString(data.state) || 'available',
    ownerId: normalizeString(data.ownerId),
    leaseExpiresAtMs,
    leaseExpiresAt: toIso(data.leaseExpiresAt),
    leasedAt: toIso(data.leasedAt),
    heartbeatAt: toIso(data.heartbeatAt),
    updatedAt: toIso(data.updatedAt),
    releasedAt: toIso(data.releasedAt),
    expiredAt: toIso(data.expiredAt),
    lastOwnerId: normalizeString(data.lastOwnerId) || normalizeString(data.ownerId),
  };
}

function isProviderLeaseActive(lease, now = Date.now()) {
  return Boolean(
    lease?.state === 'leased' &&
      lease.ownerId &&
      Number.isFinite(lease.leaseExpiresAtMs) &&
      lease.leaseExpiresAtMs > now
  );
}

function buildBusyError(code, detail, retryAfterSec) {
  const error = new Error(detail);
  error.code = code;
  error.status = 503;
  error.retryAfter = retryAfterSec;
  return error;
}

function retryAfterSecFromMs(value, fallback = getSharedOverloadRetryAfterSec()) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) {
    return fallback;
  }
  return Math.max(1, Math.ceil(Number(value) / 1000));
}

async function updateExpiredRenderSlot(ref, lease, nowDate) {
  if (!lease?.executionAttemptId) return false;
  await ref.set(
    {
      controlType: 'render',
      slotId: lease.slotId,
      state: 'expired',
      executionAttemptId: null,
      workerId: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      releasedAt: null,
      expiredAt: nowDate,
      updatedAt: nowDate,
      lastExecutionAttemptId: lease.executionAttemptId,
    },
    { merge: true }
  );
  return true;
}

async function updateExpiredProviderSlot(ref, lease, nowDate) {
  if (!lease?.ownerId) return false;
  await ref.set(
    {
      controlType: 'provider',
      providerKey: lease.providerKey,
      slotId: lease.slotId,
      state: 'expired',
      ownerId: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
      releasedAt: null,
      expiredAt: nowDate,
      updatedAt: nowDate,
      lastOwnerId: lease.ownerId,
    },
    { merge: true }
  );
  return true;
}

export async function reapExpiredSharedRenderLeases({ now = Date.now() } = {}) {
  const snapshot = await db.collection(RENDER_SLOTS_COLLECTION).get();
  const nowDate = new Date(now);
  let released = 0;
  for (const doc of snapshot.docs) {
    const lease = normalizeRenderLease(doc.data(), doc.id);
    if (!lease || isRenderLeaseActive(lease, now)) continue;
    if (lease.state === 'leased' && lease.executionAttemptId) {
      released += (await updateExpiredRenderSlot(renderSlotRef(doc.id), lease, nowDate)) ? 1 : 0;
    }
  }
  return released;
}

export async function acquireSharedRenderLease({
  executionAttemptId,
  workerId = null,
  leaseMs = getSharedRenderLeaseMs(),
} = {}) {
  const ownerId = normalizeString(executionAttemptId);
  if (!ownerId) {
    throw new Error('acquireSharedRenderLease requires executionAttemptId');
  }

  const capacity = getSharedRenderLimit();
  const nowMs = Date.now();
  const nowDate = new Date(nowMs);
  const leaseExpiresAt = new Date(nowMs + leaseMs);

  await reapExpiredSharedRenderLeases({ now: nowMs });

  return await db.runTransaction(async (tx) => {
    let targetSlotId = null;

    for (const slotId of getRenderSlotIds(capacity)) {
      const ref = renderSlotRef(slotId);
      const snap = await tx.get(ref);
      const lease = normalizeRenderLease(snap.data(), slotId);
      if (isRenderLeaseActive(lease, nowMs) && lease.executionAttemptId === ownerId) {
        targetSlotId = slotId;
        break;
      }
      if (!targetSlotId && !isRenderLeaseActive(lease, nowMs)) {
        targetSlotId = slotId;
      }
    }

    if (!targetSlotId) {
      return {
        acquired: false,
        capacity,
        retryAfterSec: getSharedOverloadRetryAfterSec(),
      };
    }

    tx.set(
      renderSlotRef(targetSlotId),
      {
        controlType: 'render',
        slotId: targetSlotId,
        state: 'leased',
        executionAttemptId: ownerId,
        workerId: normalizeString(workerId),
        leasedAt: nowDate,
        heartbeatAt: nowDate,
        leaseExpiresAt,
        releasedAt: null,
        expiredAt: null,
        updatedAt: nowDate,
        lastExecutionAttemptId: ownerId,
      },
      { merge: true }
    );

    return {
      acquired: true,
      slotId: targetSlotId,
      capacity,
      leaseExpiresAt: leaseExpiresAt.toISOString(),
    };
  });
}

export async function heartbeatSharedRenderLease({
  executionAttemptId,
  workerId = null,
  leaseMs = getSharedRenderLeaseMs(),
} = {}) {
  const ownerId = normalizeString(executionAttemptId);
  if (!ownerId) return null;

  const now = new Date();
  const nextExpiry = new Date(now.getTime() + leaseMs);
  for (const slotId of getRenderSlotIds()) {
    const ref = renderSlotRef(slotId);
    const snap = await ref.get();
    const lease = normalizeRenderLease(snap.data(), slotId);
    if (!lease || lease.executionAttemptId !== ownerId || lease.state !== 'leased') {
      continue;
    }
    await ref.set(
      {
        workerId: normalizeString(workerId) || lease.workerId || null,
        heartbeatAt: now,
        leaseExpiresAt: nextExpiry,
        updatedAt: now,
      },
      { merge: true }
    );
    return {
      slotId,
      executionAttemptId: ownerId,
      leaseExpiresAt: nextExpiry.toISOString(),
    };
  }
  return null;
}

export async function releaseSharedRenderLease({
  executionAttemptId,
  workerId = null,
  releaseState = 'released',
} = {}) {
  const ownerId = normalizeString(executionAttemptId);
  if (!ownerId) return false;

  const now = new Date();
  for (const slotId of getRenderSlotIds()) {
    const ref = renderSlotRef(slotId);
    const snap = await ref.get();
    const lease = normalizeRenderLease(snap.data(), slotId);
    if (!lease || lease.executionAttemptId !== ownerId || lease.state !== 'leased') {
      continue;
    }
    await ref.set(
      {
        workerId: normalizeString(workerId) || lease.workerId || null,
        state: releaseState,
        executionAttemptId: null,
        heartbeatAt: null,
        leaseExpiresAt: null,
        releasedAt: now,
        expiredAt: null,
        updatedAt: now,
        lastExecutionAttemptId: ownerId,
      },
      { merge: true }
    );
    return true;
  }
  return false;
}

export async function captureSharedRenderCapacitySnapshot({ now = Date.now() } = {}) {
  await reapExpiredSharedRenderLeases({ now });
  const snapshot = await db.collection(RENDER_SLOTS_COLLECTION).get();
  const leases = [];
  for (const doc of snapshot.docs) {
    const lease = normalizeRenderLease(doc.data(), doc.id);
    if (!isRenderLeaseActive(lease, now)) continue;
    leases.push({
      slotId: lease.slotId,
      executionAttemptId: lease.executionAttemptId,
      workerId: lease.workerId,
      leaseExpiresAt: lease.leaseExpiresAt,
      heartbeatAt: lease.heartbeatAt,
    });
  }
  return {
    limit: getSharedRenderLimit(),
    activeLeases: leases.length,
    availableLeases: Math.max(0, getSharedRenderLimit() - leases.length),
    leases,
  };
}

export async function withSharedFinalizeRenderLease(
  fn,
  {
    executionAttemptId = getFinalizeOwnerIdentity(),
    workerId = getRequestContext()?.workerId ?? null,
    leaseMs = getSharedRenderLeaseMs(),
    heartbeatMs = getSharedRenderHeartbeatMs(),
  } = {}
) {
  if (typeof fn !== 'function') {
    throw new Error('withSharedFinalizeRenderLease requires a callback');
  }
  if (!isFinalizeSharedControlContext()) {
    return await fn();
  }

  const ownerId = normalizeString(executionAttemptId);
  if (!ownerId) {
    throw new Error('withSharedFinalizeRenderLease requires executionAttemptId');
  }

  const lease = await acquireSharedRenderLease({
    executionAttemptId: ownerId,
    workerId,
    leaseMs,
  });
  if (!lease?.acquired) {
    throw buildBusyError(
      'SERVER_BUSY',
      'Shared render capacity is busy. Please retry shortly.',
      lease?.retryAfterSec ?? getSharedOverloadRetryAfterSec()
    );
  }

  const heartbeat = setInterval(() => {
    void heartbeatSharedRenderLease({
      executionAttemptId: ownerId,
      workerId,
      leaseMs,
    });
  }, heartbeatMs);
  heartbeat.unref?.();

  try {
    return await fn();
  } finally {
    clearInterval(heartbeat);
    await releaseSharedRenderLease({
      executionAttemptId: ownerId,
      workerId,
    }).catch(() => false);
  }
}

export async function captureFinalizeBacklogSnapshot({ now = Date.now() } = {}) {
  const limit = getSharedBacklogLimit();
  const queryLimit = limit + 1;
  const snapshot = await db
    .collection(ATTEMPTS_COLLECTION)
    .where('flow', '==', 'story.finalize')
    .where('isActive', '==', true)
    .where('jobState', 'in', BACKLOG_JOB_STATE_VALUES)
    .limit(queryLimit)
    .get();

  let queued = 0;
  let running = 0;
  let retryScheduled = 0;
  for (const doc of snapshot.docs) {
    const data = doc.data() || {};
    const jobState = normalizeString(data.jobState);
    if (!BACKLOG_JOB_STATES.has(jobState)) continue;
    if (jobState === 'queued') queued += 1;
    if (RUNNING_JOB_STATES.has(jobState)) running += 1;
    if (RETRY_SCHEDULED_JOB_STATES.has(jobState)) retryScheduled += 1;
  }

  const backlog = queued + running + retryScheduled;
  const overloaded = backlog >= limit;
  logger.info('finalize.backlog.snapshot', {
    metricType: 'finalize_backlog',
    returnedDocCount: snapshot.docs.length,
    queryLimit,
    backlog,
    queued,
    running,
    retryScheduled,
    overloaded,
  });
  return {
    backlogDefinition: 'queued + running + retry_scheduled',
    queued,
    running,
    retryScheduled,
    backlog,
    limit,
    overloaded,
    retryAfterSec: getSharedOverloadRetryAfterSec(),
    generatedAt: new Date(now).toISOString(),
  };
}

export async function shouldRejectFinalizeAdmissionForBackpressure() {
  const snapshot = await captureFinalizeBacklogSnapshot();
  return {
    reject: snapshot.overloaded,
    ...snapshot,
  };
}

export async function reapExpiredSharedProviderLeases({
  providerKey = null,
  now = Date.now(),
} = {}) {
  const snapshot = providerKey
    ? await db.collection(PROVIDER_SLOTS_COLLECTION).where('providerKey', '==', providerKey).get()
    : await db.collection(PROVIDER_SLOTS_COLLECTION).get();
  const nowDate = new Date(now);
  let released = 0;
  for (const doc of snapshot.docs) {
    const lease = normalizeProviderLease(doc.data(), doc.id);
    if (!lease || isProviderLeaseActive(lease, now)) continue;
    if (lease.state === 'leased' && lease.ownerId) {
      released += (await updateExpiredProviderSlot(providerSlotRef(doc.id), lease, nowDate))
        ? 1
        : 0;
    }
  }
  return released;
}

export async function tryAcquireSharedProviderLease({
  providerKey,
  ownerId,
  slotLimit,
  leaseMs = getSharedProviderLeaseMs(),
  minGapMs = 0,
} = {}) {
  const normalizedProviderKey = normalizeString(providerKey);
  const normalizedOwnerId = normalizeString(ownerId);
  if (!normalizedProviderKey || !normalizedOwnerId || !Number.isFinite(Number(slotLimit))) {
    throw new Error('tryAcquireSharedProviderLease requires providerKey, ownerId, and slotLimit');
  }

  const nowMs = Date.now();
  const nowDate = new Date(nowMs);
  const expiresAt = new Date(nowMs + leaseMs);

  await reapExpiredSharedProviderLeases({ providerKey: normalizedProviderKey, now: nowMs });

  return await db.runTransaction(async (tx) => {
    const stateSnap = await tx.get(providerStateRef(normalizedProviderKey));
    const state = normalizeProviderState(stateSnap.data(), normalizedProviderKey);

    if (Number.isFinite(state.cooldownUntilMs) && state.cooldownUntilMs > nowMs) {
      return {
        acquired: false,
        reason: 'cooldown',
        retryAfterMs: state.cooldownUntilMs - nowMs,
      };
    }

    if (Number.isFinite(state.nextAllowedAtMs) && state.nextAllowedAtMs > nowMs) {
      return {
        acquired: false,
        reason: 'throttled',
        retryAfterMs: state.nextAllowedAtMs - nowMs,
      };
    }

    let targetSlotId = null;
    for (const slotId of getProviderSlotIds(normalizedProviderKey, Number(slotLimit))) {
      const ref = providerSlotRef(slotId);
      const snap = await tx.get(ref);
      const lease = normalizeProviderLease(snap.data(), slotId);
      if (isProviderLeaseActive(lease, nowMs) && lease.ownerId === normalizedOwnerId) {
        targetSlotId = slotId;
        break;
      }
      if (!targetSlotId && !isProviderLeaseActive(lease, nowMs)) {
        targetSlotId = slotId;
      }
    }

    if (!targetSlotId) {
      return {
        acquired: false,
        reason: 'busy',
        retryAfterMs: null,
      };
    }

    tx.set(
      providerSlotRef(targetSlotId),
      {
        controlType: 'provider',
        providerKey: normalizedProviderKey,
        slotId: targetSlotId,
        state: 'leased',
        ownerId: normalizedOwnerId,
        leasedAt: nowDate,
        heartbeatAt: nowDate,
        leaseExpiresAt: expiresAt,
        releasedAt: null,
        expiredAt: null,
        updatedAt: nowDate,
        lastOwnerId: normalizedOwnerId,
      },
      { merge: true }
    );
    tx.set(
      providerStateRef(normalizedProviderKey),
      {
        providerKey: normalizedProviderKey,
        nextAllowedAt: minGapMs > 0 ? new Date(nowMs + minGapMs) : null,
        updatedAt: nowDate,
        lastOwnerId: normalizedOwnerId,
      },
      { merge: true }
    );

    return {
      acquired: true,
      slotId: targetSlotId,
      retryAfterMs: null,
    };
  });
}

export async function releaseSharedProviderLease({
  providerKey,
  ownerId,
  releaseState = 'released',
} = {}) {
  const normalizedProviderKey = normalizeString(providerKey);
  const normalizedOwnerId = normalizeString(ownerId);
  if (!normalizedProviderKey || !normalizedOwnerId) return false;

  const snapshot = await db
    .collection(PROVIDER_SLOTS_COLLECTION)
    .where('providerKey', '==', normalizedProviderKey)
    .get();
  const now = new Date();
  for (const doc of snapshot.docs) {
    const lease = normalizeProviderLease(doc.data(), doc.id);
    if (!lease || lease.ownerId !== normalizedOwnerId || lease.state !== 'leased') {
      continue;
    }
    await providerSlotRef(doc.id).set(
      {
        state: releaseState,
        ownerId: null,
        heartbeatAt: null,
        leaseExpiresAt: null,
        releasedAt: now,
        expiredAt: null,
        updatedAt: now,
        lastOwnerId: normalizedOwnerId,
      },
      { merge: true }
    );
    return true;
  }
  return false;
}

export async function markSharedProviderSuccess({ providerKey } = {}) {
  const normalizedProviderKey = normalizeString(providerKey);
  if (!normalizedProviderKey) return null;

  const ref = providerStateRef(normalizedProviderKey);
  const snap = await ref.get();
  const current = normalizeProviderState(snap.data(), normalizedProviderKey);
  await ref.set(
    {
      providerKey: normalizedProviderKey,
      failureCount: 0,
      cooldownUntil: null,
      updatedAt: new Date(),
      lastFailureCode: null,
    },
    { merge: true }
  );

  if (Number.isFinite(current.cooldownUntilMs) && current.cooldownUntilMs > Date.now()) {
    emitFinalizeEvent('info', FINALIZE_EVENTS.PROVIDER_COOLDOWN_CLEARED, {
      sourceRole: getRequestContext()?.sourceRole ?? FINALIZE_SOURCE_ROLES.WORKER,
      provider: normalizedProviderKey,
    });
  }

  return true;
}

export async function markSharedProviderTransientFailure({
  providerKey,
  cooldownMs,
  threshold = 1,
  errorCode = 'SERVER_BUSY',
} = {}) {
  const normalizedProviderKey = normalizeString(providerKey);
  if (!normalizedProviderKey || !Number.isFinite(Number(cooldownMs))) return null;

  const nowMs = Date.now();
  const nowDate = new Date(nowMs);
  const ref = providerStateRef(normalizedProviderKey);
  let startedCooldown = false;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = normalizeProviderState(snap.data(), normalizedProviderKey);
    const failureCount = current.failureCount + 1;
    const nextCooldownMs =
      failureCount >= Number(threshold) ? nowMs + Number(cooldownMs) : current.cooldownUntilMs;
    if (
      Number.isFinite(nextCooldownMs) &&
      (!Number.isFinite(current.cooldownUntilMs) || nextCooldownMs > current.cooldownUntilMs)
    ) {
      startedCooldown = true;
    }
    tx.set(
      ref,
      {
        providerKey: normalizedProviderKey,
        failureCount,
        cooldownUntil: Number.isFinite(nextCooldownMs) ? new Date(nextCooldownMs) : null,
        updatedAt: nowDate,
        lastFailureCode: normalizeString(errorCode),
      },
      { merge: true }
    );
  });

  if (startedCooldown) {
    emitFinalizeEvent('warn', FINALIZE_EVENTS.PROVIDER_COOLDOWN_STARTED, {
      sourceRole: getRequestContext()?.sourceRole ?? FINALIZE_SOURCE_ROLES.WORKER,
      provider: normalizedProviderKey,
      errorCode: normalizeString(errorCode) || 'SERVER_BUSY',
      ...describeFinalizeError(
        { code: normalizeString(errorCode) || 'SERVER_BUSY', status: 503 },
        { retryable: true, failureReason: 'provider_cooldown_started' }
      ),
    });
  }

  return startedCooldown;
}

export async function getSharedProviderState(providerKey) {
  const normalizedProviderKey = normalizeString(providerKey);
  if (!normalizedProviderKey) return null;
  const snap = await providerStateRef(normalizedProviderKey).get();
  return normalizeProviderState(snap.data(), normalizedProviderKey);
}

export async function isSharedProviderCooldownActive(providerKey, { now = Date.now() } = {}) {
  const state = await getSharedProviderState(providerKey);
  return Boolean(Number.isFinite(state?.cooldownUntilMs) && state.cooldownUntilMs > now);
}

export async function captureSharedProviderPressureSnapshot({ now = Date.now() } = {}) {
  await reapExpiredSharedProviderLeases({ now });
  const slotSnapshot = await db.collection(PROVIDER_SLOTS_COLLECTION).get();
  const stateSnapshot = await db.collection(PROVIDER_STATES_COLLECTION).get();

  const states = new Map();
  for (const doc of stateSnapshot.docs) {
    const normalized = normalizeProviderState(doc.data(), doc.id);
    states.set(doc.id, normalized);
  }

  const activeLeaseCounts = new Map();
  for (const doc of slotSnapshot.docs) {
    const lease = normalizeProviderLease(doc.data(), doc.id);
    if (!isProviderLeaseActive(lease, now)) continue;
    const current = activeLeaseCounts.get(lease.providerKey) || [];
    current.push({
      slotId: lease.slotId,
      ownerId: lease.ownerId,
      leaseExpiresAt: lease.leaseExpiresAt,
    });
    activeLeaseCounts.set(lease.providerKey, current);
  }

  const buildEntry = (providerKey, slotLimit = 0) => {
    const state = states.get(providerKey) || normalizeProviderState(null, providerKey);
    const activeLeases = activeLeaseCounts.get(providerKey) || [];
    return {
      providerKey,
      slotLimit,
      activeLeases: activeLeases.length,
      leases: activeLeases,
      cooldownActive: Boolean(
        Number.isFinite(state.cooldownUntilMs) && state.cooldownUntilMs > Number(now)
      ),
      cooldownUntil: state.cooldownUntil,
      nextAllowedAt: state.nextAllowedAt,
      failureCount: state.failureCount,
      lastFailureCode: state.lastFailureCode,
    };
  };

  return {
    openai: buildEntry(PROVIDER_KEYS.OPENAI, numberFromEnv('OPENAI_SHARED_CONCURRENCY_LIMIT', 2)),
    storySearchAdmission: buildEntry(
      PROVIDER_KEYS.STORY_SEARCH_ADMISSION,
      numberFromEnv('STORY_SEARCH_SHARED_CONCURRENCY_LIMIT', 2)
    ),
    storySearchProviders: {
      pexels: buildEntry(PROVIDER_KEYS.STORY_SEARCH_PEXELS),
      pixabay: buildEntry(PROVIDER_KEYS.STORY_SEARCH_PIXABAY),
      nasa: buildEntry(PROVIDER_KEYS.STORY_SEARCH_NASA),
    },
    tts: buildEntry(PROVIDER_KEYS.TTS, numberFromEnv('TTS_SHARED_CONCURRENCY_LIMIT', 1)),
  };
}

export async function captureSharedFinalizePressureSnapshot({ now = Date.now() } = {}) {
  const [render, backlog, providers] = await Promise.all([
    captureSharedRenderCapacitySnapshot({ now }),
    captureFinalizeBacklogSnapshot({ now }),
    captureSharedProviderPressureSnapshot({ now }),
  ]);
  return {
    generatedAt: new Date(now).toISOString(),
    render,
    backlog,
    providers,
  };
}

export async function reapSharedFinalizePressureState({ now = Date.now() } = {}) {
  const [renderReleased, providerReleased] = await Promise.all([
    reapExpiredSharedRenderLeases({ now }),
    reapExpiredSharedProviderLeases({ now }),
  ]);
  return {
    renderReleased,
    providerReleased,
  };
}

export async function acquireFinalizeOpenAiAdmission({
  ownerId = getFinalizeOwnerIdentity(),
} = {}) {
  if (!isFinalizeSharedControlContext()) return { acquired: false, bypassed: true };
  return await tryAcquireSharedProviderLease({
    providerKey: PROVIDER_KEYS.OPENAI,
    ownerId,
    slotLimit: numberFromEnv('OPENAI_SHARED_CONCURRENCY_LIMIT', 2),
  });
}

export async function releaseFinalizeOpenAiAdmission({
  ownerId = getFinalizeOwnerIdentity(),
} = {}) {
  if (!isFinalizeSharedControlContext()) return false;
  return await releaseSharedProviderLease({
    providerKey: PROVIDER_KEYS.OPENAI,
    ownerId,
  });
}

export function getFinalizeProviderRetryAfterSec(
  result,
  fallback = getSharedOverloadRetryAfterSec()
) {
  return retryAfterSecFromMs(result?.retryAfterMs, fallback);
}

export async function acquireFinalizeStorySearchAdmission({
  ownerId = getFinalizeOwnerIdentity(),
} = {}) {
  if (!isFinalizeSharedControlContext()) return { acquired: false, bypassed: true };
  return await tryAcquireSharedProviderLease({
    providerKey: PROVIDER_KEYS.STORY_SEARCH_ADMISSION,
    ownerId,
    slotLimit: numberFromEnv('STORY_SEARCH_SHARED_CONCURRENCY_LIMIT', 2),
  });
}

export async function releaseFinalizeStorySearchAdmission({
  ownerId = getFinalizeOwnerIdentity(),
} = {}) {
  if (!isFinalizeSharedControlContext()) return false;
  return await releaseSharedProviderLease({
    providerKey: PROVIDER_KEYS.STORY_SEARCH_ADMISSION,
    ownerId,
  });
}

export async function isFinalizeStorySearchProviderCooldownActive(
  provider,
  { now = Date.now() } = {}
) {
  if (!isFinalizeSharedControlContext()) return false;
  const providerState = await getFinalizeStorySearchProviderStatus(provider);
  return Boolean(
    Number.isFinite(providerState?.cooldownUntilMs) && providerState.cooldownUntilMs > Number(now)
  );
}

export async function getFinalizeStorySearchProviderStatus(provider) {
  const providerKey =
    provider === 'pexels'
      ? PROVIDER_KEYS.STORY_SEARCH_PEXELS
      : provider === 'pixabay'
        ? PROVIDER_KEYS.STORY_SEARCH_PIXABAY
        : provider === 'nasa'
          ? PROVIDER_KEYS.STORY_SEARCH_NASA
          : null;
  if (!providerKey) return null;
  return await getSharedProviderState(providerKey);
}

export async function markFinalizeStorySearchProviderSuccess(provider) {
  if (!isFinalizeSharedControlContext()) return null;
  const providerState = await getFinalizeStorySearchProviderStatus(provider);
  if (!providerState) return null;
  return await markSharedProviderSuccess({ providerKey: providerState.providerKey });
}

export async function markFinalizeStorySearchProviderTransientFailure(provider, errorCode) {
  if (!isFinalizeSharedControlContext()) return null;
  const providerState = await getFinalizeStorySearchProviderStatus(provider);
  if (!providerState) return null;
  return await markSharedProviderTransientFailure({
    providerKey: providerState.providerKey,
    cooldownMs: numberFromEnv('STORY_SEARCH_PROVIDER_COOLDOWN_MS', 60_000),
    threshold: numberFromEnv('STORY_SEARCH_PROVIDER_FAILURE_THRESHOLD', 2),
    errorCode,
  });
}

export async function acquireFinalizeTtsAdmission({ ownerId = getFinalizeOwnerIdentity() } = {}) {
  if (!isFinalizeSharedControlContext()) return { acquired: false, bypassed: true };
  return await tryAcquireSharedProviderLease({
    providerKey: PROVIDER_KEYS.TTS,
    ownerId,
    slotLimit: numberFromEnv('TTS_SHARED_CONCURRENCY_LIMIT', 1),
    minGapMs: numberFromEnv('TTS_RATE_LIMIT_MIN_GAP_MS', 500),
  });
}

export async function releaseFinalizeTtsAdmission({ ownerId = getFinalizeOwnerIdentity() } = {}) {
  if (!isFinalizeSharedControlContext()) return false;
  return await releaseSharedProviderLease({
    providerKey: PROVIDER_KEYS.TTS,
    ownerId,
  });
}

export async function markFinalizeTtsSuccess() {
  if (!isFinalizeSharedControlContext()) return null;
  return await markSharedProviderSuccess({ providerKey: PROVIDER_KEYS.TTS });
}

export async function markFinalizeTtsQuotaCooldown({
  errorCode = 'insufficient_quota',
  cooldownMs = 10 * 60_000,
} = {}) {
  if (!isFinalizeSharedControlContext()) return null;
  return await markSharedProviderTransientFailure({
    providerKey: PROVIDER_KEYS.TTS,
    cooldownMs,
    threshold: 1,
    errorCode,
  });
}

export async function isFinalizeTtsCooldownActive({ now = Date.now() } = {}) {
  if (!isFinalizeSharedControlContext()) return false;
  return await isSharedProviderCooldownActive(PROVIDER_KEYS.TTS, { now });
}

export function getFinalizePressureConfig() {
  return {
    renderLimit: getSharedRenderLimit(),
    renderLeaseMs: getSharedRenderLeaseMs(),
    renderHeartbeatMs: getSharedRenderHeartbeatMs(),
    backlogLimit: getSharedBacklogLimit(),
    overloadRetryAfterSec: getSharedOverloadRetryAfterSec(),
    providerLeaseMs: getSharedProviderLeaseMs(),
    openAiSharedLimit: numberFromEnv('OPENAI_SHARED_CONCURRENCY_LIMIT', 2),
    storySearchSharedLimit: numberFromEnv('STORY_SEARCH_SHARED_CONCURRENCY_LIMIT', 2),
    storySearchProviderCooldownMs: numberFromEnv('STORY_SEARCH_PROVIDER_COOLDOWN_MS', 60_000),
    storySearchProviderFailureThreshold: numberFromEnv(
      'STORY_SEARCH_PROVIDER_FAILURE_THRESHOLD',
      2
    ),
    ttsSharedLimit: numberFromEnv('TTS_SHARED_CONCURRENCY_LIMIT', 1),
    ttsMinGapMs: numberFromEnv('TTS_RATE_LIMIT_MIN_GAP_MS', 500),
  };
}

export default {
  PROVIDER_KEYS,
  acquireFinalizeOpenAiAdmission,
  acquireFinalizeStorySearchAdmission,
  acquireFinalizeTtsAdmission,
  acquireSharedRenderLease,
  captureFinalizeBacklogSnapshot,
  captureSharedFinalizePressureSnapshot,
  captureSharedProviderPressureSnapshot,
  captureSharedRenderCapacitySnapshot,
  getFinalizeProviderRetryAfterSec,
  getFinalizeOwnerIdentity,
  getFinalizePressureConfig,
  isFinalizeSharedControlContext,
  isFinalizeStorySearchProviderCooldownActive,
  isFinalizeTtsCooldownActive,
  markFinalizeStorySearchProviderSuccess,
  markFinalizeStorySearchProviderTransientFailure,
  markFinalizeTtsQuotaCooldown,
  markFinalizeTtsSuccess,
  heartbeatSharedRenderLease,
  reapExpiredSharedProviderLeases,
  reapExpiredSharedRenderLeases,
  reapSharedFinalizePressureState,
  releaseFinalizeOpenAiAdmission,
  releaseFinalizeStorySearchAdmission,
  releaseFinalizeTtsAdmission,
  releaseSharedRenderLease,
  shouldRejectFinalizeAdmissionForBackpressure,
  tryAcquireSharedProviderLease,
  withSharedFinalizeRenderLease,
};
