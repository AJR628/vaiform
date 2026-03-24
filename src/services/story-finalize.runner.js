import logger from '../observability/logger.js';
import { withRenderSlot, RENDER_SLOT_LIMIT } from '../utils/render.semaphore.js';
import { finalizeStory, persistStoryRenderRecovery } from './story.service.js';
import {
  FINALIZE_REAPER_INTERVAL_MS,
  FINALIZE_RUNNER_HEARTBEAT_MS,
  FINALIZE_RUNNER_LEASE_MS,
  FINALIZE_RUNNER_POLL_MS,
  claimNextFinalizeAttempt,
  finalizeAttemptFailure,
  heartbeatFinalizeAttempt,
  mapFinalizeFailureFromError,
  markFinalizeAttemptQueuedForRetry,
  reapStaleFinalizeAttempts,
  settleFinalizeAttemptSuccess,
} from './story-finalize.attempts.js';

const RUNNER_KEY = Symbol.for('vaiform.storyFinalizeRunner');
const TEST_MODE = process.env.NODE_ENV === 'test' && process.env.VAIFORM_TEST_MODE === '1';

function createRunner() {
  const runnerId = `story-finalize-runner-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  const inflight = new Map();

  let stopped = false;
  let pollTimer = null;
  let reaperTimer = null;
  let draining = false;

  const schedulePoll = (delayMs = FINALIZE_RUNNER_POLL_MS) => {
    if (stopped) return;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void drainQueue();
    }, delayMs);
    pollTimer.unref?.();
  };

  const scheduleReaper = () => {
    if (stopped) return;
    if (reaperTimer) clearTimeout(reaperTimer);
    reaperTimer = setTimeout(async () => {
      reaperTimer = null;
      try {
        await reapStaleFinalizeAttempts();
      } catch (error) {
        logger.error('story.finalize.runner.reaper_failed', {
          runnerId,
          error,
        });
      } finally {
        scheduleReaper();
      }
    }, FINALIZE_REAPER_INTERVAL_MS);
    reaperTimer.unref?.();
  };

  const runAttempt = async (attempt) => {
    const heartbeat = setInterval(() => {
      void heartbeatFinalizeAttempt({
        uid: attempt.uid,
        attemptId: attempt.attemptId,
        runnerId,
        leaseMs: FINALIZE_RUNNER_LEASE_MS,
      });
    }, FINALIZE_RUNNER_HEARTBEAT_MS);
    heartbeat.unref?.();

    try {
      const session = await withRenderSlot(() =>
        finalizeStory({
          uid: attempt.uid,
          sessionId: attempt.sessionId,
          attemptId: attempt.attemptId,
        })
      );
      const shortId = session?.finalVideo?.jobId || null;
      await settleFinalizeAttemptSuccess({
        uid: attempt.uid,
        attemptId: attempt.attemptId,
        session,
        shortId,
        status: 200,
      });
    } catch (error) {
      if (error?.code === 'SERVER_BUSY' || error?.message === 'SERVER_BUSY') {
        await markFinalizeAttemptQueuedForRetry({
          uid: attempt.uid,
          attemptId: attempt.attemptId,
          runnerId,
        });
        return;
      }

      const mapped = mapFinalizeFailureFromError(error);
      await persistStoryRenderRecovery({
        uid: attempt.uid,
        sessionId: attempt.sessionId,
        attemptId: attempt.attemptId,
        state: 'failed',
        error: {
          code: mapped.error,
          message: mapped.detail,
        },
      }).catch((persistError) => {
        logger.error('story.finalize.runner.recovery_failure_persist_failed', {
          runnerId,
          attemptId: attempt.attemptId,
          sessionId: attempt.sessionId,
          error: persistError,
        });
      });

      await finalizeAttemptFailure({
        uid: attempt.uid,
        attemptId: attempt.attemptId,
        status: mapped.status,
        error: mapped.error,
        detail: mapped.detail,
      });
    } finally {
      clearInterval(heartbeat);
    }
  };

  const drainQueue = async () => {
    if (stopped || draining) return;
    draining = true;
    try {
      while (!stopped && inflight.size < RENDER_SLOT_LIMIT) {
        const attempt = await claimNextFinalizeAttempt({
          runnerId,
          leaseMs: FINALIZE_RUNNER_LEASE_MS,
        });
        if (!attempt) break;

        const task = runAttempt(attempt)
          .catch((error) => {
            logger.error('story.finalize.runner.task_failed', {
              runnerId,
              attemptId: attempt.attemptId,
              sessionId: attempt.sessionId,
              error,
            });
          })
          .finally(() => {
            inflight.delete(attempt.attemptId);
            schedulePoll(0);
          });
        inflight.set(attempt.attemptId, task);
      }
    } finally {
      draining = false;
      schedulePoll();
    }
  };

  const notify = () => {
    if (stopped) return;
    schedulePoll(0);
  };

  const stop = () => {
    stopped = true;
    if (pollTimer) clearTimeout(pollTimer);
    if (reaperTimer) clearTimeout(reaperTimer);
    pollTimer = null;
    reaperTimer = null;
  };

  schedulePoll(TEST_MODE ? 0 : FINALIZE_RUNNER_POLL_MS);
  scheduleReaper();

  return {
    runnerId,
    notify,
    stop,
  };
}

export function ensureStoryFinalizeRunner() {
  if (!globalThis[RUNNER_KEY]) {
    globalThis[RUNNER_KEY] = createRunner();
  }
  return globalThis[RUNNER_KEY];
}

export function notifyStoryFinalizeRunner() {
  ensureStoryFinalizeRunner().notify();
}

export function resetStoryFinalizeRunnerForTests() {
  if (globalThis[RUNNER_KEY]) {
    globalThis[RUNNER_KEY].stop();
    delete globalThis[RUNNER_KEY];
  }
}
