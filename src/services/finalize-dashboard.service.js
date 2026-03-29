import fs from 'node:fs/promises';
import path from 'node:path';

import { snapshotFinalizeObservability } from '../observability/finalize-observability.js';
import {
  captureSharedFinalizePressureSnapshot,
  getFinalizePressureConfig,
} from './finalize-control.service.js';
import { captureFinalizeQueueMetricsSnapshot } from './story-finalize.attempts.js';

const PHASE6_SUMMARY_PATH = path.resolve(
  'docs',
  'artifacts',
  'finalize-phase6',
  'phase6-threshold-summary.json'
);

const DOC_LINKS = Object.freeze([
  {
    key: 'scalingRunbook',
    title: 'Scaling Runbook',
    description: 'Operator actions for queue growth, worker drift, cooldowns, and retries.',
    url: 'https://github.com/AJR628/vaiform/blob/main/docs/FINALIZE_SCALING_RUNBOOK.md',
  },
  {
    key: 'thresholdReport',
    title: 'Threshold Report',
    description: 'Phase 6 measured green/yellow ranges for launch-time decisions.',
    url: 'https://github.com/AJR628/vaiform/blob/main/docs/FINALIZE_THRESHOLD_REPORT.md',
  },
  {
    key: 'incidentTraceRunbook',
    title: 'Incident Trace Runbook',
    description: 'Canonical triage path for finalize queue, billing, and readback incidents.',
    url: 'https://github.com/AJR628/vaiform/blob/main/docs/INCIDENT_TRACE_RUNBOOK.md',
  },
  {
    key: 'alertArtifacts',
    title: 'Alert Artifacts',
    description: 'Stable alert families and the context each alert must carry.',
    url: 'https://github.com/AJR628/vaiform/blob/main/docs/FINALIZE_ALERT_ARTIFACTS.md',
  },
]);

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function getGaugeValue(metrics, name, labels = null) {
  const series = metrics?.gauges?.find((entry) => {
    if (entry.name !== name) return false;
    if (!labels) return true;
    return Object.entries(labels).every(([key, expected]) => entry.labels?.[key] === expected);
  });
  return numberOrNull(series?.value);
}

function getCounterTotal(metrics, name) {
  return (metrics?.counters || [])
    .filter((entry) => entry.name === name)
    .reduce((total, entry) => total + Number(entry.value || 0), 0);
}

function getHistogramMax(metrics, name) {
  const matches = (metrics?.histograms || []).filter((entry) => entry.name === name);
  if (!matches.length) return null;
  return Math.max(...matches.map((entry) => Number(entry.max || 0)));
}

function classifyThreshold(value, range) {
  if (!range || !Number.isFinite(Number(value))) return 'unknown';
  if (value > Number(range.yellow)) return 'bad';
  if (value > Number(range.green)) return 'warning';
  return 'healthy';
}

function formatCountSummary(active, limit) {
  if (!Number.isFinite(Number(limit)) || Number(limit) <= 0) {
    return `${active}`;
  }
  return `${active}/${limit}`;
}

function normalizeProviderEntries(providers = {}) {
  const entries = [];
  const pushEntry = (key, label, value) => {
    if (!value || typeof value !== 'object') return;
    entries.push({
      key,
      label,
      cooldownActive: value.cooldownActive === true,
      cooldownUntil: value.cooldownUntil || null,
      nextAllowedAt: value.nextAllowedAt || null,
      activeLeases: Number(value.activeLeases || 0),
      slotLimit: Number(value.slotLimit || 0),
      failureCount: Number(value.failureCount || 0),
      lastFailureCode: value.lastFailureCode || null,
    });
  };

  pushEntry('openai', 'OpenAI', providers.openai);
  pushEntry('storySearchAdmission', 'Story Search Admission', providers.storySearchAdmission);
  pushEntry('storySearchPexels', 'Story Search Pexels', providers.storySearchProviders?.pexels);
  pushEntry('storySearchPixabay', 'Story Search Pixabay', providers.storySearchProviders?.pixabay);
  pushEntry('storySearchNasa', 'Story Search NASA', providers.storySearchProviders?.nasa);
  pushEntry('tts', 'TTS', providers.tts);

  return entries;
}

async function loadPhase6ThresholdSummary() {
  try {
    const raw = await fs.readFile(PHASE6_SUMMARY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const runs = Array.isArray(parsed?.runs) ? parsed.runs : [];
    const thresholds = parsed?.thresholds || {};
    const scenarioCount = new Set(runs.map((run) => run.scenario).filter(Boolean)).size;
    const failingRuns = runs.filter((run) => run.verdict !== 'pass');
    const watchItems = [];

    if (Number(thresholds.billingMismatches || 0) > 0) {
      watchItems.push(
        'Phase 6 recorded at least one billing mismatch. Treat new mismatches as an operator check-now signal.'
      );
    }
    if (failingRuns.length > 0) {
      watchItems.push(
        `${failingRuns.length} Phase 6 run${failingRuns.length === 1 ? '' : 's'} did not pass. Re-check proof before changing pressure limits.`
      );
    }
    if (!watchItems.length) {
      watchItems.push('Current Phase 6 JSON summary does not report an unresolved proof failure.');
    }

    return {
      available: true,
      generatedAt: parsed.generatedAt || null,
      runCount: Number(parsed.runCount || runs.length || 0),
      scenarioCount,
      thresholds,
      runs,
      watchItems,
      quickRanges: [
        {
          key: 'queueDepth',
          label: 'Queue depth',
          greenMax: thresholds?.ranges?.queueDepth?.green ?? null,
          yellowMax: thresholds?.ranges?.queueDepth?.yellow ?? null,
        },
        {
          key: 'queueAge',
          label: 'Oldest queued age (s)',
          greenMax: thresholds?.ranges?.queueAge?.green ?? null,
          yellowMax: thresholds?.ranges?.queueAge?.yellow ?? null,
        },
        {
          key: 'retryScheduled',
          label: 'Retry-scheduled jobs',
          greenMax: thresholds?.ranges?.retryScheduled?.green ?? null,
          yellowMax: thresholds?.ranges?.retryScheduled?.yellow ?? null,
        },
      ],
    };
  } catch (error) {
    return {
      available: false,
      generatedAt: null,
      runCount: 0,
      scenarioCount: 0,
      thresholds: null,
      runs: [],
      watchItems: ['Phase 6 threshold summary JSON could not be loaded.'],
      quickRanges: [],
      error: error?.message || 'PHASE6_THRESHOLD_SUMMARY_UNAVAILABLE',
    };
  }
}

function buildFounderSummary({ verdict, issues, queueSnapshot, providerEntries, thresholdSummary }) {
  const cooldownProviders = providerEntries.filter((entry) => entry.cooldownActive).map((entry) => entry.label);
  const queueDepth = Number(queueSnapshot.queueDepth || 0);
  const queueAge = Number(queueSnapshot.queueOldestAgeSeconds || 0);
  const retryScheduled = Number(queueSnapshot.jobsRetryScheduled || 0);

  if (!thresholdSummary.available) {
    return {
      headline: 'Threshold summary unavailable',
      what: 'Live finalize data is available, but the Phase 6 threshold JSON could not be loaded.',
      why: 'Without the checked-in threshold summary, the dashboard cannot safely label the system as healthy.',
      next: 'Open the threshold report and confirm the Phase 6 artifact summary is present before using this page for launch decisions.',
    };
  }

  if (verdict === 'bad') {
    const primaryIssue = issues[0] || 'Shared finalize pressure is above the measured operating range.';
    return {
      headline: 'Shared finalize pressure is unhealthy',
      what: primaryIssue,
      why: 'Jobs are at risk of slowing down or stacking up beyond the measured Phase 6 comfort range.',
      next:
        cooldownProviders.length > 0
          ? `Provider cooldown is active (${cooldownProviders.join(', ')}). Open the scaling runbook and avoid raising load until cooldown clears.`
          : 'Open the scaling runbook and incident trace runbook, then verify worker availability and backlog trend before raising load.',
    };
  }

  if (verdict === 'warning') {
    if (cooldownProviders.length > 0) {
      return {
        headline: 'Provider pressure needs attention',
        what: `Provider cooldown is active for ${cooldownProviders.join(', ')}.`,
        why: 'Renders can still complete, but launch traffic may slow down while that provider cools off.',
        next: 'Keep load steady, watch queue age on the next refresh, and open the scaling runbook if cooldown persists.',
      };
    }

    return {
      headline: 'Finalize is drifting above the green range',
      what: `Queue depth=${queueDepth}, queue age=${queueAge}s, retry-scheduled=${retryScheduled}.`,
      why: 'The shared system is still operating, but it is above the measured green band and could tip into unhealthy pressure.',
      next: 'Refresh again in a few cycles. If queue age or retry backlog keeps rising, open the scaling runbook and reduce launch pressure.',
    };
  }

  return {
    headline: 'Finalize queue is healthy',
    what: 'Queue depth, queue age, and retry backlog are all within the measured green range.',
    why: 'Shared finalize pressure is inside the launch-time proof band and no provider cooldown is active.',
    next: 'No immediate action is needed. Keep the page open during traffic spikes and use the runbooks only if the banner changes.',
  };
}

function buildSharedHealth({
  queueSnapshot,
  sharedSystemPressure,
  pressureConfig,
  thresholdSummary,
}) {
  const providerEntries = normalizeProviderEntries(sharedSystemPressure.providers);
  const cooldownProviders = providerEntries.filter((entry) => entry.cooldownActive);
  const ranges = thresholdSummary?.thresholds?.ranges || {};
  const queueDepthStatus = classifyThreshold(queueSnapshot.queueDepth, ranges.queueDepth);
  const queueAgeStatus = classifyThreshold(queueSnapshot.queueOldestAgeSeconds, ranges.queueAge);
  const retryStatus = classifyThreshold(queueSnapshot.jobsRetryScheduled, ranges.retryScheduled);

  const issues = [];
  let verdict = 'healthy';

  if (!thresholdSummary.available) {
    verdict = 'warning';
    issues.push('Phase 6 threshold summary JSON is unavailable.');
  }

  if (sharedSystemPressure?.backlog?.overloaded) {
    verdict = 'bad';
    issues.push(
      `Shared backlog is overloaded at ${sharedSystemPressure.backlog.backlog}/${sharedSystemPressure.backlog.limit}.`
    );
  }

  if (queueDepthStatus === 'bad') {
    verdict = 'bad';
    issues.push(`Queue depth is above the Phase 6 warning band (${queueSnapshot.queueDepth}).`);
  } else if (queueDepthStatus === 'warning' && verdict !== 'bad') {
    verdict = 'warning';
    issues.push(`Queue depth is above green (${queueSnapshot.queueDepth}).`);
  }

  if (queueAgeStatus === 'bad') {
    verdict = 'bad';
    issues.push(
      `Oldest queued age is above the Phase 6 warning band (${queueSnapshot.queueOldestAgeSeconds}s).`
    );
  } else if (queueAgeStatus === 'warning' && verdict !== 'bad') {
    verdict = 'warning';
    issues.push(`Oldest queued age is above green (${queueSnapshot.queueOldestAgeSeconds}s).`);
  }

  if (retryStatus === 'bad') {
    verdict = 'bad';
    issues.push(
      `Retry-scheduled jobs are above the Phase 6 warning band (${queueSnapshot.jobsRetryScheduled}).`
    );
  } else if (retryStatus === 'warning' && verdict !== 'bad') {
    verdict = 'warning';
    issues.push(`Retry-scheduled jobs are above green (${queueSnapshot.jobsRetryScheduled}).`);
  }

  if (cooldownProviders.length > 0 && verdict === 'healthy') {
    verdict = 'warning';
  }
  if (cooldownProviders.length > 0) {
    issues.push(`Provider cooldown active: ${cooldownProviders.map((entry) => entry.label).join(', ')}.`);
  }

  const renderLimit = Number(sharedSystemPressure?.render?.limit || 0);
  const renderActiveLeases = Number(sharedSystemPressure?.render?.activeLeases || 0);
  const sharedBacklog = Number(sharedSystemPressure?.backlog?.backlog || 0);
  if (
    verdict === 'healthy' &&
    renderLimit > 0 &&
    renderActiveLeases >= renderLimit &&
    sharedBacklog > 0
  ) {
    verdict = 'warning';
    issues.push('Shared render capacity is full while backlog still exists.');
  }

  return {
    verdict,
    headline:
      verdict === 'bad'
        ? 'Bad'
        : verdict === 'warning'
          ? 'Warning'
          : 'Healthy',
    issues,
    providerEntries,
    metrics: {
      queueDepth: {
        label: 'Queue depth',
        value: Number(queueSnapshot.queueDepth || 0),
        status: queueDepthStatus,
      },
      queueOldestAgeSeconds: {
        label: 'Oldest queued age',
        value: Number(queueSnapshot.queueOldestAgeSeconds || 0),
        unit: 's',
        status: queueAgeStatus,
      },
      jobsRetryScheduled: {
        label: 'Retry-scheduled',
        value: Number(queueSnapshot.jobsRetryScheduled || 0),
        status: retryStatus,
      },
      sharedBacklog: {
        label: 'Shared backlog',
        value: Number(sharedSystemPressure?.backlog?.backlog || 0),
        detail: formatCountSummary(
          sharedSystemPressure?.backlog?.backlog || 0,
          sharedSystemPressure?.backlog?.limit || 0
        ),
        status: sharedSystemPressure?.backlog?.overloaded ? 'bad' : 'healthy',
      },
      sharedRenderLeases: {
        label: 'Shared render leases',
        value: renderActiveLeases,
        detail: formatCountSummary(renderActiveLeases, renderLimit),
        status:
          renderLimit > 0 && renderActiveLeases >= renderLimit && sharedBacklog > 0
            ? 'warning'
            : 'healthy',
      },
      providerCooldowns: {
        label: 'Provider cooldowns',
        value: cooldownProviders.length,
        detail:
          cooldownProviders.length > 0
            ? cooldownProviders.map((entry) => entry.label).join(', ')
            : 'None',
        status: cooldownProviders.length > 0 ? 'warning' : 'healthy',
      },
    },
    pressureConfigSummary: {
      renderLimit: pressureConfig.renderLimit,
      backlogLimit: pressureConfig.backlogLimit,
      overloadRetryAfterSec: pressureConfig.overloadRetryAfterSec,
      openAiSharedLimit: pressureConfig.openAiSharedLimit,
      storySearchSharedLimit: pressureConfig.storySearchSharedLimit,
      ttsSharedLimit: pressureConfig.ttsSharedLimit,
    },
    sources: ['queueSnapshot', 'sharedSystemPressure', 'pressureConfig', 'phase6-threshold-summary.json'],
  };
}

function buildLocalObservability(localProcessObservability = {}) {
  const metrics = localProcessObservability.metrics || {};
  const recentEvents = Array.isArray(localProcessObservability.recentEvents)
    ? localProcessObservability.recentEvents.slice(-10).reverse()
    : [];

  return {
    note: 'These values are from the API process serving this page only. They are not system-wide truth.',
    generatedAt: localProcessObservability.generatedAt || metrics.generatedAt || null,
    metrics: {
      workersActive: getGaugeValue(metrics, 'finalize_workers_active'),
      workerSaturationRatio: getGaugeValue(metrics, 'finalize_worker_saturation_ratio'),
      jobsRunning: getGaugeValue(metrics, 'finalize_jobs_running'),
      recentReadbackLagMs: getHistogramMax(metrics, 'finalize_readback_completion_lag_ms'),
      billingMismatchCount: getCounterTotal(metrics, 'finalize_billing_mismatches_total'),
    },
    recentEvents: recentEvents.map((event) => ({
      ts: event.ts || null,
      event: event.event || null,
      requestId: event.requestId || null,
      sessionId: event.sessionId || null,
      attemptId: event.attemptId || null,
      finalizeJobId: event.finalizeJobId || null,
      workerId: event.workerId || null,
      shortId: event.shortId || null,
      stage: event.stage || null,
      errorCode: event.errorCode || null,
      failureReason: event.failureReason || null,
      durationMs: numberOrNull(event.durationMs),
    })),
  };
}

export async function buildFinalizeDashboardPayload() {
  const [queueSnapshot, sharedSystemPressure, thresholdSummary] = await Promise.all([
    captureFinalizeQueueMetricsSnapshot(),
    captureSharedFinalizePressureSnapshot(),
    loadPhase6ThresholdSummary(),
  ]);

  const pressureConfig = getFinalizePressureConfig();
  const localProcessObservability = snapshotFinalizeObservability();
  const sharedHealth = buildSharedHealth({
    queueSnapshot,
    sharedSystemPressure,
    pressureConfig,
    thresholdSummary,
  });
  const founderSummary = buildFounderSummary({
    verdict: sharedHealth.verdict,
    issues: sharedHealth.issues,
    queueSnapshot,
    providerEntries: sharedHealth.providerEntries,
    thresholdSummary,
  });

  return {
    generatedAt: new Date().toISOString(),
    context: {
      environment: process.env.NODE_ENV || 'development',
      note: 'Backend-served internal dashboard. Top verdict uses shared finalize truth only.',
    },
    sharedHealth,
    founderSummary,
    thresholdSummary,
    queueSnapshot,
    sharedSystemPressure,
    pressureConfig,
    localObservability: buildLocalObservability(localProcessObservability),
    links: DOC_LINKS,
  };
}
