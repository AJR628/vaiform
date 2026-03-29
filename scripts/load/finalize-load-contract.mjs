import fs from 'node:fs/promises';
import path from 'node:path';

export const PHASE6_SCHEMA_VERSION = 1;
export const PHASE6_ARTIFACT_ROOT = path.resolve('docs', 'artifacts', 'finalize-phase6');
export const PHASE6_CONTROL_ROOM_FIELD_MAP = Object.freeze({
  queueSnapshot: 'queueSnapshot',
  sharedSystemPressure: 'sharedSystemPressure',
  pressureConfig: 'pressureConfig',
  localProcessObservability: 'localProcessObservability',
});

export const PHASE6_MEASUREMENT_CONTRACT = Object.freeze({
  routes: {
    storyStart: '/api/story/start',
    storyFinalize: '/api/story/finalize',
    storyGet: '/api/story/:sessionId',
    shortDetail: '/api/shorts/:jobId',
    shortsMine: '/api/shorts/mine?limit=50',
    controlRoom: '/diag/finalize-control-room',
  },
  controlRoomFields: PHASE6_CONTROL_ROOM_FIELD_MAP,
  metrics: [
    'finalize_queue_depth',
    'finalize_queue_oldest_age_seconds',
    'finalize_jobs_running',
    'finalize_jobs_retry_scheduled',
    'finalize_workers_active',
    'finalize_worker_saturation_ratio',
    'finalize_provider_cooldown_active',
    'finalize_billing_unsettled_jobs',
    'finalize_billing_mismatches_total',
    'finalize_queue_wait_duration_ms',
    'finalize_readback_completion_lag_ms',
    'finalize_readback_retries_total',
  ],
  scenarioOutputs: [
    'run-summary.json',
    'samples.ndjson',
    'control-room/*.json',
    'verdict.json',
  ],
});

function metricSeriesValue(metrics, collectionName, metricName, labels = {}) {
  const series = Array.isArray(metrics?.[collectionName]) ? metrics[collectionName] : [];
  return (
    series.find(
      (entry) =>
        entry?.name === metricName &&
        JSON.stringify(entry?.labels || {}) === JSON.stringify(labels)
    ) || null
  );
}

function stableClone(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => stableClone(entry));
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = stableClone(value[key]);
    }
    return out;
  }
  return value;
}

export function phase6ArtifactEnvelope(artifactType, payload = {}) {
  return {
    schemaVersion: PHASE6_SCHEMA_VERSION,
    artifactType,
    ...stableClone(payload),
  };
}

export async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function writeJsonArtifact(filePath, payload) {
  await ensureDir(path.dirname(filePath));
  const serialized = JSON.stringify(stableClone(payload), null, 2);
  await fs.writeFile(filePath, `${serialized}\n`, 'utf8');
}

export async function appendNdjsonArtifact(filePath, payload) {
  await ensureDir(path.dirname(filePath));
  const serialized = JSON.stringify(stableClone(payload));
  await fs.appendFile(filePath, `${serialized}\n`, 'utf8');
}

export function slugify(value) {
  return String(value || 'run')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'run';
}

export function summarizeControlRoom(payload = {}) {
  const queueSnapshot = payload?.queueSnapshot || {};
  const sharedBacklog = payload?.sharedSystemPressure?.backlog || {};
  const sharedRender = payload?.sharedSystemPressure?.render || {};
  const providers = payload?.sharedSystemPressure?.providers || {};
  const storySearchProviders = providers?.storySearchProviders || {};
  const storySearchCooldownProviders = Object.entries(storySearchProviders)
    .filter(([, providerState]) => providerState?.cooldownActive === true)
    .map(([providerKey]) => providerKey)
    .sort();
  const localMetrics = payload?.localProcessObservability?.metrics || {};
  const localWorkersActive = metricSeriesValue(localMetrics, 'gauges', 'finalize_workers_active');
  const localWorkerSaturation = metricSeriesValue(
    localMetrics,
    'gauges',
    'finalize_worker_saturation_ratio'
  );
  const queueWaitHistogram = metricSeriesValue(
    localMetrics,
    'histograms',
    'finalize_queue_wait_duration_ms'
  );
  const readbackLagHistogram = metricSeriesValue(
    localMetrics,
    'histograms',
    'finalize_readback_completion_lag_ms',
    { surface: 'short_detail' }
  );
  return {
    queueDepth: Number(queueSnapshot.queueDepth || 0),
    queueOldestAgeSeconds: Number(queueSnapshot.queueOldestAgeSeconds || 0),
    jobsRunning: Number(queueSnapshot.jobsRunning || 0),
    jobsRetryScheduled: Number(queueSnapshot.jobsRetryScheduled || 0),
    billingUnsettledJobs: Number(queueSnapshot.billingUnsettledJobs || 0),
    sharedBacklog: Number(sharedBacklog.backlog || 0),
    sharedBacklogLimit: Number(sharedBacklog.limit || 0),
    sharedRenderActiveLeases: Number(sharedRender.activeLeases || 0),
    sharedRenderLimit: Number(sharedRender.limit || 0),
    openAiCooldownActive: Boolean(providers?.openai?.cooldownActive),
    ttsCooldownActive: Boolean(providers?.tts?.cooldownActive),
    storySearchCooldownProviders,
    storySearchCooldownCount: storySearchCooldownProviders.length,
    localWorkersActive: Number(localWorkersActive?.value || 0),
    localWorkerSaturationRatio: Number(localWorkerSaturation?.value || 0),
    queueWaitLastMs: Number(queueWaitHistogram?.lastValue || 0),
    readbackLagLastMs: Number(readbackLagHistogram?.lastValue || 0),
    localMetricsSeriesCount:
      Array.isArray(localMetrics?.gauges) || Array.isArray(localMetrics?.counters)
        ? (localMetrics.gauges?.length || 0) + (localMetrics.counters?.length || 0)
        : 0,
    recentEventCount: Array.isArray(payload?.localProcessObservability?.recentEvents)
      ? payload.localProcessObservability.recentEvents.length
      : 0,
  };
}

export async function loadJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

export async function loadScenarioArtifacts(runDir) {
  const summary = await loadJson(path.join(runDir, 'run-summary.json'));
  const verdict = await loadJson(path.join(runDir, 'verdict.json'));
  return { summary, verdict };
}
