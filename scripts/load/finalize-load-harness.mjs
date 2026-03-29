process.env.VAIFORM_DEBUG = process.env.VAIFORM_DEBUG || '1';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.VAIFORM_TEST_MODE = process.env.VAIFORM_TEST_MODE || '1';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8888';
process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'vaiform-test';
process.env.FIREBASE_STORAGE_BUCKET =
  process.env.FIREBASE_STORAGE_BUCKET || 'vaiform-test.appspot.com';

import { setTimeout as delay } from 'node:timers/promises';

import {
  readDoc,
  readStorySession,
  requestJson,
  resetHarnessState,
  seedFirestoreDoc,
  seedShortDoc,
  seedShortMeta,
  seedStorySession,
  seedUserDoc,
  setRuntimeOverride,
  startHarness,
  startFinalizeWorkerRuntime,
  stopFinalizeWorkerRuntime,
  stopHarness,
  timestamp,
  waitFor,
} from '../../test/contracts/helpers/phase4a-harness.js';

export {
  delay,
  readDoc,
  readStorySession,
  requestJson,
  resetHarnessState,
  seedFirestoreDoc,
  seedShortDoc,
  seedShortMeta,
  seedStorySession,
  seedUserDoc,
  setRuntimeOverride,
  startHarness,
  startFinalizeWorkerRuntime,
  stopFinalizeWorkerRuntime,
  stopHarness,
  timestamp,
  waitFor,
};

export function buildPhase6Session({
  id,
  uid = 'user-1',
  inputText = 'Why small systems outperform motivation over time.',
  status = 'draft',
  billingEstimateSec = 12,
  story = null,
  plan = null,
  shots = null,
  renderRecovery = null,
  finalVideo = null,
} = {}) {
  const now = new Date().toISOString();
  return {
    id,
    uid,
    input: {
      text: inputText,
      type: 'paragraph',
    },
    styleKey: 'default',
    status,
    createdAt: now,
    updatedAt: now,
    billingEstimate: {
      estimatedSec: billingEstimateSec,
      source: 'phase6_harness',
      updatedAt: now,
    },
    ...(story ? { story } : {}),
    ...(plan ? { plan } : {}),
    ...(shots ? { shots } : {}),
    ...(renderRecovery ? { renderRecovery } : {}),
    ...(finalVideo ? { finalVideo } : {}),
  };
}

export function buildPhase6Shot(id, sentenceIndex, query, durationSec = 4) {
  return {
    sentenceIndex,
    visualDescription: `${query} visual`,
    searchQuery: query,
    durationSec,
    startTimeSec: sentenceIndex * durationSec,
    selectedClip: {
      id,
      url: `https://cdn.example.com/${id}.mp4`,
      thumbUrl: `https://cdn.example.com/${id}.jpg`,
      duration: durationSec,
      width: 720,
      height: 1280,
      provider: 'pexels',
      providerId: id.replace('clip-', ''),
      photographer: 'Pexels Author',
      sourceUrl: `https://pexels.example.com/${id}`,
      license: 'pexels',
    },
    candidates: [
      {
        id,
        url: `https://cdn.example.com/${id}.mp4`,
        thumbUrl: `https://cdn.example.com/${id}.jpg`,
        duration: durationSec,
        width: 720,
        height: 1280,
        provider: 'pexels',
        providerId: id.replace('clip-', ''),
        photographer: 'Pexels Author',
        sourceUrl: `https://pexels.example.com/${id}`,
        license: 'pexels',
      },
    ],
  };
}

export async function bootPhase6Harness() {
  await startHarness();
  resetHarnessState();
  seedUserDoc('user-1', {
    plan: 'creator',
    membership: {
      status: 'active',
      kind: 'subscription',
      billingCadence: 'monthly',
    },
    usage: {
      cycleIncludedSec: 600,
      cycleUsedSec: 0,
      cycleReservedSec: 0,
    },
  });
}

export async function stopAllPhase6Workers(workerRuntimes = []) {
  for (const runtime of workerRuntimes) {
    runtime?.stop?.('phase6_cleanup');
  }
  stopFinalizeWorkerRuntime('phase6_cleanup_singleton');
}

export function startPhase6Workers(workerCount = 1) {
  throw new Error('startPhase6Workers is async; use startPhase6WorkersAsync instead');
}

export async function startPhase6WorkersAsync(workerCount = 1) {
  const runtimes = [];
  if (workerCount <= 0) return runtimes;
  if (workerCount === 1) {
    runtimes.push(startFinalizeWorkerRuntime());
    return runtimes;
  }
  const { startIsolatedStoryFinalizeWorkerRuntime } = await import(
    '../../src/workers/story-finalize.worker.js'
  );
  for (let index = 0; index < workerCount; index += 1) {
    runtimes.push(
      startIsolatedStoryFinalizeWorkerRuntime({
        installSignalHandlers: false,
        runtimeLabel: `phase6-worker-${index + 1}`,
      })
    );
  }
  return runtimes;
}
