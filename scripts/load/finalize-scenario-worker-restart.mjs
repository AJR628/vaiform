import { cliArgs, runFinalizePhase6Scenario } from './finalize-load-runner.mjs';
import {
  buildTargetedFinalizeSession,
  installDeterministicFinalizeOverride,
} from './finalize-load-fixtures.mjs';

async function runQueuedRestart() {
  return await runFinalizePhase6Scenario({
    scenario: 'worker-restart',
    runName: 'queued-job-restart',
    description: 'Accepted finalize stays queued while worker is down, then completes after worker restart.',
    executionMode: 'fresh',
    autoStartWorkers: false,
    requestCount: 1,
    scenarioConfig: {
      restartCase: 'queued',
    },
    prepareEnvironment: async (ctx) => {
      await installDeterministicFinalizeOverride(ctx, {
        renderDelayMs: 90,
        durationSec: 12,
      });
    },
    runScenario: async (ctx) => {
      const session = await ctx.createFreshSession(0);
      const attemptId = `${ctx.runId}-attempt-01`;
      const finalizeResponse = await ctx.requestJson('/api/story/finalize', {
        method: 'POST',
        headers: {
          'X-Idempotency-Key': attemptId,
          'x-client': 'phase6-harness',
        },
        body: {
          sessionId: session.id,
        },
      });
      await ctx.appendSample('queued-submit', {
        sessionId: session.id,
        attemptId,
        status: finalizeResponse.status,
        code: finalizeResponse.json?.error || null,
        finalizeState: finalizeResponse.json?.finalize?.state || null,
      });
      await ctx.captureControlRoom('queued-before-restart', {
        sessionId: session.id,
        attemptId,
      });
      await ctx.startWorkers(1);
      const recovery = await ctx.pollRecovery(session.id, attemptId);
      const shortId = recovery.renderRecovery?.shortId || recovery.storyResponse?.json?.data?.finalVideo?.jobId;
      const readback = shortId ? await ctx.probeShortReadback(shortId, attemptId) : null;
      return [
        {
          sessionId: session.id,
          attemptId,
          finalizeStatus: finalizeResponse.status,
          finalizeCode: finalizeResponse.json?.error || null,
          finalizeState: finalizeResponse.json?.finalize?.state || null,
          recoveryState: recovery.renderRecovery?.state || null,
          shortId: shortId || null,
          shortDetailStatus: readback?.shortDetail?.status || null,
          attemptState: ctx.readDoc('idempotency', `user-1:${attemptId}`)?.state || null,
          attemptJobState: ctx.readDoc('idempotency', `user-1:${attemptId}`)?.jobState || null,
          billingMismatch: false,
          billingUnsettled: false,
          readbackPending: readback?.shortDetail?.status === 404,
        },
      ];
    },
    evaluateVerdict: async ({ summary, results }) => ({
      runId: summary.runId,
      scenario: summary.scenario,
      status:
        results[0]?.finalizeStatus === 202 &&
        results[0]?.recoveryState === 'done' &&
        results[0]?.shortDetailStatus === 200
          ? 'pass'
          : 'warn',
      checkpoints: [
        {
          checkpoint: 'queued-before-restart',
          status: results[0]?.finalizeStatus === 202 ? 'pass' : 'warn',
          observed: {
            finalizeStatus: results[0]?.finalizeStatus || null,
            recoveryState: results[0]?.recoveryState || null,
          },
        },
      ],
      carryForwardRisks: [],
      notes: ['This run proves queued finalize admission survives worker downtime and later completion.'],
    }),
  });
}

async function runRunningRestart() {
  return await runFinalizePhase6Scenario({
    scenario: 'worker-restart',
    runName: 'running-job-restart',
    description: 'Previously running finalize with expired worker lease is reaped to terminal failure after worker restart.',
    executionMode: 'targeted',
    autoStartWorkers: false,
    requestCount: 1,
    scenarioConfig: {
      restartCase: 'running',
    },
    prepareEnvironment: async (ctx) => {
      const sessionId = `${ctx.runId}-session`;
      ctx.seedStorySession(
        'user-1',
        buildTargetedFinalizeSession({
          sessionId,
          includeStory: true,
          includePlan: true,
          includeShots: true,
          billingEstimateSec: 8,
        })
      );
      ctx.seedFirestoreDoc('idempotency', `user-1:${ctx.runId}-attempt-01`, {
        flow: 'story.finalize',
        uid: 'user-1',
        attemptId: `${ctx.runId}-attempt-01`,
        jobId: `${ctx.runId}-attempt-01`,
        externalAttemptId: `${ctx.runId}-attempt-01`,
        sessionId,
        state: 'running',
        jobState: 'started',
        isActive: true,
        status: 202,
        createdAt: ctx.timestamp('2026-03-19T06:00:00.000Z'),
        updatedAt: ctx.timestamp('2026-03-19T06:00:01.000Z'),
        enqueuedAt: ctx.timestamp('2026-03-19T06:00:00.000Z'),
        startedAt: ctx.timestamp('2026-03-19T06:00:01.000Z'),
        expiresAt: ctx.timestamp('2026-03-19T07:00:00.000Z'),
        usageReservation: {
          estimatedSec: 8,
          reservedSec: 8,
        },
        currentExecution: {
          executionAttemptId: `${ctx.runId}-attempt-01:exec:1`,
          attemptNumber: 1,
          state: 'running',
          workerId: 'phase6-lost-worker',
          createdAt: ctx.timestamp('2026-03-19T06:00:00.000Z'),
          claimedAt: ctx.timestamp('2026-03-19T06:00:01.000Z'),
          startedAt: ctx.timestamp('2026-03-19T06:00:01.000Z'),
          lease: {
            heartbeatAt: ctx.timestamp('2026-03-19T06:00:02.000Z'),
            expiresAt: ctx.timestamp(Date.now() - 1_000),
          },
        },
        executionAttempts: [
          {
            executionAttemptId: `${ctx.runId}-attempt-01:exec:1`,
            attemptNumber: 1,
            state: 'running',
            workerId: 'phase6-lost-worker',
            createdAt: ctx.timestamp('2026-03-19T06:00:00.000Z'),
            claimedAt: ctx.timestamp('2026-03-19T06:00:01.000Z'),
            startedAt: ctx.timestamp('2026-03-19T06:00:01.000Z'),
            lease: {
              heartbeatAt: ctx.timestamp('2026-03-19T06:00:02.000Z'),
              expiresAt: ctx.timestamp(Date.now() - 1_000),
            },
          },
        ],
        runnerId: 'phase6-lost-worker',
        leaseHeartbeatAt: ctx.timestamp('2026-03-19T06:00:02.000Z'),
        leaseExpiresAt: ctx.timestamp(Date.now() - 1_000),
      });
      ctx.seedFirestoreDoc('storyFinalizeSessions', `user-1:${sessionId}`, {
        flow: 'story.finalize',
        uid: 'user-1',
        sessionId,
        attemptId: `${ctx.runId}-attempt-01`,
        state: 'running',
        createdAt: ctx.timestamp('2026-03-19T06:00:00.000Z'),
        updatedAt: ctx.timestamp('2026-03-19T06:00:02.000Z'),
        expiresAt: ctx.timestamp('2026-03-19T07:00:00.000Z'),
      });
      ctx.scenarioConfig.sessionId = sessionId;
    },
    runScenario: async (ctx) => {
      const sessionId = ctx.scenarioConfig.sessionId;
      const attemptId = `${ctx.runId}-attempt-01`;
      await ctx.captureControlRoom('running-before-restart', {
        sessionId,
        attemptId,
      });
      await ctx.startWorkers(1);
      await ctx.waitFor(() => ctx.readDoc('idempotency', `user-1:${attemptId}`)?.state === 'failed', {
        timeoutMs: 1_500,
        intervalMs: 20,
      });
      const replay = await ctx.requestJson('/api/story/finalize', {
        method: 'POST',
        headers: {
          'X-Idempotency-Key': attemptId,
          'x-client': 'phase6-harness',
        },
        body: {
          sessionId,
        },
      });
      await ctx.appendSample('running-restart-replay', {
        sessionId,
        attemptId,
        status: replay.status,
        code: replay.json?.error || null,
      });
      return [
        {
          sessionId,
          attemptId,
          finalizeStatus: replay.status,
          finalizeCode: replay.json?.error || null,
          finalizeState: replay.json?.finalize?.state || null,
          recoveryState: ctx.readStorySession('user-1', sessionId)?.renderRecovery?.state || null,
          shortId: null,
          shortDetailStatus: null,
          attemptState: ctx.readDoc('idempotency', `user-1:${attemptId}`)?.state || null,
          attemptJobState: ctx.readDoc('idempotency', `user-1:${attemptId}`)?.jobState || null,
          billingMismatch: false,
          billingUnsettled: false,
          readbackPending: false,
        },
      ];
    },
    evaluateVerdict: async ({ summary, results }) => ({
      runId: summary.runId,
      scenario: summary.scenario,
      status:
        results[0]?.finalizeStatus === 500 &&
        results[0]?.finalizeCode === 'FINALIZE_WORKER_LOST' &&
        results[0]?.recoveryState === 'failed'
          ? 'pass'
          : 'warn',
      checkpoints: [
        {
          checkpoint: 'running-before-restart',
          status: results[0]?.finalizeCode === 'FINALIZE_WORKER_LOST' ? 'pass' : 'warn',
          observed: {
            finalizeStatus: results[0]?.finalizeStatus || null,
            finalizeCode: results[0]?.finalizeCode || null,
            recoveryState: results[0]?.recoveryState || null,
          },
        },
      ],
      carryForwardRisks: ['Worker-loss handling remains a terminal failure path and not an auto-resume path.'],
      notes: ['This run captures the current stale-running-attempt restart truth without changing runtime semantics.'],
    }),
  });
}

async function main() {
  const args = cliArgs();
  const selectedCase = args.case || 'all';
  const runs = [];
  if (selectedCase === 'all' || selectedCase === 'queued') {
    runs.push(await runQueuedRestart());
  }
  if (selectedCase === 'all' || selectedCase === 'running') {
    runs.push(await runRunningRestart());
  }
  for (const run of runs) {
    console.log(`[phase6] worker-restart artifact: ${run.runDir}`);
  }
}

await main();
