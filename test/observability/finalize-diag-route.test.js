process.env.VAIFORM_DEBUG = '1';

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FINALIZE_EVENTS,
  emitFinalizeEvent,
  resetFinalizeObservabilityForTests,
} from '../../src/observability/finalize-observability.js';
import {
  requestJson,
  resetHarnessState,
  seedFirestoreDoc,
  startHarness,
  stopHarness,
  timestamp,
} from '../contracts/helpers/phase4a-harness.js';

function withEnv(patch) {
  const previous = new Map();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
  return () => {
    for (const [key, value] of previous.entries()) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
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

test('diag finalize control room exposes queue snapshot and recent canonical events', async () => {
  const restoreEnv = withEnv({
    STORY_FINALIZE_SHARED_BACKLOG_LIMIT: 1,
  });

  try {
    seedFirestoreDoc('idempotency', 'user-1:attempt-1', {
      flow: 'story.finalize',
      uid: 'user-1',
      attemptId: 'attempt-1',
      jobId: 'attempt-1',
      externalAttemptId: 'attempt-1',
      sessionId: 'session-1',
      requestId: 'request-1',
      state: 'queued',
      jobState: 'started',
      isActive: true,
      createdAt: timestamp('2026-03-26T10:00:00.000Z'),
      updatedAt: timestamp('2026-03-26T10:00:00.000Z'),
      enqueuedAt: timestamp('2026-03-26T10:00:00.000Z'),
      availableAfter: timestamp('2026-03-26T10:00:00.000Z'),
      currentExecution: {
        executionAttemptId: 'attempt-1:exec:1',
        attemptNumber: 1,
        state: 'running',
        workerId: 'worker-1',
        createdAt: timestamp('2026-03-26T10:00:00.000Z'),
        claimedAt: timestamp('2026-03-26T10:00:05.000Z'),
        startedAt: timestamp('2026-03-26T10:00:06.000Z'),
        finishedAt: null,
        lease: {
          heartbeatAt: timestamp('2026-03-26T10:00:10.000Z'),
          expiresAt: timestamp('2026-03-26T10:01:10.000Z'),
        },
      },
      executionAttempts: [
        {
          executionAttemptId: 'attempt-1:exec:1',
          attemptNumber: 1,
          state: 'running',
          workerId: 'worker-1',
          createdAt: timestamp('2026-03-26T10:00:00.000Z'),
          claimedAt: timestamp('2026-03-26T10:00:05.000Z'),
          startedAt: timestamp('2026-03-26T10:00:06.000Z'),
          finishedAt: null,
          lease: {
            heartbeatAt: timestamp('2026-03-26T10:00:10.000Z'),
            expiresAt: timestamp('2026-03-26T10:01:10.000Z'),
          },
        },
      ],
    });
    seedFirestoreDoc('idempotency', 'user-1:attempt-2', {
      flow: 'story.finalize',
      uid: 'user-1',
      attemptId: 'attempt-2',
      jobId: 'attempt-2',
      externalAttemptId: 'attempt-2',
      sessionId: 'session-2',
      requestId: 'request-2',
      state: 'queued',
      jobState: 'retry_scheduled',
      isActive: true,
      createdAt: timestamp('2026-03-26T10:00:00.000Z'),
      updatedAt: timestamp('2026-03-26T10:00:00.000Z'),
      enqueuedAt: timestamp('2026-03-26T10:00:00.000Z'),
      availableAfter: timestamp('2026-03-26T10:02:00.000Z'),
      currentExecution: {
        executionAttemptId: 'attempt-2:exec:2',
        attemptNumber: 2,
        state: 'created',
        workerId: null,
        createdAt: timestamp('2026-03-26T10:00:00.000Z'),
        claimedAt: null,
        startedAt: null,
        finishedAt: null,
        lease: {
          heartbeatAt: null,
          expiresAt: null,
        },
      },
      executionAttempts: [
        {
          executionAttemptId: 'attempt-2:exec:1',
          attemptNumber: 1,
          state: 'failed_retryable',
          workerId: 'worker-1',
          createdAt: timestamp('2026-03-26T10:00:00.000Z'),
          claimedAt: timestamp('2026-03-26T10:00:05.000Z'),
          startedAt: timestamp('2026-03-26T10:00:06.000Z'),
          finishedAt: timestamp('2026-03-26T10:00:20.000Z'),
          failure: {
            error: 'SERVER_BUSY',
          },
          lease: {
            heartbeatAt: timestamp('2026-03-26T10:00:10.000Z'),
            expiresAt: timestamp('2026-03-26T10:00:40.000Z'),
          },
        },
        {
          executionAttemptId: 'attempt-2:exec:2',
          attemptNumber: 2,
          state: 'created',
          workerId: null,
          createdAt: timestamp('2026-03-26T10:01:00.000Z'),
          claimedAt: null,
          startedAt: null,
          finishedAt: null,
          lease: {
            heartbeatAt: null,
            expiresAt: null,
          },
        },
      ],
    });
    seedFirestoreDoc('finalizeControlRenderSlots', 'render-slot-1', {
      controlType: 'render',
      slotId: 'render-slot-1',
      state: 'leased',
      executionAttemptId: 'attempt-1:exec:1',
      workerId: 'worker-1',
      leasedAt: timestamp('2026-03-26T10:00:06.000Z'),
      heartbeatAt: timestamp('2026-03-26T10:00:10.000Z'),
      leaseExpiresAt: timestamp('2099-03-26T10:01:10.000Z'),
      updatedAt: timestamp('2026-03-26T10:00:10.000Z'),
    });
    seedFirestoreDoc('finalizeControlProviderSlots', 'openai:slot-1', {
      controlType: 'provider',
      providerKey: 'openai',
      slotId: 'openai:slot-1',
      state: 'leased',
      ownerId: 'attempt-1:exec:1',
      leaseExpiresAt: timestamp('2099-03-26T10:01:10.000Z'),
      updatedAt: timestamp('2026-03-26T10:00:10.000Z'),
    });
    seedFirestoreDoc('finalizeControlProviderStates', 'tts', {
      providerKey: 'tts',
      failureCount: 1,
      cooldownUntil: timestamp('2099-03-26T10:05:00.000Z'),
      updatedAt: timestamp('2026-03-26T10:00:10.000Z'),
      lastFailureCode: 'insufficient_quota',
    });

    emitFinalizeEvent('info', FINALIZE_EVENTS.API_ACCEPTED, {
      sourceRole: 'api',
      requestId: 'request-1',
      uid: 'user-1',
      sessionId: 'session-1',
      attemptId: 'attempt-1',
      finalizeJobId: 'attempt-1',
      executionAttemptId: 'attempt-1:exec:1',
      queueDepth: 1,
      stage: 'queue_enqueue',
    });

    const { status, json } = await requestJson('/diag/finalize-control-room', { auth: false });

    assert.equal(status, 200);
    assert.equal(json.success, true);
    assert.equal(json.source, 'diagnostic_only');
    assert.equal(json.queueSnapshot.queueDepth, 1);
    assert.equal(json.queueSnapshot.jobsRunning, 1);
    assert.equal(json.queueSnapshot.jobsRetryScheduled, 1);
    assert.equal(json.queueSnapshot.jobStateCounts.started, 1);
    assert.equal(json.queueSnapshot.jobStateCounts.retry_scheduled, 1);
    assert.equal(json.sharedSystemPressure.backlog.backlogDefinition, 'queued + running + retry_scheduled');
    assert.equal(json.sharedSystemPressure.backlog.backlog, 2);
    assert.equal(json.sharedSystemPressure.backlog.overloaded, true);
    assert.equal(json.sharedSystemPressure.render.activeLeases, 1);
    assert.equal(json.sharedSystemPressure.render.leases[0].executionAttemptId, 'attempt-1:exec:1');
    assert.equal(json.sharedSystemPressure.providers.openai.activeLeases, 1);
    assert.equal(json.sharedSystemPressure.providers.tts.cooldownActive, true);
    assert.equal(json.pressureConfig.backlogLimit, 1);
    assert.equal(json.finalizeStorageTruth, 'phase3_canonical_job_on_existing_durable_doc');
    assert.equal(json.executionLineage, 'embedded_execution_attempts_on_same_doc');
    assert.ok(
      Array.isArray(json.localProcessObservability?.recentEvents) &&
        json.localProcessObservability.recentEvents.some(
          (event) => event.event === FINALIZE_EVENTS.API_ACCEPTED
        )
    );
  } finally {
    restoreEnv();
  }
});
