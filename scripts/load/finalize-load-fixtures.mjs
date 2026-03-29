import { buildPhase6Session, buildPhase6Shot } from './finalize-load-harness.mjs';

export function buildTargetedFinalizeSession({
  sessionId,
  includeStory = true,
  includePlan = true,
  includeShots = true,
  billingEstimateSec = 12,
} = {}) {
  const story = includeStory
    ? {
        sentences: ['Beat one', 'Beat two', 'Beat three'],
      }
    : null;
  const plan = includePlan
    ? [
        {
          sentenceIndex: 0,
          visualDescription: 'Beat one visual',
          searchQuery: 'momentum systems',
          durationSec: 4,
          startTimeSec: 0,
        },
        {
          sentenceIndex: 1,
          visualDescription: 'Beat two visual',
          searchQuery: 'creator workflow',
          durationSec: 4,
          startTimeSec: 4,
        },
        {
          sentenceIndex: 2,
          visualDescription: 'Beat three visual',
          searchQuery: 'consistent publishing',
          durationSec: 4,
          startTimeSec: 8,
        },
      ]
    : null;
  const shots = includeShots
    ? [
        buildPhase6Shot('clip-1', 0, 'momentum', 4),
        buildPhase6Shot('clip-2', 1, 'systems', 4),
        buildPhase6Shot('clip-3', 2, 'consistency', 4),
      ]
    : null;
  return buildPhase6Session({
    id: sessionId,
    billingEstimateSec,
    story,
    plan,
    shots,
  });
}

export async function installDeterministicFinalizeOverride(ctx, config = {}) {
  process.env.NODE_ENV = process.env.NODE_ENV || 'test';
  process.env.VAIFORM_TEST_MODE = process.env.VAIFORM_TEST_MODE || '1';
  process.env.VAIFORM_DEBUG = process.env.VAIFORM_DEBUG || '1';
  process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8888';
  process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'vaiform-test';
  process.env.FIREBASE_STORAGE_BUCKET =
    process.env.FIREBASE_STORAGE_BUCKET || 'vaiform-test.appspot.com';
  const [{ withRenderSlot }, { withSharedFinalizeRenderLease }, { saveStorySession }] =
    await Promise.all([
      import('../../src/utils/render.semaphore.js'),
      import('../../src/services/finalize-control.service.js'),
      import('../../src/services/story.service.js'),
    ]);
  const {
    renderDelayMs = 80,
    durationSec = 12,
    failWith = null,
    sequence = [],
    blocker = null,
    onAttempt = null,
  } = config;
  const state = {
    calls: 0,
    sequenceIndex: 0,
  };

  ctx.setRuntimeOverride('story.service.finalizeStory', async ({ uid, sessionId, attemptId }) => {
    state.calls += 1;
    const existing = ctx.readStorySession(uid, sessionId);
    const estimatedSec = Number(existing?.billingEstimate?.estimatedSec || durationSec);
    const nextConfig = sequence[state.sequenceIndex] || null;
    if (nextConfig) {
      state.sequenceIndex += 1;
    }
    const effectiveFail = nextConfig?.failWith || failWith;
    const effectiveDurationSec = Number(
      nextConfig?.durationSec ||
        (effectiveFail ? durationSec : Math.max(1, estimatedSec || Number(durationSec) || 1))
    );
    const effectiveDelayMs = Number(nextConfig?.renderDelayMs || renderDelayMs);

    if (typeof onAttempt === 'function') {
      await onAttempt({ uid, sessionId, attemptId, callNumber: state.calls, existing });
    }

    await withSharedFinalizeRenderLease(() =>
      withRenderSlot(async () => {
        if (blocker?.promise) {
          await blocker.promise;
        } else if (effectiveDelayMs > 0) {
          await ctx.delay(effectiveDelayMs);
        }
      }),
      {
        executionAttemptId: `${attemptId}:exec:${Math.max(1, state.calls)}`,
        workerId: `phase6-worker-${state.calls}`,
      }
    );

    if (effectiveFail) {
      const error = new Error(effectiveFail.detail || effectiveFail.code);
      error.code = effectiveFail.code;
      error.status = effectiveFail.status || 500;
      throw error;
    }

    const now = new Date().toISOString();
    const shortId = `short-${attemptId}`;
    const session = {
      ...existing,
      status: 'rendered',
      updatedAt: now,
      finalVideo: {
        jobId: shortId,
        durationSec: effectiveDurationSec,
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
      billingEstimate: {
        ...(existing?.billingEstimate || {}),
        estimatedSec,
      },
    };
    await saveStorySession({ uid, sessionId, data: session });
    ctx.seedShortDoc(shortId, {
      ownerId: uid,
      status: 'ready',
      finalizeAttemptId: attemptId,
      createdAt: now,
      completedAt: now,
      billing: {
        estimatedSec,
        billedSec: effectiveDurationSec,
      },
    });
    ctx.seedShortMeta(uid, shortId, {
      durationSec: effectiveDurationSec,
      createdAt: now,
      urls: {
        video: `https://cdn.example.com/${shortId}.mp4`,
        cover: `https://cdn.example.com/${shortId}.jpg`,
      },
      usedTemplate: 'phase6',
      usedQuote: {
        text: 'Phase 6 proof artifact',
      },
    });
    return session;
  });

  return state;
}

export function createBlocker() {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return {
    promise,
    release: () => release?.(),
  };
}
