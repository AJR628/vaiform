import { cliArgs, runFinalizePhase6Scenario } from './finalize-load-runner.mjs';
import {
  buildTargetedFinalizeSession,
  installDeterministicFinalizeOverride,
} from './finalize-load-fixtures.mjs';

async function main() {
  const args = cliArgs();
  const retryCount = Number(args.retryCount || 2);

  const run = await runFinalizePhase6Scenario({
    scenario: 'retry-storm',
    runName: 'controlled-retries-and-billing',
    description: 'Controlled render-stage busy retries plus a billing mismatch probe.',
    executionMode: 'fresh',
    workerCount: 1,
    concurrency: 2,
    requestCount: 2,
    autoStartWorkers: true,
    scenarioConfig: {
      retryCount,
    },
    prepareEnvironment: async (ctx) => {
      const sequence = [];
      for (let index = 0; index < retryCount; index += 1) {
        sequence.push({
          failWith: {
            code: 'SERVER_BUSY',
            status: 503,
            detail: 'Render stage is busy for controlled retry pressure.',
          },
        });
      }
      sequence.push({ durationSec: 2, renderDelayMs: 60 });
      sequence.push({ durationSec: 2, renderDelayMs: 60 });
      await installDeterministicFinalizeOverride(ctx, {
        renderDelayMs: 60,
        durationSec: 2,
        sequence,
      });
    },
    runScenario: async (ctx) => {
      const attempts = await Promise.all([
        ctx.executeFinalizeAttempt({}, 0),
        ctx.executeFinalizeAttempt({}, 1),
      ]);

      const billingSessionId = `${ctx.runId}-billing-mismatch`;
      ctx.seedStorySession(
        'user-1',
        buildTargetedFinalizeSession({
          sessionId: billingSessionId,
          includeStory: true,
          includePlan: true,
          includeShots: true,
          billingEstimateSec: 8,
        })
      );
      await installDeterministicFinalizeOverride(ctx, {
        renderDelayMs: 40,
        durationSec: 12,
        sequence: [{ durationSec: 12, renderDelayMs: 40 }],
      });
      const billingProbe = await ctx.executeFinalizeAttempt(
        {
          sessionId: billingSessionId,
          attemptId: `${ctx.runId}-billing-mismatch-attempt`,
        },
        2
      );
      return [...attempts, billingProbe];
    },
    evaluateVerdict: async ({ summary, results }) => ({
      runId: summary.runId,
      scenario: summary.scenario,
      status:
        (summary.observations.maxJobsRetryScheduled > 0 ||
          results.some((entry) => entry.retryScheduledObserved)) &&
        results.some((entry) => entry.billingMismatch) &&
        results.filter((entry) => entry.recoveryState === 'done').length >= 2
          ? 'pass'
          : 'warn',
      checkpoints: [
        {
          checkpoint: 'retry-pressure',
          status:
            summary.observations.maxJobsRetryScheduled > 0 ||
            results.some((entry) => entry.retryScheduledObserved)
              ? 'pass'
              : 'warn',
          observed: {
            maxJobsRetryScheduled: summary.observations.maxJobsRetryScheduled,
            maxQueueDepth: summary.observations.maxQueueDepth,
            retryScheduledObserved: results.filter((entry) => entry.retryScheduledObserved).length,
          },
        },
        {
          checkpoint: 'billing-mismatch-probe',
          status: results.some((entry) => entry.billingMismatch) ? 'pass' : 'warn',
          observed: {
            mismatches: summary.counts.billingMismatches,
          },
        },
      ],
      carryForwardRisks: [
        'Render-stage contention still retries instead of waiting inside the render stage.',
        'BILLING_ESTIMATE_TOO_LOW remains a measured carry-forward risk, not a Phase 6 fix.',
      ],
      notes: ['This run captures retry-scheduled pressure, queue growth, and billing mismatch signaling.'],
    }),
  });

  console.log(`[phase6] retry-storm artifact: ${run.runDir}`);
}

await main();
