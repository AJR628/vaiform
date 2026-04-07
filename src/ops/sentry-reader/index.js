const DEFAULT_SENTRY_API_BASE_URL = 'https://sentry.io/api/0';
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS_CAP = 10;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,160}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;
const EVENT_SELECTORS = new Set(['recommended', 'latest']);

function normalizeString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requiredString(name, value) {
  const normalized = normalizeString(value);
  if (!normalized) {
    throw new Error(`${name} is required for the Sentry incident bridge.`);
  }
  return normalized;
}

function clampMaxResults(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_MAX_RESULTS;
  return Math.min(Math.floor(numeric), MAX_RESULTS_CAP);
}

function resolveTimeoutMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.floor(numeric), 30_000);
}

function assertSafeId(name, value) {
  const normalized = requiredString(name, value);
  if (!SAFE_ID_PATTERN.test(normalized)) {
    throw new Error(`${name} contains unsupported characters.`);
  }
  return normalized;
}

function assertSafeRequestId(value) {
  const normalized = requiredString('request_id', value);
  if (!REQUEST_ID_PATTERN.test(normalized)) {
    throw new Error('request_id contains unsupported characters.');
  }
  return normalized;
}

function appendQuery(url, params = {}) {
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry != null && entry !== '') url.searchParams.append(key, String(entry));
      }
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

function normalizeApiBaseUrl(value) {
  const normalized = normalizeString(value) || DEFAULT_SENTRY_API_BASE_URL;
  return normalized.replace(/\/+$/, '');
}

function tagsToObject(tags) {
  if (!tags) return {};
  if (!Array.isArray(tags) && typeof tags === 'object') return { ...tags };
  if (!Array.isArray(tags)) return {};

  const out = {};
  for (const tag of tags) {
    const key = normalizeString(tag?.key);
    if (!key) continue;
    out[key] = tag?.value == null ? null : String(tag.value);
  }
  return out;
}

function firstPresent(source, keys) {
  for (const key of keys) {
    const value = normalizeString(source?.[key]);
    if (value) return value;
  }
  return null;
}

function valueOrNull(value) {
  if (typeof value === 'string') return normalizeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  return null;
}

function releaseVersion(release) {
  if (typeof release === 'string') return normalizeString(release);
  return normalizeString(release?.version ?? release?.shortVersion ?? null);
}

function projectSummary(project) {
  if (!project || typeof project !== 'object') return { id: null, slug: null, name: null };
  return {
    id: valueOrNull(project.id),
    slug: normalizeString(project.slug),
    name: normalizeString(project.name),
  };
}

function pickTopStackFrames(event, maxFrames = 5) {
  const entries = Array.isArray(event?.entries) ? event.entries : [];
  const exceptionEntry = entries.find((entry) => entry?.type === 'exception');
  const values = exceptionEntry?.data?.values;
  const frames = values?.[0]?.stacktrace?.frames;
  if (!Array.isArray(frames)) return [];

  return frames
    .filter((frame) => frame && typeof frame === 'object')
    .filter((frame) => frame.inApp === true)
    .slice(-maxFrames)
    .map((frame) => ({
      module: normalizeString(frame.module),
      function: normalizeString(frame.function),
      filename: normalizeString(frame.filename),
      lineNo: Number.isFinite(Number(frame.lineNo)) ? Number(frame.lineNo) : null,
      colNo: Number.isFinite(Number(frame.colNo)) ? Number(frame.colNo) : null,
      inApp: frame.inApp === true,
    }));
}

function eventErrorSummary(event) {
  const metadata = event?.metadata || {};
  return {
    type: normalizeString(metadata.type ?? event?.type),
    value: normalizeString(metadata.value ?? event?.message ?? event?.title),
    culprit: normalizeString(event?.culprit),
    location: normalizeString(event?.location),
    stackFrames: pickTopStackFrames(event),
  };
}

function eventCorrelation(event) {
  const tags = tagsToObject(event?.tags);
  const context = event?.contexts || {};
  const requestContext = context.vaiform_request || {};
  const traceContext = context.trace || {};

  return {
    requestId: firstPresent(tags, ['request_id']),
    surface: firstPresent(tags, ['surface']),
    service: firstPresent(tags, ['service']),
    flow: firstPresent(tags, ['flow']),
    method: normalizeString(requestContext.method),
    path: normalizeString(requestContext.path),
    release: releaseVersion(event?.release),
    environment: firstPresent(tags, ['environment']),
    traceId: normalizeString(traceContext.trace_id),
    spanId: normalizeString(traceContext.span_id),
    sessionId: firstPresent(tags, ['sessionId', 'session_id']),
    attemptId: firstPresent(tags, ['attemptId', 'attempt_id']),
    finalizeJobId: firstPresent(tags, ['finalizeJobId', 'finalize_job_id']),
    shortId: firstPresent(tags, ['shortId', 'short_id']),
    workerId: firstPresent(tags, ['workerId', 'worker_id']),
  };
}

export function sanitizeIssue(issue) {
  if (!issue || typeof issue !== 'object') return null;
  return {
    id: valueOrNull(issue.id),
    shortId: normalizeString(issue.shortId),
    title: normalizeString(issue.title ?? issue.metadata?.title),
    status: normalizeString(issue.status),
    substatus: normalizeString(issue.substatus),
    level: normalizeString(issue.level),
    type: normalizeString(issue.type),
    count: Number.isFinite(Number(issue.count)) ? Number(issue.count) : null,
    userCount: Number.isFinite(Number(issue.userCount)) ? Number(issue.userCount) : null,
    firstSeen: normalizeString(issue.firstSeen),
    lastSeen: normalizeString(issue.lastSeen),
    permalink: normalizeString(issue.permalink),
    culprit: normalizeString(issue.culprit),
    project: projectSummary(issue.project),
  };
}

export function sanitizeEvent(event) {
  if (!event || typeof event !== 'object') return null;
  return {
    id: valueOrNull(event.id),
    eventId: normalizeString(event.eventID ?? event.eventId),
    groupId: valueOrNull(event.groupID ?? event.groupId),
    title: normalizeString(event.title ?? event.metadata?.title),
    type: normalizeString(event.type),
    platform: normalizeString(event.platform),
    dateCreated: normalizeString(event.dateCreated),
    dateReceived: normalizeString(event.dateReceived),
    projectId: valueOrNull(event.projectID ?? event.projectId),
    correlation: eventCorrelation(event),
    error: eventErrorSummary(event),
  };
}

export function buildIncidentPacket({
  issue = null,
  event = null,
  eventSelector = null,
  requestedRequestId = null,
} = {}) {
  const safeIssue = sanitizeIssue(issue);
  const safeEvent = sanitizeEvent(event);
  const fallbackRequestId = normalizeString(requestedRequestId);
  const correlation = {
    requestId: safeEvent?.correlation?.requestId ?? fallbackRequestId,
    surface: safeEvent?.correlation?.surface ?? null,
    service: safeEvent?.correlation?.service ?? null,
    flow: safeEvent?.correlation?.flow ?? null,
    method: safeEvent?.correlation?.method ?? null,
    path: safeEvent?.correlation?.path ?? null,
    release: safeEvent?.correlation?.release ?? null,
    environment: safeEvent?.correlation?.environment ?? null,
    traceId: safeEvent?.correlation?.traceId ?? null,
    spanId: safeEvent?.correlation?.spanId ?? null,
    sessionId: safeEvent?.correlation?.sessionId ?? null,
    attemptId: safeEvent?.correlation?.attemptId ?? null,
    finalizeJobId: safeEvent?.correlation?.finalizeJobId ?? null,
    shortId: safeEvent?.correlation?.shortId ?? null,
    workerId: safeEvent?.correlation?.workerId ?? null,
  };

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: 'sentry',
    sentry: {
      org: null,
      project: safeIssue?.project?.slug ?? null,
      issueId: safeIssue?.id ?? safeEvent?.groupId ?? null,
      issueShortId: safeIssue?.shortId ?? null,
      eventId: safeEvent?.eventId ?? null,
      eventSelector: eventSelector ?? null,
      permalink: safeIssue?.permalink ?? null,
    },
    summary: {
      title: safeIssue?.title ?? safeEvent?.title ?? null,
      level: safeIssue?.level ?? null,
      status: safeIssue?.status ?? null,
      substatus: safeIssue?.substatus ?? null,
      firstSeen: safeIssue?.firstSeen ?? null,
      lastSeen: safeIssue?.lastSeen ?? null,
      count: safeIssue?.count ?? null,
    },
    correlation,
    error: safeEvent?.error ?? {
      type: null,
      value: null,
      culprit: null,
      location: null,
      stackFrames: [],
    },
    repoInvestigation: {
      canonicalDocs: ['docs/MAINTENANCE_FRONT_DOOR.md', 'docs/INCIDENT_TRACE_RUNBOOK.md'],
      suggestedFirstChecks: [
        'Start from requestId in backend/mobile support evidence.',
        'Use docs/INCIDENT_TRACE_RUNBOOK.md only for finalize-related flows.',
        'Treat sessionId, attemptId, finalizeJobId, shortId, and workerId as conditional unless present in this packet.',
      ],
    },
    redaction: {
      policy: 'allowlist',
      blockedFields: [
        'user',
        'request.headers',
        'request.data',
        'breadcrumbs',
        'frame.vars',
        'frame.context',
        'attachments',
        'replay',
      ],
    },
  };
}

export function loadSentryBridgeConfig(env = process.env) {
  return {
    token: requiredString('SENTRY_BRIDGE_TOKEN', env.SENTRY_BRIDGE_TOKEN),
    orgSlug: assertSafeId('SENTRY_BRIDGE_ORG_SLUG', env.SENTRY_BRIDGE_ORG_SLUG),
    projectSlug: assertSafeId('SENTRY_BRIDGE_PROJECT_SLUG', env.SENTRY_BRIDGE_PROJECT_SLUG),
    timeoutMs: resolveTimeoutMs(env.SENTRY_BRIDGE_TIMEOUT_MS),
    maxResults: clampMaxResults(env.SENTRY_BRIDGE_MAX_RESULTS),
  };
}

function quoteSearchValue(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function normalizeEventSelector(value) {
  const eventSelector = normalizeString(value) || 'recommended';
  if (!EVENT_SELECTORS.has(eventSelector)) {
    throw new Error('event selector must be recommended or latest.');
  }
  return eventSelector;
}

export class SentryReader {
  constructor({
    token,
    orgSlug,
    projectSlug,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxResults = DEFAULT_MAX_RESULTS,
    fetchImpl = globalThis.fetch,
    apiBaseUrl = DEFAULT_SENTRY_API_BASE_URL,
  }) {
    this.token = requiredString('token', token);
    this.orgSlug = assertSafeId('orgSlug', orgSlug);
    this.projectSlug = assertSafeId('projectSlug', projectSlug);
    this.timeoutMs = resolveTimeoutMs(timeoutMs);
    this.maxResults = clampMaxResults(maxResults);
    this.fetchImpl = fetchImpl;
    this.apiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);

    if (typeof this.fetchImpl !== 'function') {
      throw new Error('fetch implementation is required for the Sentry incident bridge.');
    }
  }

  async sentryGet(pathname, params = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const url = appendQuery(new URL(`${this.apiBaseUrl}${pathname}`), params);

    try {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Sentry read failed with HTTP ${response.status} for ${pathname}.`);
      }

      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  async getIssue(issueId) {
    const safeIssueId = assertSafeId('issue_id', issueId);
    const issue = await this.sentryGet(`/organizations/${this.orgSlug}/issues/${safeIssueId}/`);
    return sanitizeIssue(issue);
  }

  async getIssueEvent(issueId, selector = 'recommended', { environment = null } = {}) {
    const safeIssueId = assertSafeId('issue_id', issueId);
    const eventSelector = normalizeEventSelector(selector);

    const event = await this.sentryGet(
      `/organizations/${this.orgSlug}/issues/${safeIssueId}/events/${eventSelector}/`,
      {
        environment: normalizeString(environment),
      }
    );
    return sanitizeEvent(event);
  }

  async searchByRequestId(requestId, { statsPeriod = '14d' } = {}) {
    const safeRequestId = assertSafeRequestId(requestId);
    const issues = await this.sentryGet(`/projects/${this.orgSlug}/${this.projectSlug}/issues/`, {
      statsPeriod: normalizeString(statsPeriod) || '14d',
      query: `request_id:${quoteSearchValue(safeRequestId)}`,
    });

    return Array.isArray(issues) ? issues.slice(0, this.maxResults).map(sanitizeIssue) : [];
  }

  async buildIncidentPacket({ issueId = null, requestId = null, event = 'recommended' } = {}) {
    const eventSelector = normalizeEventSelector(event);
    let issue = null;
    let requestedRequestId = null;
    if (issueId) {
      issue = await this.sentryGet(
        `/organizations/${this.orgSlug}/issues/${assertSafeId('issue_id', issueId)}/`
      );
    } else if (requestId) {
      requestedRequestId = assertSafeRequestId(requestId);
      const matches = await this.searchByRequestId(requestedRequestId);
      if (matches.length > 0) {
        issue = matches[0];
      }
    } else {
      throw new Error('issue_id or request_id is required to build an incident packet.');
    }

    if (!issue?.id) {
      const packet = buildIncidentPacket({
        issue,
        event: null,
        eventSelector,
        requestedRequestId,
      });
      return {
        ...packet,
        sentry: {
          ...packet.sentry,
          org: this.orgSlug,
          project: this.projectSlug,
        },
      };
    }

    const rawEvent = await this.sentryGet(
      `/organizations/${this.orgSlug}/issues/${assertSafeId('issue_id', issue.id)}/events/${eventSelector}/`
    );
    const packet = buildIncidentPacket({ issue, event: rawEvent, eventSelector });
    return {
      ...packet,
      sentry: {
        ...packet.sentry,
        org: this.orgSlug,
        project: this.projectSlug,
      },
    };
  }
}

export function createSentryReader(options = {}) {
  return new SentryReader(options);
}
