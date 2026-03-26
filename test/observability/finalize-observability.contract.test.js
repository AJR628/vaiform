import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FINALIZE_EVENT_NAMES,
  FINALIZE_EVENT_REQUIRED_FIELDS,
  FINALIZE_EVENTS,
  FINALIZE_METRIC_DEFINITIONS,
  FINALIZE_STAGE_SEQUENCE,
  FINALIZE_STAGES,
  addFinalizeEventSink,
  emitFinalizeEvent,
  finalizeJobIdFromAttemptId,
  resetFinalizeObservabilityForTests,
  runWithFinalizeObservabilityContext,
  snapshotFinalizeObservability,
  withFinalizeStage,
} from '../../src/observability/finalize-observability.js';

test.beforeEach(() => {
  resetFinalizeObservabilityForTests();
});

test('finalize observability contract exposes the canonical stage, event, and metric names', () => {
  assert.deepEqual(FINALIZE_STAGE_SEQUENCE, [
    FINALIZE_STAGES.ADMISSION_VALIDATE,
    FINALIZE_STAGES.ADMISSION_RESERVE_USAGE,
    FINALIZE_STAGES.QUEUE_ENQUEUE,
    FINALIZE_STAGES.QUEUE_WAIT,
    FINALIZE_STAGES.WORKER_CLAIM,
    FINALIZE_STAGES.HYDRATE_SESSION,
    FINALIZE_STAGES.STORY_GENERATE,
    FINALIZE_STAGES.PLAN_SHOTS,
    FINALIZE_STAGES.CLIP_SEARCH,
    FINALIZE_STAGES.CAPTION_GENERATE,
    FINALIZE_STAGES.RENDER_VIDEO,
    FINALIZE_STAGES.UPLOAD_ARTIFACTS,
    FINALIZE_STAGES.WRITE_SHORT,
    FINALIZE_STAGES.PERSIST_RECOVERY,
    FINALIZE_STAGES.BILLING_SETTLE,
    FINALIZE_STAGES.CLIENT_RECOVERY_POLL,
    FINALIZE_STAGES.SHORT_DETAIL_READBACK,
    FINALIZE_STAGES.LIBRARY_FALLBACK_READBACK,
  ]);
  assert.deepEqual(FINALIZE_EVENT_NAMES, [
    FINALIZE_EVENTS.API_REQUESTED,
    FINALIZE_EVENTS.API_REJECTED,
    FINALIZE_EVENTS.API_ACCEPTED,
    FINALIZE_EVENTS.API_REPLAYED_PENDING,
    FINALIZE_EVENTS.API_REPLAYED_DONE,
    FINALIZE_EVENTS.API_REPLAYED_FAILED,
    FINALIZE_EVENTS.API_CONFLICT_ACTIVE,
    FINALIZE_EVENTS.JOB_CREATED,
    FINALIZE_EVENTS.JOB_QUEUED,
    FINALIZE_EVENTS.JOB_CLAIMED,
    FINALIZE_EVENTS.JOB_STARTED,
    FINALIZE_EVENTS.JOB_STAGE_STARTED,
    FINALIZE_EVENTS.JOB_STAGE_COMPLETED,
    FINALIZE_EVENTS.JOB_RETRY_SCHEDULED,
    FINALIZE_EVENTS.JOB_FAILED,
    FINALIZE_EVENTS.JOB_COMPLETED,
    FINALIZE_EVENTS.JOB_SETTLED,
    FINALIZE_EVENTS.WORKER_STARTED,
    FINALIZE_EVENTS.WORKER_STOPPED,
    FINALIZE_EVENTS.WORKER_HEARTBEAT,
    FINALIZE_EVENTS.WORKER_HEARTBEAT_MISSED,
    FINALIZE_EVENTS.WORKER_CLAIM_LOOP_ERROR,
    FINALIZE_EVENTS.RECOVERY_PROJECTED,
    FINALIZE_EVENTS.RECOVERY_POLL,
    FINALIZE_EVENTS.READBACK_SHORT_DETAIL_PENDING,
    FINALIZE_EVENTS.READBACK_SHORT_DETAIL_READY,
    FINALIZE_EVENTS.READBACK_LIBRARY_FALLBACK_HIT,
    FINALIZE_EVENTS.READBACK_LIBRARY_FALLBACK_MISS,
    FINALIZE_EVENTS.PROVIDER_REQUEST,
    FINALIZE_EVENTS.PROVIDER_RETRYABLE_FAILURE,
    FINALIZE_EVENTS.PROVIDER_TERMINAL_FAILURE,
    FINALIZE_EVENTS.PROVIDER_COOLDOWN_STARTED,
    FINALIZE_EVENTS.PROVIDER_COOLDOWN_CLEARED,
  ]);
  assert.deepEqual(
    FINALIZE_METRIC_DEFINITIONS.map((definition) => definition.name),
    [
      'finalize_api_requests_total',
      'finalize_jobs_created_total',
      'finalize_job_retries_total',
      'finalize_job_failures_total',
      'finalize_dead_letters_total',
      'finalize_worker_claims_total',
      'finalize_worker_lease_expirations_total',
      'finalize_provider_failures_total',
      'finalize_billing_mismatches_total',
      'finalize_readback_retries_total',
      'finalize_queue_depth',
      'finalize_queue_oldest_age_seconds',
      'finalize_jobs_running',
      'finalize_jobs_retry_scheduled',
      'finalize_dead_letter_depth',
      'finalize_workers_active',
      'finalize_worker_saturation_ratio',
      'finalize_provider_cooldown_active',
      'finalize_billing_unsettled_jobs',
      'finalize_api_admission_duration_ms',
      'finalize_queue_wait_duration_ms',
      'finalize_job_total_duration_ms',
      'finalize_stage_duration_ms',
      'finalize_provider_request_duration_ms',
      'finalize_readback_completion_lag_ms',
    ]
  );
  assert.deepEqual(FINALIZE_EVENT_REQUIRED_FIELDS.all, [
    'ts',
    'sourceRole',
    'requestId',
    'uid',
    'sessionId',
    'finalizeJobId',
  ]);
});

test('finalize event emitter bridges attemptId into finalizeJobId and records metrics', async () => {
  const recordedEvents = [];
  const removeSink = addFinalizeEventSink((event) => recordedEvents.push(event));

  await runWithFinalizeObservabilityContext(
    {
      sourceRole: 'worker',
      requestId: 'request-1',
      uid: 'user-1',
      sessionId: 'session-1',
      attemptId: 'attempt-1',
      workerId: 'worker-1',
      jobState: 'running',
    },
    async () => {
      emitFinalizeEvent('info', FINALIZE_EVENTS.JOB_CREATED, {});
      await withFinalizeStage(FINALIZE_STAGES.RENDER_VIDEO, {}, async () => 'ok');
      emitFinalizeEvent('info', FINALIZE_EVENTS.JOB_CLAIMED, {
        durationMs: 3200,
      });
      emitFinalizeEvent('info', FINALIZE_EVENTS.READBACK_SHORT_DETAIL_READY, {
        surface: 'short_detail',
        readbackLagMs: 950,
      });
    }
  );

  removeSink();

  assert.equal(recordedEvents[0].finalizeJobId, 'attempt-1');
  assert.equal(recordedEvents[0].attemptId, 'attempt-1');
  assert.equal(recordedEvents[0].requestId, 'request-1');
  assert.equal(recordedEvents[0].workerId, 'worker-1');
  assert.equal(recordedEvents[0].sourceRole, 'worker');

  const snapshot = snapshotFinalizeObservability();
  assert.ok(snapshot.recentEvents.some((event) => event.event === FINALIZE_EVENTS.JOB_STAGE_STARTED));
  assert.ok(
    snapshot.recentEvents.some((event) => event.event === FINALIZE_EVENTS.JOB_STAGE_COMPLETED)
  );
  assert.ok(
    snapshot.metrics.counters.some(
      (series) => series.name === 'finalize_jobs_created_total' && series.value === 1
    )
  );
  assert.ok(
    snapshot.metrics.counters.some(
      (series) => series.name === 'finalize_worker_claims_total' && series.value === 1
    )
  );
  assert.ok(
    snapshot.metrics.histograms.some(
      (series) =>
        series.name === 'finalize_queue_wait_duration_ms' &&
        series.count === 1 &&
        series.lastValue === 3200
    )
  );
  assert.ok(
    snapshot.metrics.histograms.some(
      (series) =>
        series.name === 'finalize_stage_duration_ms' &&
        series.labels.stage === FINALIZE_STAGES.RENDER_VIDEO &&
        series.count === 1
    )
  );
  assert.ok(
    snapshot.metrics.histograms.some(
      (series) =>
        series.name === 'finalize_readback_completion_lag_ms' &&
        series.labels.surface === 'short_detail' &&
        series.lastValue === 950
    )
  );
});

test('finalizeJobId bridge remains an identity alias over the current attemptId', () => {
  assert.equal(finalizeJobIdFromAttemptId('attempt-123'), 'attempt-123');
  assert.equal(finalizeJobIdFromAttemptId('  attempt-123  '), 'attempt-123');
  assert.equal(finalizeJobIdFromAttemptId(null), null);
});
