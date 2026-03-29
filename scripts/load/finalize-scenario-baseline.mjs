import { cliArgs, runFinalizePhase6Scenario } from './finalize-load-runner.mjs';
import { installDeterministicFinalizeOverride } from './finalize-load-fixtures.mjs';

async function runBaselineVariant(variant) {
  const singleWorker = variant === 'single';
  return await runFinalizePhase6Scenario({
    scenario: 'baseline',
    runName: singleWorker ? 'single-worker-low-concurrency' : 'multi-worker-baseline',
    description: singleWorker
      ? 'Single worker, low concurrency finalize baseline.'
      : 'Two worker, higher concurrency finalize baseline.',
    workerCount: singleWorker ? 1 : 2,
    concurrency: singleWorker ? 1 : 2,
    requestCount: singleWorker ? 2 : 4,
    executionMode: 'fresh',
    scenarioConfig: {
      variant,
      measurementTargets: ['queue depth', 'queue age', 'readback lag', 'billing correctness'],
    },
    prepareEnvironment: async (ctx) => {
      await installDeterministicFinalizeOverride(ctx, {
        renderDelayMs: singleWorker ? 90 : 140,
        durationSec: 12,
      });
    },
    evaluateVerdict: async ({ results, summary }) => ({
      runId: summary.runId,
      scenario: summary.scenario,
      status:
        results.every((entry) => entry.finalizeStatus === 202 && entry.recoveryState === 'done') &&
        results.every((entry) => entry.shortDetailStatus === 200)
          ? 'pass'
          : 'warn',
      checkpoints: [
        {
          checkpoint: variant,
          status: results.every((entry) => entry.recoveryState === 'done') ? 'pass' : 'warn',
          observed: {
            completed: summary.counts.completed,
            maxQueueDepth: summary.observations.maxQueueDepth,
            maxJobsRunning: summary.observations.maxJobsRunning,
          },
        },
      ],
      carryForwardRisks: [],
      notes: [
        singleWorker
          ? 'Baseline records the single-worker queue and readback profile.'
          : 'Baseline records multi-worker queue and lease behavior with the same frozen caller contract.',
      ],
    }),
  });
}

async function main() {
  const args = cliArgs();
  const variant = args.variant || 'all';
  const runs = [];
  if (variant === 'all' || variant === 'single') {
    runs.push(await runBaselineVariant('single'));
  }
  if (variant === 'all' || variant === 'multi') {
    runs.push(await runBaselineVariant('multi'));
  }
  for (const run of runs) {
    console.log(`[phase6] baseline artifact: ${run.runDir}`);
  }
}

await main();
