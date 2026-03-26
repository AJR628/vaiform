process.env.VAIFORM_DEBUG = '1';

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FINALIZE_EVENTS,
  emitFinalizeEvent,
  resetFinalizeObservabilityForTests,
} from '../../src/observability/finalize-observability.js';
import {
  requestJson,
  resetHarnessState,
  seedFirestoreDoc,
  startHarness,
  stopHarness,
  timestamp,
} from '../contracts/helpers/phase4a-harness.js';

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

test('diag finalize control room exposes queue snapshot and recent canonical events', async () => {
  seedFirestoreDoc('idempotency', 'user-1:attempt-1', {
    flow: 'story.finalize',
    uid: 'user-1',
    attemptId: 'attempt-1',
    sessionId: 'session-1',
    requestId: 'request-1',
    state: 'queued',
    isActive: true,
    createdAt: timestamp('2026-03-26T10:00:00.000Z'),
    updatedAt: timestamp('2026-03-26T10:00:00.000Z'),
    enqueuedAt: timestamp('2026-03-26T10:00:00.000Z'),
    availableAfter: timestamp('2026-03-26T10:00:00.000Z'),
  });

  emitFinalizeEvent('info', FINALIZE_EVENTS.API_ACCEPTED, {
    sourceRole: 'api',
    requestId: 'request-1',
    uid: 'user-1',
    sessionId: 'session-1',
    attemptId: 'attempt-1',
    queueDepth: 1,
    stage: 'queue_enqueue',
  });

  const { status, json } = await requestJson('/diag/finalize-control-room', { auth: false });

  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.equal(json.source, 'diagnostic_only');
  assert.equal(json.queueSnapshot.queueDepth, 1);
  assert.ok(
    Array.isArray(json.observability?.recentEvents) &&
      json.observability.recentEvents.some((event) => event.event === FINALIZE_EVENTS.API_ACCEPTED)
  );
});
