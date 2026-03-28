process.env.VAIFORM_DEBUG = '1';

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  readStorySession,
  resetHarnessState,
  seedStorySession,
  startHarness,
  stopHarness,
} from '../contracts/helpers/phase4a-harness.js';
import { runWithFinalizeObservabilityContext } from '../../src/observability/finalize-observability.js';
import { setRuntimeOverride } from '../../src/testing/runtime-overrides.js';

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
