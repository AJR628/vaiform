import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { compileCaptionSSOT } from '../../src/captions/compile.js';
import {
  buildStoryVideoCutsTimelinePlan,
  prepareDraftPreviewRequest,
  sanitizeStorySessionForClient,
} from '../../src/services/story.service.js';

function buildCaptionMeta(textRaw, style = {}) {
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
    textHash: crypto
      .createHash('sha256')
      .update(textRaw.trim().toLowerCase())
      .digest('hex')
      .slice(0, 16),
    maxWidthPx: compiled.maxWidthPx,
    totalTextH: compiled.totalTextH,
  };
}

function buildSession(overrides = {}) {
  return {
    id: 'story-test',
    uid: 'user-test',
    story: { sentences: ['Beat one', 'Beat two'] },
    shots: [
      {
        sentenceIndex: 0,
        selectedClip: {
          id: 'clip-a',
          url: 'https://cdn.example.com/a.mp4',
          thumbUrl: 'https://cdn.example.com/a.jpg',
        },
      },
      {
        sentenceIndex: 1,
        selectedClip: {
          id: 'clip-b',
          url: 'https://cdn.example.com/b.mp4',
          thumbUrl: 'https://cdn.example.com/b.jpg',
        },
      },
    ],
    captions: [
      { sentenceIndex: 0, text: 'Beat one', startTimeSec: 0, endTimeSec: 2 },
      { sentenceIndex: 1, text: 'Beat two', startTimeSec: 2, endTimeSec: 4 },
    ],
    overlayCaption: { placement: 'bottom', yPct: 0.78, fontPx: 72 },
    beats: [
      {
        narration: {
          fingerprint: 'beat-sync-story-test-0',
          durationSec: 2,
          audioStoragePath: 'artifacts/user-test/story-test/sync/beat-0.mp3',
          timingStoragePath: 'artifacts/user-test/story-test/sync/beat-0.json',
          syncedAt: '2026-01-01T00:00:00.000Z',
        },
      },
      {
        narration: {
          fingerprint: 'beat-sync-story-test-1',
          durationSec: 2,
          audioStoragePath: 'artifacts/user-test/story-test/sync/beat-1.mp3',
          timingStoragePath: 'artifacts/user-test/story-test/sync/beat-1.json',
          syncedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    ],
    voiceSync: {
      state: 'current',
      currentFingerprint: 'voice-fp',
      previewAudioUrl: 'https://cdn.example.com/preview.mp3',
      previewAudioStoragePath: 'artifacts/user-test/story-test/sync/voice-fp/preview.mp3',
      previewAudioDurationSec: 4,
    },
    ...overrides,
  };
}

function withEnv(patch) {
  const previous = {};
  for (const key of Object.keys(patch)) {
    previous[key] = process.env[key];
    if (patch[key] === undefined) delete process.env[key];
    else process.env[key] = patch[key];
  }
  return () => {
    for (const key of Object.keys(patch)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  };
}

test('old base renderer draftPreviewV1 projects stale and omits playable/private fields', () => {
  const session = buildSession({
    draftPreviewV1: {
      version: 1,
      state: 'ready',
      updatedAt: '2026-01-01T00:00:00.000Z',
      rendererVersion: 'base-preview-v1',
      fingerprint: 'private-fingerprint',
      previewId: 'preview-private',
      artifact: {
        url: 'https://cdn.example.com/base.mp4',
        storagePath: 'artifacts/user-test/story-test/previews/preview-private/base.mp4',
        contentType: 'video/mp4',
        durationSec: 4,
        width: 1080,
        height: 1920,
        createdAt: '2026-01-01T00:00:00.000Z',
        expiresAt: '2026-01-02T00:00:00.000Z',
      },
    },
  });

  const safe = sanitizeStorySessionForClient(session);

  assert.equal(safe.draftPreviewV1.state, 'stale');
  assert.equal(safe.draftPreviewV1.artifact, undefined);
  assert.equal(safe.draftPreviewV1.fingerprint, undefined);
  assert.equal(safe.draftPreviewV1.previewId, undefined);
});

test('old captioned renderer draftPreviewV1 projects stale after timing stabilization', () => {
  const safe = sanitizeStorySessionForClient(
    buildSession({
      draftPreviewV1: {
        version: 1,
        state: 'ready',
        updatedAt: '2026-01-01T00:00:00.000Z',
        rendererVersion: 'captioned-preview-v1',
        fingerprint: 'private-fingerprint',
        previewId: 'preview-private',
        artifact: {
          url: 'https://cdn.example.com/captioned.mp4',
          storagePath: 'artifacts/user-test/story-test/previews/preview-private/captioned.mp4',
          contentType: 'video/mp4',
          durationSec: 4,
          width: 1080,
          height: 1920,
          createdAt: '2026-01-01T00:00:00.000Z',
          expiresAt: '2026-01-02T00:00:00.000Z',
        },
      },
    })
  );

  assert.equal(safe.draftPreviewV1.state, 'stale');
  assert.equal(safe.draftPreviewV1.artifact, undefined);
  assert.equal(safe.draftPreviewV1.fingerprint, undefined);
  assert.equal(safe.draftPreviewV1.previewId, undefined);
});

test('captioned-preview-v1.1 draftPreviewV1 projects stale after visual topology renderer bump', () => {
  const safe = sanitizeStorySessionForClient(
    buildSession({
      draftPreviewV1: {
        version: 1,
        state: 'ready',
        updatedAt: '2026-01-01T00:00:00.000Z',
        rendererVersion: 'captioned-preview-v1.1',
        fingerprint: 'private-fingerprint',
        previewId: 'preview-private',
        artifact: {
          url: 'https://cdn.example.com/captioned.mp4',
          storagePath: 'artifacts/user-test/story-test/previews/preview-private/captioned.mp4',
          contentType: 'video/mp4',
          durationSec: 4,
          width: 1080,
          height: 1920,
          createdAt: '2026-01-01T00:00:00.000Z',
          expiresAt: '2026-01-02T00:00:00.000Z',
        },
      },
    })
  );

  assert.equal(safe.draftPreviewV1.state, 'stale');
  assert.equal(safe.draftPreviewV1.artifact, undefined);
  assert.equal(safe.draftPreviewV1.fingerprint, undefined);
  assert.equal(safe.draftPreviewV1.previewId, undefined);
});

test('captioned renderer draftPreviewV1 projects ready with mobile-safe artifact shape', () => {
  const safe = sanitizeStorySessionForClient(
    buildSession({
      draftPreviewV1: {
        version: 1,
        state: 'ready',
        updatedAt: '2026-01-01T00:00:00.000Z',
        rendererVersion: 'captioned-preview-v1.2',
        fingerprint: 'private-fingerprint',
        previewId: 'preview-private',
        artifact: {
          url: 'https://cdn.example.com/captioned.mp4',
          storagePath: 'artifacts/user-test/story-test/previews/preview-private/captioned.mp4',
          contentType: 'video/mp4',
          durationSec: 4,
          width: 1080,
          height: 1920,
          createdAt: '2026-01-01T00:00:00.000Z',
          expiresAt: '2026-01-02T00:00:00.000Z',
        },
      },
    })
  );

  assert.equal(safe.draftPreviewV1.state, 'ready');
  assert.deepEqual(safe.draftPreviewV1.artifact, {
    url: 'https://cdn.example.com/captioned.mp4',
    contentType: 'video/mp4',
    durationSec: 4,
    width: 1080,
    height: 1920,
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-02T00:00:00.000Z',
  });
  assert.equal(safe.draftPreviewV1.fingerprint, undefined);
  assert.equal(safe.draftPreviewV1.previewId, undefined);
  assert.equal(Object.hasOwn(safe.draftPreviewV1.artifact, 'storagePath'), false);
});

test('videoCutsV1 preview timeline uses global visual cuts and stored narration beat slices', () => {
  const restoreEnv = withEnv({ ENABLE_VIDEO_CUTS_V1: '1' });
  try {
    const session = buildSession({
      captions: [
        { sentenceIndex: 0, text: 'Beat one', startTimeSec: 0, endTimeSec: 10 },
        { sentenceIndex: 1, text: 'Beat two', startTimeSec: 10, endTimeSec: 20 },
      ],
      videoCutsV1Disabled: false,
      videoCutsV1: {
        version: 1,
        source: 'manual',
        boundaries: [{ leftBeat: 0, pos: { beatIndex: 1, pct: 0.5 } }],
      },
    });

    const prepared = prepareDraftPreviewRequest(session);
    const timelinePlan = buildStoryVideoCutsTimelinePlan({
      session,
      sentences: session.story.sentences,
      beatsDurSec: session.beats.map((beat) => beat.narration.durationSec),
    });

    assert.equal(prepared.ready, true);
    assert.equal(timelinePlan.useVideoCutsV1, true);
    assert.deepEqual(
      prepared.previewReadiness.segments.map((segment) => segment.durSec),
      [15, 5]
    );
    assert.deepEqual(
      timelinePlan.segments.map((segment) => segment.durSec),
      [3, 1]
    );
    assert.deepEqual(
      timelinePlan.beatSlices.map((slice) => ({
        beatIndex: slice.beatIndex,
        startSec: slice.startSec,
        endSec: slice.endSec,
        durationSec: slice.durationSec,
      })),
      [
        { beatIndex: 0, startSec: 0, endSec: 2, durationSec: 2 },
        { beatIndex: 1, startSec: 2, endSec: 4, durationSec: 2 },
      ]
    );
  } finally {
    restoreEnv();
  }
});

test('preview fingerprint changes when active videoCutsV1 visual topology changes', () => {
  const restoreEnv = withEnv({ ENABLE_VIDEO_CUTS_V1: '1' });
  try {
    const baseline = buildSession({
      captions: [
        { sentenceIndex: 0, text: 'Beat one', startTimeSec: 0, endTimeSec: 10 },
        { sentenceIndex: 1, text: 'Beat two', startTimeSec: 10, endTimeSec: 20 },
      ],
      videoCutsV1Disabled: false,
      videoCutsV1: {
        version: 1,
        source: 'manual',
        boundaries: [{ leftBeat: 0, pos: { beatIndex: 1, pct: 0.5 } }],
      },
    });
    const changed = JSON.parse(JSON.stringify(baseline));
    changed.videoCutsV1.boundaries[0].pos.pct = 0.25;

    const baselineReady = prepareDraftPreviewRequest(baseline);
    const changedReady = prepareDraftPreviewRequest(changed);

    assert.equal(baselineReady.ready, true);
    assert.equal(changedReady.ready, true);
    assert.notEqual(baselineReady.fingerprint, changedReady.fingerprint);
  } finally {
    restoreEnv();
  }
});

test('preview fingerprint changes when stored narration duration changes independently of captions', () => {
  const baseline = buildSession({
    captions: [
      { sentenceIndex: 0, text: 'Beat one', startTimeSec: 0, endTimeSec: 10 },
      { sentenceIndex: 1, text: 'Beat two', startTimeSec: 10, endTimeSec: 20 },
    ],
  });
  const changed = JSON.parse(JSON.stringify(baseline));
  changed.beats[0].narration.durationSec = 3.29;

  const baselineReady = prepareDraftPreviewRequest(baseline);
  const changedReady = prepareDraftPreviewRequest(changed);

  assert.equal(baselineReady.ready, true);
  assert.equal(changedReady.ready, true);
  assert.notEqual(baselineReady.fingerprint, changedReady.fingerprint);
});

test('preview fingerprint changes when overlay caption render style changes', () => {
  const baseline = prepareDraftPreviewRequest(buildSession());
  const changed = prepareDraftPreviewRequest(
    buildSession({
      overlayCaption: { placement: 'bottom', yPct: 0.78, fontPx: 84 },
    })
  );

  assert.equal(baseline.ready, true);
  assert.equal(changed.ready, true);
  assert.notEqual(baseline.fingerprint, changed.fingerprint);
});

test('preview fingerprint changes when persisted caption render meta changes', () => {
  const captionMeta = buildCaptionMeta('Beat one', {
    placement: 'bottom',
    yPct: 0.78,
    fontPx: 72,
  });
  const session = buildSession({
    beats: [
      {
        captionMeta,
        narration: {
          fingerprint: 'beat-sync-story-test-0',
          durationSec: 2,
          audioStoragePath: 'artifacts/user-test/story-test/sync/beat-0.mp3',
          timingStoragePath: 'artifacts/user-test/story-test/sync/beat-0.json',
          syncedAt: '2026-01-01T00:00:00.000Z',
        },
      },
      buildSession().beats[1],
    ],
  });
  const changed = JSON.parse(JSON.stringify(session));
  changed.beats[0].captionMeta.lines = ['Different persisted wrap'];

  const baselineReady = prepareDraftPreviewRequest(session);
  const changedReady = prepareDraftPreviewRequest(changed);

  assert.equal(baselineReady.ready, true);
  assert.equal(changedReady.ready, true);
  assert.notEqual(baselineReady.fingerprint, changedReady.fingerprint);
});

test('preview fingerprint ignores irrelevant non-render session fields', () => {
  const baseline = prepareDraftPreviewRequest(
    buildSession({ updatedAt: '2026-01-01T00:00:00.000Z' })
  );
  const changed = prepareDraftPreviewRequest(
    buildSession({ updatedAt: '2026-01-02T00:00:00.000Z' })
  );

  assert.equal(baseline.ready, true);
  assert.equal(changed.ready, true);
  assert.equal(baseline.fingerprint, changed.fingerprint);
});

test('prepareDraftPreviewRequest reuses current ready preview with same fingerprint', () => {
  const session = buildSession();
  const prepared = prepareDraftPreviewRequest(session);
  session.draftPreviewV1 = {
    version: 1,
    state: 'ready',
    updatedAt: '2026-01-01T00:00:00.000Z',
    rendererVersion: 'captioned-preview-v1.2',
    fingerprint: prepared.fingerprint,
    previewId: 'preview-private',
    artifact: {
      url: 'https://cdn.example.com/captioned.mp4',
      storagePath: 'artifacts/user-test/story-test/previews/preview-private/captioned.mp4',
      contentType: 'video/mp4',
      durationSec: 4,
      width: 1080,
      height: 1920,
      createdAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-02T00:00:00.000Z',
    },
  };

  const reused = prepareDraftPreviewRequest(session);

  assert.equal(reused.ready, true);
  assert.equal(reused.alreadyReady, true);
  assert.equal(reused.fingerprint, prepared.fingerprint);
});

test('captionOverlayV1 is a mobile-safe computed projection without token timing', () => {
  const safe = sanitizeStorySessionForClient(buildSession());

  assert.equal(safe.captionOverlayV1.version, 1);
  assert.equal(safe.captionOverlayV1.rendererVersion, 'caption-overlay-v1');
  assert.deepEqual(safe.captionOverlayV1.frame, { width: 1080, height: 1920 });
  assert.equal(safe.captionOverlayV1.segments.length, 2);
  assert.equal(Object.hasOwn(safe.captionOverlayV1.segments[0], 'tokens'), false);
});

test('prepareDraftPreviewRequest blocks missing clip coverage and returns private fingerprint only internally', () => {
  const blocked = prepareDraftPreviewRequest(
    buildSession({
      shots: [{ sentenceIndex: 0, selectedClip: { url: 'https://cdn.example.com/a.mp4' } }],
    })
  );
  assert.equal(blocked.ready, false);
  assert.equal(blocked.blockedState.blocked.reasonCode, 'MISSING_CLIP_COVERAGE');

  const ready = prepareDraftPreviewRequest(buildSession());
  assert.equal(ready.ready, true);
  assert.equal(typeof ready.fingerprint, 'string');
});

test('prepareDraftPreviewRequest blocks missing per-beat narration artifacts safely', () => {
  const blocked = prepareDraftPreviewRequest(
    buildSession({
      beats: [
        {
          narration: {
            fingerprint: 'beat-sync-story-test-0',
            durationSec: 2,
            syncedAt: '2026-01-01T00:00:00.000Z',
          },
        },
        {
          narration: {
            fingerprint: 'beat-sync-story-test-1',
            durationSec: 2,
            audioStoragePath: 'artifacts/user-test/story-test/sync/beat-1.mp3',
            timingStoragePath: 'artifacts/user-test/story-test/sync/beat-1.json',
            syncedAt: '2026-01-01T00:00:00.000Z',
          },
        },
      ],
    })
  );

  assert.equal(blocked.ready, false);
  assert.equal(blocked.blockedState.blocked.reasonCode, 'VOICE_SYNC_ARTIFACT_MISSING');
  assert.deepEqual(blocked.blockedState.blocked.missingBeatIndices, [0]);
});
