import assert from 'node:assert/strict';
import test from 'node:test';
import {
  invalidateDraftPreviewBase,
  prepareDraftPreviewRequest,
  sanitizeStorySessionForClient,
} from '../../src/services/story.service.js';

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

test('draftPreviewV1 omits playable artifact URL when stale', () => {
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

  invalidateDraftPreviewBase(session, 'CLIP_CHANGED');
  const safe = sanitizeStorySessionForClient(session);

  assert.equal(safe.draftPreviewV1.state, 'stale');
  assert.equal(safe.draftPreviewV1.artifact, undefined);
  assert.equal(safe.draftPreviewV1.fingerprint, undefined);
  assert.equal(safe.draftPreviewV1.previewId, undefined);
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
