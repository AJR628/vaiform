import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SentryReader,
  buildIncidentPacket,
  loadSentryBridgeConfig,
  sanitizeEvent,
} from '../../src/ops/sentry-reader/index.js';

function mockJsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

test('Sentry reader loads minimal bridge env contract', () => {
  const config = loadSentryBridgeConfig({
    SENTRY_BRIDGE_TOKEN: 'token-1',
    SENTRY_BRIDGE_ORG_SLUG: 'vaiform',
    SENTRY_BRIDGE_PROJECT_SLUG: 'backend-api',
    SENTRY_BRIDGE_TIMEOUT_MS: '3000',
    SENTRY_BRIDGE_MAX_RESULTS: '50',
  });

  assert.deepEqual(config, {
    token: 'token-1',
    orgSlug: 'vaiform',
    projectSlug: 'backend-api',
    timeoutMs: 3000,
    maxResults: 10,
  });
});

test('searchByRequestId uses GET-only project issue lookup and never returns the token', async () => {
  const calls = [];
  const reader = new SentryReader({
    token: 'secret-token',
    orgSlug: 'vaiform',
    projectSlug: 'backend-api',
    apiBaseUrl: 'https://sentry.example/api/0',
    maxResults: 3,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return mockJsonResponse([
        {
          id: '123',
          shortId: 'BACKEND-1',
          title: 'Backend failure',
          status: 'unresolved',
          count: '7',
          project: { id: '9', slug: 'backend-api', name: 'Backend API' },
        },
      ]);
    },
  });

  const result = await reader.searchByRequestId('req-123');

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer secret-token');
  assert.equal(calls[0].url.pathname, '/api/0/projects/vaiform/backend-api/issues/');
  assert.match(calls[0].url.searchParams.get('query'), /request_id:"req-123"/);
  assert.doesNotMatch(calls[0].url.searchParams.get('query'), /is:unresolved/);
  assert.doesNotMatch(JSON.stringify(result), /secret-token/);
  assert.deepEqual(result[0], {
    id: '123',
    shortId: 'BACKEND-1',
    title: 'Backend failure',
    status: 'unresolved',
    substatus: null,
    level: null,
    type: null,
    count: 7,
    userCount: null,
    firstSeen: null,
    lastSeen: null,
    permalink: null,
    culprit: null,
    project: { id: '9', slug: 'backend-api', name: 'Backend API' },
  });
});

test('sanitizeEvent allowlists phase-1 Sentry fields and leaves deeper IDs null unless present', () => {
  const safe = sanitizeEvent({
    id: 'event-row-1',
    eventID: 'event-1',
    groupID: '123',
    title: 'TypeError: boom',
    type: 'error',
    platform: 'node',
    release: { version: 'api@1' },
    tags: [
      { key: 'request_id', value: 'req-123' },
      { key: 'surface', value: 'backend-api' },
      { key: 'service', value: 'api' },
      { key: 'flow', value: 'story' },
      { key: 'environment', value: 'production' },
    ],
    contexts: {
      vaiform_request: {
        method: 'POST',
        path: '/api/story/finalize',
        hasAuthorizationHeader: true,
      },
      trace: {
        trace_id: 'trace-1',
        span_id: 'span-1',
      },
    },
    request: {
      headers: { authorization: 'Bearer token' },
      data: { prompt: 'do not return this' },
    },
    user: { email: 'founder@example.com', ip_address: '127.0.0.1' },
    breadcrumbs: [{ message: 'do not return this' }],
    metadata: {
      type: 'TypeError',
      value: 'boom',
    },
    entries: [
      {
        type: 'exception',
        data: {
          values: [
            {
              stacktrace: {
                frames: [
                  {
                    module: 'src.routes.story',
                    function: 'finalize',
                    filename: 'src/routes/story.routes.js',
                    lineNo: 10,
                    colNo: 2,
                    inApp: true,
                    vars: { authorization: 'Bearer token' },
                    context: [['9', 'secret line']],
                  },
                ],
              },
            },
          ],
        },
      },
    ],
  });

  assert.equal(safe.correlation.requestId, 'req-123');
  assert.equal(safe.correlation.flow, 'story');
  assert.equal(safe.correlation.sessionId, null);
  assert.equal(safe.correlation.attemptId, null);
  assert.equal(safe.correlation.finalizeJobId, null);
  assert.equal(safe.correlation.shortId, null);
  assert.equal(safe.correlation.workerId, null);
  assert.deepEqual(safe.error.stackFrames, [
    {
      module: 'src.routes.story',
      function: 'finalize',
      filename: 'src/routes/story.routes.js',
      lineNo: 10,
      colNo: 2,
      inApp: true,
    },
  ]);

  const serialized = JSON.stringify(safe);
  assert.doesNotMatch(serialized, /founder@example\.com/);
  assert.doesNotMatch(serialized, /127\.0\.0\.1/);
  assert.doesNotMatch(serialized, /Bearer token/);
  assert.doesNotMatch(serialized, /do not return this/);
  assert.doesNotMatch(serialized, /secret line/);
});

test('incident packet keeps Sentry issue short ID separate from Vaiform shortId', () => {
  const packet = buildIncidentPacket({
    issue: {
      id: '123',
      shortId: 'BACKEND-1',
      title: 'Backend failure',
      status: 'unresolved',
      project: { slug: 'backend-api' },
    },
    event: {
      eventID: 'event-1',
      groupID: '123',
      metadata: { type: 'Error', value: 'boom' },
      tags: [{ key: 'request_id', value: 'req-123' }],
    },
    eventSelector: 'recommended',
  });

  assert.equal(packet.sentry.issueShortId, 'BACKEND-1');
  assert.equal(packet.correlation.requestId, 'req-123');
  assert.equal(packet.correlation.shortId, null);
  assert.deepEqual(packet.redaction.blockedFields, [
    'user',
    'request.headers',
    'request.data',
    'breadcrumbs',
    'frame.vars',
    'frame.context',
    'attachments',
    'replay',
  ]);
});

test('buildIncidentPacket preserves requested requestId when no Sentry issue matches', async () => {
  const reader = new SentryReader({
    token: 'secret-token',
    orgSlug: 'vaiform',
    projectSlug: 'backend-api',
    fetchImpl: async () => mockJsonResponse([]),
  });

  const packet = await reader.buildIncidentPacket({ requestId: 'req-no-match' });

  assert.equal(packet.correlation.requestId, 'req-no-match');
  assert.equal(packet.sentry.org, 'vaiform');
  assert.equal(packet.sentry.project, 'backend-api');
  assert.equal(packet.sentry.issueId, null);
  assert.equal(packet.sentry.eventId, null);
});

test('getIssueEvent rejects non-phase-1 selectors', async () => {
  const reader = new SentryReader({
    token: 'secret-token',
    orgSlug: 'vaiform',
    projectSlug: 'backend-api',
    fetchImpl: async () => mockJsonResponse({}),
  });

  await assert.rejects(
    () => reader.getIssueEvent('123', 'oldest'),
    /event selector must be recommended or latest/
  );

  await assert.rejects(
    () => reader.buildIncidentPacket({ issueId: '123', event: 'oldest' }),
    /event selector must be recommended or latest/
  );
});
