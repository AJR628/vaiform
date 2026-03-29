import { cliArgs, runFinalizePhase6Scenario } from './finalize-load-runner.mjs';
import { buildTargetedFinalizeSession } from './finalize-load-fixtures.mjs';

async function main() {
  const args = cliArgs();
  const provider = args.provider || 'pexels';
  const { markFinalizeStorySearchProviderTransientFailure } = await import(
    '../../src/services/finalize-control.service.js'
  );
  const { runWithFinalizeObservabilityContext } = await import(
    '../../src/observability/finalize-observability.js'
  );

  const run = await runFinalizePhase6Scenario({
    scenario: 'provider-slowdown',
    runName: `${provider}-cooldown`,
    description: 'Finalize targeted session fails through shared story-search provider cooldown.',
    executionMode: 'targeted',
    workerCount: 1,
    concurrency: 1,
    requestCount: 1,
    autoStartWorkers: true,
    scenarioConfig: {
      provider,
    },
    prepareEnvironment: async (ctx) => {
      const sessionId = `${ctx.runId}-session`;
      ctx.seedStorySession(
        'user-1',
        buildTargetedFinalizeSession({
          sessionId,
          includeStory: true,
          includePlan: true,
          includeShots: false,
          billingEstimateSec: 12,
        })
      );
      await runWithFinalizeObservabilityContext(
        {
          sourceRole: 'worker',
          uid: 'user-1',
          sessionId,
          attemptId: `${ctx.runId}-provider-seed`,
          finalizeJobId: `${ctx.runId}-provider-seed`,
          executionAttemptId: `${ctx.runId}-provider-seed:exec:1`,
          workerId: 'phase6-provider-seed',
        },
        async () => {
          await markFinalizeStorySearchProviderTransientFailure(provider, 'HTTP_429');
          await markFinalizeStorySearchProviderTransientFailure(provider, 'HTTP_429');
          if (provider !== 'nasa') {
            const pairedProvider = provider === 'pexels' ? 'pixabay' : 'pexels';
            await markFinalizeStorySearchProviderTransientFailure(pairedProvider, 'HTTP_429');
            await markFinalizeStorySearchProviderTransientFailure(pairedProvider, 'HTTP_429');
          }
        }
      );
      ctx.scenarioConfig.sessionId = sessionId;
    },
    runScenario: async (ctx) => {
      const sessionId = ctx.scenarioConfig.sessionId;
      const attemptId = `${ctx.runId}-attempt-01`;
      await ctx.captureControlRoom('provider-cooldown-before-submit', {
        sessionId,
        attemptId,
      });
      const finalizeResponse = await ctx.requestJson('/api/story/finalize', {
        method: 'POST',
        headers: {
          'X-Idempotency-Key': attemptId,
          'x-client': 'phase6-harness',
        },
        body: {
          sessionId,
        },
      });
      const recovery = await ctx.pollRecovery(sessionId, attemptId);
      return [
        {
          sessionId,
          attemptId,
          finalizeStatus: finalizeResponse.status,
          finalizeCode: finalizeResponse.json?.error || null,
          finalizeState: finalizeResponse.json?.finalize?.state || null,
          recoveryState: recovery.renderRecovery?.state || null,
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
    evaluateVerdict: async ({ summary, results, controlRoomSnapshots }) => {
      const cooldownSeen = controlRoomSnapshots.some((entry) =>
        Object.values(entry.snapshot.payload?.sharedSystemPressure?.providers?.storySearchProviders || {}).some(
          (providerState) => providerState?.cooldownActive === true
        )
      );
      return {
        runId: summary.runId,
        scenario: summary.scenario,
        status:
          results[0]?.recoveryState === 'failed' &&
          results[0]?.attemptState === 'failed' &&
          cooldownSeen
            ? 'pass'
            : 'warn',
        checkpoints: [
          {
            checkpoint: 'shared-story-search-cooldown',
            status: cooldownSeen ? 'pass' : 'warn',
            observed: {
              finalizeStatus: results[0]?.finalizeStatus || null,
              attemptState: results[0]?.attemptState || null,
              recoveryState: results[0]?.recoveryState || null,
            },
          },
        ],
        carryForwardRisks: [],
        notes: ['This run captures shared provider cooldown/backpressure without changing finalize admission semantics.'],
      };
    },
  });

  console.log(`[phase6] provider-slowdown artifact: ${run.runDir}`);
}

await main();
