import logger from '../observability/logger.js';
import {
  FINALIZE_EVENTS,
  FINALIZE_SOURCE_ROLES,
  FINALIZE_STAGES,
  describeFinalizeError,
  emitFinalizeEvent,
  runWithFinalizeObservabilityContext,
} from '../observability/finalize-observability.js';
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
  refreshFinalizeQueueMetrics,
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

  const currentWorkerMetrics = () => ({
    workersActive: stopped ? 0 : 1,
    jobsRunning: inflight.size,
    workerSaturationRatio: Number((inflight.size / RENDER_SLOT_LIMIT).toFixed(3)),
  });

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
        emitFinalizeEvent('error', FINALIZE_EVENTS.WORKER_CLAIM_LOOP_ERROR, {
          sourceRole: FINALIZE_SOURCE_ROLES.WORKER,
          workerId: runnerId,
          error,
          failureReason: 'reaper_failed',
          ...currentWorkerMetrics(),
          ...describeFinalizeError(error, {
            retryable: false,
            failureReason: 'reaper_failed',
          }),
        });
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
    return await runWithFinalizeObservabilityContext(
      {
        sourceRole: FINALIZE_SOURCE_ROLES.WORKER,
        requestId: attempt.requestId ?? null,
        uid: attempt.uid,
        sessionId: attempt.sessionId,
        attemptId: attempt.attemptId,
        workerId: runnerId,
        jobState: attempt.state,
        queuedAt: attempt.enqueuedAt ?? null,
        startedAt: attempt.startedAt ?? null,
      },
      async () => {
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
          emitFinalizeEvent('info', FINALIZE_EVENTS.JOB_STARTED, {
            sourceRole: FINALIZE_SOURCE_ROLES.WORKER,
            requestId: attempt.requestId ?? null,
            uid: attempt.uid,
            sessionId: attempt.sessionId,
            attemptId: attempt.attemptId,
            workerId: runnerId,
            jobState: 'running',
            stage: FINALIZE_STAGES.WORKER_CLAIM,
            queuedAt: attempt.enqueuedAt ?? null,
            startedAt: attempt.startedAt ?? null,
            ...currentWorkerMetrics(),
          });
          const session = await withRenderSlot(() =>
            finalizeStory({
              uid: attempt.uid,
              sessionId: attempt.sessionId,
              attemptId: attempt.attemptId,
            })
          );
          const shortId = session?.finalVideo?.jobId || null;
          emitFinalizeEvent('info', FINALIZE_EVENTS.JOB_COMPLETED, {
            sourceRole: FINALIZE_SOURCE_ROLES.WORKER,
            requestId: attempt.requestId ?? null,
            uid: attempt.uid,
            sessionId: attempt.sessionId,
            attemptId: attempt.attemptId,
            workerId: runnerId,
            shortId,
            jobState: 'completed',
            stage: FINALIZE_STAGES.PERSIST_RECOVERY,
            durationMs: Number.isFinite(Date.parse(attempt.enqueuedAt))
              ? Date.now() - Date.parse(attempt.enqueuedAt)
              : null,
            ...currentWorkerMetrics(),
          });
          await settleFinalizeAttemptSuccess({
            uid: attempt.uid,
            attemptId: attempt.attemptId,
            session,
            shortId,
            status: 200,
          });
          await refreshFinalizeQueueMetrics();
        } catch (error) {
          if (error?.code === 'SERVER_BUSY' || error?.message === 'SERVER_BUSY') {
            await markFinalizeAttemptQueuedForRetry({
              uid: attempt.uid,
              attemptId: attempt.attemptId,
              runnerId,
            });
            await refreshFinalizeQueueMetrics();
            return;
          }

          const mapped = mapFinalizeFailureFromError(error);
          emitFinalizeEvent('error', FINALIZE_EVENTS.JOB_FAILED, {
            sourceRole: FINALIZE_SOURCE_ROLES.WORKER,
            requestId: attempt.requestId ?? null,
            uid: attempt.uid,
            sessionId: attempt.sessionId,
            attemptId: attempt.attemptId,
            workerId: runnerId,
            jobState: 'failed',
            stage: error?.finalizeStage || FINALIZE_STAGES.RENDER_VIDEO,
            durationMs:
              error?.finalizeStageDurationMs ??
              (Number.isFinite(Date.parse(attempt.enqueuedAt))
                ? Date.now() - Date.parse(attempt.enqueuedAt)
                : null),
            error,
            ...currentWorkerMetrics(),
            ...describeFinalizeError(
              {
                code: mapped.error,
                status: mapped.status,
                message: mapped.detail,
                name: error?.name,
              },
              {
                retryable: false,
                failureReason: mapped.error,
              }
            ),
          });
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
            stage: error?.finalizeStage || FINALIZE_STAGES.RENDER_VIDEO,
            failureReason: mapped.error,
            emitObservability: false,
          });
          await refreshFinalizeQueueMetrics();
        } finally {
          clearInterval(heartbeat);
        }
      }
    );
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
            emitFinalizeEvent('error', FINALIZE_EVENTS.WORKER_CLAIM_LOOP_ERROR, {
              sourceRole: FINALIZE_SOURCE_ROLES.WORKER,
              requestId: attempt.requestId ?? null,
              uid: attempt.uid,
              sessionId: attempt.sessionId,
              attemptId: attempt.attemptId,
              workerId: runnerId,
              error,
              ...currentWorkerMetrics(),
              ...describeFinalizeError(error, {
                retryable: false,
                failureReason: 'runner_task_failed',
              }),
            });
            logger.error('story.finalize.runner.task_failed', {
              runnerId,
              attemptId: attempt.attemptId,
              sessionId: attempt.sessionId,
              error,
            });
          })
          .finally(() => {
            inflight.delete(attempt.attemptId);
            emitFinalizeEvent('debug', FINALIZE_EVENTS.WORKER_HEARTBEAT, {
              sourceRole: FINALIZE_SOURCE_ROLES.WORKER,
              requestId: attempt.requestId ?? null,
              uid: attempt.uid,
              sessionId: attempt.sessionId,
              attemptId: attempt.attemptId,
              workerId: runnerId,
              ...currentWorkerMetrics(),
            });
            schedulePoll(0);
          });
        inflight.set(attempt.attemptId, task);
      }
    } catch (error) {
      emitFinalizeEvent('error', FINALIZE_EVENTS.WORKER_CLAIM_LOOP_ERROR, {
        sourceRole: FINALIZE_SOURCE_ROLES.WORKER,
        workerId: runnerId,
        error,
        ...currentWorkerMetrics(),
        ...describeFinalizeError(error, {
          retryable: false,
          failureReason: 'claim_loop_failed',
        }),
      });
      throw error;
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
    emitFinalizeEvent('info', FINALIZE_EVENTS.WORKER_STOPPED, {
      sourceRole: FINALIZE_SOURCE_ROLES.WORKER,
      workerId: runnerId,
      workersActive: 0,
      jobsRunning: inflight.size,
      workerSaturationRatio: 0,
    });
  };

  schedulePoll(TEST_MODE ? 0 : FINALIZE_RUNNER_POLL_MS);
  scheduleReaper();
  emitFinalizeEvent('info', FINALIZE_EVENTS.WORKER_STARTED, {
    sourceRole: FINALIZE_SOURCE_ROLES.WORKER,
    workerId: runnerId,
    ...currentWorkerMetrics(),
  });
  void refreshFinalizeQueueMetrics().catch(() => {});

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
