import logger from '../observability/logger.js';
import {
  STORY_PREVIEW_REAPER_INTERVAL_MS,
  STORY_PREVIEW_RUNNER_HEARTBEAT_MS,
  STORY_PREVIEW_RUNNER_LEASE_MS,
  STORY_PREVIEW_RUNNER_POLL_MS,
  claimNextStoryPreviewAttempt,
  failStoryPreviewAttempt,
  heartbeatStoryPreviewAttempt,
  reapStaleStoryPreviewAttempts,
  settleStoryPreviewAttemptSuccess,
} from './story-preview.attempts.js';
import { persistDraftPreviewFailure, renderStoryDraftPreview } from './story.service.js';

const RUNNER_KEY = Symbol.for('vaiform.storyPreviewRunner');
const LOCAL_WORKER_INFLIGHT_LIMIT = Math.max(
  1,
  Number(process.env.STORY_PREVIEW_LOCAL_WORKER_INFLIGHT_LIMIT || 1)
);
const fingerprintPrefix = (fingerprint) =>
  typeof fingerprint === 'string' && fingerprint.length > 0 ? fingerprint.slice(0, 12) : null;

export function createStoryPreviewRunner({ keepProcessAlive = false } = {}) {
  const runnerId = `story-preview-runner-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  const inflight = new Map();
  const shouldUnrefTimers = !keepProcessAlive;
  let stopped = false;
  let pollTimer = null;
  let reaperTimer = null;
  let draining = false;

  const schedulePoll = (delayMs = STORY_PREVIEW_RUNNER_POLL_MS) => {
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
        await reapStaleStoryPreviewAttempts();
      } catch (error) {
        logger.error('story.preview.runner.reaper_failed', { runnerId, error });
      } finally {
        scheduleReaper();
      }
    }, STORY_PREVIEW_REAPER_INTERVAL_MS);
    if (shouldUnrefTimers) reaperTimer.unref?.();
  };

  const runAttempt = async (attempt) => {
    const heartbeat = setInterval(() => {
      void heartbeatStoryPreviewAttempt({
        uid: attempt.uid,
        attemptId: attempt.attemptId,
        runnerId,
        leaseMs: STORY_PREVIEW_RUNNER_LEASE_MS,
      });
    }, STORY_PREVIEW_RUNNER_HEARTBEAT_MS);
    if (shouldUnrefTimers) heartbeat.unref?.();

    try {
      logger.info('story.preview.runner.started', {
        runnerId,
        attemptId: attempt.attemptId,
        previewId: attempt.previewId,
        sessionId: attempt.sessionId,
        requestId: attempt.requestId,
        fingerprintPrefix: fingerprintPrefix(attempt.requestFingerprint),
        outcome: 'started',
        state: attempt.state,
      });
      const session = await renderStoryDraftPreview({
        uid: attempt.uid,
        sessionId: attempt.sessionId,
        attemptId: attempt.attemptId,
        previewId: attempt.previewId,
        fingerprint: attempt.requestFingerprint,
      });
      await settleStoryPreviewAttemptSuccess({
        uid: attempt.uid,
        attemptId: attempt.attemptId,
        session,
      });
      logger.info('story.preview.runner.completed', {
        runnerId,
        attemptId: attempt.attemptId,
        previewId: attempt.previewId,
        sessionId: attempt.sessionId,
        requestId: attempt.requestId,
        fingerprintPrefix: fingerprintPrefix(attempt.requestFingerprint),
        outputDurationSec: Number(session?.draftPreviewV1?.artifact?.durationSec),
        outcome: 'completed',
        state: 'succeeded',
      });
    } catch (error) {
      const code = error?.code || error?.message || 'DRAFT_PREVIEW_FAILED';
      const state = code === 'DRAFT_PREVIEW_SUPERSEDED' ? 'superseded' : 'failed';
      await persistDraftPreviewFailure({
        uid: attempt.uid,
        sessionId: attempt.sessionId,
        attemptId: attempt.attemptId,
        code,
        message: error?.message || 'Failed to generate preview.',
      }).catch((persistError) => {
        logger.error('story.preview.runner.failure_persist_failed', {
          runnerId,
          attemptId: attempt.attemptId,
          previewId: attempt.previewId,
          sessionId: attempt.sessionId,
          requestId: attempt.requestId,
          fingerprintPrefix: fingerprintPrefix(attempt.requestFingerprint),
          error: persistError,
        });
      });
      await failStoryPreviewAttempt({
        uid: attempt.uid,
        attemptId: attempt.attemptId,
        error: code,
        detail: error?.message || 'Failed to generate preview.',
        state,
      });
      logger.error('story.preview.runner.failed', {
        runnerId,
        attemptId: attempt.attemptId,
        previewId: attempt.previewId,
        sessionId: attempt.sessionId,
        requestId: attempt.requestId,
        fingerprintPrefix: fingerprintPrefix(attempt.requestFingerprint),
        failureCode: code,
        outcome: state,
        state,
        error,
      });
    } finally {
      clearInterval(heartbeat);
    }
  };

  const drainQueue = async () => {
    if (stopped || draining) return;
    draining = true;
    try {
      while (!stopped && inflight.size < LOCAL_WORKER_INFLIGHT_LIMIT) {
        const attempt = await claimNextStoryPreviewAttempt({
          runnerId,
          leaseMs: STORY_PREVIEW_RUNNER_LEASE_MS,
        });
        if (!attempt) break;
        const task = runAttempt(attempt).finally(() => {
          inflight.delete(attempt.attemptId);
          schedulePoll(0);
        });
        inflight.set(attempt.attemptId, task);
      }
    } catch (error) {
      logger.error('story.preview.runner.claim_loop_failed', { runnerId, error });
    } finally {
      draining = false;
      schedulePoll();
    }
  };

  const notify = () => schedulePoll(0);
  const stop = () => {
    stopped = true;
    if (pollTimer) clearTimeout(pollTimer);
    if (reaperTimer) clearTimeout(reaperTimer);
    pollTimer = null;
    reaperTimer = null;
  };

  schedulePoll(STORY_PREVIEW_RUNNER_POLL_MS);
  scheduleReaper();

  return {
    runnerId,
    notify,
    stop,
  };
}

export function ensureStoryPreviewRunner(options = {}) {
  if (!globalThis[RUNNER_KEY]) {
    globalThis[RUNNER_KEY] = createStoryPreviewRunner({
      keepProcessAlive: options.keepProcessAlive === true,
    });
  }
  return globalThis[RUNNER_KEY];
}

export function notifyStoryPreviewRunner() {
  ensureStoryPreviewRunner().notify();
}

export function stopStoryPreviewRunner() {
  if (globalThis[RUNNER_KEY]) {
    globalThis[RUNNER_KEY].stop();
    delete globalThis[RUNNER_KEY];
  }
}
