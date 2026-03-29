import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FINALIZE_EVENTS,
  emitFinalizeEvent,
  resetFinalizeObservabilityForTests,
} from '../../src/observability/finalize-observability.js';
import {
  requestJson,
  requestText,
  resetHarnessState,
  seedAuthToken,
  startHarness,
  stopHarness,
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

test('finalize dashboard page and data 404 when disabled', async () => {
  const restoreEnv = withEnv({
    FINALIZE_DASHBOARD_ENABLED: null,
    FINALIZE_DASHBOARD_ALLOWED_EMAILS: 'user1@example.com',
  });

  try {
    const page = await requestText('/admin/finalize', { auth: false });
    const data = await requestJson('/api/admin/finalize/data', { auth: false });

    assert.equal(page.status, 404);
    assert.equal(data.status, 404);
    assert.equal(data.json.success, false);
    assert.equal(data.json.error, 'NOT_FOUND');
  } finally {
    restoreEnv();
  }
});

test('finalize dashboard page serves html when enabled', async () => {
  const restoreEnv = withEnv({
    FINALIZE_DASHBOARD_ENABLED: '1',
  });

  try {
    const page = await requestText('/admin/finalize', { auth: false });
    assert.equal(page.status, 200);
    assert.match(page.text, /Finalize Control Room/);
  } finally {
    restoreEnv();
  }
});

test('finalize dashboard data requires auth and founder allowlist', async () => {
  const restoreEnv = withEnv({
    FINALIZE_DASHBOARD_ENABLED: '1',
    FINALIZE_DASHBOARD_ALLOWED_EMAILS: 'founder@example.com',
  });

  try {
    const unauthenticated = await requestJson('/api/admin/finalize/data', { auth: false });
    assert.equal(unauthenticated.status, 401);
    assert.equal(unauthenticated.json.error, 'AUTH_REQUIRED');

    const forbidden = await requestJson('/api/admin/finalize/data', {
      auth: true,
      authToken: 'token-user-1',
    });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.json.error, 'FORBIDDEN');
  } finally {
    restoreEnv();
  }
});

test('finalize dashboard data returns shared-truth verdict and labels local-only metrics separately', async () => {
  const restoreEnv = withEnv({
    FINALIZE_DASHBOARD_ENABLED: '1',
    FINALIZE_DASHBOARD_ALLOWED_EMAILS: 'user1@example.com',
  });

  try {
    seedAuthToken('token-founder', {
      uid: 'founder-1',
      email: 'user1@example.com',
      email_verified: true,
    });

    emitFinalizeEvent('info', FINALIZE_EVENTS.WORKER_STARTED, {
      sourceRole: 'worker',
      workerId: 'worker-local',
      workersActive: 4,
      workerSaturationRatio: 9,
      jobsRunning: 5,
    });

    const { status, json } = await requestJson('/api/admin/finalize/data', {
      authToken: 'token-founder',
    });

    assert.equal(status, 200);
    assert.equal(json.success, true);
    assert.equal(json.data.sharedHealth.verdict, 'healthy');
    assert.equal(json.data.sharedHealth.sources.includes('phase6-threshold-summary.json'), true);
    assert.equal(json.data.localObservability.metrics.workerSaturationRatio, 9);
    assert.match(json.data.localObservability.note, /not system-wide truth/i);
    assert.equal(typeof json.data.thresholdSummary.runCount, 'number');
    assert.equal(Array.isArray(json.data.links), true);
    assert.equal(json.data.links.length, 4);
  } finally {
    restoreEnv();
  }
});

test('finalize dashboard data rejects unverified allowlisted users', async () => {
  const restoreEnv = withEnv({
    FINALIZE_DASHBOARD_ENABLED: '1',
    FINALIZE_DASHBOARD_ALLOWED_EMAILS: 'user1@example.com',
  });

  try {
    seedAuthToken('token-unverified', {
      uid: 'user-1',
      email: 'user1@example.com',
      email_verified: false,
    });

    const result = await requestJson('/api/admin/finalize/data', {
      authToken: 'token-unverified',
    });

    assert.equal(result.status, 403);
    assert.equal(result.json.error, 'FORBIDDEN');
  } finally {
    restoreEnv();
  }
});
