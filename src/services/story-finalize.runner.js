import logger from '../observability/logger.js';
import {
  FINALIZE_EVENTS,
  FINALIZE_SOURCE_ROLES,
  FINALIZE_STAGES,
  describeFinalizeError,
  emitFinalizeEvent,
  runWithFinalizeObservabilityContext,
} from '../observability/finalize-observability.js';
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
  markFinalizeAttemptStarted,
  reapStaleFinalizeAttempts,
  refreshFinalizeQueueMetrics,
  settleFinalizeAttemptSuccess,
} from './story-finalize.attempts.js';
import { reapSharedFinalizePressureState } from './finalize-control.service.js';

const RUNNER_KEY = Symbol.for('vaiform.storyFinalizeRunner');
const TEST_MODE = process.env.NODE_ENV === 'test' && process.env.VAIFORM_TEST_MODE === '1';
const LOCAL_WORKER_INFLIGHT_LIMIT = Math.max(
  1,
  Number(process.env.STORY_FINALIZE_LOCAL_WORKER_INFLIGHT_LIMIT || (TEST_MODE ? 2 : 6))
);
const FINALIZE_RUNNER_IDLE_POLL_MAX_MS = 5000;

export function createStoryFinalizeRunner({ keepProcessAlive = false } = {}) {
  const runnerId = `story-finalize-runner-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  const inflight = new Map();
  const shouldUnrefTimers = !keepProcessAlive;

  let stopped = false;
  let pollTimer = null;
  let reaperTimer = null;
  let draining = false;
  let consecutiveEmptyPolls = 0;

  const currentWorkerMetrics = () => ({
    workersActive: stopped ? 0 : 1,
    jobsRunning: inflight.size,
    workerSaturationRatio: Number((inflight.size / LOCAL_WORKER_INFLIGHT_LIMIT).toFixed(3)),
  });

  const resetIdlePollBackoff = () => {
    consecutiveEmptyPolls = 0;
  };

  const nextIdlePollDelayMs = () => {
    consecutiveEmptyPolls += 1;
    const multiplier = consecutiveEmptyPolls === 1 ? 2 : 5;
    return Math.min(FINALIZE_RUNNER_POLL_MS * multiplier, FINALIZE_RUNNER_IDLE_POLL_MAX_MS);
  };

  const schedulePoll = (delayMs = FINALIZE_RUNNER_POLL_MS) => {
    if (stopped) return;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void drainQueue();
    }, delayMs);
    if (shouldUnrefTimers) pollTimer.unref?.();
  };

  const scheduleReaper = () => {
    if (stopped) return;
    if (reaperTimer) clearTimeout(reaperTimer);
    reaperTimer = setTimeout(async () => {
      reaperTimer = null;
      try {
        await reapStaleFinalizeAttempts();
        await reapSharedFinalizePressureState();
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
    if (shouldUnrefTimers) reaperTimer.unref?.();
  };

  const runAttempt = async (attempt) => {
    return await runWithFinalizeObservabilityContext(
      {
        sourceRole: FINALIZE_SOURCE_ROLES.WORKER,
        requestId: attempt.requestId ?? null,
        uid: attempt.uid,
        sessionId: attempt.sessionId,
        attemptId: attempt.attemptId,
        finalizeJobId: attempt.jobId ?? attempt.attemptId,
        executionAttemptId: attempt.executionAttemptId ?? null,
        workerId: runnerId,
        jobState: attempt.jobState ?? attempt.state,
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
        if (shouldUnrefTimers) heartbeat.unref?.();

        try {
          const startedAttempt =
            (await markFinalizeAttemptStarted({
              uid: attempt.uid,
              attemptId: attempt.attemptId,
              runnerId,
              stage: FINALIZE_STAGES.WORKER_CLAIM,
            })) || attempt;
          emitFinalizeEvent('info', FINALIZE_EVENTS.JOB_STARTED, {
            sourceRole: FINALIZE_SOURCE_ROLES.WORKER,
            requestId: startedAttempt.requestId ?? attempt.requestId ?? null,
            uid: startedAttempt.uid ?? attempt.uid,
            sessionId: startedAttempt.sessionId ?? attempt.sessionId,
            attemptId: startedAttempt.attemptId ?? attempt.attemptId,
            finalizeJobId: startedAttempt.jobId ?? attempt.jobId ?? attempt.attemptId,
            executionAttemptId:
              startedAttempt.executionAttemptId ?? attempt.executionAttemptId ?? null,
            workerId: runnerId,
            jobState: startedAttempt.jobState ?? 'started',
            stage: FINALIZE_STAGES.WORKER_CLAIM,
            queuedAt: startedAttempt.enqueuedAt ?? attempt.enqueuedAt ?? null,
            startedAt: startedAttempt.startedAt ?? attempt.startedAt ?? null,
            ...currentWorkerMetrics(),
          });
          const session = await finalizeStory({
            uid: attempt.uid,
            sessionId: attempt.sessionId,
            attemptId: attempt.attemptId,
          });
          const shortId = session?.finalVideo?.jobId || null;
          emitFinalizeEvent('info', FINALIZE_EVENTS.JOB_COMPLETED, {
            sourceRole: FINALIZE_SOURCE_ROLES.WORKER,
            requestId: attempt.requestId ?? null,
            uid: attempt.uid,
            sessionId: attempt.sessionId,
            attemptId: attempt.attemptId,
            finalizeJobId: attempt.jobId ?? attempt.attemptId,
            executionAttemptId: attempt.executionAttemptId ?? null,
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
          emitFinalizeEvent('error', FINALIZE_EVENTS.JOB_FAILED, {
            sourceRole: FINALIZE_SOURCE_ROLES.WORKER,
            requestId: attempt.requestId ?? null,
            uid: attempt.uid,
            sessionId: attempt.sessionId,
            attemptId: attempt.attemptId,
            finalizeJobId: attempt.jobId ?? attempt.attemptId,
            executionAttemptId: attempt.executionAttemptId ?? null,
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
        } finally {
          clearInterval(heartbeat);
        }
      }
    );
  };

  const drainQueue = async () => {
    if (stopped || draining) return;
    draining = true;
    let claimedAny = false;
    let nextDelayMs = FINALIZE_RUNNER_POLL_MS;
    try {
      while (!stopped && inflight.size < LOCAL_WORKER_INFLIGHT_LIMIT) {
        const attempt = await claimNextFinalizeAttempt({
          runnerId,
          leaseMs: FINALIZE_RUNNER_LEASE_MS,
        });
        if (!attempt) break;
        claimedAny = true;
        resetIdlePollBackoff();

        const task = runAttempt(attempt)
          .catch((error) => {
            emitFinalizeEvent('error', FINALIZE_EVENTS.WORKER_CLAIM_LOOP_ERROR, {
              sourceRole: FINALIZE_SOURCE_ROLES.WORKER,
              requestId: attempt.requestId ?? null,
              uid: attempt.uid,
              sessionId: attempt.sessionId,
              attemptId: attempt.attemptId,
              finalizeJobId: attempt.jobId ?? attempt.attemptId,
              executionAttemptId: attempt.executionAttemptId ?? null,
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
            resetIdlePollBackoff();
            emitFinalizeEvent('debug', FINALIZE_EVENTS.WORKER_HEARTBEAT, {
              sourceRole: FINALIZE_SOURCE_ROLES.WORKER,
              requestId: attempt.requestId ?? null,
              uid: attempt.uid,
              sessionId: attempt.sessionId,
              attemptId: attempt.attemptId,
              finalizeJobId: attempt.jobId ?? attempt.attemptId,
              executionAttemptId: attempt.executionAttemptId ?? null,
              workerId: runnerId,
              ...currentWorkerMetrics(),
            });
            schedulePoll(0);
          });
        inflight.set(attempt.attemptId, task);
      }
      if (!claimedAny) {
        nextDelayMs = nextIdlePollDelayMs();
      }
    } catch (error) {
      resetIdlePollBackoff();
      nextDelayMs = FINALIZE_RUNNER_POLL_MS;
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
      schedulePoll(nextDelayMs);
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

  resetIdlePollBackoff();
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

export function ensureStoryFinalizeRunner(options = {}) {
  if (!globalThis[RUNNER_KEY]) {
    globalThis[RUNNER_KEY] = createStoryFinalizeRunner({
      keepProcessAlive: options.keepProcessAlive === true,
    });
  }
  return globalThis[RUNNER_KEY];
}

export function notifyStoryFinalizeRunner() {
  ensureStoryFinalizeRunner().notify();
}

export function stopStoryFinalizeRunner() {
  if (globalThis[RUNNER_KEY]) {
    globalThis[RUNNER_KEY].stop();
    delete globalThis[RUNNER_KEY];
  }
}

export function resetStoryFinalizeRunnerForTests() {
  stopStoryFinalizeRunner();
}
