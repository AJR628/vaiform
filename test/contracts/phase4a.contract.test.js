import assert from 'node:assert/strict';
import test from 'node:test';
import { compileCaptionSSOT } from '../../src/captions/compile.js';
import {
  readDoc,
  readStorySession,
  requestJson,
  resetHarnessState,
  seedFirestoreDoc,
  seedShortDoc,
  seedShortMeta,
  seedStorySession,
  seedUserDoc,
  setRuntimeOverride,
  startFinalizeWorkerRuntime,
  startHarness,
  stopFinalizeWorkerRuntime,
  stopHarness,
  timestamp,
  waitFor,
} from './helpers/phase4a-harness.js';

function buildBaseSession(overrides = {}) {
  const baseNowMs = Date.now();
  const now = new Date(baseNowMs).toISOString();
  const expiresAt = new Date(baseNowMs + 48 * 60 * 60 * 1000).toISOString();
  return {
    id: 'story-test-session',
    uid: 'user-1',
    input: {
      text: 'How tiny habits build momentum',
      type: 'paragraph',
    },
    styleKey: 'default',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    expiresAt,
    billingEstimate: {
      estimatedSec: 12,
      source: 'heuristic',
      updatedAt: now,
    },
    ...overrides,
  };
}

function buildShot(id, sentenceIndex, query, durationSec = 4) {
  return {
    sentenceIndex,
    visualDescription: `${query} visual`,
    searchQuery: query,
    durationSec,
    startTimeSec: sentenceIndex * durationSec,
    selectedClip: {
      id,
      url: `https://cdn.example.com/${id}.mp4`,
      thumbUrl: `https://cdn.example.com/${id}.jpg`,
      duration: durationSec,
      width: 720,
      height: 1280,
      provider: 'pexels',
      providerId: id.replace('clip-', ''),
      photographer: 'Pexels Author',
      sourceUrl: `https://pexels.example.com/${id}`,
      license: 'pexels',
    },
    candidates: [
      {
        id,
        url: `https://cdn.example.com/${id}.mp4`,
        thumbUrl: `https://cdn.example.com/${id}.jpg`,
        duration: durationSec,
        width: 720,
        height: 1280,
        provider: 'pexels',
        providerId: id.replace('clip-', ''),
        photographer: 'Pexels Author',
        sourceUrl: `https://pexels.example.com/${id}`,
        license: 'pexels',
      },
    ],
  };
}

function buildSyncedSession(overrides = {}) {
  const baseNow = '2026-03-19T00:00:00.000Z';
  const story = overrides.story || { sentences: ['Beat one'] };
  const sentences =
    Array.isArray(story?.sentences) && story.sentences.length > 0 ? story.sentences : ['Beat one'];
  const shots =
    Array.isArray(overrides.shots) && overrides.shots.length > 0
      ? overrides.shots
      : sentences.map((text, index) => buildShot(`clip-${index + 1}`, index, text, 4));

  let cursor = 0;
  const captions = sentences.map((text, index) => {
    const shot = shots.find((candidate) => candidate?.sentenceIndex === index);
    const durationSec = Number(shot?.durationSec ?? shot?.selectedClip?.duration ?? 4);
    const startTimeSec = cursor;
    cursor += durationSec;
    return {
      sentenceIndex: index,
      text,
      startTimeSec,
      endTimeSec: cursor,
    };
  });

  const totalDurationSec = captions.length > 0 ? captions[captions.length - 1].endTimeSec : 0;
  const renderChargeSec = totalDurationSec / 2;
  const beats = captions.map((caption, index) => ({
    captionMeta: null,
    narration: {
      fingerprint: `beat-sync-${overrides.id || 'session'}-${index}`,
      durationSec: caption.endTimeSec - caption.startTimeSec,
      audioStoragePath: `artifacts/user-1/${overrides.id || 'session'}/sync/beat-${index}.mp3`,
      timingStoragePath: `artifacts/user-1/${overrides.id || 'session'}/sync/beat-${index}.json`,
      syncedAt: baseNow,
    },
  }));
  const voiceSync = overrides.voiceSync || {
    schemaVersion: 1,
    state: 'current',
    requiredForRender: true,
    staleScope: 'none',
    staleBeatIndices: [],
    currentFingerprint: `sync-${overrides.id || 'session'}`,
    nextEstimatedChargeSec: 0,
    totalDurationSec,
    previewAudioUrl: `https://cdn.example.com/${overrides.id || 'session'}-preview.mp3`,
    previewAudioDurationSec: totalDurationSec,
    lastChargeSec: renderChargeSec,
    totalBilledSec: renderChargeSec,
    lastSyncedAt: baseNow,
    cached: false,
  };
  const billingEstimate = overrides.billingEstimate || {
    estimatedSec: renderChargeSec,
    source: 'voice_sync.current',
    computedAt: baseNow,
    heuristicEstimatedSec: totalDurationSec,
    heuristicSource: 'shot_durations',
    heuristicComputedAt: baseNow,
  };

  return buildBaseSession({
    status: 'voice_synced',
    story,
    shots,
    captions,
    beats,
    voicePreset: 'male_calm',
    voicePacePreset: 'normal',
    voiceSync,
    billingEstimate,
    ...overrides,
  });
}

function buildReadyDraftPreview({ previewId = 'preview-existing', durationSec = 4 } = {}) {
  return {
    version: 1,
    state: 'ready',
    updatedAt: '2026-03-19T00:00:00.000Z',
    rendererVersion: 'captioned-preview-v1.1',
    fingerprint: 'existing-preview-fingerprint',
    previewId,
    artifact: {
      url: `https://cdn.example.com/${previewId}.mp4`,
      storagePath: `artifacts/user-1/story/previews/${previewId}/captioned.mp4`,
      contentType: 'video/mp4',
      durationSec,
      width: 1080,
      height: 1920,
      createdAt: '2026-03-19T00:00:00.000Z',
      expiresAt: '2026-03-20T00:00:00.000Z',
    },
  };
}

function buildClientCaptionMeta(textRaw, style = {}) {
  const compiled = compileCaptionSSOT({
    textRaw,
    style,
    frameW: 1080,
    frameH: 1920,
  });
  return {
    lines: compiled.lines,
    effectiveStyle: compiled.effectiveStyle,
    styleHash: compiled.styleHash,
    wrapHash: compiled.wrapHash,
    maxWidthPx: compiled.maxWidthPx,
    totalTextH: compiled.totalTextH,
  };
}

function buildFinalizeAttemptDoc({
  uid = 'user-1',
  attemptId = 'idem-finalize-test',
  sessionId = 'story-finalize-test',
  state = 'queued',
  jobState = null,
  shortId = null,
  status = state === 'done' ? 200 : 202,
  createdAt = '2026-03-19T00:00:00.000Z',
  updatedAt = '2026-03-19T00:00:05.000Z',
  enqueuedAt = createdAt,
  startedAt = null,
  finishedAt = null,
  renderRecovery = null,
  result = null,
} = {}) {
  const resolvedJobState =
    jobState ||
    (state === 'done'
      ? 'settled'
      : state === 'failed' || state === 'expired'
        ? 'failed_terminal'
        : state === 'running'
          ? 'started'
          : 'queued');
  const resolvedRenderRecovery = renderRecovery || {
    state:
      state === 'done' ? 'done' : state === 'failed' || state === 'expired' ? 'failed' : 'pending',
    attemptId,
    shortId: state === 'done' ? shortId : null,
    startedAt: startedAt || createdAt,
    updatedAt,
    finishedAt: state === 'done' ? finishedAt || updatedAt : null,
    failedAt: state === 'failed' || state === 'expired' ? finishedAt || updatedAt : null,
    code: state === 'failed' || state === 'expired' ? 'STORY_FINALIZE_FAILED' : null,
    message: state === 'failed' || state === 'expired' ? 'Failed to finalize story' : null,
  };
  return {
    flow: 'story.finalize',
    uid,
    attemptId,
    jobId: attemptId,
    externalAttemptId: attemptId,
    sessionId,
    state,
    jobState: resolvedJobState,
    isActive: state === 'queued' || state === 'running',
    status,
    shortId,
    createdAt: timestamp(createdAt),
    updatedAt: timestamp(updatedAt),
    enqueuedAt: timestamp(enqueuedAt),
    startedAt: startedAt ? timestamp(startedAt) : null,
    finishedAt: finishedAt ? timestamp(finishedAt) : null,
    expiresAt: timestamp('2026-03-19T01:00:00.000Z'),
    availableAfter:
      resolvedJobState === 'retry_scheduled' ? timestamp('2026-03-19T00:01:00.000Z') : null,
    usageReservation: {
      estimatedSec: 8,
      reservedSec: state === 'queued' || state === 'running' ? 8 : 0,
    },
    billingSettlement:
      state === 'done'
        ? {
            estimatedSec: 8,
            billedSec: 8,
            settledAt: timestamp(finishedAt || updatedAt),
            source: 'finalVideo.durationSec',
          }
        : null,
    failure:
      state === 'failed' || state === 'expired'
        ? {
            error: resolvedRenderRecovery.code,
            detail: resolvedRenderRecovery.message,
          }
        : null,
    result: result || {
      shortId: state === 'done' ? shortId : null,
      status,
      failure: null,
    },
    projection: {
      renderRecovery: resolvedRenderRecovery,
    },
  };
}

function buildFinalizeSessionLock({
  uid = 'user-1',
  sessionId = 'story-finalize-test',
  attemptId = 'idem-finalize-test',
  state = 'queued',
  createdAt = '2026-03-19T00:00:00.000Z',
  updatedAt = '2026-03-19T00:00:05.000Z',
} = {}) {
  return {
    flow: 'story.finalize',
    uid,
    sessionId,
    attemptId,
    state,
    createdAt: timestamp(createdAt),
    updatedAt: timestamp(updatedAt),
    expiresAt: timestamp('2026-03-19T01:00:00.000Z'),
  };
}

function withEnv(patch) {
  const previous = new Map();
  for (const [key, value] of Object.entries(patch)) {
    previous.set(key, process.env[key]);
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
  return () => {
    for (const [key, value] of previous.entries()) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

const unauthorizedRoutes = [
  ['POST', '/api/users/ensure', {}],
  ['GET', '/api/usage', undefined],
  ['POST', '/api/story/start', { input: 'Need a story' }],
  ['POST', '/api/story/generate', { sessionId: 'story-unauth' }],
  ['GET', '/api/story/story-unauth', undefined],
  ['POST', '/api/story/plan', { sessionId: 'story-unauth' }],
  ['POST', '/api/story/search', { sessionId: 'story-unauth' }],
  [
    'POST',
    '/api/story/update-beat-text',
    { sessionId: 'story-unauth', sentenceIndex: 0, text: 'x' },
  ],
  ['POST', '/api/story/delete-beat', { sessionId: 'story-unauth', sentenceIndex: 0 }],
  ['POST', '/api/story/search-shot', { sessionId: 'story-unauth', sentenceIndex: 0 }],
  [
    'POST',
    '/api/story/update-shot',
    { sessionId: 'story-unauth', sentenceIndex: 0, clipId: 'clip-1' },
  ],
  [
    'POST',
    '/api/story/update-caption-style',
    { sessionId: 'story-unauth', overlayCaption: { fontPx: 48 } },
  ],
  [
    'POST',
    '/api/caption/preview',
    { ssotVersion: 3, mode: 'raster', measure: 'server', text: 'Hello', placement: 'bottom' },
  ],
  ['POST', '/api/story/preview', { sessionId: 'story-unauth' }],
  ['POST', '/api/story/finalize', { sessionId: 'story-unauth' }],
  ['GET', '/api/shorts/mine', undefined],
  ['GET', '/api/shorts/short-unauth', undefined],
];

test.before(async () => {
  await startHarness();
});

test.after(async () => {
  await stopHarness();
});

test.beforeEach(() => {
  resetHarnessState();
});

test('all active mobile-used Phase 4A routes reject missing auth with AUTH_REQUIRED', async () => {
  for (const [method, path, body] of unauthorizedRoutes) {
    const result = await requestJson(path, { method, body, auth: false });
    assert.equal(result.status, 401, `${method} ${path} should reject missing auth`);
    assert.equal(result.json.success, false);
    assert.equal(result.json.error, 'AUTH_REQUIRED');
  }
});

test('POST /api/users/ensure returns the mobile bootstrap profile envelope', async () => {
  const result = await requestJson('/api/users/ensure', { method: 'POST', body: {} });
  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
  assert.equal(result.json.data.uid, 'user-1');
  assert.equal(result.json.data.email, 'user1@example.com');
  assert.equal(result.json.data.plan, 'free');
  assert.equal(result.json.data.freeShortsUsed, 0);
});

test('GET /api/usage returns canonical plan and availableSec used by bootstrap/settings refresh', async () => {
  seedUserDoc('user-1', {
    plan: 'creator',
    membership: {
      status: 'active',
      kind: 'subscription',
      billingCadence: 'monthly',
    },
    usage: {
      periodStartAt: timestamp('2026-03-01T00:00:00.000Z'),
      periodEndAt: timestamp('2026-04-01T00:00:00.000Z'),
      cycleIncludedSec: 600,
      cycleUsedSec: 120,
      cycleReservedSec: 30,
    },
  });

  const result = await requestJson('/api/usage');
  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
  assert.equal(result.json.data.plan, 'creator');
  assert.equal(result.json.data.membership.status, 'active');
  assert.equal(result.json.data.usage.availableSec, 450);
  assert.equal(result.json.data.usage.billingUnit, 'sec');
});

test('GET /api/shorts/mine returns the current library list shape for the authenticated owner only', async () => {
  seedShortDoc('short-new', {
    ownerId: 'user-1',
    status: 'ready',
    videoUrl: 'https://cdn.example.com/new.mp4',
    coverImageUrl: 'https://cdn.example.com/new.jpg',
    createdAt: timestamp('2026-03-19T10:00:00.000Z'),
  });
  seedShortDoc('short-old', {
    ownerId: 'user-1',
    status: 'ready',
    videoUrl: 'https://cdn.example.com/old.mp4',
    coverImageUrl: 'https://cdn.example.com/old.jpg',
    createdAt: timestamp('2026-03-18T10:00:00.000Z'),
  });
  seedShortDoc('short-other-user', {
    ownerId: 'user-2',
    status: 'ready',
    videoUrl: 'https://cdn.example.com/other.mp4',
    coverImageUrl: 'https://cdn.example.com/other.jpg',
    createdAt: timestamp('2026-03-20T10:00:00.000Z'),
  });

  const result = await requestJson('/api/shorts/mine?limit=2');
  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
  assert.equal(result.json.data.items.length, 2);
  assert.equal(result.json.data.items[0].id, 'short-new');
  assert.equal(result.json.data.items[1].id, 'short-old');
  assert.equal(result.json.data.hasMore, true);
  assert.ok(result.json.data.nextCursor);
});

test('GET /api/shorts/:jobId returns the ready detail payload mobile uses when metadata URLs exist', async () => {
  seedShortMeta('user-1', 'short-ready', {
    urls: {
      video: 'https://cdn.example.com/ready.mp4',
      cover: 'https://cdn.example.com/ready.jpg',
    },
    durationSec: 14,
    createdAt: '2026-03-19T10:00:00.000Z',
  });

  const result = await requestJson('/api/shorts/short-ready');
  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
  assert.equal(result.json.data.id, 'short-ready');
  assert.equal(result.json.data.jobId, 'short-ready');
  assert.equal(result.json.data.videoUrl, 'https://cdn.example.com/ready.mp4');
  assert.equal(result.json.data.coverImageUrl, 'https://cdn.example.com/ready.jpg');
  assert.equal(result.json.data.durationSec, 14);
});

test('GET /api/shorts/:jobId preserves the current 404 pending bridge when no video object exists yet', async () => {
  const result = await requestJson('/api/shorts/short-pending');
  assert.equal(result.status, 404);
  assert.equal(result.json.success, false);
  assert.equal(result.json.error, 'NOT_FOUND');
});

test('POST /api/story/render is disabled by default and directs callers to finalize', async () => {
  const result = await requestJson('/api/story/render', {
    method: 'POST',
    body: {
      sessionId: 'story-render-disabled-default',
    },
  });

  assert.equal(result.status, 405);
  assert.equal(result.json.success, false);
  assert.equal(result.json.error, 'RENDER_DISABLED');
  assert.equal(result.json.detail, 'Use POST /api/story/finalize');
});

test('POST /api/story/render clears the default disable gate when ENABLE_STORY_RENDER_ROUTE=1', async () => {
  const restoreEnv = withEnv({ ENABLE_STORY_RENDER_ROUTE: '1' });
  try {
    const result = await requestJson('/api/story/render', {
      method: 'POST',
      body: {},
    });

    assert.equal(result.status, 400);
    assert.equal(result.json.success, false);
    assert.equal(result.json.error, 'INVALID_INPUT');
  } finally {
    restoreEnv();
  }
});

test('POST /api/story/start creates a draft story session for the authenticated user', async () => {
  const result = await requestJson('/api/story/start', {
    method: 'POST',
    body: {
      input: 'Why simple habits outperform motivation',
      inputType: 'paragraph',
      styleKey: 'cozy',
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
  assert.match(result.json.data.id, /^story-/);
  assert.equal(result.json.data.status, 'draft');
  assert.equal(result.json.data.input.text, 'Why simple habits outperform motivation');
  assert.equal(result.json.data.styleKey, 'cozy');
});

test('POST /api/story/generate preserves the generated story envelope mobile reads', async () => {
  seedUserDoc('user-1');
  let capturedStyleKey = null;
  setRuntimeOverride('story.llm.generateStoryFromInput', async ({ styleKey }) => {
    capturedStyleKey = styleKey;
    return {
      sentences: [
        'You think motivation starts the work.',
        'Tiny habits start before you feel ready.',
        'Pick one cue you never miss.',
        'Shrink the action until it feels automatic.',
        'Repeat it where friction is already low.',
        'Stack wins before you chase intensity.',
        'Momentum grows because the start gets cheap.',
        'What habit becomes easy enough to keep tomorrow?',
      ],
      totalDurationSec: 32,
    };
  });

  const started = await requestJson('/api/story/start', {
    method: 'POST',
    body: { input: 'Build habit momentum', inputType: 'idea' },
  });

  assert.equal(started.status, 200);
  assert.equal(started.json.success, true);
  assert.equal(started.json.data.styleKey, 'default');

  const result = await requestJson('/api/story/generate', {
    method: 'POST',
    body: { sessionId: started.json.data.id },
  });

  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
  assert.equal(result.json.data.status, 'story_generated');
  assert.equal(result.json.data.styleKey, 'default');
  assert.equal(result.json.data.story.sentences.length, 8);
  assert.equal(result.json.data.billingEstimate.estimatedSec, null);
  assert.equal(result.json.data.billingEstimate.heuristicEstimatedSec, 26);
  assert.equal(capturedStyleKey, 'default');
});

test('POST /api/story/generate returns retryable 503 when generation hits a transient busy state', async () => {
  seedUserDoc('user-1');
  setRuntimeOverride('story.llm.generateStoryFromInput', async () => {
    const error = new Error('Story generation is busy. Please retry shortly.');
    error.code = 'STORY_GENERATE_BUSY';
    error.status = 503;
    error.retryAfter = 15;
    throw error;
  });

  const started = await requestJson('/api/story/start', {
    method: 'POST',
    body: {
      input: 'Busy story input',
      inputType: 'idea',
    },
  });

  const result = await requestJson('/api/story/generate', {
    method: 'POST',
    body: { sessionId: started.json.data.id },
  });

  assert.equal(result.status, 503);
  assert.equal(result.response.headers.get('retry-after'), '15');
  assert.equal(result.json.success, false);
  assert.equal(result.json.error, 'SERVER_BUSY');
});

test('POST /api/story/generate sanitizes unexpected 500 detail while preserving requestId', async () => {
  seedUserDoc('user-1');
  setRuntimeOverride('story.llm.generateStoryFromInput', async () => {
    throw new Error('OpenAI upstream 500 with internal provider detail');
  });

  const started = await requestJson('/api/story/start', {
    method: 'POST',
    body: {
      input: 'Sanitized story input',
      inputType: 'idea',
    },
  });

  const result = await requestJson('/api/story/generate', {
    method: 'POST',
    body: { sessionId: started.json.data.id },
  });

  assert.equal(result.status, 500);
  assert.equal(result.json.success, false);
  assert.equal(result.json.error, 'STORY_GENERATE_FAILED');
  assert.equal(result.json.detail, 'Failed to generate story');
  assert.equal(typeof result.json.requestId, 'string');
  assert.equal(
    result.json.detail.includes('OpenAI upstream 500 with internal provider detail'),
    false
  );
});

test('POST /api/story/plan returns the active shot plan shape for generated sessions', async () => {
  seedUserDoc('user-1');
  setRuntimeOverride('story.llm.planVisualShots', async ({ sentences }) =>
    sentences.map((sentence, sentenceIndex) => ({
      sentenceIndex,
      visualDescription: `visual-${sentenceIndex}`,
      searchQuery: `query-${sentenceIndex}`,
      durationSec: 4 + sentenceIndex,
      startTimeSec: sentenceIndex * 5,
    }))
  );

  seedStorySession(
    'user-1',
    buildBaseSession({
      id: 'story-plan',
      status: 'story_generated',
      story: {
        sentences: ['Line one', 'Line two'],
      },
    })
  );

  const result = await requestJson('/api/story/plan', {
    method: 'POST',
    body: { sessionId: 'story-plan' },
  });

  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
  assert.equal(result.json.data.status, 'shots_planned');
  assert.equal(result.json.data.plan.length, 2);
  assert.equal(result.json.data.plan[0].searchQuery, 'query-0');
});

test('POST /api/story/plan returns retryable 503 when planning hits a transient timeout', async () => {
  seedUserDoc('user-1');
  setRuntimeOverride('story.llm.planVisualShots', async () => {
    const error = new Error('Story planning timed out. Please retry shortly.');
    error.code = 'STORY_PLAN_TIMEOUT';
    error.status = 503;
    error.retryAfter = 15;
    throw error;
  });

  seedStorySession(
    'user-1',
    buildBaseSession({
      id: 'story-plan-timeout',
      status: 'story_generated',
      story: {
        sentences: ['Line one', 'Line two'],
      },
    })
  );

  const result = await requestJson('/api/story/plan', {
    method: 'POST',
    body: { sessionId: 'story-plan-timeout' },
  });

  assert.equal(result.status, 503);
  assert.equal(result.response.headers.get('retry-after'), '15');
  assert.equal(result.json.success, false);
  assert.equal(result.json.error, 'SERVER_BUSY');
});

test('POST /api/story/search returns planned shots with selectedClip and candidates for all beats', async () => {
  setRuntimeOverride('story.providers.pexelsSearchVideos', async ({ query, page }) => ({
    ok: true,
    reason: 'OK',
    nextPage: page + 1,
    items: [
      {
        id: `${query}-clip-1`,
        provider: 'pexels',
        fileUrl: `https://cdn.example.com/${query}-1.mp4`,
        thumbUrl: `https://cdn.example.com/${query}-1.jpg`,
        duration: 5,
        width: 720,
        height: 1280,
        photographer: 'Pexels Author',
        sourceUrl: `https://pexels.example.com/${query}-1`,
      },
      {
        id: `${query}-clip-2`,
        provider: 'pexels',
        fileUrl: `https://cdn.example.com/${query}-2.mp4`,
        thumbUrl: `https://cdn.example.com/${query}-2.jpg`,
        duration: 7,
        width: 720,
        height: 1280,
        photographer: 'Pexels Author',
        sourceUrl: `https://pexels.example.com/${query}-2`,
      },
    ],
  }));
  setRuntimeOverride('story.providers.pixabaySearchVideos', async () => ({
    ok: false,
    reason: 'HTTP_503',
    items: [],
    nextPage: null,
    transient: true,
  }));
  setRuntimeOverride('story.providers.nasaSearchVideos', async () => ({
    ok: false,
    reason: 'HTTP_503',
    items: [],
    nextPage: null,
    transient: true,
  }));

  seedStorySession(
    'user-1',
    buildBaseSession({
      id: 'story-search-all',
      status: 'shots_planned',
      story: {
        sentences: ['Ocean routine', 'Desk reset'],
      },
      plan: [
        {
          sentenceIndex: 0,
          visualDescription: 'space visual',
          searchQuery: 'space habit',
          durationSec: 5,
          startTimeSec: 0,
        },
        {
          sentenceIndex: 1,
          visualDescription: 'desk visual',
          searchQuery: 'desk reset',
          durationSec: 4,
          startTimeSec: 5,
        },
      ],
    })
  );

  const result = await requestJson('/api/story/search', {
    method: 'POST',
    body: { sessionId: 'story-search-all' },
  });

  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
  assert.equal(result.json.data.status, 'clips_searched');
  assert.equal(result.json.data.previewReadinessV1.version, 1);
  assert.equal(result.json.data.previewReadinessV1.ready, false);
  assert.equal(result.json.data.previewReadinessV1.reasonCode, 'VOICE_SYNC_NOT_CURRENT');
  assert.equal(result.json.data.shots.length, 2);
  assert.equal(result.json.data.shots[0].candidates.length, 2);
  assert.equal(result.json.data.shots[0].selectedClip.id, 'space habit-clip-1');
});

test('POST /api/story/search returns retryable 503 only when all consulted providers fail transiently and no usable clips exist', async () => {
  setRuntimeOverride('story.providers.pexelsSearchVideos', async () => ({
    ok: false,
    reason: 'HTTP_503',
    items: [],
    nextPage: null,
  }));
  setRuntimeOverride('story.providers.pixabaySearchVideos', async () => ({
    ok: false,
    reason: 'TIMEOUT',
    items: [],
    nextPage: null,
    transient: true,
  }));
  setRuntimeOverride('story.providers.nasaSearchVideos', async () => ({
    ok: false,
    reason: 'HTTP_503',
    items: [],
    nextPage: null,
    transient: true,
  }));

  seedStorySession(
    'user-1',
    buildBaseSession({
      id: 'story-search-transient-fail',
      status: 'shots_planned',
      story: {
        sentences: ['Space routine'],
      },
      plan: [
        {
          sentenceIndex: 0,
          visualDescription: 'space visual',
          searchQuery: 'space routine',
          durationSec: 5,
          startTimeSec: 0,
        },
      ],
    })
  );

  const result = await requestJson('/api/story/search', {
    method: 'POST',
    body: { sessionId: 'story-search-transient-fail' },
  });

  assert.equal(result.status, 503);
  assert.equal(result.response.headers.get('retry-after'), '15');
  assert.equal(result.json.success, false);
  assert.equal(result.json.error, 'SERVER_BUSY');
});

test('GET /api/story/:sessionId preserves recovery polling fields mobile reads after finalize', async () => {
  seedStorySession(
    'user-1',
    buildBaseSession({
      id: 'story-recovery',
      status: 'rendering',
      story: {
        sentences: ['A', 'B'],
      },
      renderRecovery: {
        state: 'pending',
        attemptId: 'idem-recovery-1',
        shortId: null,
        startedAt: '2026-03-19T01:00:00.000Z',
        updatedAt: '2026-03-19T01:00:10.000Z',
      },
    })
  );

  const result = await requestJson('/api/story/story-recovery');
  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
  assert.equal(result.json.data.renderRecovery.state, 'pending');
  assert.equal(result.json.data.renderRecovery.attemptId, 'idem-recovery-1');
});

test('GET /api/story/:sessionId returns additive playbackTimelineV1 for synced sessions without persisting auto cuts', async () => {
  const restoreEnv = withEnv({ ENABLE_VIDEO_CUTS_V1: '1' });

  try {
    seedStorySession(
      'user-1',
      buildSyncedSession({
        id: 'story-playback-auto',
        story: {
          sentences: ['Beat one', 'Beat two', 'Beat three'],
        },
        shots: [
          buildShot('clip-playback-1', 0, 'Beat one', 4),
          buildShot('clip-playback-2', 1, 'Beat two', 5),
          buildShot('clip-playback-3', 2, 'Beat three', 6),
        ],
        videoCutsV1: undefined,
        videoCutsV1Disabled: false,
      })
    );

    const result = await requestJson('/api/story/story-playback-auto');

    assert.equal(result.status, 200);
    assert.equal(result.json.success, true);
    assert.equal(result.json.data.previewReadinessV1.version, 1);
    assert.equal(result.json.data.previewReadinessV1.ready, true);
    assert.equal(result.json.data.previewReadinessV1.reasonCode, null);
    assert.deepEqual(result.json.data.previewReadinessV1.missingBeatIndices, []);
    assert.equal(result.json.data.playbackTimelineV1.version, 1);
    assert.equal(result.json.data.playbackTimelineV1.source, 'auto');
    assert.equal(result.json.data.playbackTimelineV1.totalDurationSec, 15);
    assert.equal(result.json.data.playbackTimelineV1.segments.length, 3);
    assert.deepEqual(
      result.json.data.playbackTimelineV1.segments.map((segment) => segment.segmentIndex),
      [0, 1, 2]
    );
    assert.equal(readStorySession('user-1', 'story-playback-auto').videoCutsV1, undefined);
  } finally {
    restoreEnv();
  }
});

test('GET /api/story/:sessionId reflects manual videoCutsV1 in playbackTimelineV1 and keeps adjacent same-url segments distinct', async () => {
  const restoreEnv = withEnv({ ENABLE_VIDEO_CUTS_V1: '1' });

  try {
    seedStorySession(
      'user-1',
      buildSyncedSession({
        id: 'story-playback-manual',
        story: {
          sentences: ['Beat one', 'Beat two'],
        },
        shots: [
          buildShot('clip-shared', 0, 'Beat one', 4),
          buildShot('clip-shared', 1, 'Beat two', 4),
        ],
        videoCutsV1Disabled: false,
        videoCutsV1: {
          version: 1,
          source: 'manual',
          boundaries: [
            {
              leftBeat: 0,
              pos: { beatIndex: 1, pct: 0.5 },
            },
          ],
        },
      })
    );

    const result = await requestJson('/api/story/story-playback-manual');
    const timeline = result.json.data.playbackTimelineV1;

    assert.equal(result.status, 200);
    assert.equal(result.json.success, true);
    assert.equal(result.json.data.previewReadinessV1.version, 1);
    assert.equal(result.json.data.previewReadinessV1.ready, true);
    assert.equal(result.json.data.previewReadinessV1.reasonCode, null);
    assert.equal(timeline.version, 1);
    assert.equal(timeline.source, 'manual');
    assert.equal(timeline.segments.length, 2);
    assert.equal(timeline.segments[0].clipUrl, timeline.segments[1].clipUrl);
    assert.equal(timeline.segments[0].segmentIndex, 0);
    assert.equal(timeline.segments[1].segmentIndex, 1);
    assert.equal(timeline.segments[0].globalEndSec, 6);
    assert.equal(timeline.segments[1].globalStartSec, 6);
    assert.equal(timeline.segments[1].clipStartSec, 2);
    assert.equal(timeline.segments[0].ownerSentenceIndex, 0);
    assert.equal(timeline.segments[1].ownerSentenceIndex, 1);
  } finally {
    restoreEnv();
  }
});

test('GET /api/story/:sessionId omits playbackTimelineV1 when synced clip coverage is incomplete', async () => {
  const restoreEnv = withEnv({ ENABLE_VIDEO_CUTS_V1: '1' });

  try {
    seedStorySession(
      'user-1',
      buildSyncedSession({
        id: 'story-playback-incomplete',
        story: {
          sentences: ['Beat one', 'Beat two'],
        },
        shots: [
          buildShot('clip-incomplete-1', 0, 'Beat one', 4),
          {
            sentenceIndex: 1,
            visualDescription: 'Beat two visual',
            searchQuery: 'Beat two',
            durationSec: 4,
            startTimeSec: 4,
            selectedClip: null,
            candidates: [],
          },
        ],
      })
    );

    const result = await requestJson('/api/story/story-playback-incomplete');

    assert.equal(result.status, 200);
    assert.equal(result.json.success, true);
    assert.equal(result.json.data.previewReadinessV1.version, 1);
    assert.equal(result.json.data.previewReadinessV1.ready, false);
    assert.equal(result.json.data.previewReadinessV1.reasonCode, 'MISSING_CLIP_COVERAGE');
    assert.deepEqual(result.json.data.previewReadinessV1.missingBeatIndices, [1]);
    assert.equal(
      Object.prototype.hasOwnProperty.call(result.json.data, 'playbackTimelineV1'),
      false
    );
  } finally {
    restoreEnv();
  }
});

test('GET /api/story/:sessionId returns mobile-safe draftPreviewV1 and captionOverlayV1 projections', async () => {
  seedStorySession(
    'user-1',
    buildSyncedSession({
      id: 'story-preview-safe-projection',
      draftPreviewV1: {
        version: 1,
        state: 'stale',
        fingerprint: 'internal-fingerprint',
        previewId: 'internal-preview-id',
        artifact: {
          url: 'https://cdn.example.com/stale-base.mp4',
          storagePath: 'artifacts/user-1/story-preview-safe-projection/previews/old/base.mp4',
          contentType: 'video/mp4',
          durationSec: 4,
          width: 1080,
          height: 1920,
        },
      },
      overlayCaption: {
        placement: 'center',
        fontPx: 80,
        color: '#ffffff',
      },
    })
  );

  const result = await requestJson('/api/story/story-preview-safe-projection');

  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
  assert.equal(result.json.data.draftPreviewV1.state, 'stale');
  assert.equal(
    Object.prototype.hasOwnProperty.call(result.json.data.draftPreviewV1, 'artifact'),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(result.json.data.draftPreviewV1, 'fingerprint'),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(result.json.data.draftPreviewV1, 'previewId'),
    false
  );
  assert.equal(result.json.data.captionOverlayV1.version, 1);
  assert.deepEqual(result.json.data.captionOverlayV1.frame, { width: 1080, height: 1920 });
  assert.equal(
    Object.prototype.hasOwnProperty.call(result.json.data.captionOverlayV1.segments[0], 'tokens'),
    false
  );
});

test('GET /api/story/:sessionId returns mobile-safe ready captioned draftPreviewV1 artifact', async () => {
  seedStorySession(
    'user-1',
    buildSyncedSession({
      id: 'story-preview-captioned-ready',
      draftPreviewV1: {
        version: 1,
        state: 'ready',
        updatedAt: '2026-03-19T00:00:00.000Z',
        rendererVersion: 'captioned-preview-v1.2',
        fingerprint: 'internal-fingerprint',
        previewId: 'internal-preview-id',
        artifact: {
          url: 'https://cdn.example.com/captioned.mp4',
          storagePath: 'artifacts/user-1/story-preview-captioned-ready/previews/id/captioned.mp4',
          contentType: 'video/mp4',
          durationSec: 4,
          width: 1080,
          height: 1920,
          createdAt: '2026-03-19T00:00:00.000Z',
          expiresAt: '2026-03-20T00:00:00.000Z',
        },
      },
    })
  );

  const result = await requestJson('/api/story/story-preview-captioned-ready');

  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
  assert.equal(result.json.data.draftPreviewV1.state, 'ready');
  assert.deepEqual(result.json.data.draftPreviewV1.artifact, {
    url: 'https://cdn.example.com/captioned.mp4',
    contentType: 'video/mp4',
    durationSec: 4,
    width: 1080,
    height: 1920,
    createdAt: '2026-03-19T00:00:00.000Z',
    expiresAt: '2026-03-20T00:00:00.000Z',
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(result.json.data.draftPreviewV1, 'fingerprint'),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(result.json.data.draftPreviewV1, 'previewId'),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(result.json.data.draftPreviewV1.artifact, 'storagePath'),
    false
  );
});

test('POST /api/story/preview requires idempotency and returns blocked state without exposing unsafe fields', async () => {
  const missingKey = await requestJson('/api/story/preview', {
    method: 'POST',
    body: { sessionId: 'story-preview-missing-key' },
  });

  assert.equal(missingKey.status, 400);
  assert.equal(missingKey.json.success, false);
  assert.equal(missingKey.json.error, 'MISSING_IDEMPOTENCY_KEY');

  seedStorySession(
    'user-1',
    buildSyncedSession({
      id: 'story-preview-blocked',
      beats: [
        {
          narration: {
            fingerprint: 'beat-sync-story-preview-blocked-0',
            durationSec: 4,
            syncedAt: '2026-03-19T00:00:00.000Z',
          },
        },
      ],
    })
  );

  const result = await requestJson('/api/story/preview', {
    method: 'POST',
    headers: {
      'X-Idempotency-Key': 'idem-story-preview-blocked',
      'x-client': 'mobile',
    },
    body: { sessionId: 'story-preview-blocked' },
  });

  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
  assert.equal(result.json.data.draftPreviewV1.state, 'blocked');
  assert.equal(result.json.data.draftPreviewV1.blocked.reasonCode, 'VOICE_SYNC_ARTIFACT_MISSING');
  assert.deepEqual(result.json.data.draftPreviewV1.blocked.missingBeatIndices, [0]);
  assert.equal(
    Object.prototype.hasOwnProperty.call(result.json.data.draftPreviewV1, 'artifact'),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(result.json.data.draftPreviewV1, 'fingerprint'),
    false
  );
  assert.equal(result.json.data.captionOverlayV1.version, 1);

  const stored = readStorySession('user-1', 'story-preview-blocked');
  assert.equal(stored.draftPreviewV1.state, 'blocked');
});

test('POST /api/story/preview queues ready captioned preview work without rendering in the handler', async () => {
  seedStorySession(
    'user-1',
    buildSyncedSession({
      id: 'story-preview-queued',
    })
  );

  try {
    const result = await requestJson('/api/story/preview', {
      method: 'POST',
      headers: {
        'X-Idempotency-Key': 'idem-story-preview-queued',
        'x-client': 'mobile',
      },
      body: { sessionId: 'story-preview-queued' },
    });

    assert.equal(result.status, 202);
    assert.equal(result.json.success, true);
    assert.equal(result.json.preview.state, 'pending');
    assert.equal(result.json.preview.attemptId, 'idem-story-preview-queued');
    assert.equal(result.json.data.draftPreviewV1.state, 'queued');
    assert.equal(
      Object.prototype.hasOwnProperty.call(result.json.data.draftPreviewV1, 'artifact'),
      false
    );
    assert.ok(
      ['queued', 'running'].includes(
        readDoc('storyPreviewAttempts', 'user-1:idem-story-preview-queued').state
      )
    );
  } finally {
    const { stopStoryPreviewRunner } = await import('../../src/services/story-preview.runner.js');
    stopStoryPreviewRunner();
  }
});

test('GET /api/story/:sessionId returns canonical pending when session recovery is missing but an active lock + attempt exist', async () => {
  seedStorySession(
    'user-1',
    buildBaseSession({
      id: 'story-recovery-canonical-pending',
      status: 'rendering',
      story: {
        sentences: ['A', 'B'],
      },
    })
  );
  seedFirestoreDoc(
    'idempotency',
    'user-1:idem-recovery-canonical-pending',
    buildFinalizeAttemptDoc({
      attemptId: 'idem-recovery-canonical-pending',
      sessionId: 'story-recovery-canonical-pending',
      state: 'running',
      jobState: 'started',
      createdAt: '2026-03-19T01:00:00.000Z',
      updatedAt: '2026-03-19T01:00:10.000Z',
      startedAt: '2026-03-19T01:00:05.000Z',
      renderRecovery: {
        state: 'pending',
        attemptId: 'idem-recovery-canonical-pending',
        shortId: null,
        startedAt: '2026-03-19T01:00:05.000Z',
        updatedAt: '2026-03-19T01:00:10.000Z',
        finishedAt: null,
        failedAt: null,
        code: null,
        message: null,
      },
    })
  );
  seedFirestoreDoc(
    'storyFinalizeSessions',
    'user-1:story-recovery-canonical-pending',
    buildFinalizeSessionLock({
      sessionId: 'story-recovery-canonical-pending',
      attemptId: 'idem-recovery-canonical-pending',
      state: 'running',
      createdAt: '2026-03-19T01:00:00.000Z',
      updatedAt: '2026-03-19T01:00:10.000Z',
    })
  );

  const result = await requestJson('/api/story/story-recovery-canonical-pending');
  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
  assert.equal(result.json.data.renderRecovery.state, 'pending');
  assert.equal(result.json.data.renderRecovery.attemptId, 'idem-recovery-canonical-pending');
  assert.equal(result.json.data.renderRecovery.shortId, null);
});

test('GET /api/story/:sessionId returns canonical done + shortId when the settled attempt is newer than the session projection', async () => {
  seedStorySession(
    'user-1',
    buildBaseSession({
      id: 'story-recovery-canonical-done',
      status: 'rendered',
      story: {
        sentences: ['A', 'B'],
      },
      finalVideo: {
        jobId: 'short-canonical-done',
        durationSec: 8,
        videoUrl: 'https://cdn.example.com/short-canonical-done.mp4',
      },
      renderRecovery: {
        state: 'pending',
        attemptId: 'idem-recovery-canonical-done',
        shortId: null,
        startedAt: '2026-03-19T02:00:00.000Z',
        updatedAt: '2026-03-19T02:00:01.000Z',
      },
    })
  );
  seedFirestoreDoc(
    'idempotency',
    'user-1:idem-recovery-canonical-done',
    buildFinalizeAttemptDoc({
      attemptId: 'idem-recovery-canonical-done',
      sessionId: 'story-recovery-canonical-done',
      state: 'done',
      jobState: 'settled',
      shortId: 'short-canonical-done',
      status: 200,
      createdAt: '2026-03-19T02:00:00.000Z',
      updatedAt: '2026-03-19T02:00:10.000Z',
      startedAt: '2026-03-19T02:00:02.000Z',
      finishedAt: '2026-03-19T02:00:10.000Z',
      renderRecovery: {
        state: 'done',
        attemptId: 'idem-recovery-canonical-done',
        shortId: 'short-canonical-done',
        startedAt: '2026-03-19T02:00:02.000Z',
        updatedAt: '2026-03-19T02:00:10.000Z',
        finishedAt: '2026-03-19T02:00:10.000Z',
        failedAt: null,
        code: null,
        message: null,
      },
      result: {
        shortId: 'short-canonical-done',
        status: 200,
        failure: null,
      },
    })
  );
  seedShortDoc('short-canonical-done', {
    ownerId: 'user-1',
    status: 'ready',
    videoUrl: 'https://cdn.example.com/short-canonical-done.mp4',
    finalizeAttemptId: 'idem-recovery-canonical-done',
  });

  const result = await requestJson('/api/story/story-recovery-canonical-done');
  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
  assert.equal(result.json.data.renderRecovery.state, 'done');
  assert.equal(result.json.data.renderRecovery.attemptId, 'idem-recovery-canonical-done');
  assert.equal(result.json.data.renderRecovery.shortId, 'short-canonical-done');
  assert.equal(
    readDoc('idempotency', 'user-1:idem-recovery-canonical-done').result.shortId,
    'short-canonical-done'
  );
  assert.equal(
    readDoc('shorts', 'short-canonical-done').finalizeAttemptId,
    'idem-recovery-canonical-done'
  );
});

test('GET /api/story/:sessionId does not leak a stale shortId from session recovery when canonical attempt lineage is retry_scheduled', async () => {
  seedStorySession(
    'user-1',
    buildBaseSession({
      id: 'story-recovery-retry-scheduled',
      status: 'rendering',
      story: {
        sentences: ['A'],
      },
      finalVideo: {
        jobId: 'short-stale-session',
        durationSec: 8,
        videoUrl: 'https://cdn.example.com/short-stale-session.mp4',
      },
      renderRecovery: {
        state: 'done',
        attemptId: 'idem-recovery-retry-scheduled',
        shortId: 'short-stale-session',
        startedAt: '2026-03-19T03:00:00.000Z',
        updatedAt: '2026-03-19T03:00:05.000Z',
        finishedAt: '2026-03-19T03:00:05.000Z',
      },
    })
  );
  seedFirestoreDoc(
    'idempotency',
    'user-1:idem-recovery-retry-scheduled',
    buildFinalizeAttemptDoc({
      attemptId: 'idem-recovery-retry-scheduled',
      sessionId: 'story-recovery-retry-scheduled',
      state: 'queued',
      jobState: 'retry_scheduled',
      createdAt: '2026-03-19T03:00:00.000Z',
      updatedAt: '2026-03-19T03:00:10.000Z',
      renderRecovery: {
        state: 'pending',
        attemptId: 'idem-recovery-retry-scheduled',
        shortId: null,
        startedAt: '2026-03-19T03:00:00.000Z',
        updatedAt: '2026-03-19T03:00:10.000Z',
        finishedAt: null,
        failedAt: null,
        code: null,
        message: null,
      },
      result: {
        shortId: null,
        status: 202,
        failure: null,
      },
    })
  );

  const result = await requestJson('/api/story/story-recovery-retry-scheduled');
  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
  assert.equal(result.json.data.renderRecovery.state, 'pending');
  assert.equal(result.json.data.renderRecovery.attemptId, 'idem-recovery-retry-scheduled');
  assert.equal(result.json.data.renderRecovery.shortId, null);
});

test('same-key replay and GET /api/story/:sessionId return the same canonical recovery projection', async () => {
  seedUserDoc('user-1', {
    plan: 'creator',
    membership: {
      status: 'active',
      kind: 'subscription',
      billingCadence: 'monthly',
    },
    usage: {
      cycleIncludedSec: 600,
      cycleUsedSec: 10,
      cycleReservedSec: 0,
    },
  });
  seedStorySession(
    'user-1',
    buildBaseSession({
      id: 'story-replay-canonical-sync',
      status: 'rendered',
      story: {
        sentences: ['A'],
      },
      finalVideo: {
        jobId: 'short-replay-canonical-sync',
        durationSec: 8,
        videoUrl: 'https://cdn.example.com/short-replay-canonical-sync.mp4',
      },
      renderRecovery: {
        state: 'pending',
        attemptId: 'idem-replay-canonical-sync',
        shortId: null,
        startedAt: '2026-03-19T04:00:00.000Z',
        updatedAt: '2026-03-19T04:00:01.000Z',
      },
    })
  );
  seedFirestoreDoc(
    'idempotency',
    'user-1:idem-replay-canonical-sync',
    buildFinalizeAttemptDoc({
      attemptId: 'idem-replay-canonical-sync',
      sessionId: 'story-replay-canonical-sync',
      state: 'done',
      jobState: 'settled',
      shortId: 'short-replay-canonical-sync',
      status: 200,
      createdAt: '2026-03-19T04:00:00.000Z',
      updatedAt: '2026-03-19T04:00:10.000Z',
      startedAt: '2026-03-19T04:00:02.000Z',
      finishedAt: '2026-03-19T04:00:10.000Z',
      renderRecovery: {
        state: 'done',
        attemptId: 'idem-replay-canonical-sync',
        shortId: 'short-replay-canonical-sync',
        startedAt: '2026-03-19T04:00:02.000Z',
        updatedAt: '2026-03-19T04:00:10.000Z',
        finishedAt: '2026-03-19T04:00:10.000Z',
        failedAt: null,
        code: null,
        message: null,
      },
      result: {
        shortId: 'short-replay-canonical-sync',
        status: 200,
        failure: null,
      },
    })
  );
  seedShortDoc('short-replay-canonical-sync', {
    ownerId: 'user-1',
    status: 'ready',
    videoUrl: 'https://cdn.example.com/short-replay-canonical-sync.mp4',
    finalizeAttemptId: 'idem-replay-canonical-sync',
  });

  const replay = await requestJson('/api/story/finalize', {
    method: 'POST',
    headers: {
      'x-client': 'mobile',
      'X-Idempotency-Key': 'idem-replay-canonical-sync',
    },
    body: {
      sessionId: 'story-replay-canonical-sync',
    },
  });
  const storyGet = await requestJson('/api/story/story-replay-canonical-sync');

  assert.equal(replay.status, 200);
  assert.equal(replay.json.success, true);
  assert.equal(replay.json.shortId, 'short-replay-canonical-sync');
  assert.equal(storyGet.status, 200);
  assert.deepEqual(replay.json.data.renderRecovery, storyGet.json.data.renderRecovery);
  assert.equal(replay.json.data.renderRecovery.shortId, 'short-replay-canonical-sync');
});

test('POST /api/story/update-beat-text updates narration without mutating visual-intent fields', async () => {
  const preservedShot = buildShot('clip-1', 0, 'space ocean');
  seedStorySession(
    'user-1',
    buildBaseSession({
      id: 'story-update-beat',
      story: {
        sentences: ['Old narration', 'Second beat'],
      },
      shots: [preservedShot, buildShot('clip-2', 1, 'Second beat')],
    })
  );

  const result = await requestJson('/api/story/update-beat-text', {
    method: 'POST',
    body: {
      sessionId: 'story-update-beat',
      sentenceIndex: 0,
      text: 'Updated beat text',
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
  assert.equal(result.json.data.sentences[0], 'Updated beat text');
  assert.equal(result.json.data.shots[0].searchQuery, preservedShot.searchQuery);
  assert.equal(result.json.data.shots[0].visualDescription, preservedShot.visualDescription);
  assert.deepEqual(result.json.data.shots[0].selectedClip, preservedShot.selectedClip);
  assert.deepEqual(result.json.data.shots[0].candidates, preservedShot.candidates);
});

test('POST /api/story/delete-beat returns the reduced sentences and reindexed shots', async () => {
  seedStorySession(
    'user-1',
    buildBaseSession({
      id: 'story-delete-beat',
      story: {
        sentences: ['Beat one', 'Beat two', 'Beat three'],
      },
      shots: [
        buildShot('clip-1', 0, 'Beat one'),
        buildShot('clip-2', 1, 'Beat two'),
        buildShot('clip-3', 2, 'Beat three'),
      ],
    })
  );

  const result = await requestJson('/api/story/delete-beat', {
    method: 'POST',
    body: {
      sessionId: 'story-delete-beat',
      sentenceIndex: 1,
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
  assert.deepEqual(result.json.data.sentences, ['Beat one', 'Beat three']);
  assert.equal(result.json.data.shots.length, 2);
  assert.equal(result.json.data.shots[1].sentenceIndex, 1);
});

test('POST /api/story/search-shot returns the single-shot pagination payload mobile uses', async () => {
  setRuntimeOverride('story.providers.pexelsSearchVideos', async ({ query, page }) => ({
    ok: true,
    reason: 'OK',
    nextPage: page + 1,
    items: [
      {
        id: `${query}-shot-a`,
        provider: 'pexels',
        fileUrl: `https://cdn.example.com/${query}-shot-a.mp4`,
        thumbUrl: `https://cdn.example.com/${query}-shot-a.jpg`,
        duration: 5,
        width: 720,
        height: 1280,
        photographer: 'Pexels Author',
        sourceUrl: `https://pexels.example.com/${query}-shot-a`,
      },
      {
        id: `${query}-shot-b`,
        provider: 'pexels',
        fileUrl: `https://cdn.example.com/${query}-shot-b.mp4`,
        thumbUrl: `https://cdn.example.com/${query}-shot-b.jpg`,
        duration: 6,
        width: 720,
        height: 1280,
        photographer: 'Pexels Author',
        sourceUrl: `https://pexels.example.com/${query}-shot-b`,
      },
    ],
  }));
  setRuntimeOverride('story.providers.pixabaySearchVideos', async () => ({
    ok: false,
    reason: 'HTTP_503',
    items: [],
    nextPage: null,
    transient: true,
  }));
  setRuntimeOverride('story.providers.nasaSearchVideos', async () => ({
    ok: false,
    reason: 'HTTP_503',
    items: [],
    nextPage: null,
    transient: true,
  }));

  seedStorySession(
    'user-1',
    buildBaseSession({
      id: 'story-search-shot',
      story: {
        sentences: ['Ocean visual beat'],
      },
      shots: [buildShot('clip-1', 0, 'ocean visual beat')],
    })
  );

  const result = await requestJson('/api/story/search-shot', {
    method: 'POST',
    body: {
      sessionId: 'story-search-shot',
      sentenceIndex: 0,
      query: 'space ocean',
      page: 1,
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
  assert.equal(result.json.data.page, 1);
  assert.equal(result.json.data.hasMore, true);
  assert.equal(result.json.data.shot.candidates.length, 2);
  assert.equal(result.json.data.shot.selectedClip.id, 'space ocean-shot-a');
});

test('POST /api/story/search-shot still uses preserved shot.searchQuery after beat-save', async () => {
  setRuntimeOverride('story.providers.pexelsSearchVideos', async ({ query, page }) => ({
    ok: true,
    reason: 'OK',
    nextPage: page + 1,
    items: [
      {
        id: `${query}-shot-a`,
        provider: 'pexels',
        fileUrl: `https://cdn.example.com/${query}-shot-a.mp4`,
        thumbUrl: `https://cdn.example.com/${query}-shot-a.jpg`,
        duration: 5,
        width: 720,
        height: 1280,
        photographer: 'Pexels Author',
        sourceUrl: `https://pexels.example.com/${query}-shot-a`,
      },
    ],
  }));
  setRuntimeOverride('story.providers.pixabaySearchVideos', async () => ({
    ok: false,
    reason: 'HTTP_503',
    items: [],
    nextPage: null,
    transient: true,
  }));
  setRuntimeOverride('story.providers.nasaSearchVideos', async () => ({
    ok: false,
    reason: 'HTTP_503',
    items: [],
    nextPage: null,
    transient: true,
  }));

  seedStorySession(
    'user-1',
    buildBaseSession({
      id: 'story-search-shot-preserved-query',
      story: {
        sentences: ['Old narration'],
      },
      shots: [buildShot('clip-1', 0, 'space ocean')],
    })
  );

  const saveResult = await requestJson('/api/story/update-beat-text', {
    method: 'POST',
    body: {
      sessionId: 'story-search-shot-preserved-query',
      sentenceIndex: 0,
      text: 'Updated narration text',
    },
  });

  assert.equal(saveResult.status, 200);
  assert.equal(saveResult.json.data.sentences[0], 'Updated narration text');
  assert.equal(saveResult.json.data.shots[0].searchQuery, 'space ocean');

  const result = await requestJson('/api/story/search-shot', {
    method: 'POST',
    body: {
      sessionId: 'story-search-shot-preserved-query',
      sentenceIndex: 0,
      page: 1,
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
  assert.equal(result.json.data.shot.searchQuery, 'space ocean');
  assert.equal(result.json.data.shot.selectedClip.id, 'space ocean-shot-a');
  assert.equal(result.json.data.shot.candidates[0].id, 'space ocean-shot-a');
});

test('POST /api/story/search-shot returns retryable 503 only when all consulted providers fail transiently and no usable clips exist', async () => {
  setRuntimeOverride('story.providers.pexelsSearchVideos', async () => ({
    ok: false,
    reason: 'HTTP_503',
    items: [],
    nextPage: null,
  }));
  setRuntimeOverride('story.providers.pixabaySearchVideos', async () => ({
    ok: false,
    reason: 'TIMEOUT',
    items: [],
    nextPage: null,
    transient: true,
  }));
  setRuntimeOverride('story.providers.nasaSearchVideos', async () => ({
    ok: false,
    reason: 'HTTP_503',
    items: [],
    nextPage: null,
    transient: true,
  }));

  seedStorySession(
    'user-1',
    buildBaseSession({
      id: 'story-search-shot-transient-fail',
      story: {
        sentences: ['Space beat'],
      },
      shots: [buildShot('clip-1', 0, 'space beat')],
    })
  );

  const result = await requestJson('/api/story/search-shot', {
    method: 'POST',
    body: {
      sessionId: 'story-search-shot-transient-fail',
      sentenceIndex: 0,
      query: 'space beat',
      page: 1,
    },
  });

  assert.equal(result.status, 503);
  assert.equal(result.response.headers.get('retry-after'), '15');
  assert.equal(result.json.success, false);
  assert.equal(result.json.error, 'SERVER_BUSY');
});

test('POST /api/story/update-shot returns shots with the newly selected clip', async () => {
  const shots = [buildShot('clip-1', 0, 'Morning habit')];
  shots[0].candidates.push({
    id: 'clip-2',
    url: 'https://cdn.example.com/clip-2.mp4',
    thumbUrl: 'https://cdn.example.com/clip-2.jpg',
    duration: 4,
    width: 720,
    height: 1280,
    provider: 'pexels',
    providerId: '2',
    photographer: 'Pexels Author',
    sourceUrl: 'https://pexels.example.com/clip-2',
    license: 'pexels',
  });
  seedStorySession(
    'user-1',
    buildBaseSession({
      id: 'story-update-shot',
      story: {
        sentences: ['Morning habit'],
      },
      shots,
    })
  );

  const result = await requestJson('/api/story/update-shot', {
    method: 'POST',
    body: {
      sessionId: 'story-update-shot',
      sentenceIndex: 0,
      clipId: 'clip-2',
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
  assert.equal(result.json.data.shots[0].selectedClip.id, 'clip-2');
});

test('POST /api/story/update-caption-style returns the persisted overlayCaption style only', async () => {
  seedStorySession(
    'user-1',
    buildBaseSession({
      id: 'story-caption-style',
      overlayCaption: {
        fontFamily: 'DejaVu Sans',
        fontPx: 64,
        placement: 'bottom',
      },
    })
  );

  const result = await requestJson('/api/story/update-caption-style', {
    method: 'POST',
    body: {
      sessionId: 'story-caption-style',
      overlayCaption: {
        fontPx: 72,
        color: 'rgb(255,255,255)',
        placement: 'top',
      },
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
  assert.equal(result.json.data.overlayCaption.fontPx, 72);
  assert.equal(result.json.data.overlayCaption.placement, 'top');
  assert.equal(result.json.data.overlayCaption.color, 'rgb(255,255,255)');
});

test('POST /api/story/update-caption-style stales ready preview without changing response shape', async () => {
  seedStorySession(
    'user-1',
    buildSyncedSession({
      id: 'story-caption-style-stale-preview',
      draftPreviewV1: buildReadyDraftPreview({ previewId: 'preview-style-stale' }),
      overlayCaption: {
        fontFamily: 'DejaVu Sans',
        fontPx: 64,
        placement: 'bottom',
      },
    })
  );

  const result = await requestJson('/api/story/update-caption-style', {
    method: 'POST',
    body: {
      sessionId: 'story-caption-style-stale-preview',
      overlayCaption: {
        fontPx: 72,
        placement: 'top',
      },
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
  assert.deepEqual(Object.keys(result.json.data).sort(), ['overlayCaption']);
  assert.equal(result.json.data.overlayCaption.fontPx, 72);

  const stored = readStorySession('user-1', 'story-caption-style-stale-preview');
  assert.equal(stored.draftPreviewV1.state, 'stale');
  assert.equal(stored.draftPreviewV1.staleReasonCode, 'CAPTION_RENDER_INPUT_CHANGED');
  assert.equal(Object.prototype.hasOwnProperty.call(stored.draftPreviewV1, 'job'), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(stored.draftPreviewV1, 'activeAttemptId'),
    false
  );

  const readback = await requestJson('/api/story/story-caption-style-stale-preview');
  assert.equal(readback.status, 200);
  assert.equal(readback.json.data.draftPreviewV1.state, 'stale');
  assert.equal(
    Object.prototype.hasOwnProperty.call(readback.json.data.draftPreviewV1, 'artifact'),
    false
  );
});

test('POST /api/story/update-caption-meta stales ready preview when meta is accepted', async () => {
  seedStorySession(
    'user-1',
    buildSyncedSession({
      id: 'story-caption-meta-stale-preview',
      draftPreviewV1: buildReadyDraftPreview({ previewId: 'preview-meta-stale' }),
    })
  );

  const result = await requestJson('/api/story/update-caption-meta', {
    method: 'POST',
    body: {
      sessionId: 'story-caption-meta-stale-preview',
      beatIndex: 0,
      captionMeta: buildClientCaptionMeta('Beat one', {}),
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
  assert.deepEqual(Object.keys(result.json.data).sort(), ['captionMeta']);

  const stored = readStorySession('user-1', 'story-caption-meta-stale-preview');
  assert.equal(stored.draftPreviewV1.state, 'stale');
  assert.equal(stored.draftPreviewV1.staleReasonCode, 'CAPTION_RENDER_INPUT_CHANGED');
  assert.equal(Object.prototype.hasOwnProperty.call(stored.draftPreviewV1, 'job'), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(stored.draftPreviewV1, 'activeAttemptId'),
    false
  );
});

test('POST /api/story/update-caption-meta does not stale preview when all batch updates are skipped', async () => {
  seedStorySession(
    'user-1',
    buildSyncedSession({
      id: 'story-caption-meta-skipped-preview',
      draftPreviewV1: buildReadyDraftPreview({ previewId: 'preview-meta-skipped' }),
    })
  );

  const result = await requestJson('/api/story/update-caption-meta', {
    method: 'POST',
    body: {
      sessionId: 'story-caption-meta-skipped-preview',
      updates: [
        {
          beatIndex: 0,
          captionMeta: {
            ...buildClientCaptionMeta('Beat one', {}),
            lines: ['This line intentionally does not match'],
          },
        },
      ],
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
  assert.deepEqual(result.json.data.updates, []);

  const stored = readStorySession('user-1', 'story-caption-meta-skipped-preview');
  assert.equal(stored.draftPreviewV1.state, 'ready');
  assert.equal(stored.draftPreviewV1.previewId, 'preview-meta-skipped');
  assert.equal(Object.prototype.hasOwnProperty.call(stored.draftPreviewV1, 'job'), false);
  assert.equal(
    Object.prototype.hasOwnProperty.call(stored.draftPreviewV1, 'activeAttemptId'),
    false
  );
});

test('POST /api/story/sync requires X-Idempotency-Key', async () => {
  seedUserDoc('user-1');
  seedStorySession(
    'user-1',
    buildBaseSession({
      id: 'story-sync-missing-key',
      story: {
        sentences: ['Beat one'],
      },
    })
  );

  const result = await requestJson('/api/story/sync', {
    method: 'POST',
    headers: {
      'x-client': 'mobile',
    },
    body: {
      sessionId: 'story-sync-missing-key',
      mode: 'stale',
    },
  });

  assert.equal(result.status, 400);
  assert.equal(result.json.success, false);
  assert.equal(result.json.error, 'MISSING_IDEMPOTENCY_KEY');
});

test('POST /api/story/sync reuses an identical current fingerprint without charging again', async () => {
  const restoreEnv = withEnv({
    TTS_PROVIDER: 'elevenlabs',
    ELEVENLABS_API_KEY: 'test-eleven-key',
  });

  try {
    seedUserDoc('user-1', {
      plan: 'creator',
      membership: {
        status: 'active',
        kind: 'subscription',
        billingCadence: 'monthly',
      },
      usage: {
        cycleIncludedSec: 600,
        cycleUsedSec: 20,
        cycleReservedSec: 0,
      },
    });
    seedStorySession(
      'user-1',
      buildSyncedSession({
        id: 'story-sync-cached',
        story: {
          sentences: ['Beat one'],
        },
        shots: [buildShot('clip-sync-cached', 0, 'Beat one', 8)],
      })
    );

    const { buildStoryVoiceSyncPlan } = await import('../../src/services/story.service.js');
    const { plan } = await buildStoryVoiceSyncPlan({
      uid: 'user-1',
      sessionId: 'story-sync-cached',
      mode: 'stale',
      voicePreset: 'male_calm',
      voicePacePreset: 'normal',
    });
    const currentSession = readStorySession('user-1', 'story-sync-cached');
    currentSession.voicePreset = 'male_calm';
    currentSession.voicePacePreset = 'normal';
    currentSession.voiceSync = {
      ...currentSession.voiceSync,
      state: 'current',
      staleScope: 'none',
      staleBeatIndices: [],
      currentFingerprint: plan.fullFingerprint,
      nextEstimatedChargeSec: 0,
    };
    seedStorySession('user-1', currentSession);

    const result = await requestJson('/api/story/sync', {
      method: 'POST',
      headers: {
        'x-client': 'mobile',
        'X-Idempotency-Key': 'idem-story-sync-cached',
      },
      body: {
        sessionId: 'story-sync-cached',
        mode: 'stale',
        voicePreset: 'male_calm',
        voicePacePreset: 'normal',
      },
    });

    assert.equal(result.status, 200);
    assert.equal(result.json.success, true);
    assert.equal(result.json.data.voiceSync.cached, true);
    assert.equal(result.json.data.voiceSync.lastChargeSec, 0);
    assert.equal(result.json.data.voiceSync.currentFingerprint, plan.fullFingerprint);
    assert.equal(result.json.data.previewReadinessV1.version, 1);
    assert.equal(result.json.data.previewReadinessV1.ready, true);
    assert.equal(result.json.data.previewReadinessV1.reasonCode, null);
    assert.equal(result.json.data.playbackTimelineV1.segments.length, 1);

    const attemptDoc = readDoc('storySyncAttempts', 'user-1:idem-story-sync-cached');
    assert.equal(attemptDoc.state, 'done');
    assert.equal(attemptDoc.billingSettlement.billedSec, 0);
    assert.equal(readDoc('storySyncSessions', 'user-1:story-sync-cached'), null);
    assert.equal(readDoc('users', 'user-1').usage.cycleUsedSec, 20);
    assert.equal(readDoc('users', 'user-1').usage.cycleReservedSec, 0);
  } finally {
    restoreEnv();
  }
});

test('POST /api/story/sync preserves current voiceSync but returns blocked preview readiness when clip coverage is incomplete', async () => {
  const restoreEnv = withEnv({
    TTS_PROVIDER: 'elevenlabs',
    ELEVENLABS_API_KEY: 'test-eleven-key',
  });

  try {
    seedUserDoc('user-1', {
      plan: 'creator',
      membership: {
        status: 'active',
        kind: 'subscription',
        billingCadence: 'monthly',
      },
      usage: {
        cycleIncludedSec: 600,
        cycleUsedSec: 20,
        cycleReservedSec: 0,
      },
    });
    seedStorySession(
      'user-1',
      buildSyncedSession({
        id: 'story-sync-incomplete-clips',
        story: {
          sentences: ['Beat one', 'Beat two'],
        },
        shots: [
          buildShot('clip-sync-incomplete-1', 0, 'Beat one', 4),
          {
            sentenceIndex: 1,
            visualDescription: 'Beat two visual',
            searchQuery: 'Beat two',
            durationSec: 4,
            startTimeSec: 4,
            selectedClip: null,
            candidates: [],
          },
        ],
      })
    );

    const { buildStoryVoiceSyncPlan } = await import('../../src/services/story.service.js');
    const { plan } = await buildStoryVoiceSyncPlan({
      uid: 'user-1',
      sessionId: 'story-sync-incomplete-clips',
      mode: 'stale',
      voicePreset: 'male_calm',
      voicePacePreset: 'normal',
    });
    const currentSession = readStorySession('user-1', 'story-sync-incomplete-clips');
    currentSession.voicePreset = 'male_calm';
    currentSession.voicePacePreset = 'normal';
    currentSession.voiceSync = {
      ...currentSession.voiceSync,
      state: 'current',
      staleScope: 'none',
      staleBeatIndices: [],
      currentFingerprint: plan.fullFingerprint,
      nextEstimatedChargeSec: 0,
    };
    seedStorySession('user-1', currentSession);

    const result = await requestJson('/api/story/sync', {
      method: 'POST',
      headers: {
        'x-client': 'mobile',
        'X-Idempotency-Key': 'idem-story-sync-incomplete-clips',
      },
      body: {
        sessionId: 'story-sync-incomplete-clips',
        mode: 'stale',
        voicePreset: 'male_calm',
        voicePacePreset: 'normal',
      },
    });

    assert.equal(result.status, 200);
    assert.equal(result.json.success, true);
    assert.equal(result.json.data.voiceSync.state, 'current');
    assert.equal(result.json.data.previewReadinessV1.version, 1);
    assert.equal(result.json.data.previewReadinessV1.ready, false);
    assert.equal(result.json.data.previewReadinessV1.reasonCode, 'MISSING_CLIP_COVERAGE');
    assert.deepEqual(result.json.data.previewReadinessV1.missingBeatIndices, [1]);
    assert.equal(
      Object.prototype.hasOwnProperty.call(result.json.data, 'playbackTimelineV1'),
      false
    );
  } finally {
    restoreEnv();
  }
});

test('POST /api/caption/preview locks the current mobile server-measured request and response shape', async () => {
  const result = await requestJson('/api/caption/preview', {
    method: 'POST',
    headers: {
      'x-client': 'mobile',
    },
    body: {
      ssotVersion: 3,
      mode: 'raster',
      measure: 'server',
      text: 'Caption preview from mobile',
      placement: 'bottom',
      frameW: 1080,
      frameH: 1920,
      style: {
        fontPx: 64,
        fontFamily: 'DejaVu Sans',
        color: 'rgb(255,255,255)',
      },
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.json.success, true);
  assert.equal(result.json.data.wPx, 1080);
  assert.equal(result.json.data.hPx, 1920);
  assert.ok(result.json.data.meta.rasterUrl.startsWith('data:image/png;base64,'));
  assert.ok(Number.isInteger(result.json.data.meta.rasterW));
  assert.ok(Number.isInteger(result.json.data.meta.rasterH));
  assert.ok(Number.isInteger(result.json.data.meta.yPx_png));
  assert.ok(Array.isArray(result.json.data.meta.lines));
});

test('POST /api/story/finalize returns 202 pending first, then same-key replay returns completed success with shortId and settled billing', async () => {
  seedUserDoc('user-1', {
    plan: 'creator',
    membership: {
      status: 'active',
      kind: 'subscription',
      billingCadence: 'monthly',
    },
    usage: {
      cycleIncludedSec: 600,
      cycleUsedSec: 60,
      cycleReservedSec: 0,
    },
  });
  seedStorySession(
    'user-1',
    buildSyncedSession({
      id: 'story-finalize-success',
      story: {
        sentences: ['Beat one', 'Beat two'],
      },
      shots: [buildShot('clip-1', 0, 'Beat one', 4), buildShot('clip-2', 1, 'Beat two', 5)],
    })
  );

  setRuntimeOverride('story.service.finalizeStory', async ({ uid, sessionId, attemptId }) => {
    const session = readStorySession(uid, sessionId);
    session.status = 'rendered';
    session.finalVideo = {
      jobId: 'short-finalized-1',
      durationSec: 9,
      videoUrl: 'https://cdn.example.com/finalized.mp4',
    };
    session.renderRecovery = {
      state: 'done',
      attemptId,
      shortId: 'short-finalized-1',
      startedAt: '2026-03-19T02:00:00.000Z',
      updatedAt: '2026-03-19T02:00:10.000Z',
      finishedAt: '2026-03-19T02:00:10.000Z',
    };
    seedStorySession(uid, session);
    return session;
  });

  startFinalizeWorkerRuntime();
  try {
    const first = await requestJson('/api/story/finalize', {
      method: 'POST',
      headers: {
        'x-client': 'mobile',
        'X-Idempotency-Key': 'idem-finalize-1',
      },
      body: {
        sessionId: 'story-finalize-success',
      },
    });

    assert.equal(first.status, 202);
    assert.equal(first.json.success, true);
    assert.equal(first.json.shortId, null);
    assert.equal(first.json.finalize.state, 'pending');
    assert.equal(first.json.finalize.attemptId, 'idem-finalize-1');
    assert.equal(first.json.finalize.pollSessionId, 'story-finalize-success');
    assert.equal(first.json.data.renderRecovery.state, 'pending');

    const acceptedAttempt = readDoc('idempotency', 'user-1:idem-finalize-1');
    assert.equal(acceptedAttempt.schemaVersion, 3);
    assert.equal(acceptedAttempt.jobId, 'idem-finalize-1');
    assert.equal(acceptedAttempt.externalAttemptId, 'idem-finalize-1');
    assert.ok(['queued', 'claimed', 'started', 'settled'].includes(acceptedAttempt.jobState));
    assert.equal(acceptedAttempt.currentExecution.executionAttemptId, 'idem-finalize-1:exec:1');
    assert.equal(acceptedAttempt.executionAttempts.length, 1);
    assert.equal(acceptedAttempt.executionAttempts[0].executionAttemptId, 'idem-finalize-1:exec:1');
    assert.ok(
      ['created', 'claimed', 'running', 'succeeded'].includes(
        acceptedAttempt.executionAttempts[0].state
      )
    );

    await waitFor(() => readDoc('idempotency', 'user-1:idem-finalize-1')?.state === 'done', {
      timeoutMs: 1000,
      intervalMs: 20,
    });

    const replay = await requestJson('/api/story/finalize', {
      method: 'POST',
      headers: {
        'x-client': 'mobile',
        'X-Idempotency-Key': 'idem-finalize-1',
      },
      body: {
        sessionId: 'story-finalize-success',
      },
    });

    assert.equal(replay.status, 200);
    assert.equal(replay.json.success, true);
    assert.equal(replay.json.shortId, 'short-finalized-1');
    assert.equal(replay.json.data.finalVideo.jobId, 'short-finalized-1');
    assert.equal(replay.json.data.billing.billedSec, 4.5);

    const settledAttempt = readDoc('idempotency', 'user-1:idem-finalize-1');
    assert.equal(settledAttempt.jobId, 'idem-finalize-1');
    assert.equal(settledAttempt.jobState, 'settled');
    assert.equal(settledAttempt.executionAttempts.length, 1);
    assert.equal(settledAttempt.executionAttempts[0].executionAttemptId, 'idem-finalize-1:exec:1');
    assert.equal(settledAttempt.executionAttempts[0].state, 'succeeded');
    assert.equal(settledAttempt.currentExecution.executionAttemptId, 'idem-finalize-1:exec:1');
    assert.equal(settledAttempt.currentExecution.state, 'succeeded');

    const usageDoc = readDoc('users', 'user-1');
    assert.equal(usageDoc.usage.cycleUsedSec, 64.5);
    assert.equal(usageDoc.usage.cycleReservedSec, 0);
  } finally {
    stopFinalizeWorkerRuntime('contract_finalize_success_cleanup');
  }
});

test('POST /api/story/finalize fails closed with 409 VOICE_SYNC_REQUIRED when the session was never synced', async () => {
  seedUserDoc('user-1', {
    plan: 'creator',
    membership: {
      status: 'active',
      kind: 'subscription',
      billingCadence: 'monthly',
    },
    usage: {
      cycleIncludedSec: 600,
      cycleUsedSec: 40,
      cycleReservedSec: 0,
    },
  });
  seedStorySession(
    'user-1',
    buildBaseSession({
      id: 'story-finalize-sync-required',
      story: {
        sentences: ['Beat one', 'Beat two'],
      },
      shots: [buildShot('clip-1', 0, 'Beat one', 4), buildShot('clip-2', 1, 'Beat two', 5)],
    })
  );

  const result = await requestJson('/api/story/finalize', {
    method: 'POST',
    headers: {
      'x-client': 'mobile',
      'X-Idempotency-Key': 'idem-finalize-sync-required',
    },
    body: {
      sessionId: 'story-finalize-sync-required',
    },
  });

  assert.equal(result.status, 409);
  assert.equal(result.json.success, false);
  assert.equal(result.json.error, 'VOICE_SYNC_REQUIRED');
  assert.equal(readDoc('idempotency', 'user-1:idem-finalize-sync-required'), null);
});

test('POST /api/story/finalize fails closed with 409 VOICE_SYNC_STALE when narration timing is stale', async () => {
  seedUserDoc('user-1', {
    plan: 'creator',
    membership: {
      status: 'active',
      kind: 'subscription',
      billingCadence: 'monthly',
    },
    usage: {
      cycleIncludedSec: 600,
      cycleUsedSec: 40,
      cycleReservedSec: 0,
    },
  });
  seedStorySession(
    'user-1',
    buildSyncedSession({
      id: 'story-finalize-sync-stale',
      story: {
        sentences: ['Beat one', 'Beat two'],
      },
      shots: [buildShot('clip-1', 0, 'Beat one', 4), buildShot('clip-2', 1, 'Beat two', 5)],
      voiceSync: {
        schemaVersion: 1,
        state: 'stale',
        requiredForRender: true,
        staleScope: 'beat',
        staleBeatIndices: [1],
        currentFingerprint: 'sync-story-finalize-sync-stale',
        nextEstimatedChargeSec: 2.5,
        totalDurationSec: 9,
        previewAudioUrl: 'https://cdn.example.com/story-finalize-sync-stale-preview.mp3',
        previewAudioDurationSec: 9,
        lastChargeSec: 4.5,
        totalBilledSec: 4.5,
        lastSyncedAt: '2026-03-19T00:00:00.000Z',
        cached: false,
      },
    })
  );

  const result = await requestJson('/api/story/finalize', {
    method: 'POST',
    headers: {
      'x-client': 'mobile',
      'X-Idempotency-Key': 'idem-finalize-sync-stale',
    },
    body: {
      sessionId: 'story-finalize-sync-stale',
    },
  });

  assert.equal(result.status, 409);
  assert.equal(result.json.success, false);
  assert.equal(result.json.error, 'VOICE_SYNC_STALE');
  assert.equal(readDoc('idempotency', 'user-1:idem-finalize-sync-stale'), null);
});

test('POST /api/story/finalize replays 202 pending for the same key while the background attempt is still active', async () => {
  seedUserDoc('user-1', {
    plan: 'creator',
    membership: {
      status: 'active',
      kind: 'subscription',
      billingCadence: 'monthly',
    },
    usage: {
      cycleIncludedSec: 600,
      cycleUsedSec: 20,
      cycleReservedSec: 0,
    },
  });
  seedStorySession(
    'user-1',
    buildSyncedSession({
      id: 'story-finalize-pending',
      story: {
        sentences: ['Beat one'],
      },
      shots: [buildShot('clip-1', 0, 'Beat one', 8)],
    })
  );

  let release;
  const blocker = new Promise((resolve) => {
    release = resolve;
  });

  setRuntimeOverride('story.service.finalizeStory', async ({ uid, sessionId, attemptId }) => {
    await blocker;
    const session = readStorySession(uid, sessionId);
    session.finalVideo = {
      jobId: 'short-finalized-pending',
      durationSec: 8,
    };
    session.renderRecovery = {
      state: 'done',
      attemptId,
      shortId: 'short-finalized-pending',
      startedAt: '2026-03-19T03:00:00.000Z',
      updatedAt: '2026-03-19T03:00:05.000Z',
      finishedAt: '2026-03-19T03:00:05.000Z',
    };
    seedStorySession(uid, session);
    return session;
  });

  startFinalizeWorkerRuntime();
  try {
    const firstPromise = requestJson('/api/story/finalize', {
      method: 'POST',
      headers: {
        'X-Idempotency-Key': 'idem-finalize-pending',
        'x-client': 'mobile',
      },
      body: {
        sessionId: 'story-finalize-pending',
      },
    });

    await waitFor(() => Boolean(readDoc('idempotency', 'user-1:idem-finalize-pending')));

    const second = await requestJson('/api/story/finalize', {
      method: 'POST',
      headers: {
        'X-Idempotency-Key': 'idem-finalize-pending',
        'x-client': 'mobile',
      },
      body: {
        sessionId: 'story-finalize-pending',
      },
    });

    assert.equal(second.status, 202);
    assert.equal(second.json.success, true);
    assert.equal(second.json.shortId, null);
    assert.equal(second.json.finalize.state, 'pending');
    assert.equal(second.json.finalize.attemptId, 'idem-finalize-pending');

    const usageDoc = readDoc('users', 'user-1');
    assert.equal(usageDoc.usage.cycleReservedSec, 4);

    release();
    const first = await firstPromise;
    assert.equal(first.status, 202);
    assert.equal(first.json.finalize.attemptId, 'idem-finalize-pending');

    await waitFor(() => readDoc('idempotency', 'user-1:idem-finalize-pending')?.state === 'done', {
      timeoutMs: 1000,
      intervalMs: 20,
    });

    const replay = await requestJson('/api/story/finalize', {
      method: 'POST',
      headers: {
        'X-Idempotency-Key': 'idem-finalize-pending',
        'x-client': 'mobile',
      },
      body: {
        sessionId: 'story-finalize-pending',
      },
    });
    assert.equal(replay.status, 200);
    assert.equal(replay.json.shortId, 'short-finalized-pending');
  } finally {
    stopFinalizeWorkerRuntime('contract_finalize_pending_cleanup');
  }
});

test('POST /api/story/finalize preserves caller behavior while retrying with canonical execution lineage', async () => {
  seedUserDoc('user-1', {
    plan: 'creator',
    membership: {
      status: 'active',
      kind: 'subscription',
      billingCadence: 'monthly',
    },
    usage: {
      cycleIncludedSec: 600,
      cycleUsedSec: 20,
      cycleReservedSec: 0,
    },
  });
  seedStorySession(
    'user-1',
    buildSyncedSession({
      id: 'story-finalize-retry-lineage',
      story: {
        sentences: ['Beat one'],
      },
      shots: [buildShot('clip-retry', 0, 'Beat one', 8)],
    })
  );

  let finalizeCalls = 0;
  setRuntimeOverride('story.service.finalizeStory', async ({ uid, sessionId, attemptId }) => {
    finalizeCalls += 1;
    if (finalizeCalls === 1) {
      const error = new Error('SERVER_BUSY');
      error.code = 'SERVER_BUSY';
      throw error;
    }
    const session = readStorySession(uid, sessionId);
    session.status = 'rendered';
    session.finalVideo = {
      jobId: 'short-finalized-retry',
      durationSec: 8,
      videoUrl: 'https://cdn.example.com/finalized-retry.mp4',
    };
    session.renderRecovery = {
      state: 'done',
      attemptId,
      shortId: 'short-finalized-retry',
      startedAt: '2026-03-19T03:00:00.000Z',
      updatedAt: '2026-03-19T03:00:05.000Z',
      finishedAt: '2026-03-19T03:00:05.000Z',
    };
    seedStorySession(uid, session);
    return session;
  });

  startFinalizeWorkerRuntime();
  try {
    const first = await requestJson('/api/story/finalize', {
      method: 'POST',
      headers: {
        'X-Idempotency-Key': 'idem-finalize-retry-lineage',
        'x-client': 'mobile',
      },
      body: {
        sessionId: 'story-finalize-retry-lineage',
      },
    });

    assert.equal(first.status, 202);
    assert.equal(first.json.success, true);
    assert.equal(first.json.shortId, null);
    assert.equal(first.json.finalize.state, 'pending');
    assert.equal(first.json.finalize.attemptId, 'idem-finalize-retry-lineage');

    await waitFor(
      () =>
        readDoc('idempotency', 'user-1:idem-finalize-retry-lineage')?.executionAttempts?.length ===
        2,
      { timeoutMs: 1000, intervalMs: 20 }
    );

    const retriedAttempt = readDoc('idempotency', 'user-1:idem-finalize-retry-lineage');
    assert.equal(retriedAttempt.jobId, 'idem-finalize-retry-lineage');
    assert.equal(retriedAttempt.externalAttemptId, 'idem-finalize-retry-lineage');
    assert.equal(retriedAttempt.jobState, 'retry_scheduled');
    assert.equal(retriedAttempt.executionAttempts.length, 2);
    assert.equal(
      retriedAttempt.executionAttempts[0].executionAttemptId,
      'idem-finalize-retry-lineage:exec:1'
    );
    assert.equal(retriedAttempt.executionAttempts[0].state, 'failed_retryable');
    assert.equal(
      retriedAttempt.executionAttempts[1].executionAttemptId,
      'idem-finalize-retry-lineage:exec:2'
    );
    assert.equal(retriedAttempt.executionAttempts[1].state, 'created');
    assert.equal(
      retriedAttempt.currentExecution.executionAttemptId,
      'idem-finalize-retry-lineage:exec:2'
    );
    assert.equal(retriedAttempt.currentExecution.state, 'created');

    await waitFor(
      () => readDoc('idempotency', 'user-1:idem-finalize-retry-lineage')?.state === 'done',
      {
        timeoutMs: 1500,
        intervalMs: 20,
      }
    );

    const replay = await requestJson('/api/story/finalize', {
      method: 'POST',
      headers: {
        'X-Idempotency-Key': 'idem-finalize-retry-lineage',
        'x-client': 'mobile',
      },
      body: {
        sessionId: 'story-finalize-retry-lineage',
      },
    });

    assert.equal(replay.status, 200);
    assert.equal(replay.json.success, true);
    assert.equal(replay.json.shortId, 'short-finalized-retry');
    assert.equal(replay.json.data.finalVideo.jobId, 'short-finalized-retry');

    const settledAttempt = readDoc('idempotency', 'user-1:idem-finalize-retry-lineage');
    assert.equal(settledAttempt.jobState, 'settled');
    assert.equal(settledAttempt.executionAttempts.length, 2);
    assert.equal(settledAttempt.executionAttempts[0].state, 'failed_retryable');
    assert.equal(settledAttempt.executionAttempts[1].state, 'succeeded');
    assert.equal(
      settledAttempt.currentExecution.executionAttemptId,
      'idem-finalize-retry-lineage:exec:2'
    );
    assert.equal(settledAttempt.currentExecution.state, 'succeeded');
  } finally {
    stopFinalizeWorkerRuntime('contract_finalize_retry_lineage_cleanup');
  }
});

test('POST /api/story/finalize returns 409 FINALIZE_ALREADY_ACTIVE for a different key on the same active session without double-reserving', async () => {
  seedUserDoc('user-1', {
    plan: 'creator',
    membership: {
      status: 'active',
      kind: 'subscription',
      billingCadence: 'monthly',
    },
    usage: {
      cycleIncludedSec: 600,
      cycleUsedSec: 20,
      cycleReservedSec: 0,
    },
  });
  seedStorySession(
    'user-1',
    buildSyncedSession({
      id: 'story-finalize-conflict',
      story: {
        sentences: ['Beat one'],
      },
      shots: [buildShot('clip-1', 0, 'Beat one', 8)],
    })
  );

  let release;
  const blocker = new Promise((resolve) => {
    release = resolve;
  });

  setRuntimeOverride('story.service.finalizeStory', async ({ uid, sessionId, attemptId }) => {
    await blocker;
    const session = readStorySession(uid, sessionId);
    session.finalVideo = {
      jobId: 'short-finalized-conflict',
      durationSec: 8,
    };
    session.renderRecovery = {
      state: 'done',
      attemptId,
      shortId: 'short-finalized-conflict',
      startedAt: '2026-03-19T04:00:00.000Z',
      updatedAt: '2026-03-19T04:00:05.000Z',
      finishedAt: '2026-03-19T04:00:05.000Z',
    };
    seedStorySession(uid, session);
    return session;
  });

  startFinalizeWorkerRuntime();
  try {
    const first = await requestJson('/api/story/finalize', {
      method: 'POST',
      headers: {
        'X-Idempotency-Key': 'idem-finalize-conflict-a',
        'x-client': 'mobile',
      },
      body: {
        sessionId: 'story-finalize-conflict',
      },
    });
    assert.equal(first.status, 202);

    await waitFor(
      () => {
        const attempt = readDoc('idempotency', 'user-1:idem-finalize-conflict-a');
        return attempt?.state === 'queued' || attempt?.state === 'running';
      },
      { timeoutMs: 1000, intervalMs: 20 }
    );

    const second = await requestJson('/api/story/finalize', {
      method: 'POST',
      headers: {
        'X-Idempotency-Key': 'idem-finalize-conflict-b',
        'x-client': 'mobile',
      },
      body: {
        sessionId: 'story-finalize-conflict',
      },
    });

    assert.equal(second.status, 409);
    assert.equal(second.json.success, false);
    assert.equal(second.json.error, 'FINALIZE_ALREADY_ACTIVE');
    assert.equal(second.json.finalize.attemptId, 'idem-finalize-conflict-a');
    assert.equal(second.json.finalize.pollSessionId, 'story-finalize-conflict');

    const acceptedAttempt = readDoc('idempotency', 'user-1:idem-finalize-conflict-a');
    assert.equal(acceptedAttempt.jobId, 'idem-finalize-conflict-a');
    assert.equal(acceptedAttempt.externalAttemptId, 'idem-finalize-conflict-a');
    assert.equal(acceptedAttempt.executionAttempts.length, 1);
    assert.equal(
      acceptedAttempt.executionAttempts[0].executionAttemptId,
      'idem-finalize-conflict-a:exec:1'
    );

    const usageDoc = readDoc('users', 'user-1');
    assert.equal(usageDoc.usage.cycleReservedSec, 4);
    assert.equal(readDoc('idempotency', 'user-1:idem-finalize-conflict-b'), null);

    release();
    await waitFor(
      () => readDoc('idempotency', 'user-1:idem-finalize-conflict-a')?.state === 'done',
      {
        timeoutMs: 1000,
        intervalMs: 20,
      }
    );
  } finally {
    stopFinalizeWorkerRuntime('contract_finalize_conflict_cleanup');
  }
});

test('POST /api/story/finalize rejects new admissions with 503 SERVER_BUSY and Retry-After once shared backlog is at cap without creating durable finalize artifacts', async () => {
  const restoreEnv = withEnv({
    STORY_FINALIZE_SHARED_BACKLOG_LIMIT: 1,
    STORY_FINALIZE_OVERLOAD_RETRY_AFTER_SEC: 45,
  });

  try {
    seedUserDoc('user-1', {
      plan: 'creator',
      membership: {
        status: 'active',
        kind: 'subscription',
        billingCadence: 'monthly',
      },
      usage: {
        cycleIncludedSec: 600,
        cycleUsedSec: 20,
        cycleReservedSec: 0,
      },
    });
    seedStorySession(
      'user-1',
      buildSyncedSession({
        id: 'story-finalize-overload-new',
        story: {
          sentences: ['Beat one'],
        },
        shots: [buildShot('clip-overload-1', 0, 'Beat one', 8)],
      })
    );
    seedFirestoreDoc('idempotency', 'user-1:existing-overload-attempt', {
      flow: 'story.finalize',
      uid: 'user-1',
      attemptId: 'existing-overload-attempt',
      jobId: 'existing-overload-attempt',
      externalAttemptId: 'existing-overload-attempt',
      sessionId: 'story-existing-overload',
      state: 'queued',
      jobState: 'queued',
      isActive: true,
      createdAt: timestamp('2026-03-26T10:00:00.000Z'),
      updatedAt: timestamp('2026-03-26T10:00:00.000Z'),
      enqueuedAt: timestamp('2026-03-26T10:00:00.000Z'),
      availableAfter: timestamp('2026-03-26T10:00:00.000Z'),
    });

    const result = await requestJson('/api/story/finalize', {
      method: 'POST',
      headers: {
        'X-Idempotency-Key': 'idem-finalize-overload-new',
        'x-client': 'mobile',
      },
      body: {
        sessionId: 'story-finalize-overload-new',
      },
    });

    assert.equal(result.status, 503);
    assert.equal(result.json.success, false);
    assert.equal(result.json.error, 'SERVER_BUSY');
    assert.equal(result.response.headers.get('retry-after'), '45');
    assert.equal(readDoc('idempotency', 'user-1:idem-finalize-overload-new'), null);
    assert.equal(readDoc('storyFinalizeSessions', 'user-1:story-finalize-overload-new'), null);
    assert.equal(readDoc('users', 'user-1').usage.cycleReservedSec, 0);
  } finally {
    restoreEnv();
  }
});

test('POST /api/story/finalize same-key replay bypasses the shared overload gate', async () => {
  const restoreEnv = withEnv({
    STORY_FINALIZE_SHARED_BACKLOG_LIMIT: 1,
  });

  try {
    seedUserDoc('user-1', {
      plan: 'creator',
      membership: {
        status: 'active',
        kind: 'subscription',
        billingCadence: 'monthly',
      },
      usage: {
        cycleIncludedSec: 600,
        cycleUsedSec: 20,
        cycleReservedSec: 0,
      },
    });
    seedStorySession(
      'user-1',
      buildSyncedSession({
        id: 'story-finalize-overload-replay',
        story: {
          sentences: ['Beat one'],
        },
        shots: [buildShot('clip-overload-replay', 0, 'Beat one', 8)],
      })
    );

    const first = await requestJson('/api/story/finalize', {
      method: 'POST',
      headers: {
        'X-Idempotency-Key': 'idem-finalize-overload-replay',
        'x-client': 'mobile',
      },
      body: {
        sessionId: 'story-finalize-overload-replay',
      },
    });

    assert.equal(first.status, 202);

    const replay = await requestJson('/api/story/finalize', {
      method: 'POST',
      headers: {
        'X-Idempotency-Key': 'idem-finalize-overload-replay',
        'x-client': 'mobile',
      },
      body: {
        sessionId: 'story-finalize-overload-replay',
      },
    });

    assert.equal(replay.status, 202);
    assert.equal(replay.json.success, true);
    assert.equal(replay.json.finalize.attemptId, 'idem-finalize-overload-replay');
  } finally {
    restoreEnv();
  }
});

test('POST /api/story/finalize same-session active conflict still returns 409 before the shared overload gate', async () => {
  const restoreEnv = withEnv({
    STORY_FINALIZE_SHARED_BACKLOG_LIMIT: 1,
  });

  try {
    seedUserDoc('user-1', {
      plan: 'creator',
      membership: {
        status: 'active',
        kind: 'subscription',
        billingCadence: 'monthly',
      },
      usage: {
        cycleIncludedSec: 600,
        cycleUsedSec: 20,
        cycleReservedSec: 0,
      },
    });
    seedStorySession(
      'user-1',
      buildSyncedSession({
        id: 'story-finalize-overload-conflict',
        story: {
          sentences: ['Beat one'],
        },
        shots: [buildShot('clip-overload-conflict', 0, 'Beat one', 8)],
      })
    );

    const first = await requestJson('/api/story/finalize', {
      method: 'POST',
      headers: {
        'X-Idempotency-Key': 'idem-finalize-overload-conflict-a',
        'x-client': 'mobile',
      },
      body: {
        sessionId: 'story-finalize-overload-conflict',
      },
    });

    assert.equal(first.status, 202);

    const second = await requestJson('/api/story/finalize', {
      method: 'POST',
      headers: {
        'X-Idempotency-Key': 'idem-finalize-overload-conflict-b',
        'x-client': 'mobile',
      },
      body: {
        sessionId: 'story-finalize-overload-conflict',
      },
    });

    assert.equal(second.status, 409);
    assert.equal(second.json.error, 'FINALIZE_ALREADY_ACTIVE');
    assert.equal(second.json.finalize.attemptId, 'idem-finalize-overload-conflict-a');
  } finally {
    restoreEnv();
  }
});

test('POST /api/story/finalize returns 402 INSUFFICIENT_RENDER_TIME before calling the finalize service', async () => {
  seedUserDoc('user-1', {
    plan: 'creator',
    membership: {
      status: 'active',
      kind: 'subscription',
      billingCadence: 'monthly',
    },
    usage: {
      cycleIncludedSec: 60,
      cycleUsedSec: 55,
      cycleReservedSec: 0,
    },
  });
  seedStorySession(
    'user-1',
    buildSyncedSession({
      id: 'story-finalize-no-seconds',
      story: {
        sentences: ['Beat one'],
      },
      shots: [buildShot('clip-no-seconds', 0, 'Beat one', 24)],
    })
  );

  let overrideCalled = false;
  setRuntimeOverride('story.service.finalizeStory', async () => {
    overrideCalled = true;
    throw new Error('finalize override should not run');
  });

  const result = await requestJson('/api/story/finalize', {
    method: 'POST',
    headers: {
      'X-Idempotency-Key': 'idem-finalize-no-seconds',
      'x-client': 'mobile',
    },
    body: {
      sessionId: 'story-finalize-no-seconds',
    },
  });

  assert.equal(result.status, 402);
  assert.equal(result.json.success, false);
  assert.equal(result.json.error, 'INSUFFICIENT_RENDER_TIME');
  assert.equal(overrideCalled, false);
});

test('POST /api/story/finalize returns 404 SESSION_NOT_FOUND when the requested session is missing', async () => {
  seedUserDoc('user-1', {
    plan: 'creator',
    membership: {
      status: 'active',
      kind: 'subscription',
      billingCadence: 'monthly',
    },
    usage: {
      cycleIncludedSec: 600,
      cycleUsedSec: 0,
      cycleReservedSec: 0,
    },
  });

  const result = await requestJson('/api/story/finalize', {
    method: 'POST',
    headers: {
      'X-Idempotency-Key': 'idem-missing-session',
      'x-client': 'mobile',
    },
    body: {
      sessionId: 'story-missing-session',
    },
  });

  assert.equal(result.status, 404);
  assert.equal(result.json.success, false);
  assert.equal(result.json.error, 'SESSION_NOT_FOUND');
});

test('POST /api/story/finalize preserves active web creative additive options compatibility', async () => {
  seedUserDoc('user-1', {
    plan: 'creator',
    membership: {
      status: 'active',
      kind: 'subscription',
      billingCadence: 'monthly',
    },
    usage: {
      cycleIncludedSec: 600,
      cycleUsedSec: 0,
      cycleReservedSec: 0,
    },
  });
  seedStorySession(
    'user-1',
    buildSyncedSession({
      id: 'story-finalize-web-options',
      story: {
        sentences: ['Beat one'],
      },
      shots: [buildShot('clip-web-options', 0, 'Beat one', 8)],
    })
  );

  const result = await requestJson('/api/story/finalize', {
    method: 'POST',
    headers: {
      'X-Idempotency-Key': 'story-finalize-web-options',
    },
    body: {
      sessionId: 'story-finalize-web-options',
      options: {
        voicePreset: 'narrator',
      },
    },
  });

  assert.equal(result.status, 202);
  assert.equal(result.json.success, true);
  assert.equal(result.json.shortId, null);
  assert.equal(result.json.finalize?.state, 'pending');
  assert.equal(result.json.finalize?.attemptId, 'story-finalize-web-options');
  assert.equal(readDoc('idempotency', 'user-1:story-finalize-web-options')?.state, 'queued');
  assert.equal(
    readStorySession('user-1', 'story-finalize-web-options')?.renderRecovery?.attemptId,
    'story-finalize-web-options'
  );
});

test('POST /api/story/finalize queues accepted work instead of returning 503 when render slots are saturated', async () => {
  seedUserDoc('user-1', {
    plan: 'creator',
    membership: {
      status: 'active',
      kind: 'subscription',
      billingCadence: 'monthly',
    },
    usage: {
      cycleIncludedSec: 600,
      cycleUsedSec: 0,
      cycleReservedSec: 0,
    },
  });

  for (const sessionId of [
    'story-finalize-slot-1',
    'story-finalize-slot-2',
    'story-finalize-slot-3',
    'story-finalize-slot-4',
  ]) {
    seedStorySession(
      'user-1',
      buildSyncedSession({
        id: sessionId,
        story: {
          sentences: ['Beat one'],
        },
        shots: [buildShot(`clip-${sessionId}`, 0, 'Beat one', 8)],
      })
    );
  }

  let entered = 0;
  let release;
  const blocker = new Promise((resolve) => {
    release = resolve;
  });

  setRuntimeOverride('story.service.finalizeStory', async ({ uid, sessionId, attemptId }) => {
    entered += 1;
    await blocker;
    const session = readStorySession(uid, sessionId);
    session.finalVideo = {
      jobId: `short-${sessionId}`,
      durationSec: 8,
    };
    session.renderRecovery = {
      state: 'done',
      attemptId,
      shortId: `short-${sessionId}`,
      startedAt: '2026-03-19T05:00:00.000Z',
      updatedAt: '2026-03-19T05:00:05.000Z',
      finishedAt: '2026-03-19T05:00:05.000Z',
    };
    seedStorySession(uid, session);
    return session;
  });

  startFinalizeWorkerRuntime();
  try {
    const firstThree = [
      'story-finalize-slot-1',
      'story-finalize-slot-2',
      'story-finalize-slot-3',
    ].map((sessionId) =>
      requestJson('/api/story/finalize', {
        method: 'POST',
        headers: {
          'X-Idempotency-Key': `idem-${sessionId}`,
          'x-client': 'mobile',
        },
        body: {
          sessionId,
        },
      })
    );

    await waitFor(() => entered >= 1, { timeoutMs: 1000, intervalMs: 20 });

    const fourth = await requestJson('/api/story/finalize', {
      method: 'POST',
      headers: {
        'X-Idempotency-Key': 'idem-story-finalize-slot-4',
        'x-client': 'mobile',
      },
      body: {
        sessionId: 'story-finalize-slot-4',
      },
    });

    assert.equal(fourth.status, 202);
    assert.equal(fourth.json.success, true);
    assert.equal(fourth.json.shortId, null);
    assert.equal(fourth.json.finalize.state, 'pending');

    release();
    const settled = await Promise.all(firstThree);
    for (const result of settled) {
      assert.equal(result.status, 202);
      assert.equal(result.json.success, true);
    }

    await waitFor(
      () => readDoc('idempotency', 'user-1:idem-story-finalize-slot-4')?.state === 'done',
      { timeoutMs: 1500, intervalMs: 20 }
    );
  } finally {
    stopFinalizeWorkerRuntime('contract_finalize_slots_cleanup');
  }
});

test('stale running finalize attempts are reaped into terminal failure, release reservations, and persist renderRecovery.failed', async () => {
  seedUserDoc('user-1', {
    plan: 'creator',
    membership: {
      status: 'active',
      kind: 'subscription',
      billingCadence: 'monthly',
    },
    usage: {
      cycleIncludedSec: 600,
      cycleUsedSec: 10,
      cycleReservedSec: 8,
    },
  });
  seedStorySession(
    'user-1',
    buildBaseSession({
      id: 'story-finalize-stale',
      story: {
        sentences: ['Beat one'],
      },
      shots: [buildShot('clip-1', 0, 'Beat one')],
      renderRecovery: {
        state: 'pending',
        attemptId: 'idem-finalize-stale',
        shortId: null,
        startedAt: '2026-03-19T06:00:00.000Z',
        updatedAt: '2026-03-19T06:00:01.000Z',
        finishedAt: null,
        failedAt: null,
        code: null,
        message: null,
      },
    })
  );
  seedFirestoreDoc('idempotency', 'user-1:idem-finalize-stale', {
    flow: 'story.finalize',
    uid: 'user-1',
    attemptId: 'idem-finalize-stale',
    jobId: 'idem-finalize-stale',
    externalAttemptId: 'idem-finalize-stale',
    sessionId: 'story-finalize-stale',
    state: 'running',
    jobState: 'started',
    isActive: true,
    status: 202,
    createdAt: timestamp('2026-03-19T06:00:00.000Z'),
    updatedAt: timestamp('2026-03-19T06:00:01.000Z'),
    enqueuedAt: timestamp('2026-03-19T06:00:00.000Z'),
    startedAt: timestamp('2026-03-19T06:00:01.000Z'),
    expiresAt: timestamp('2026-03-19T07:00:00.000Z'),
    availableAfter: null,
    usageReservation: {
      estimatedSec: 8,
      reservedSec: 8,
    },
    currentExecution: {
      executionAttemptId: 'idem-finalize-stale:exec:1',
      attemptNumber: 1,
      state: 'running',
      workerId: 'lost-runner',
      createdAt: timestamp('2026-03-19T06:00:00.000Z'),
      claimedAt: timestamp('2026-03-19T06:00:01.000Z'),
      startedAt: timestamp('2026-03-19T06:00:01.000Z'),
      finishedAt: null,
      lease: {
        heartbeatAt: timestamp('2026-03-19T06:00:02.000Z'),
        expiresAt: timestamp(Date.now() - 1000),
      },
    },
    executionAttempts: [
      {
        executionAttemptId: 'idem-finalize-stale:exec:1',
        attemptNumber: 1,
        state: 'running',
        workerId: 'lost-runner',
        createdAt: timestamp('2026-03-19T06:00:00.000Z'),
        claimedAt: timestamp('2026-03-19T06:00:01.000Z'),
        startedAt: timestamp('2026-03-19T06:00:01.000Z'),
        finishedAt: null,
        lease: {
          heartbeatAt: timestamp('2026-03-19T06:00:02.000Z'),
          expiresAt: timestamp(Date.now() - 1000),
        },
      },
    ],
    runnerId: 'lost-runner',
    leaseHeartbeatAt: timestamp('2026-03-19T06:00:02.000Z'),
    leaseExpiresAt: timestamp(Date.now() - 1000),
  });
  seedFirestoreDoc('storyFinalizeSessions', 'user-1:story-finalize-stale', {
    flow: 'story.finalize',
    uid: 'user-1',
    sessionId: 'story-finalize-stale',
    attemptId: 'idem-finalize-stale',
    state: 'running',
    createdAt: timestamp('2026-03-19T06:00:00.000Z'),
    updatedAt: timestamp('2026-03-19T06:00:02.000Z'),
    expiresAt: timestamp('2026-03-19T07:00:00.000Z'),
  });

  startFinalizeWorkerRuntime();
  try {
    const first = await requestJson('/api/story/finalize', {
      method: 'POST',
      headers: {
        'X-Idempotency-Key': 'idem-finalize-stale',
        'x-client': 'mobile',
      },
      body: {
        sessionId: 'story-finalize-stale',
      },
    });
    assert.equal(first.status, 202);

    await waitFor(() => readDoc('idempotency', 'user-1:idem-finalize-stale')?.state === 'failed', {
      timeoutMs: 1000,
      intervalMs: 20,
    });

    const attemptDoc = readDoc('idempotency', 'user-1:idem-finalize-stale');
    assert.equal(attemptDoc.jobState, 'failed_terminal');
    assert.equal(attemptDoc.failure.error, 'FINALIZE_WORKER_LOST');
    assert.equal(attemptDoc.executionAttempts.length, 1);
    assert.equal(attemptDoc.executionAttempts[0].executionAttemptId, 'idem-finalize-stale:exec:1');
    assert.equal(attemptDoc.executionAttempts[0].state, 'abandoned');
    assert.equal(attemptDoc.currentExecution.executionAttemptId, 'idem-finalize-stale:exec:1');
    assert.equal(attemptDoc.currentExecution.state, 'abandoned');
    assert.equal(readDoc('storyFinalizeSessions', 'user-1:story-finalize-stale'), null);

    const usageDoc = readDoc('users', 'user-1');
    assert.equal(usageDoc.usage.cycleReservedSec, 0);

    const session = readStorySession('user-1', 'story-finalize-stale');
    assert.equal(session.renderRecovery.state, 'failed');
    assert.equal(session.renderRecovery.code, 'FINALIZE_WORKER_LOST');

    const replay = await requestJson('/api/story/finalize', {
      method: 'POST',
      headers: {
        'X-Idempotency-Key': 'idem-finalize-stale',
        'x-client': 'mobile',
      },
      body: {
        sessionId: 'story-finalize-stale',
      },
    });
    assert.equal(replay.status, 500);
    assert.equal(replay.json.success, false);
    assert.equal(replay.json.error, 'FINALIZE_WORKER_LOST');
  } finally {
    stopFinalizeWorkerRuntime('contract_finalize_stale_cleanup');
  }
});
