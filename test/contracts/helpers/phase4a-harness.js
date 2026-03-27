import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';

let server;
let baseUrl;
let firebaseMock;
let runtimeOverrides;
let finalizeRunner;
let finalizeWorkerRuntime;

function setTestEnv() {
  process.env.NODE_ENV = 'test';
  process.env.VAIFORM_TEST_MODE = '1';
  process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8888';
  process.env.FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'vaiform-test';
  process.env.FIREBASE_STORAGE_BUCKET =
    process.env.FIREBASE_STORAGE_BUCKET || 'vaiform-test.appspot.com';
}

async function loadModules() {
  if (firebaseMock && runtimeOverrides) {
    return;
  }
  setTestEnv();
  const [
    { registerDejaVuFonts },
    mockModule,
    overridesModule,
    finalizeRunnerModule,
    finalizeWorkerRuntimeModule,
  ] =
    await Promise.all([
      import('../../../src/caption/canvas-fonts.js'),
      import('../../../src/testing/firebase-admin.mock.js'),
      import('../../../src/testing/runtime-overrides.js'),
      import('../../../src/services/story-finalize.runner.js'),
      import('../../../src/workers/story-finalize.worker.js'),
    ]);
  registerDejaVuFonts();
  firebaseMock = mockModule;
  runtimeOverrides = overridesModule;
  finalizeRunner = finalizeRunnerModule;
  finalizeWorkerRuntime = finalizeWorkerRuntimeModule;
}

export async function startHarness() {
  if (server) return { baseUrl };
  await loadModules();
  const { default: app } = await import('../../../src/app.js');
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  return { baseUrl };
}

export async function stopHarness() {
  if (!server) return;
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  server = null;
  baseUrl = null;
}

export function resetHarnessState() {
  finalizeWorkerRuntime?.stopStoryFinalizeWorkerRuntime?.('harness_reset');
  firebaseMock.resetMockFirebase();
  runtimeOverrides.clearRuntimeOverrides();
  finalizeRunner?.resetStoryFinalizeRunnerForTests?.();
  firebaseMock.seedAuthToken('token-user-1', {
    uid: 'user-1',
    email: 'user1@example.com',
  });
  firebaseMock.seedAuthToken('token-user-2', {
    uid: 'user-2',
    email: 'user2@example.com',
  });
}

export function startFinalizeWorkerRuntime() {
  if (!finalizeWorkerRuntime) {
    throw new Error('Harness modules not loaded');
  }
  return finalizeWorkerRuntime.startStoryFinalizeWorkerRuntime({ installSignalHandlers: false });
}

export function stopFinalizeWorkerRuntime(signal = 'manual') {
  finalizeWorkerRuntime?.stopStoryFinalizeWorkerRuntime?.(signal);
}

export async function requestJson(
  path,
  { method = 'GET', body, authToken = 'token-user-1', headers = {}, auth = true } = {}
) {
  if (!baseUrl) {
    throw new Error('Harness not started');
  }
  const requestHeaders = { ...headers };
  if (body !== undefined && !requestHeaders['Content-Type']) {
    requestHeaders['Content-Type'] = 'application/json';
  }
  if (auth) {
    requestHeaders.Authorization = `Bearer ${authToken}`;
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  return { response, status: response.status, json };
}

export function seedUserDoc(uid = 'user-1', doc = {}) {
  const plan = doc.plan || 'free';
  firebaseMock.seedDoc('users', uid, {
    uid,
    email: doc.email || `${uid}@example.com`,
    plan,
    freeShortsUsed: doc.freeShortsUsed || 0,
    membership: {
      status: plan === 'free' ? 'inactive' : 'active',
      kind: plan === 'free' ? 'free' : 'subscription',
      billingCadence: plan === 'free' ? 'none' : 'monthly',
      startedAt: null,
      expiresAt: null,
      canceledAt: null,
      ...(doc.membership || {}),
    },
    usage: {
      version: 1,
      billingUnit: 'sec',
      periodStartAt: null,
      periodEndAt: null,
      cycleIncludedSec: plan === 'free' ? 0 : 600,
      cycleUsedSec: 0,
      cycleReservedSec: 0,
      updatedAt: null,
      ...(doc.usage || {}),
    },
  });
}

export function seedFirestoreDoc(collectionName, id, data) {
  firebaseMock.seedDoc(collectionName, id, data);
}

export function seedShortDoc(id, doc) {
  firebaseMock.seedDoc('shorts', id, doc);
}

export function seedShortMeta(uid, jobId, meta) {
  firebaseMock.seedStorageObject(`artifacts/${uid}/${jobId}/meta.json`, meta, {
    contentType: 'application/json',
  });
}

export function seedStorySession(uid, session) {
  firebaseMock.seedStorageObject(`drafts/${uid}/${session.id}/story.json`, session, {
    contentType: 'application/json',
    metadata: {
      cacheControl: 'no-store',
    },
  });
}

export function readStorySession(uid, sessionId) {
  const entry = firebaseMock.readStorageObject(`drafts/${uid}/${sessionId}/story.json`);
  if (!entry) return null;
  return JSON.parse(entry.body.toString('utf8'));
}

export function setRuntimeOverride(name, fn) {
  runtimeOverrides.setRuntimeOverride(name, fn);
}

export function readDoc(collectionName, id) {
  return firebaseMock.readDoc(collectionName, id);
}

export function timestamp(value) {
  return firebaseMock.timestamp(value);
}

export async function waitFor(condition, { timeoutMs = 1000, intervalMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await delay(intervalMs);
  }
  throw new Error('waitFor timed out');
}
