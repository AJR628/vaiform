process.env.VAIFORM_DEBUG = '1';

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readDoc,
  readStorySession,
  resetHarnessState,
  seedStorySession,
  startHarness,
  stopHarness,
} from '../contracts/helpers/phase4a-harness.js';
import { runWithFinalizeObservabilityContext } from '../../src/observability/finalize-observability.js';
import { setRuntimeOverride } from '../../src/testing/runtime-overrides.js';
import { readQueryLog, seedDoc } from '../../src/testing/firebase-admin.mock.js';

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

function buildFinalizeContext({
  sessionId = 'story-phase4-shared',
  attemptId,
  executionAttemptId,
  workerId,
}) {
  return {
    sourceRole: 'worker',
    uid: 'user-1',
    sessionId,
    attemptId,
    finalizeJobId: attemptId,
    executionAttemptId,
    workerId,
  };
}

function buildSearchSession(sessionId) {
  const now = new Date().toISOString();
  return {
    id: sessionId,
    uid: 'user-1',
    status: 'planned',
    createdAt: now,
    updatedAt: now,
    input: {
      text: 'How small systems compound',
      type: 'paragraph',
    },
    plan: [
      {
        sentenceIndex: 0,
        visualDescription: 'compounding systems',
        searchQuery: 'productivity systems',
        durationSec: 4,
      },
    ],
  };
}

function seedFinalizeAttempt(id, patch = {}) {
  const now = patch.createdAt || new Date('2026-04-27T12:00:00.000Z').toISOString();
  seedDoc('idempotency', id, {
    flow: 'story.finalize',
    uid: 'user-1',
    attemptId: id,
    sessionId: `session-${id}`,
    state: patch.state || 'queued',
    jobState: patch.jobState || patch.state || 'queued',
    isActive: patch.isActive === undefined ? true : patch.isActive,
    createdAt: now,
    enqueuedAt: patch.enqueuedAt || now,
    updatedAt: now,
    ...patch,
  });
}

function latestIdempotencyQuery() {
  return readQueryLog()
    .filter((entry) => entry.collectionName === 'idempotency')
    .at(-1);
}

function idempotencyQueries() {
  return readQueryLog().filter((entry) => entry.collectionName === 'idempotency');
}

function hasFilter(query, field, op, value) {
  return query.filters?.some(
    (filter) =>
      filter.field === field &&
      filter.op === op &&
      (Array.isArray(value)
        ? JSON.stringify(filter.value) === JSON.stringify(value)
        : filter.value === value)
  );
}

function finalizeQueueMetricsQueries() {
  return idempotencyQueries().filter(
    (query) =>
      hasFilter(query, 'flow', '==', 'story.finalize') &&
      hasFilter(query, 'isActive', '==', true) &&
      hasFilter(query, 'jobState', 'in', ['queued', 'claimed', 'started', 'retry_scheduled'])
  );
}

function finalizeClaimQueries() {
  return idempotencyQueries().filter(
    (query) =>
      hasFilter(query, 'flow', '==', 'story.finalize') &&
      hasFilter(query, 'state', '==', 'queued') &&
      query.limitCount === 10
  );
}

function assertActiveFinalizeQueryShape(query, { expectedLimit }) {
  assert.ok(query, 'expected an idempotency query to be recorded');
  assert.equal(query.limitCount, expectedLimit);
  assert.deepEqual(query.order, null);
  assert.deepEqual(query.filters, [
    { field: 'flow', op: '==', value: 'story.finalize' },
    { field: 'isActive', op: '==', value: true },
    {
      field: 'jobState',
      op: 'in',
      value: ['queued', 'claimed', 'started', 'retry_scheduled'],
    },
  ]);
}

async function waitForAsync(predicate, { timeoutMs = 1000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('waitForAsync timed out');
}

test.before(async () => {
  await startHarness();
});

test.after(async () => {
  await stopHarness();
});

test.beforeEach(() => {
  resetHarnessState();
});

test('finalize backlog snapshot uses bounded active-state query and ignores historical attempts', async () => {
  const restoreEnv = withEnv({
    STORY_FINALIZE_SHARED_BACKLOG_LIMIT: 4,
  });

  try {
    const control = await import('../../src/services/finalize-control.service.js');

    for (let i = 0; i < 25; i += 1) {
      seedFinalizeAttempt(`historical-${i}`, {
        state: 'done',
        jobState: 'done',
        isActive: false,
      });
    }
    seedFinalizeAttempt('active-queued', { jobState: 'queued', state: 'queued' });
    seedFinalizeAttempt('active-claimed', { jobState: 'claimed', state: 'running' });
    seedFinalizeAttempt('active-started', { jobState: 'started', state: 'running' });
    seedFinalizeAttempt('active-retry', { jobState: 'retry_scheduled', state: 'queued' });

    const snapshot = await control.captureFinalizeBacklogSnapshot({
      now: Date.parse('2026-04-27T12:05:00.000Z'),
    });

    assert.equal(snapshot.backlogDefinition, 'queued + running + retry_scheduled');
    assert.equal(snapshot.queued, 1);
    assert.equal(snapshot.running, 2);
    assert.equal(snapshot.retryScheduled, 1);
    assert.equal(snapshot.backlog, 4);
    assert.equal(snapshot.limit, 4);
    assert.equal(snapshot.overloaded, true);
    assert.equal(snapshot.retryAfterSec, 30);
    assert.equal(snapshot.generatedAt, '2026-04-27T12:05:00.000Z');

    const query = latestIdempotencyQuery();
    assertActiveFinalizeQueryShape(query, { expectedLimit: 5 });
    assert.equal(query.returnedDocCount, 4);
  } finally {
    restoreEnv();
  }
});

test('finalize queue metrics snapshot counts active pressure docs only', async () => {
  const { captureFinalizeQueueMetricsSnapshot } = await import(
    '../../src/services/story-finalize.attempts.js'
  );

  for (let i = 0; i < 25; i += 1) {
    seedFinalizeAttempt(`inactive-${i}`, {
      state: 'done',
      jobState: i % 2 === 0 ? 'done' : 'failed',
      isActive: false,
    });
  }
  seedFinalizeAttempt('queued-oldest', {
    jobState: 'queued',
    state: 'queued',
    createdAt: '2026-04-27T12:00:00.000Z',
    enqueuedAt: '2026-04-27T12:00:00.000Z',
  });
  seedFinalizeAttempt('claimed-running', {
    jobState: 'claimed',
    state: 'running',
    createdAt: '2026-04-27T12:01:00.000Z',
  });
  seedFinalizeAttempt('started-running', {
    jobState: 'started',
    state: 'running',
    createdAt: '2026-04-27T12:02:00.000Z',
  });
  seedFinalizeAttempt('retry-later', {
    jobState: 'retry_scheduled',
    state: 'queued',
    createdAt: '2026-04-27T12:03:00.000Z',
    availableAfter: '2026-04-27T12:10:00.000Z',
  });

  const snapshot = await captureFinalizeQueueMetricsSnapshot({
    now: Date.parse('2026-04-27T12:05:00.000Z'),
  });

  assert.equal(snapshot.queueDepth, 2);
  assert.equal(snapshot.queueOldestAgeSeconds, 300);
  assert.equal(snapshot.jobsRunning, 2);
  assert.equal(snapshot.jobsRetryScheduled, 1);
  assert.equal(snapshot.billingUnsettledJobs, 4);
  assert.deepEqual(snapshot.jobStateCounts, {
    queued: 1,
    claimed: 1,
    started: 1,
    retry_scheduled: 1,
  });

  const query = latestIdempotencyQuery();
  assertActiveFinalizeQueryShape(query, { expectedLimit: 100 });
  assert.equal(query.returnedDocCount, 4);
});

test('stale finalize reaper does not refresh queue metrics when no attempts mutate', async () => {
  const { reapStaleFinalizeAttempts } = await import(
    '../../src/services/story-finalize.attempts.js'
  );

  seedFinalizeAttempt('user-1:not-stale-queued', {
    attemptId: 'not-stale-queued',
    sessionId: 'story-not-stale-queued',
    state: 'queued',
    jobState: 'queued',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });

  await reapStaleFinalizeAttempts();
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(finalizeQueueMetricsQueries().length, 0);
  assert.equal(readDoc('idempotency', 'user-1:not-stale-queued')?.state, 'queued');
});

test('stale finalize reaper mutates queued and running attempts and refreshes queue metrics once', async () => {
  const { reapStaleFinalizeAttempts } = await import(
    '../../src/services/story-finalize.attempts.js'
  );
  const staleIso = new Date(Date.now() - 60_000).toISOString();

  seedFinalizeAttempt('user-1:stale-queued', {
    attemptId: 'stale-queued',
    sessionId: 'story-stale-queued',
    state: 'queued',
    jobState: 'queued',
    expiresAt: staleIso,
  });
  seedFinalizeAttempt('user-1:stale-running', {
    attemptId: 'stale-running',
    sessionId: 'story-stale-running',
    state: 'running',
    jobState: 'started',
    leaseExpiresAt: staleIso,
    runnerId: 'lost-runner',
  });

  await reapStaleFinalizeAttempts();
  await waitForAsync(() => finalizeQueueMetricsQueries().length === 1, {
    timeoutMs: 500,
    intervalMs: 10,
  });

  assert.equal(readDoc('idempotency', 'user-1:stale-queued')?.state, 'expired');
  assert.equal(readDoc('idempotency', 'user-1:stale-queued')?.isActive, false);
  assert.equal(readDoc('idempotency', 'user-1:stale-running')?.state, 'failed');
  assert.equal(readDoc('idempotency', 'user-1:stale-running')?.isActive, false);
  assert.equal(finalizeQueueMetricsQueries().length, 1);
});

test('finalize runner backs off empty claim polling and resets after a claim', async () => {
  const { createStoryFinalizeRunner } = await import('../../src/services/story-finalize.runner.js');
  const runner = createStoryFinalizeRunner();

  try {
    await waitForAsync(() => finalizeClaimQueries().length >= 2, {
      timeoutMs: 250,
      intervalMs: 10,
    });

    const emptyClaims = finalizeClaimQueries();
    await new Promise((resolve) => setTimeout(resolve, 90));
    assert.ok(
      finalizeClaimQueries().length <= emptyClaims.length + 1,
      'empty claim loops should slow down instead of polling at the active cadence'
    );

    seedFinalizeAttempt('user-1:runner-backoff-claim', {
      attemptId: 'runner-backoff-claim',
      sessionId: 'story-runner-backoff-claim',
      state: 'queued',
      jobState: 'queued',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    await waitForAsync(
      () => readDoc('idempotency', 'user-1:runner-backoff-claim')?.state !== 'queued',
      {
        timeoutMs: 500,
        intervalMs: 10,
      }
    );

    const claimedQuery = finalizeClaimQueries().find((query) => query.returnedDocCount > 0);
    assert.ok(claimedQuery, 'expected the runner to claim the queued attempt');
    await waitForAsync(
      () =>
        finalizeClaimQueries().some(
          (query) => query.atMs > claimedQuery.atMs && query.atMs - claimedQuery.atMs <= 75
        ),
      {
        timeoutMs: 250,
        intervalMs: 10,
      }
    );
  } finally {
    runner.stop();
  }
});

test('shared render leases enforce global capacity by executionAttemptId and stale leases are reapable', async () => {
  const restoreEnv = withEnv({
    STORY_FINALIZE_SHARED_RENDER_LIMIT: 1,
    STORY_FINALIZE_SHARED_RENDER_LEASE_MS: 30,
  });

  try {
    const control = await import('../../src/services/finalize-control.service.js');
    const firstLease = await control.acquireSharedRenderLease({
      executionAttemptId: 'attempt-render-1:exec:1',
      workerId: 'worker-1',
      leaseMs: 30,
    });
    assert.equal(firstLease.acquired, true);

    const secondLease = await control.acquireSharedRenderLease({
      executionAttemptId: 'attempt-render-2:exec:1',
      workerId: 'worker-2',
      leaseMs: 30,
    });
    assert.equal(secondLease.acquired, false);

    const activeSnapshot = await control.captureSharedRenderCapacitySnapshot();
    assert.equal(activeSnapshot.limit, 1);
    assert.equal(activeSnapshot.activeLeases, 1);
    assert.equal(activeSnapshot.leases[0].executionAttemptId, 'attempt-render-1:exec:1');
    assert.equal(activeSnapshot.leases[0].workerId, 'worker-1');

    const released = await control.releaseSharedRenderLease({
      executionAttemptId: 'attempt-render-1:exec:1',
      workerId: 'worker-1',
    });
    assert.equal(released, true);

    const releasedSnapshot = await control.captureSharedRenderCapacitySnapshot();
    assert.equal(releasedSnapshot.activeLeases, 0);

    const staleLease = await control.acquireSharedRenderLease({
      executionAttemptId: 'attempt-render-3:exec:1',
      workerId: 'worker-3',
      leaseMs: 20,
    });
    assert.equal(staleLease.acquired, true);

    const reaped = await control.reapExpiredSharedRenderLeases({
      now: Date.now() + 40,
    });
    assert.equal(reaped, 1);

    const reacquired = await control.acquireSharedRenderLease({
      executionAttemptId: 'attempt-render-4:exec:1',
      workerId: 'worker-4',
      leaseMs: 20,
    });
    assert.equal(reacquired.acquired, true);
  } finally {
    restoreEnv();
  }
});

test('finalize OpenAI admission is shared across contexts', async () => {
  const restoreEnv = withEnv({
    OPENAI_SHARED_CONCURRENCY_LIMIT: 1,
    STORY_FINALIZE_SHARED_PROVIDER_LEASE_MS: 500,
  });

  try {
    const { generateStoryFromInput } = await import('../../src/services/story.llm.service.js');
    const control = await import('../../src/services/finalize-control.service.js');

    let releaseFirst;
    const firstBlocked = new Promise((resolve) => {
      releaseFirst = resolve;
    });

    setRuntimeOverride('story.llm.generateStoryFromInput', async () => {
      await firstBlocked;
      return {
        sentences: ['Hook', 'Beat 1', 'Beat 2', 'Beat 3', 'Beat 4', 'Beat 5', 'Outro'],
        totalDurationSec: 32,
      };
    });

    const firstCall = runWithFinalizeObservabilityContext(
      buildFinalizeContext({
        attemptId: 'attempt-openai-1',
        executionAttemptId: 'attempt-openai-1:exec:1',
        workerId: 'worker-openai-1',
      }),
      () => generateStoryFromInput({ input: 'idea', inputType: 'idea' })
    );

    await waitForAsync(async () => {
      const snapshot = await control.captureSharedProviderPressureSnapshot();
      return snapshot.openai.activeLeases === 1;
    });

    const secondError = await runWithFinalizeObservabilityContext(
      buildFinalizeContext({
        attemptId: 'attempt-openai-2',
        executionAttemptId: 'attempt-openai-2:exec:1',
        workerId: 'worker-openai-2',
      }),
      async () => {
        try {
          await generateStoryFromInput({ input: 'idea', inputType: 'idea' });
          return null;
        } catch (error) {
          return error;
        }
      }
    );

    assert.equal(secondError?.code, 'STORY_GENERATE_BUSY');

    releaseFirst();
    await firstCall;

    const releasedSnapshot = await control.captureSharedProviderPressureSnapshot();
    assert.equal(releasedSnapshot.openai.activeLeases, 0);
  } finally {
    restoreEnv();
  }
});

test('finalize story search observes shared provider cooldown across contexts', async () => {
  const restoreEnv = withEnv({
    STORY_SEARCH_PROVIDER_FAILURE_THRESHOLD: 1,
  });

  try {
    const { searchShots } = await import('../../src/services/story.service.js');
    const control = await import('../../src/services/finalize-control.service.js');

    seedStorySession('user-1', buildSearchSession('story-shared-search-cooldown'));

    await runWithFinalizeObservabilityContext(
      buildFinalizeContext({
        sessionId: 'story-shared-search-cooldown',
        attemptId: 'attempt-search-1',
        executionAttemptId: 'attempt-search-1:exec:1',
        workerId: 'worker-search-1',
      }),
      async () => {
        await control.markFinalizeStorySearchProviderTransientFailure('pexels', 'HTTP_429');
        await control.markFinalizeStorySearchProviderTransientFailure('pixabay', 'HTTP_429');
      }
    );

    const error = await runWithFinalizeObservabilityContext(
      buildFinalizeContext({
        sessionId: 'story-shared-search-cooldown',
        attemptId: 'attempt-search-2',
        executionAttemptId: 'attempt-search-2:exec:1',
        workerId: 'worker-search-2',
      }),
      async () => {
        try {
          await searchShots({ uid: 'user-1', sessionId: 'story-shared-search-cooldown' });
          return null;
        } catch (err) {
          return err;
        }
      }
    );

    assert.equal(error?.code, 'STORY_SEARCH_TEMPORARILY_UNAVAILABLE');
    assert.equal(readStorySession('user-1', 'story-shared-search-cooldown')?.shots, undefined);
  } finally {
    restoreEnv();
  }
});

test('finalize TTS observes shared cooldown across contexts without changing the soft-fail envelope', async () => {
  const restoreEnv = withEnv({
    TTS_PROVIDER: 'openai',
    OPENAI_API_KEY: 'test-openai-key',
  });

  try {
    const { getLastTtsState, synthVoice } = await import('../../src/services/tts.service.js');
    const control = await import('../../src/services/finalize-control.service.js');

    await runWithFinalizeObservabilityContext(
      buildFinalizeContext({
        attemptId: 'attempt-tts-1',
        executionAttemptId: 'attempt-tts-1:exec:1',
        workerId: 'worker-tts-1',
      }),
      async () => {
        await control.markFinalizeTtsQuotaCooldown({ errorCode: 'insufficient_quota' });
      }
    );

    const result = await runWithFinalizeObservabilityContext(
      buildFinalizeContext({
        attemptId: 'attempt-tts-2',
        executionAttemptId: 'attempt-tts-2:exec:1',
        workerId: 'worker-tts-2',
      }),
      () =>
        synthVoice({
          text: 'Hello from shared cooldown',
          voiceId: 'alloy',
          modelId: 'gpt-4o-mini-tts',
          outputFormat: 'mp3',
        })
    );

    assert.equal(result.audioPath, null);
    assert.equal(result.durationMs, null);
    assert.equal(getLastTtsState().code, 'tts_shared_cooldown_active');
  } finally {
    restoreEnv();
  }
});
