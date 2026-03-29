import fs from 'node:fs/promises';
import path from 'node:path';

import {
  PHASE6_ARTIFACT_ROOT,
  PHASE6_MEASUREMENT_CONTRACT,
  loadScenarioArtifacts,
  writeJsonArtifact,
} from './finalize-load-contract.mjs';

const REPORT_PATH = path.resolve('docs', 'FINALIZE_THRESHOLD_REPORT.md');
const SUMMARY_PATH = path.join(PHASE6_ARTIFACT_ROOT, 'phase6-threshold-summary.json');

async function walk(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
      continue;
    }
    files.push(fullPath);
  }
  return files;
}

function formatRange(green, yellow, red) {
  return `green <= ${green}; yellow <= ${yellow}; red > ${yellow}${red != null ? ` (current max ${red})` : ''}`;
}

async function loadRuns() {
  const files = await walk(PHASE6_ARTIFACT_ROOT).catch(() => []);
  const summaryFiles = files.filter((filePath) => path.basename(filePath) === 'run-summary.json');
  const runs = [];
  for (const summaryFile of summaryFiles.sort()) {
    const runDir = path.dirname(summaryFile);
    const { summary, verdict } = await loadScenarioArtifacts(runDir);
    runs.push({ runDir, summary, verdict });
  }
  return runs;
}

function buildThresholds(runs) {
  const maxOf = (selector) => Math.max(0, ...runs.map((run) => selector(run.summary)));
  const queueDepth = maxOf((summary) => summary.observations.maxQueueDepth);
  const queueAge = maxOf((summary) => summary.observations.maxQueueOldestAgeSeconds);
  const queueWait = maxOf((summary) => summary.observations.maxQueueWaitMs);
  const workerSaturation = maxOf((summary) => summary.observations.maxLocalWorkerSaturationRatio);
  const readbackLag = maxOf((summary) => summary.observations.maxReadbackLagMs);
  const retryScheduled = maxOf((summary) => summary.observations.maxJobsRetryScheduled);
  const billingMismatches = maxOf((summary) => summary.counts.billingMismatches);
  return {
    queueDepth,
    queueAge,
    queueWait,
    workerSaturation,
    readbackLag,
    retryScheduled,
    billingMismatches,
    ranges: {
      queueDepth: {
        green: queueDepth,
        yellow: queueDepth + 1,
        red: queueDepth,
      },
      queueAge: {
        green: queueAge,
        yellow: queueAge + 1,
        red: queueAge,
      },
      queueWait: {
        green: queueWait,
        yellow: queueWait + 50,
        red: queueWait,
      },
      workerSaturation: {
        green: Number(workerSaturation.toFixed(3)),
        yellow: Number(Math.min(1, workerSaturation + 0.2).toFixed(3)),
        red: Number(workerSaturation.toFixed(3)),
      },
      readbackLag: {
        green: readbackLag,
        yellow: readbackLag + 100,
        red: readbackLag,
      },
      retryScheduled: {
        green: retryScheduled,
        yellow: retryScheduled + 1,
        red: retryScheduled,
      },
      billingMismatches: {
        green: 0,
        yellow: billingMismatches > 0 ? billingMismatches : 1,
        red: billingMismatches,
      },
    },
  };
}

function buildMustFixList(runs) {
  const items = [];
  if (runs.some((run) => run.summary.observations.maxJobsRetryScheduled > 0)) {
    items.push(
      'Render-stage `SERVER_BUSY` retries were observed under controlled pressure; treat render contention as a carry-forward must-watch item before raising concurrency.'
    );
  }
  if (runs.some((run) => run.summary.counts.billingMismatches > 0)) {
    items.push(
      '`BILLING_ESTIMATE_TOO_LOW` was reproduced in the mismatch probe; keep billing mismatch alerts active and do not tune estimates inside Phase 6.'
    );
  }
  return items;
}

function buildReportMarkdown(runs, thresholds) {
  const workerCounts = [...new Set(runs.map((run) => run.summary.execution.workerCount))].sort((a, b) => a - b);
  const concurrencyLevels = [...new Set(runs.map((run) => run.summary.execution.concurrency))].sort((a, b) => a - b);
  const mustFixList = buildMustFixList(runs);
  const providerCooldownSeen = runs.some(
    (run) =>
      run.summary.observations.openAiCooldownSeen ||
      run.summary.observations.ttsCooldownSeen ||
      run.summary.observations.storySearchCooldownSeen
  );
  const storySearchCooldownProviders = [
    ...new Set(
      runs.flatMap((run) => run.summary.observations.storySearchCooldownProviders || [])
    ),
  ].sort();

  return `# FINALIZE_THRESHOLD_REPORT

- Status: CANONICAL
- Owner repo: backend
- Source of truth for: Phase 6 measured finalize proof artifacts, operating ranges, and carry-forward must-fix candidates
- Artifact root: \`docs/artifacts/finalize-phase6/\`

## Measurement Contract

- Routes exercised: ${Object.values(PHASE6_MEASUREMENT_CONTRACT.routes).join(', ')}
- Control-room payload fields frozen for Phase 6: \`queueSnapshot\`, \`sharedSystemPressure\`, \`pressureConfig\`, \`localProcessObservability\`
- Artifact inputs only: this report is generated from checked-in Phase 6 artifacts and does not infer new thresholds outside those artifacts

## Tested Matrix

- Worker counts tested: ${workerCounts.join(', ') || 'none'}
- Concurrency levels tested: ${concurrencyLevels.join(', ') || 'none'}
- Scenario runs:
${runs
  .map(
    (run) =>
      `  - \`${run.summary.scenario}/${run.summary.runName}\`: verdict=${run.verdict.status}, workerCount=${run.summary.execution.workerCount}, concurrency=${run.summary.execution.concurrency}, attempts=${run.summary.counts.totalAttempts}`
  )
  .join('\n')}

## Observations

- Queue depth observed: max ${thresholds.queueDepth}
- Queue oldest age observed: max ${thresholds.queueAge}s
- Queue wait observed: max ${thresholds.queueWait}ms
- Jobs running observed: max ${Math.max(0, ...runs.map((run) => run.summary.observations.maxJobsRunning))}
- Worker saturation observed: max ${thresholds.workerSaturation}
- Shared render leases observed: max ${Math.max(0, ...runs.map((run) => run.summary.observations.maxSharedRenderLeases))}
- Provider cooldown observed: ${providerCooldownSeen ? 'yes' : 'no'}${
    storySearchCooldownProviders.length > 0
      ? ` (${storySearchCooldownProviders.join(', ')})`
      : ''
  }
- Readback lag observed: max ${thresholds.readbackLag}ms
- Retry-scheduled observed: max ${thresholds.retryScheduled}
- Billing mismatches observed: ${thresholds.billingMismatches}

## Operating Ranges

- Queue depth: ${formatRange(thresholds.ranges.queueDepth.green, thresholds.ranges.queueDepth.yellow, thresholds.queueDepth)}
- Queue oldest age: ${formatRange(thresholds.ranges.queueAge.green, thresholds.ranges.queueAge.yellow, thresholds.queueAge)}
- Queue wait: ${formatRange(thresholds.ranges.queueWait.green, thresholds.ranges.queueWait.yellow, thresholds.queueWait)}
- Worker saturation ratio: ${formatRange(thresholds.ranges.workerSaturation.green, thresholds.ranges.workerSaturation.yellow, thresholds.workerSaturation)}
- Readback lag: ${formatRange(thresholds.ranges.readbackLag.green, thresholds.ranges.readbackLag.yellow, thresholds.readbackLag)}
- Retry-scheduled count: ${formatRange(thresholds.ranges.retryScheduled.green, thresholds.ranges.retryScheduled.yellow, thresholds.retryScheduled)}
- Billing mismatches: green = 0; yellow = investigate immediately; red = repeated or sustained mismatch

## Must-Fix List

${mustFixList.length > 0 ? mustFixList.map((item) => `- ${item}`).join('\n') : '- None justified by the current checked-in Phase 6 artifacts.'}
`;
}

async function main() {
  const runs = await loadRuns();
  if (runs.length === 0) {
    throw new Error('No Phase 6 artifacts found to build the threshold report.');
  }
  const thresholds = buildThresholds(runs);
  const markdown = buildReportMarkdown(runs, thresholds);
  await fs.writeFile(REPORT_PATH, `${markdown}\n`, 'utf8');
  await writeJsonArtifact(SUMMARY_PATH, {
    generatedAt: new Date().toISOString(),
    runCount: runs.length,
    thresholds,
    runs: runs.map((run) => ({
      runId: run.summary.runId,
      scenario: run.summary.scenario,
      runName: run.summary.runName,
      verdict: run.verdict.status,
    })),
  });
  console.log(`[phase6] threshold report written: ${REPORT_PATH}`);
}

await main();
