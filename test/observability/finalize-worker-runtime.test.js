process.env.VAIFORM_DEBUG = '1';

import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import {
  FINALIZE_EVENTS,
  resetFinalizeObservabilityForTests,
  snapshotFinalizeObservability,
} from '../../src/observability/finalize-observability.js';
import {
  readDoc,
  readStorySession,
  requestJson,
  resetHarnessState,
  seedStorySession,
  seedUserDoc,
  setRuntimeOverride,
  startHarness,
  stopHarness,
  waitFor,
} from '../contracts/helpers/phase4a-harness.js';

const RUNNER_KEY = Symbol.for('vaiform.storyFinalizeRunner');

function buildStorySession(sessionId) {
  const now = new Date().toISOString();
  return {
    id: sessionId,
    uid: 'user-1',
    status: 'draft',
    styleKey: 'default',
    createdAt: now,
    updatedAt: now,
    input: {
      text: 'Why deliberate practice compounds faster than motivation.',
      type: 'paragraph',
    },
    billingEstimate: {
      estimatedSec: 12,
      source: 'heuristic',
      updatedAt: now,
    },
  };
}

async function installFinalizeSuccessOverride() {
  const { saveStorySession } = await import('../../src/services/story.service.js');
  setRuntimeOverride('story.service.finalizeStory', async ({ uid, sessionId, attemptId }) => {
    const existing = readStorySession(uid, sessionId);
    const now = new Date().toISOString();
    const shortId = `short-${attemptId}`;
    const session = {
      ...existing,
      status: 'rendered',
      updatedAt: now,
      finalVideo: {
        jobId: shortId,
        durationSec: 12,
        url: `https://cdn.example.com/${shortId}.mp4`,
        thumbUrl: `https://cdn.example.com/${shortId}.jpg`,
      },
      renderRecovery: {
        state: 'done',
        attemptId,
        startedAt: existing?.renderRecovery?.startedAt || now,
        updatedAt: now,
        finishedAt: now,
        failedAt: null,
        shortId,
        code: null,
        message: null,
      },
    };
    await saveStorySession({ uid, sessionId, data: session });
    return session;
  });
}

async function startWorkerRuntime() {
  const workerModule = await import('../../src/workers/story-finalize.worker.js');
  return {
    runtime: workerModule.startStoryFinalizeWorkerRuntime({ installSignalHandlers: false }),
    stop: (signal = 'test_stop') => workerModule.stopStoryFinalizeWorkerRuntime(signal),
  };
}

test.before(async () => {
  await startHarness();
});

test.after(async () => {
  await stopHarness();
});

test.beforeEach(() => {
  resetHarnessState();
  resetFinalizeObservabilityForTests();
});

test('API startup does not bootstrap finalize execution and accepted finalize stays queued while workers are down', async () => {
  const sessionId = 'story-phase2-api-only';
  const attemptId = 'attempt-phase2-api-only';

  seedUserDoc('user-1', {
    plan: 'creator',
    usage: {
      cycleIncludedSec: 600,
      cycleUsedSec: 0,
      cycleReservedSec: 0,
    },
  });
  seedStorySession('user-1', buildStorySession(sessionId));

  assert.equal(globalThis[RUNNER_KEY], undefined);

  const result = await requestJson('/api/story/finalize', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': attemptId },
    body: { sessionId },
  });

  assert.equal(result.status, 202);
  assert.equal(result.json.success, true);
  assert.equal(result.json.finalize?.attemptId, attemptId);
  assert.equal(result.json.finalize?.state, 'pending');
  assert.equal(globalThis[RUNNER_KEY], undefined);

  await delay(125);

  const attemptDoc = readDoc('idempotency', `user-1:${attemptId}`);
  assert.equal(attemptDoc.state, 'queued');
  assert.equal(attemptDoc.isActive, true);
  assert.equal(attemptDoc.schemaVersion, 3);
  assert.equal(attemptDoc.jobId, attemptId);
  assert.equal(attemptDoc.externalAttemptId, attemptId);
  assert.equal(attemptDoc.jobState, 'queued');
  assert.equal(attemptDoc.currentExecution.executionAttemptId, `${attemptId}:exec:1`);
  assert.equal(attemptDoc.currentExecution.state, 'created');
  assert.equal(attemptDoc.executionAttempts.length, 1);
  assert.equal(attemptDoc.executionAttempts[0].executionAttemptId, `${attemptId}:exec:1`);
  assert.equal(attemptDoc.executionAttempts[0].state, 'created');
  assert.equal(readStorySession('user-1', sessionId)?.renderRecovery?.state, 'pending');
});

test('an accepted finalize remains queued while workers are down and completes after worker startup without client resubmission', async () => {
  const sessionId = 'story-phase2-delayed-worker';
  const attemptId = 'attempt-phase2-delayed-worker';

  seedUserDoc('user-1', {
    plan: 'creator',
    usage: {
      cycleIncludedSec: 600,
      cycleUsedSec: 0,
      cycleReservedSec: 0,
    },
  });
  seedStorySession('user-1', buildStorySession(sessionId));
  await installFinalizeSuccessOverride();

  const result = await requestJson('/api/story/finalize', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': attemptId },
    body: { sessionId },
  });

  assert.equal(result.status, 202);
  assert.equal(readDoc('idempotency', `user-1:${attemptId}`)?.state, 'queued');
  assert.equal(globalThis[RUNNER_KEY], undefined);

  const worker = await startWorkerRuntime();

  try {
    await waitFor(() => readDoc('idempotency', `user-1:${attemptId}`)?.state === 'done', {
      timeoutMs: 1500,
      intervalMs: 25,
    });
  } finally {
    worker.stop();
  }

  const attemptDoc = readDoc('idempotency', `user-1:${attemptId}`);
  const session = readStorySession('user-1', sessionId);
  const snapshot = snapshotFinalizeObservability();

  assert.equal(attemptDoc.state, 'done');
  assert.equal(attemptDoc.shortId, `short-${attemptId}`);
  assert.equal(attemptDoc.jobId, attemptId);
  assert.equal(attemptDoc.jobState, 'settled');
  assert.equal(attemptDoc.executionAttempts.length, 1);
  assert.equal(attemptDoc.executionAttempts[0].executionAttemptId, `${attemptId}:exec:1`);
  assert.equal(attemptDoc.executionAttempts[0].state, 'succeeded');
  assert.equal(attemptDoc.currentExecution.executionAttemptId, `${attemptId}:exec:1`);
  assert.equal(attemptDoc.currentExecution.state, 'succeeded');
  assert.equal(session?.renderRecovery?.state, 'done');
  assert.equal(session?.renderRecovery?.attemptId, attemptId);
  assert.equal(session?.finalVideo?.jobId, `short-${attemptId}`);
  assert.ok(snapshot.recentEvents.some((event) => event.event === FINALIZE_EVENTS.WORKER_STARTED));
  assert.ok(
    snapshot.recentEvents.some(
      (event) =>
        event.event === FINALIZE_EVENTS.JOB_CLAIMED &&
        event.executionAttemptId === `${attemptId}:exec:1` &&
        event.finalizeJobId === attemptId
    )
  );
  assert.ok(
    snapshot.recentEvents.some(
      (event) =>
        event.event === FINALIZE_EVENTS.JOB_STARTED &&
        event.executionAttemptId === `${attemptId}:exec:1` &&
        event.finalizeJobId === attemptId
    )
  );
  assert.ok(
    snapshot.recentEvents.some(
      (event) =>
        event.event === FINALIZE_EVENTS.JOB_COMPLETED &&
        event.executionAttemptId === `${attemptId}:exec:1` &&
        event.finalizeJobId === attemptId
    )
  );
  assert.ok(
    snapshot.recentEvents.some(
      (event) =>
        event.event === FINALIZE_EVENTS.JOB_SETTLED &&
        event.executionAttemptId === `${attemptId}:exec:1` &&
        event.finalizeJobId === attemptId
    )
  );
});

test('worker runtime can restart without changing API admission handling', async () => {
  const sessionId = 'story-phase2-worker-restart';
  const attemptId = 'attempt-phase2-worker-restart';

  seedUserDoc('user-1', {
    plan: 'creator',
    usage: {
      cycleIncludedSec: 600,
      cycleUsedSec: 0,
      cycleReservedSec: 0,
    },
  });
  seedStorySession('user-1', buildStorySession(sessionId));
  await installFinalizeSuccessOverride();

  let worker = await startWorkerRuntime();
  worker.stop('test_restart_before_admission');

  assert.equal(globalThis[RUNNER_KEY], undefined);

  const result = await requestJson('/api/story/finalize', {
    method: 'POST',
    headers: { 'X-Idempotency-Key': attemptId },
    body: { sessionId },
  });

  assert.equal(result.status, 202);
  assert.equal(readDoc('idempotency', `user-1:${attemptId}`)?.state, 'queued');

  worker = await startWorkerRuntime();
  try {
    await waitFor(() => readDoc('idempotency', `user-1:${attemptId}`)?.state === 'done', {
      timeoutMs: 1500,
      intervalMs: 25,
    });
  } finally {
    worker.stop('test_restart_cleanup');
  }

  assert.equal(readDoc('idempotency', `user-1:${attemptId}`)?.state, 'done');
  assert.equal(readStorySession('user-1', sessionId)?.renderRecovery?.attemptId, attemptId);
});
