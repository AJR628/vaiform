import fs from 'node:fs/promises';
import path from 'node:path';

import {
  PHASE6_ARTIFACT_ROOT,
  PHASE6_CONTROL_ROOM_FIELD_MAP,
  PHASE6_MEASUREMENT_CONTRACT,
  appendNdjsonArtifact,
  ensureDir,
  phase6ArtifactEnvelope,
  slugify,
  summarizeControlRoom,
  writeJsonArtifact,
} from './finalize-load-contract.mjs';
import {
  bootPhase6Harness,
  delay,
  readDoc,
  readStorySession,
  requestJson,
  seedFirestoreDoc,
  seedStorySession,
  seedShortDoc,
  seedShortMeta,
  setRuntimeOverride,
  startPhase6WorkersAsync,
  stopAllPhase6Workers,
  stopHarness,
  timestamp,
  waitFor,
} from './finalize-load-harness.mjs';

function parseJsonArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (const entry of argv) {
    if (!entry.startsWith('--')) continue;
    const [, rawKey, rawValue = 'true'] = entry.match(/^--([^=]+)=?(.*)$/) || [];
    if (!rawKey) continue;
    if (rawValue === '') {
      args[rawKey] = true;
      continue;
    }
    try {
      args[rawKey] = JSON.parse(rawValue);
    } catch {
      args[rawKey] = rawValue;
    }
  }
  return args;
}

function randomId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function runPool(items, concurrency, worker) {
  const results = [];
  let cursor = 0;
  const limit = Math.max(1, Number(concurrency || 1));
  async function loop() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, () => loop()));
  return results;
}

function extractShortId(finalizeResponse, recoveredSession) {
  return (
    finalizeResponse?.json?.shortId ||
    finalizeResponse?.json?.data?.finalVideo?.jobId ||
    recoveredSession?.finalVideo?.jobId ||
    recoveredSession?.renderRecovery?.shortId ||
    null
  );
}

function extractFinalizeState(responseJson) {
  return responseJson?.finalize?.state || responseJson?.data?.renderRecovery?.state || null;
}

function buildScenarioDir(scenario, runName) {
  return path.join(PHASE6_ARTIFACT_ROOT, slugify(scenario), slugify(runName));
}

export async function runFinalizePhase6Scenario(options = {}) {
  const {
    scenario,
    runName = scenario,
    description = '',
    executionMode = 'fresh',
    requestCount = 1,
    concurrency = 1,
    workerCount = 1,
    autoStartWorkers = true,
    storyInput = 'Why small systems beat motivation for creators.',
    readbackDelayMs = 120,
    recoveryPollDelayMs = 30,
    maxRecoveryPolls = 20,
    buildWorkItems = null,
    prepareEnvironment = null,
    runScenario = null,
    evaluateVerdict = null,
    scenarioConfig = {},
  } = options;

  if (!scenario) {
    throw new Error('runFinalizePhase6Scenario requires a scenario name');
  }

  const startedAtMs = Date.now();
  const runId = slugify(`${scenario}-${runName}`);
  const runDir = buildScenarioDir(scenario, runName);
  const controlRoomDir = path.join(runDir, 'control-room');
  const samplesPath = path.join(runDir, 'samples.ndjson');
  const workerRuntimes = [];
  let sampleIndex = 0;
  const results = [];
  const controlRoomSnapshots = [];

  await fs.rm(runDir, { recursive: true, force: true });
  await ensureDir(controlRoomDir);
  await bootPhase6Harness();

  const ctx = {
    scenario,
    runName,
    runId,
    runDir,
    samplesPath,
    controlRoomDir,
    storyInput,
    executionMode,
    workerCount,
    concurrency,
    requestCount,
    scenarioConfig,
    workerRuntimes,
    requestJson,
    readDoc,
    readStorySession,
    seedFirestoreDoc,
    seedStorySession,
    seedShortDoc,
    seedShortMeta,
    setRuntimeOverride,
    timestamp,
    waitFor,
    delay,
    async startWorkers(count = workerCount) {
      const runtimes = await startPhase6WorkersAsync(count);
      workerRuntimes.push(...runtimes);
      return runtimes;
    },
    async stopWorkers() {
      await stopAllPhase6Workers(workerRuntimes.splice(0, workerRuntimes.length));
    },
    async appendSample(eventType, payload = {}) {
      sampleIndex += 1;
      await appendNdjsonArtifact(
        samplesPath,
        phase6ArtifactEnvelope('sample', {
          runId,
          scenario,
          eventType,
          sampleIndex,
          capturedAt: new Date().toISOString(),
          ...payload,
        })
      );
    },
    async captureControlRoom(checkpoint, extra = {}) {
      const response = await requestJson(PHASE6_MEASUREMENT_CONTRACT.routes.controlRoom, { auth: false });
      const snapshot = phase6ArtifactEnvelope('control-room', {
        runId,
        scenario,
        checkpoint,
        capturedAt: new Date().toISOString(),
        route: PHASE6_MEASUREMENT_CONTRACT.routes.controlRoom,
        status: response.status,
        summary: summarizeControlRoom(response.json || {}),
        payload: response.json,
        ...extra,
      });
      const fileName = `${String(controlRoomSnapshots.length + 1).padStart(2, '0')}-${slugify(checkpoint)}.json`;
      const filePath = path.join(controlRoomDir, fileName);
      await writeJsonArtifact(filePath, snapshot);
      controlRoomSnapshots.push({ filePath, snapshot });
      await ctx.appendSample('control-room', {
        checkpoint,
        controlRoomFile: path.relative(runDir, filePath).replaceAll('\\', '/'),
        controlRoomSummary: snapshot.summary,
      });
      return snapshot;
    },
    async createFreshSession(index, inputText = storyInput) {
      const response = await requestJson(PHASE6_MEASUREMENT_CONTRACT.routes.storyStart, {
        method: 'POST',
        body: {
          input: `${inputText} [phase6 ${scenario} ${index + 1}]`,
          inputType: 'paragraph',
          styleKey: 'default',
        },
      });
      if (response.status !== 200 || !response.json?.data?.id) {
        throw new Error(`Fresh session provisioning failed for ${scenario} item ${index + 1}`);
      }
      return response.json.data;
    },
    async pollRecovery(sessionId, attemptId) {
      let lastResponse = null;
      for (let pollAttempt = 0; pollAttempt < maxRecoveryPolls; pollAttempt += 1) {
        const storyResponse = await requestJson(
          PHASE6_MEASUREMENT_CONTRACT.routes.storyGet.replace(':sessionId', sessionId)
        );
        lastResponse = storyResponse;
        const renderRecovery = storyResponse.json?.data?.renderRecovery;
        const attemptDoc = readDoc('idempotency', `user-1:${attemptId}`);
        await ctx.appendSample('recovery-poll', {
          sessionId,
          attemptId,
          pollAttempt,
          status: storyResponse.status,
          requestId: storyResponse.response.headers.get('x-request-id'),
          renderRecoveryState: renderRecovery?.state || null,
          renderRecoveryAttemptId: renderRecovery?.attemptId || null,
          attemptJobState: attemptDoc?.jobState || null,
        });
        if (pollAttempt === 0 || attemptDoc?.jobState === 'retry_scheduled') {
          await ctx.captureControlRoom(
            `recovery-poll-${String(pollAttempt + 1).padStart(2, '0')}-${String(attemptId).slice(-12)}`,
            {
              sessionId,
              attemptId,
              pollAttempt,
              attemptJobState: attemptDoc?.jobState || null,
            }
          );
        }
        if (renderRecovery?.attemptId === attemptId && ['done', 'failed'].includes(renderRecovery.state)) {
          return { storyResponse, renderRecovery };
        }
        await delay(recoveryPollDelayMs);
      }
      return { storyResponse: lastResponse, renderRecovery: lastResponse?.json?.data?.renderRecovery || null };
    },
    async probeShortReadback(shortId, attemptId) {
      await delay(readbackDelayMs);
      const detailPath = PHASE6_MEASUREMENT_CONTRACT.routes.shortDetail.replace(':jobId', shortId);
      const shortDetail = await requestJson(detailPath);
      await ctx.appendSample('short-detail-probe', {
        shortId,
        attemptId,
        status: shortDetail.status,
        requestId: shortDetail.response.headers.get('x-request-id'),
        code: shortDetail.json?.error || null,
      });
      let fallback = null;
      if (shortDetail.status === 404) {
        fallback = await requestJson(PHASE6_MEASUREMENT_CONTRACT.routes.shortsMine);
        await ctx.appendSample('shorts-mine-fallback', {
          shortId,
          attemptId,
          status: fallback.status,
          requestId: fallback.response.headers.get('x-request-id'),
        });
      }
      return { shortDetail, fallback };
    },
    async executeFinalizeAttempt(item, index) {
      const useTargetedSession = typeof item.sessionId === 'string' && item.sessionId.trim().length > 0;
      const session =
        executionMode === 'fresh' && !useTargetedSession
          ? await ctx.createFreshSession(index, item.inputText || storyInput)
          : { id: item.sessionId };
      const sessionId = item.sessionId || session.id;
      const attemptId = item.attemptId || `${runId}-attempt-${String(index + 1).padStart(2, '0')}`;
      const finalizeResponse = await requestJson(PHASE6_MEASUREMENT_CONTRACT.routes.storyFinalize, {
        method: 'POST',
        headers: {
          'X-Idempotency-Key': attemptId,
          'x-client': 'phase6-harness',
        },
        body: {
          sessionId,
        },
      });
      const requestId = finalizeResponse.response.headers.get('x-request-id');
      await ctx.appendSample('finalize-submit', {
        sessionId,
        attemptId,
        status: finalizeResponse.status,
        requestId,
        code: finalizeResponse.json?.error || null,
        finalizeState: extractFinalizeState(finalizeResponse.json),
      });
      await ctx.captureControlRoom(`submit-attempt-${String(index + 1).padStart(2, '0')}`, {
        sessionId,
        attemptId,
      });

      const result = {
        sessionId,
        attemptId,
        requestId,
        finalizeStatus: finalizeResponse.status,
        finalizeCode: finalizeResponse.json?.error || null,
        finalizeState: extractFinalizeState(finalizeResponse.json),
        shortId: finalizeResponse.json?.shortId || null,
        estimatedSec: Number(finalizeResponse.json?.data?.billingEstimate?.estimatedSec || session.billingEstimate?.estimatedSec || 0),
        billedSec: Number(finalizeResponse.json?.data?.billing?.billedSec || 0) || null,
        reservedSec: Number(finalizeResponse.json?.data?.billingEstimate?.reservedSec || 0) || null,
        recoveryState: null,
        shortDetailStatus: null,
        fallbackStatus: null,
      };

      if (finalizeResponse.status === 202 || finalizeResponse.status === 409) {
        const recovery = await ctx.pollRecovery(sessionId, attemptId);
        result.recoveryState = recovery.renderRecovery?.state || null;
        result.shortId = extractShortId(finalizeResponse, recovery.storyResponse?.json?.data);
        result.billedSec =
          Number(recovery.storyResponse?.json?.data?.billing?.billedSec || 0) || result.billedSec;
        if (result.shortId && result.recoveryState === 'done') {
          const readback = await ctx.probeShortReadback(result.shortId, attemptId);
          result.shortDetailStatus = readback.shortDetail.status;
          result.fallbackStatus = readback.fallback?.status || null;
          await ctx.captureControlRoom(`readback-attempt-${String(index + 1).padStart(2, '0')}`, {
            sessionId,
            attemptId,
            shortId: result.shortId,
          });
        }
      } else if (finalizeResponse.status === 200 && result.shortId) {
        const readback = await ctx.probeShortReadback(result.shortId, attemptId);
        result.shortDetailStatus = readback.shortDetail.status;
        result.fallbackStatus = readback.fallback?.status || null;
        await ctx.captureControlRoom(`readback-attempt-${String(index + 1).padStart(2, '0')}`, {
          sessionId,
          attemptId,
          shortId: result.shortId,
        });
      }

      const attemptDoc = readDoc('idempotency', `user-1:${attemptId}`);
      result.attemptState = attemptDoc?.state || null;
      result.attemptJobState = attemptDoc?.jobState || null;
      result.executionAttemptCount = Array.isArray(attemptDoc?.executionAttempts)
        ? attemptDoc.executionAttempts.length
        : 0;
      result.retryScheduledObserved = Boolean(
        result.attemptJobState === 'retry_scheduled' ||
          (Array.isArray(attemptDoc?.executionAttempts) &&
            attemptDoc.executionAttempts.some((entry) => entry?.state === 'failed_retryable'))
      );
      result.estimatedSec = Number(
        attemptDoc?.usageReservation?.estimatedSec || result.estimatedSec || 0
      ) || null;
      result.reservedSec = Number(
        attemptDoc?.usageReservation?.reservedSec || result.reservedSec || 0
      ) || null;
      result.billedSec = Number(
        attemptDoc?.billingSettlement?.billedSec || result.billedSec || 0
      ) || null;
      result.billingMismatch =
        Boolean(attemptDoc?.failure?.error === 'BILLING_ESTIMATE_TOO_LOW') ||
        Boolean(attemptDoc?.billingSettlement?.billingMismatch);
      result.billingUnsettled = Boolean(attemptDoc?.isActive === true);
      result.readbackPending = result.shortDetailStatus === 404;
      await ctx.captureControlRoom(`after-attempt-${String(index + 1).padStart(2, '0')}`, {
        sessionId,
        attemptId,
      });
      return result;
    },
  };

  if (prepareEnvironment) {
    await prepareEnvironment(ctx);
  }
  if (autoStartWorkers) {
    await ctx.startWorkers(workerCount);
  }

  try {
    await ctx.captureControlRoom('before');
    if (runScenario) {
      results.push(...(await runScenario(ctx)));
    } else {
      const workItems =
        typeof buildWorkItems === 'function'
          ? await buildWorkItems(ctx)
          : Array.from({ length: requestCount }, () => ({}));
      results.push(
        ...(await runPool(workItems, concurrency, async (item, index) => await ctx.executeFinalizeAttempt(item, index)))
      );
    }
    await ctx.captureControlRoom('after');
  } finally {
    await ctx.stopWorkers();
    await stopHarness();
  }

  const finishedAtMs = Date.now();
  const summary = phase6ArtifactEnvelope('run-summary', {
    runId,
    scenario,
    runName,
    description,
    startedAt: new Date(startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    durationMs: finishedAtMs - startedAtMs,
    execution: {
      mode: executionMode,
      workerCount,
      concurrency,
      requestCount,
      autoStartWorkers,
    },
    measurementContract: PHASE6_MEASUREMENT_CONTRACT,
    controlRoomFieldMap: PHASE6_CONTROL_ROOM_FIELD_MAP,
    counts: {
      totalAttempts: results.length,
      acceptedOrReplayed: results.filter((entry) => [200, 202, 409, 500].includes(entry.finalizeStatus)).length,
      queuedOrPending: results.filter((entry) => ['pending', 'queued', 'running'].includes(entry.finalizeState)).length,
      completed: results.filter((entry) => entry.recoveryState === 'done' || entry.attemptState === 'done').length,
      failed: results.filter((entry) => entry.recoveryState === 'failed' || entry.attemptState === 'failed').length,
      overloadRejections: results.filter((entry) => entry.finalizeStatus === 503).length,
      conflicts: results.filter((entry) => entry.finalizeStatus === 409).length,
      readback404s: results.filter((entry) => entry.shortDetailStatus === 404).length,
      billingMismatches: results.filter((entry) => entry.billingMismatch).length,
    },
    observations: {
      maxQueueDepth: Math.max(0, ...controlRoomSnapshots.map((entry) => entry.snapshot.summary.queueDepth)),
      maxQueueOldestAgeSeconds: Math.max(
        0,
        ...controlRoomSnapshots.map((entry) => entry.snapshot.summary.queueOldestAgeSeconds)
      ),
      maxJobsRunning: Math.max(0, ...controlRoomSnapshots.map((entry) => entry.snapshot.summary.jobsRunning)),
      maxJobsRetryScheduled: Math.max(
        0,
        ...controlRoomSnapshots.map((entry) => entry.snapshot.summary.jobsRetryScheduled)
      ),
      maxLocalWorkersActive: Math.max(
        0,
        ...controlRoomSnapshots.map((entry) => entry.snapshot.summary.localWorkersActive)
      ),
      maxLocalWorkerSaturationRatio: Math.max(
        0,
        ...controlRoomSnapshots.map((entry) => entry.snapshot.summary.localWorkerSaturationRatio)
      ),
      maxQueueWaitMs: Math.max(
        0,
        ...controlRoomSnapshots.map((entry) => entry.snapshot.summary.queueWaitLastMs)
      ),
      maxReadbackLagMs: Math.max(
        0,
        ...controlRoomSnapshots.map((entry) => entry.snapshot.summary.readbackLagLastMs)
      ),
      maxSharedRenderLeases: Math.max(
        0,
        ...controlRoomSnapshots.map((entry) => entry.snapshot.summary.sharedRenderActiveLeases)
      ),
      billingUnsettledJobsMax: Math.max(
        0,
        ...controlRoomSnapshots.map((entry) => entry.snapshot.summary.billingUnsettledJobs)
      ),
      openAiCooldownSeen: controlRoomSnapshots.some((entry) => entry.snapshot.summary.openAiCooldownActive),
      ttsCooldownSeen: controlRoomSnapshots.some((entry) => entry.snapshot.summary.ttsCooldownActive),
      storySearchCooldownSeen: controlRoomSnapshots.some(
        (entry) => entry.snapshot.summary.storySearchCooldownCount > 0
      ),
      storySearchCooldownProviders: [
        ...new Set(
          controlRoomSnapshots.flatMap(
            (entry) => entry.snapshot.summary.storySearchCooldownProviders || []
          )
        ),
      ].sort(),
    },
    artifacts: {
      samples: 'samples.ndjson',
      controlRoomDir: 'control-room',
      verdict: 'verdict.json',
    },
    results,
  });

  const verdict = phase6ArtifactEnvelope(
    'scenario-verdict',
    await (evaluateVerdict
      ? evaluateVerdict({ ctx, results, summary, controlRoomSnapshots })
      : {
          runId,
          scenario,
          status: results.every((entry) => entry.finalizeStatus < 500) ? 'pass' : 'warn',
          checkpoints: results.map((entry) => ({
            checkpoint: entry.attemptId,
            status:
              entry.finalizeStatus >= 500 && entry.finalizeCode !== 'BILLING_ESTIMATE_TOO_LOW'
                ? 'warn'
                : 'pass',
            observed: {
              finalizeStatus: entry.finalizeStatus,
              attemptState: entry.attemptState,
              recoveryState: entry.recoveryState,
              shortDetailStatus: entry.shortDetailStatus,
            },
          })),
          carryForwardRisks: [],
          notes: [],
        })
  );

  await writeJsonArtifact(path.join(runDir, 'run-summary.json'), summary);
  await writeJsonArtifact(path.join(runDir, 'verdict.json'), verdict);

  return { runDir, summary, verdict };
}

export function cliArgs(argv = process.argv.slice(2)) {
  return parseJsonArgs(argv);
}
