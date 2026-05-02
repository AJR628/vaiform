/* eslint-disable no-irregular-whitespace */
/**
 * Story-based video pipeline service
 * Orchestrates: input Ã¢â€ â€™ story Ã¢â€ â€™ visual plan Ã¢â€ â€™ stock search Ã¢â€ â€™ timeline Ã¢â€ â€™ render
 */

import crypto from 'node:crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { loadJSON, saveJSON } from '../utils/json.store.js';
import { generateStoryFromInput, planVisualShots } from './story.llm.service.js';
import { pexelsSearchVideos } from './pexels.videos.provider.js';
import { pixabaySearchVideos } from './pixabay.videos.provider.js';
import { nasaSearchVideos } from './nasa.videos.provider.js';
import {
  concatenateAudioFiles,
  concatenateClips,
  concatenateClipsVideoOnly,
  trimClipToSegment,
  extractSegmentFromFile,
  fetchClipsToTmp,
} from '../utils/ffmpeg.timeline.js';
import { renderVideoQuoteOverlay } from '../utils/ffmpeg.video.js';
import { fetchVideoToTmp } from '../utils/video.fetch.js';
import { uploadPublic } from '../utils/storage.js';
import {
  calculateReadingDuration,
  calculateBillingSpeechDuration,
} from '../utils/text.duration.js';
import admin from '../config/firebase.js';
import { extractCoverJpeg } from '../utils/ffmpeg.cover.js';
import { getDurationMsFromMedia } from '../utils/media.duration.js';
import { synthVoiceWithTimestamps } from './tts.service.js';
import { VOICE_PRESETS, getVoicePreset } from '../constants/voice.presets.js';
import { buildKaraokeASSFromTimestamps } from '../utils/karaoke.ass.js';
import { wrapTextWithFont } from '../utils/caption.wrap.js';
import { deriveCaptionWrapWidthPx } from '../utils/caption.wrapWidth.js';
import { extractStyleOnly } from '../utils/caption-style-helper.js';
import { compileCaptionSSOT } from '../captions/compile.js';
import logger from '../observability/logger.js';
import {
  FINALIZE_EVENTS,
  FINALIZE_STAGES,
  emitFinalizeEvent,
  withFinalizeStage,
} from '../observability/finalize-observability.js';
import { getRuntimeOverride } from '../testing/runtime-overrides.js';
import { withRenderSlot } from '../utils/render.semaphore.js';
import {
  billingMsToSeconds,
  computeRenderChargeMs,
  computeSyncChargeMs,
  secondsToBillingMs,
} from './usage.service.js';
import {
  acquireFinalizeStorySearchAdmission,
  getFinalizeProviderRetryAfterSec,
  isFinalizeStorySearchProviderCooldownActive,
  markFinalizeStorySearchProviderSuccess,
  markFinalizeStorySearchProviderTransientFailure,
  releaseFinalizeStorySearchAdmission,
  withSharedFinalizeRenderLease,
} from './finalize-control.service.js';

const TTL_HOURS = Number(process.env.STORY_TTL_HOURS || 48);
const BILLING_ESTIMATE_HEURISTIC_PAD_SEC = Math.max(
  0,
  Number(process.env.BILLING_ESTIMATE_HEURISTIC_PAD_SEC || 2)
);
const BILLING_ESTIMATE_PER_BEAT_BASE_SEC = Math.max(
  0,
  Number(process.env.BILLING_ESTIMATE_PER_BEAT_BASE_SEC || 0.5)
);
const BILLING_ESTIMATE_PER_BEAT_MIN_SEC = Math.max(
  0,
  Number(process.env.BILLING_ESTIMATE_PER_BEAT_MIN_SEC || 1)
);
const BILLING_ESTIMATE_BEAT_BOUNDARY_PAD_SEC = Math.max(
  0,
  Number(process.env.BILLING_ESTIMATE_BEAT_BOUNDARY_PAD_SEC || 0.2)
);
const BILLING_ESTIMATE_BEAT_BOUNDARY_PAD_MAX_SEC = Math.max(
  0,
  Number(process.env.BILLING_ESTIMATE_BEAT_BOUNDARY_PAD_MAX_SEC || 1.4)
);

// Manual script mode constants
export const MAX_BEATS = 8;
export const MAX_BEAT_CHARS = 160;
export const MAX_TOTAL_CHARS = 850;
const STORY_SEARCH_RETRY_AFTER_SEC = 15;
const MAX_CONCURRENT_STORY_SEARCH_REQUESTS = 2;
const SEARCH_PROVIDER_FAILURE_THRESHOLD = 2;
const SEARCH_PROVIDER_COOLDOWN_MS = 60_000;
let activeStorySearchRequests = 0;
const providerSearchHealth = new Map();
const VOICE_SYNC_SCHEMA_VERSION = 1;
const VOICE_PACE_PRESET_DEFAULT = 'normal';
const DEFAULT_VOICE_PRESET_KEY = 'male_calm';
const SYNC_PREVIEW_CONTENT_TYPE = 'audio/mpeg';
const SYNC_AUDIO_CONTENT_TYPE = 'audio/mpeg';
const SYNC_TIMING_CONTENT_TYPE = 'application/json';
const DRAFT_PREVIEW_SCHEMA_VERSION = 1;
const DRAFT_PREVIEW_RENDERER_VERSION = 'captioned-preview-v1.2';
const DRAFT_PREVIEW_CONTENT_TYPE = 'video/mp4';
const DRAFT_PREVIEW_WIDTH = 1080;
const DRAFT_PREVIEW_HEIGHT = 1920;
const DRAFT_PREVIEW_FPS = 24;
const DRAFT_PREVIEW_CACHE_CONTROL = 'private,max-age=300';
const CAPTION_OVERLAY_SCHEMA_VERSION = 1;
const CAPTION_OVERLAY_CONTRACT_VERSION = 'caption-overlay-v1';
const CAPTION_OVERLAY_RENDERER_VERSION = 'caption-overlay-v1';

function previewFingerprintPrefix(fingerprint) {
  return typeof fingerprint === 'string' && fingerprint.length > 0
    ? fingerprint.slice(0, 12)
    : null;
}

function safeJsonClone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function normalizeVoiceSyncState(state) {
  return state === 'current' || state === 'stale' || state === 'syncing' ? state : 'never_synced';
}

function buildDefaultVoiceSync() {
  return {
    schemaVersion: VOICE_SYNC_SCHEMA_VERSION,
    state: 'never_synced',
    requiredForRender: true,
    staleScope: 'full',
    staleBeatIndices: [],
    currentFingerprint: null,
    nextEstimatedChargeSec: null,
    totalDurationSec: null,
    previewAudioUrl: null,
    previewAudioStoragePath: null,
    previewAudioDurationSec: null,
    lastChargeSec: null,
    totalBilledSec: 0,
    lastSyncedAt: null,
    cached: false,
  };
}

function safeVoiceOptions() {
  return Object.entries(VOICE_PRESETS).map(([key, preset]) => ({
    key,
    name: preset.name,
    gender: preset.gender,
    emotion: preset.emotion,
  }));
}

function normalizeVoiceSyncBeatIndices(indices, sentenceCount = 0) {
  if (!Array.isArray(indices) || indices.length === 0) return [];
  const maxIndex = Math.max(0, Number(sentenceCount) - 1);
  const unique = new Set();
  for (const raw of indices) {
    const index = Number(raw);
    if (!Number.isInteger(index) || index < 0 || index > maxIndex) continue;
    unique.add(index);
  }
  return Array.from(unique).sort((a, b) => a - b);
}

function normalizeVoiceSyncSummary(session) {
  const current =
    session?.voiceSync && typeof session.voiceSync === 'object'
      ? session.voiceSync
      : buildDefaultVoiceSync();
  const sentenceCount = Array.isArray(session?.story?.sentences)
    ? session.story.sentences.length
    : 0;
  return {
    ...buildDefaultVoiceSync(),
    ...current,
    schemaVersion: VOICE_SYNC_SCHEMA_VERSION,
    state: normalizeVoiceSyncState(current.state),
    requiredForRender: true,
    staleScope:
      current.staleScope === 'beat' || current.staleScope === 'none' ? current.staleScope : 'full',
    staleBeatIndices: normalizeVoiceSyncBeatIndices(current.staleBeatIndices, sentenceCount),
    nextEstimatedChargeSec: (() => {
      const value = Number(current.nextEstimatedChargeSec);
      return Number.isFinite(value) && value >= 0
        ? billingMsToSeconds(secondsToBillingMs(value))
        : null;
    })(),
    totalDurationSec: (() => {
      const value = Number(current.totalDurationSec);
      return Number.isFinite(value) && value > 0
        ? billingMsToSeconds(secondsToBillingMs(value))
        : null;
    })(),
    previewAudioDurationSec: (() => {
      const value = Number(current.previewAudioDurationSec);
      return Number.isFinite(value) && value > 0
        ? billingMsToSeconds(secondsToBillingMs(value))
        : null;
    })(),
    lastChargeSec: (() => {
      const value = Number(current.lastChargeSec);
      return Number.isFinite(value) && value >= 0
        ? billingMsToSeconds(secondsToBillingMs(value))
        : null;
    })(),
    totalBilledSec: (() => {
      const value = Number(current.totalBilledSec);
      return Number.isFinite(value) && value >= 0
        ? billingMsToSeconds(secondsToBillingMs(value))
        : 0;
    })(),
  };
}

function isVoiceSyncCurrent(session) {
  return normalizeVoiceSyncSummary(session).state === 'current';
}

function estimateScopeDurationMs(sentences = [], indices = []) {
  if (
    !Array.isArray(sentences) ||
    sentences.length === 0 ||
    !Array.isArray(indices) ||
    indices.length === 0
  ) {
    return 0;
  }
  let totalMs = 0;
  for (const index of indices) {
    const sentence = normalizeNarrationText(sentences[index]);
    if (!sentence) continue;
    const durationSec = calculateBillingSpeechDuration(sentence, {
      baseTime: 2,
      minDuration: 2,
      roundTo: 0,
    });
    totalMs += secondsToBillingMs(durationSec);
  }
  return totalMs;
}

function buildSyncBillingEstimate(session, heuristicEstimate) {
  const normalizedSync = normalizeVoiceSyncSummary(session);
  if (normalizedSync.state === 'current' && Number(normalizedSync.totalDurationSec) > 0) {
    const durationMs = secondsToBillingMs(normalizedSync.totalDurationSec);
    return {
      estimatedSec: billingMsToSeconds(computeRenderChargeMs(durationMs)),
      source: 'synced_render_duration',
      computedAt: new Date().toISOString(),
      heuristicEstimatedSec: heuristicEstimate?.estimatedSec ?? null,
      heuristicSource: heuristicEstimate?.source ?? null,
      heuristicComputedAt: heuristicEstimate?.computedAt ?? null,
    };
  }

  return {
    estimatedSec: null,
    source: 'voice_sync_required',
    computedAt: new Date().toISOString(),
    heuristicEstimatedSec: heuristicEstimate?.estimatedSec ?? null,
    heuristicSource: heuristicEstimate?.source ?? null,
    heuristicComputedAt: heuristicEstimate?.computedAt ?? null,
  };
}

function deriveSessionEditingStatus(session) {
  if (session?.finalVideo) return 'rendered';
  if (normalizeVoiceSyncSummary(session).state === 'current') return 'voice_synced';
  if (Array.isArray(session?.shots) && session.shots.some((shot) => shot?.selectedClip?.url)) {
    return 'clips_searched';
  }
  if (Array.isArray(session?.plan) && session.plan.length > 0) return 'planned';
  if (Array.isArray(session?.story?.sentences) && session.story.sentences.length > 0) {
    return 'story_generated';
  }
  return session?.status || 'draft';
}

function invalidateRenderedOutput(session, nextStatus = null) {
  if (!session || typeof session !== 'object') return session;
  delete session.finalVideo;
  delete session.renderedSegments;
  delete session.renderRecovery;
  invalidateDraftPreviewBase(session, 'BASE_INPUT_CHANGED');
  session.status = nextStatus || deriveSessionEditingStatus(session);
  return session;
}

function normalizeDraftPreviewState(state) {
  return ['not_requested', 'blocked', 'queued', 'running', 'ready', 'failed', 'stale'].includes(
    state
  )
    ? state
    : 'not_requested';
}

export function invalidateDraftPreviewBase(session, reasonCode = 'BASE_INPUT_CHANGED') {
  if (!session || typeof session !== 'object') return session;
  const current = session.draftPreviewV1;
  const now = new Date().toISOString();
  const staleArtifactStoragePaths = Array.isArray(current?.staleArtifactStoragePaths)
    ? current.staleArtifactStoragePaths.filter(Boolean)
    : [];
  if (current?.artifact?.storagePath) {
    staleArtifactStoragePaths.push(current.artifact.storagePath);
  }
  session.draftPreviewV1 = {
    version: DRAFT_PREVIEW_SCHEMA_VERSION,
    state: 'stale',
    updatedAt: now,
    rendererVersion: DRAFT_PREVIEW_RENDERER_VERSION,
    staleReasonCode: reasonCode,
    staleArtifactStoragePaths: Array.from(new Set(staleArtifactStoragePaths)).slice(-10),
  };
  return session;
}

function buildMobileDraftPreviewProjection(session) {
  const preview = session?.draftPreviewV1;
  const state = normalizeDraftPreviewState(preview?.state);
  const rendererMatches = preview?.rendererVersion === DRAFT_PREVIEW_RENDERER_VERSION;
  const projectedState = state === 'ready' && !rendererMatches ? 'stale' : state;
  const projection = {
    version: DRAFT_PREVIEW_SCHEMA_VERSION,
    state: projectedState,
    updatedAt: preview?.updatedAt ?? session?.updatedAt ?? null,
  };

  if (projectedState === 'ready' && preview?.artifact?.url) {
    projection.artifact = {
      url: preview.artifact.url,
      contentType: preview.artifact.contentType || DRAFT_PREVIEW_CONTENT_TYPE,
      durationSec: Number.isFinite(Number(preview.artifact.durationSec))
        ? Number(preview.artifact.durationSec)
        : null,
      width: Number.isFinite(Number(preview.artifact.width))
        ? Number(preview.artifact.width)
        : DRAFT_PREVIEW_WIDTH,
      height: Number.isFinite(Number(preview.artifact.height))
        ? Number(preview.artifact.height)
        : DRAFT_PREVIEW_HEIGHT,
      createdAt: preview.artifact.createdAt ?? null,
      expiresAt: preview.artifact.expiresAt ?? null,
    };
  }

  if (projectedState === 'blocked' && preview?.blocked) {
    projection.blocked = {
      reasonCode: preview.blocked.reasonCode || 'PREVIEW_BLOCKED',
      missingBeatIndices: Array.isArray(preview.blocked.missingBeatIndices)
        ? preview.blocked.missingBeatIndices
        : [],
    };
  }

  if (['queued', 'running'].includes(projectedState) && preview?.job) {
    projection.job = {
      state: preview.job.state || projectedState,
      attemptId: preview.job.attemptId || null,
      retryAfterSec: Number.isFinite(Number(preview.job.retryAfterSec))
        ? Number(preview.job.retryAfterSec)
        : null,
    };
  }

  if (projectedState === 'failed' && preview?.error) {
    projection.error = {
      code: preview.error.code || 'DRAFT_PREVIEW_FAILED',
      message: preview.error.message || 'Failed to generate preview.',
    };
  }

  return projection;
}

function buildCaptionOverlayProjection(session) {
  const captions = Array.isArray(session?.captions) ? session.captions : [];
  const style = extractStyleOnly(session?.overlayCaption || session?.captionStyle || {});
  const segments = captions
    .map((caption) => {
      const beatIndex = Number(caption?.sentenceIndex);
      const startSec = Number(caption?.startTimeSec);
      const endSec = Number(caption?.endTimeSec);
      const text = typeof caption?.text === 'string' ? caption.text : '';
      if (!Number.isFinite(beatIndex) || !Number.isFinite(startSec) || !Number.isFinite(endSec)) {
        return null;
      }
      return {
        beatIndex,
        startSec,
        endSec,
        text,
      };
    })
    .filter(Boolean);

  return {
    version: CAPTION_OVERLAY_SCHEMA_VERSION,
    contractVersion: CAPTION_OVERLAY_CONTRACT_VERSION,
    rendererVersion: CAPTION_OVERLAY_RENDERER_VERSION,
    frame: {
      width: DRAFT_PREVIEW_WIDTH,
      height: DRAFT_PREVIEW_HEIGHT,
    },
    placement: style.placement || 'bottom',
    style,
    segments,
  };
}

function updateVoiceSyncEstimate(session) {
  const sentences = Array.isArray(session?.story?.sentences) ? session.story.sentences : [];
  const voiceSync = normalizeVoiceSyncSummary(session);
  let scopeIndices = [];
  if (voiceSync.state === 'never_synced' || voiceSync.staleScope === 'full') {
    scopeIndices = sentences.map((_, index) => index);
  } else if (voiceSync.staleScope === 'beat') {
    scopeIndices = voiceSync.staleBeatIndices;
  }

  const estimatedDurationMs = estimateScopeDurationMs(sentences, scopeIndices);
  voiceSync.nextEstimatedChargeSec =
    estimatedDurationMs > 0 ? billingMsToSeconds(computeSyncChargeMs(estimatedDurationMs)) : null;
  if (voiceSync.state === 'current') {
    voiceSync.staleScope = 'none';
    voiceSync.staleBeatIndices = [];
  }
  session.voiceSync = voiceSync;
  return session;
}

function markVoiceSyncStale(session, { scope = 'full', beatIndices = [] } = {}) {
  const voiceSync = normalizeVoiceSyncSummary(session);
  if (voiceSync.state === 'never_synced') {
    voiceSync.staleScope = 'full';
    voiceSync.staleBeatIndices = [];
  } else if (scope === 'full') {
    voiceSync.state = 'stale';
    voiceSync.staleScope = 'full';
    voiceSync.staleBeatIndices = [];
  } else {
    const merged = new Set(voiceSync.staleScope === 'beat' ? voiceSync.staleBeatIndices : []);
    for (const index of beatIndices) merged.add(index);
    voiceSync.state = 'stale';
    voiceSync.staleScope = 'beat';
    voiceSync.staleBeatIndices = normalizeVoiceSyncBeatIndices(
      Array.from(merged),
      session?.story?.sentences?.length ?? 0
    );
  }
  voiceSync.cached = false;
  session.voiceSync = voiceSync;
  invalidateRenderedOutput(session);
  return updateVoiceSyncEstimate(session);
}

function resetVoiceSyncForNewScript(session) {
  session.voiceSync = buildDefaultVoiceSync();
  invalidateRenderedOutput(
    session,
    Array.isArray(session?.story?.sentences) ? 'story_generated' : 'draft'
  );
  return updateVoiceSyncEstimate(session);
}

function buildStorageObjectPath({ uid, sessionId, fingerprint, ext }) {
  return `drafts/${uid}/${sessionId}/sync/v${VOICE_SYNC_SCHEMA_VERSION}/beats/${fingerprint}.${ext}`;
}

async function savePrivateObject({ bucketPath, body, contentType }) {
  const bucket = admin.storage().bucket();
  const file = bucket.file(bucketPath);
  await file.save(body, {
    contentType,
    resumable: false,
    validation: false,
    metadata: { cacheControl: 'no-store' },
  });
  return { storagePath: bucketPath };
}

async function uploadPrivateLocalFile({ localPath, bucketPath, contentType }) {
  const bucket = admin.storage().bucket();
  await bucket.upload(localPath, {
    destination: bucketPath,
    resumable: false,
    validation: false,
    metadata: {
      contentType,
      cacheControl: 'no-store',
    },
  });
  return { storagePath: bucketPath };
}

async function downloadPrivateObjectToTmp({ bucketPath, tmpDir, name }) {
  const bucket = admin.storage().bucket();
  const localPath = path.join(tmpDir, name);
  await bucket.file(bucketPath).download({ destination: localPath });
  return localPath;
}

async function readPrivateJson(bucketPath) {
  const bucket = admin.storage().bucket();
  const [buf] = await bucket.file(bucketPath).download();
  return JSON.parse(buf.toString('utf8'));
}

function hashStableValue(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function resolvedVoicePresetKey(key) {
  return typeof key === 'string' && VOICE_PRESETS[key] ? key : DEFAULT_VOICE_PRESET_KEY;
}

function resolvedVoicePacePreset(key) {
  return typeof key === 'string' && key.trim().length > 0 ? key.trim() : VOICE_PACE_PRESET_DEFAULT;
}

function resolveVoiceFingerprintPayload({ voicePresetKey, voicePacePreset }) {
  const normalizedPresetKey = resolvedVoicePresetKey(voicePresetKey);
  const normalizedPacePreset = resolvedVoicePacePreset(voicePacePreset);
  const preset = getVoicePreset(normalizedPresetKey);
  return {
    voicePresetKey: normalizedPresetKey,
    voicePacePreset: normalizedPacePreset,
    voiceId: preset.voiceId,
    voiceSettings: preset.voiceSettings,
    modelId: process.env.ELEVEN_TTS_MODEL || 'eleven_flash_v2_5',
  };
}

function buildBeatVoiceFingerprint({ text, voice }) {
  return hashStableValue({
    schemaVersion: VOICE_SYNC_SCHEMA_VERSION,
    text: normalizeNarrationText(text),
    voice,
  });
}

function buildFullVoiceFingerprint(beatFingerprints = [], voice = {}) {
  return hashStableValue({
    schemaVersion: VOICE_SYNC_SCHEMA_VERSION,
    voice,
    beatFingerprints,
  });
}

function buildVoiceSyncPlan(session, { mode = 'stale', voicePreset, voicePacePreset } = {}) {
  const storySentences = Array.isArray(session?.story?.sentences) ? session.story.sentences : [];
  const normalizedVoice = resolveVoiceFingerprintPayload({
    voicePresetKey: voicePreset || session?.voicePreset || DEFAULT_VOICE_PRESET_KEY,
    voicePacePreset: voicePacePreset || session?.voicePacePreset || VOICE_PACE_PRESET_DEFAULT,
  });
  const existingVoiceSync = normalizeVoiceSyncSummary(session);
  const beatFingerprints = storySentences.map((text) =>
    buildBeatVoiceFingerprint({
      text,
      voice: normalizedVoice,
    })
  );
  const fullFingerprint = buildFullVoiceFingerprint(beatFingerprints, normalizedVoice);
  const voiceChanged =
    normalizedVoice.voicePresetKey !== resolvedVoicePresetKey(session?.voicePreset) ||
    normalizedVoice.voicePacePreset !== resolvedVoicePacePreset(session?.voicePacePreset);

  let scope =
    mode === 'full' || voiceChanged || existingVoiceSync.state === 'never_synced' ? 'full' : 'beat';
  let targetIndices =
    scope === 'full'
      ? storySentences.map((_, index) => index)
      : normalizeVoiceSyncBeatIndices(existingVoiceSync.staleBeatIndices, storySentences.length);
  if (targetIndices.length === 0 && scope === 'beat') {
    scope = 'full';
    targetIndices = storySentences.map((_, index) => index);
  }

  const matchesStoredFingerprint =
    fullFingerprint === existingVoiceSync.currentFingerprint && !voiceChanged;
  const nextEstimatedChargeSec = matchesStoredFingerprint
    ? 0
    : targetIndices.length > 0
      ? billingMsToSeconds(
          computeSyncChargeMs(estimateScopeDurationMs(storySentences, targetIndices))
        )
      : 0;

  return {
    scope,
    targetIndices,
    beatFingerprints,
    fullFingerprint,
    voice: normalizedVoice,
    matchesStoredFingerprint,
    nextEstimatedChargeSec,
  };
}

function ensureTimestampCapableVoiceSync() {
  const provider = (process.env.TTS_PROVIDER || 'openai').toLowerCase();
  if (provider !== 'elevenlabs' || !process.env.ELEVENLABS_API_KEY) {
    const error = new Error('VOICE_SYNC_TIMESTAMPS_UNAVAILABLE');
    error.code = 'VOICE_SYNC_TIMESTAMPS_UNAVAILABLE';
    error.status = 503;
    throw error;
  }
}

/**
 * Ensure session has default structure
 */
function ensureSessionDefaults(session) {
  if (!session.id) session.id = `story-${crypto.randomUUID()}`;
  if (!session.uid) throw new Error('UID_REQUIRED');
  if (!session.input) session.input = { text: '', type: 'paragraph' };
  if (!session.createdAt) session.createdAt = new Date().toISOString();
  if (!session.updatedAt) session.updatedAt = new Date().toISOString();
  if (!session.voicePreset) {
    session.voicePreset = DEFAULT_VOICE_PRESET_KEY;
  }
  if (!session.voicePacePreset) {
    session.voicePacePreset = VOICE_PACE_PRESET_DEFAULT;
  }
  if (!Array.isArray(session.beats)) {
    session.beats = [];
  }
  session.voiceSync = normalizeVoiceSyncSummary(session);

  // Set expiration
  if (!session.expiresAt) {
    const created = Date.parse(session.createdAt);
    session.expiresAt = new Date(created + TTL_HOURS * 3600 * 1000).toISOString();
  }

  updateVoiceSyncEstimate(session);
  return session;
}

function createRetryableStoryError(code, detail, retryAfter = STORY_SEARCH_RETRY_AFTER_SEC) {
  const error = new Error(detail);
  error.code = code;
  error.status = 503;
  error.retryAfter = retryAfter;
  return error;
}

async function withStorySearchAdmission(fn) {
  const sharedAdmission = await acquireFinalizeStorySearchAdmission();
  const sharedControlled = sharedAdmission?.bypassed !== true;
  if (sharedControlled && sharedAdmission?.acquired !== true) {
    throw createRetryableStoryError(
      'STORY_SEARCH_BUSY',
      'Story search is busy. Please retry shortly.',
      getFinalizeProviderRetryAfterSec(sharedAdmission, STORY_SEARCH_RETRY_AFTER_SEC)
    );
  }
  if (activeStorySearchRequests >= MAX_CONCURRENT_STORY_SEARCH_REQUESTS) {
    if (sharedControlled) {
      await releaseFinalizeStorySearchAdmission().catch(() => false);
    }
    throw createRetryableStoryError(
      'STORY_SEARCH_BUSY',
      'Story search is busy. Please retry shortly.'
    );
  }

  activeStorySearchRequests += 1;
  try {
    return await fn();
  } finally {
    activeStorySearchRequests -= 1;
    if (sharedControlled) {
      await releaseFinalizeStorySearchAdmission().catch(() => false);
    }
  }
}

function resetProviderSearchHealth(provider) {
  providerSearchHealth.delete(provider);
}

function markProviderTransientFailure(provider) {
  const current = providerSearchHealth.get(provider) || { failures: 0, cooldownUntil: 0 };
  const failures = current.failures + 1;
  const cooldownUntil =
    failures >= SEARCH_PROVIDER_FAILURE_THRESHOLD ? Date.now() + SEARCH_PROVIDER_COOLDOWN_MS : 0;
  providerSearchHealth.set(provider, { failures, cooldownUntil });
}

function isProviderCooldownActive(provider) {
  const state = providerSearchHealth.get(provider);
  return Boolean(state?.cooldownUntil && state.cooldownUntil > Date.now());
}

function isTransientProviderResult(result) {
  if (!result) return false;
  if (result.transient === true) return true;
  const reason = String(result.reason || '').toUpperCase();
  if (reason === 'TIMEOUT' || reason === 'ERROR' || reason === 'COOLDOWN_ACTIVE') {
    return true;
  }
  if (reason === 'ASSET_UNAVAILABLE') {
    return true;
  }
  const httpMatch = reason.match(/^HTTP_(\d{3})$/);
  if (!httpMatch) return false;
  const status = Number(httpMatch[1]);
  return status === 429 || status >= 500;
}

async function callProviderSearch(provider, run, { consulted = true } = {}) {
  if (!consulted) {
    return {
      provider,
      ok: false,
      reason: 'SKIPPED',
      items: [],
      nextPage: null,
      consulted: false,
      transient: false,
    };
  }

  if (
    (await isFinalizeStorySearchProviderCooldownActive(provider)) ||
    isProviderCooldownActive(provider)
  ) {
    return {
      provider,
      ok: false,
      reason: 'COOLDOWN_ACTIVE',
      items: [],
      nextPage: null,
      consulted: true,
      transient: true,
    };
  }

  try {
    const result = await run();
    const normalized = {
      provider,
      ok: Boolean(result?.ok),
      reason: result?.reason || 'UNKNOWN',
      items: Array.isArray(result?.items) ? result.items : [],
      nextPage: result?.nextPage ?? null,
      consulted: result?.reason !== 'NOT_CONFIGURED',
      transient: Boolean(result?.transient),
    };
    normalized.transient = isTransientProviderResult(normalized);

    if (normalized.ok || !normalized.transient) {
      resetProviderSearchHealth(provider);
      await markFinalizeStorySearchProviderSuccess(provider);
    } else {
      markProviderTransientFailure(provider);
      await markFinalizeStorySearchProviderTransientFailure(provider, normalized.reason);
    }

    return normalized;
  } catch (error) {
    markProviderTransientFailure(provider);
    await markFinalizeStorySearchProviderTransientFailure(provider, error?.code || 'ERROR');
    return {
      provider,
      ok: false,
      reason: error?.code || 'ERROR',
      items: [],
      nextPage: null,
      consulted: true,
      transient: true,
    };
  }
}

function totalCaptionTimelineSec(session) {
  if (!Array.isArray(session?.captions) || session.captions.length === 0) return null;
  let maxEnd = null;
  for (const caption of session.captions) {
    const end = Number(caption?.endTimeSec);
    if (!Number.isFinite(end) || end <= 0) continue;
    maxEnd = maxEnd == null ? end : Math.max(maxEnd, end);
  }
  return maxEnd;
}

function totalShotDurationSec(session) {
  const shots =
    Array.isArray(session?.shots) && session.shots.length > 0 ? session.shots : session?.plan;
  if (!Array.isArray(shots) || shots.length === 0) return null;
  let total = 0;
  let count = 0;
  for (const shot of shots) {
    const durationSec = Number(shot?.durationSec);
    if (!Number.isFinite(durationSec) || durationSec <= 0) continue;
    total += durationSec;
    count += 1;
  }
  return count > 0 ? total : null;
}

function normalizeNarrationText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getNormalizedNarrationSentences(session) {
  const sentences = session?.story?.sentences;
  if (!Array.isArray(sentences) || sentences.length === 0) return [];
  return sentences
    .map((sentence) => normalizeNarrationText(sentence))
    .filter((sentence) => sentence.length > 0);
}

function getNormalizedNarrationScript(session) {
  return normalizeNarrationText(getNormalizedNarrationSentences(session).join(' '));
}

function validateStoryCharacterLimits(sentences = []) {
  const normalizedSentences = Array.isArray(sentences)
    ? sentences.map((sentence) => normalizeNarrationText(sentence))
    : [];

  for (const sentence of normalizedSentences) {
    if (!sentence) {
      const error = new Error('INVALID_SENTENCE_TEXT');
      error.code = 'INVALID_SENTENCE_TEXT';
      error.status = 400;
      throw error;
    }
  }

  if (normalizedSentences.length > MAX_BEATS) {
    const error = new Error('MAX_BEATS_EXCEEDED');
    error.code = 'MAX_BEATS_EXCEEDED';
    error.status = 400;
    throw error;
  }

  for (const sentence of normalizedSentences) {
    if (sentence.length > MAX_BEAT_CHARS) {
      const error = new Error('MAX_BEAT_CHARS_EXCEEDED');
      error.code = 'MAX_BEAT_CHARS_EXCEEDED';
      error.status = 400;
      throw error;
    }
  }

  const totalChars = normalizedSentences.join('').length;
  if (totalChars > MAX_TOTAL_CHARS) {
    const error = new Error('MAX_TOTAL_CHARS_EXCEEDED');
    error.code = 'MAX_TOTAL_CHARS_EXCEEDED';
    error.status = 400;
    throw error;
  }

  return normalizedSentences;
}

function clearScriptDerivedArtifacts(session) {
  if (!session || typeof session !== 'object') return session;
  delete session.plan;
  delete session.shots;
  delete session.captions;
  delete session.videoCutsV1;
  delete session.videoCutsV1Disabled;
  delete session.playbackTimelineV1;
  delete session.previewReadinessV1;
  delete session.captionOverlayV1;
  return session;
}

function withBillingEstimatePad(baseEstimatedSec, padSec) {
  const bufferedSec = baseEstimatedSec + padSec;
  return Math.max(1, Math.ceil(bufferedSec));
}

function totalBeatSpeechDurationSec(session) {
  const sentences = getNormalizedNarrationSentences(session);
  if (sentences.length === 0) return null;

  let total = 0;
  for (const sentence of sentences) {
    const durationSec = calculateBillingSpeechDuration(sentence, {
      baseTime: BILLING_ESTIMATE_PER_BEAT_BASE_SEC,
      minDuration: BILLING_ESTIMATE_PER_BEAT_MIN_SEC,
      roundTo: 0,
    });
    if (!Number.isFinite(durationSec) || durationSec <= 0) continue;
    total += durationSec;
  }
  if (!(total > 0)) return null;

  const boundaryPadSec = Math.min(
    BILLING_ESTIMATE_BEAT_BOUNDARY_PAD_MAX_SEC,
    Math.max(0, sentences.length - 1) * BILLING_ESTIMATE_BEAT_BOUNDARY_PAD_SEC
  );
  return total + boundaryPadSec;
}

export function deriveHeuristicBillingEstimate(session) {
  const computedAt = new Date().toISOString();
  const normalizedScript = getNormalizedNarrationScript(session);
  const wholeScriptDurationSec = normalizedScript
    ? calculateBillingSpeechDuration(normalizedScript)
    : null;
  const beatSpeechDurationSec = totalBeatSpeechDurationSec(session);
  const speechCandidates = [wholeScriptDurationSec, beatSpeechDurationSec].filter(
    (value) => Number.isFinite(value) && value > 0
  );
  if (speechCandidates.length > 0) {
    return {
      estimatedSec: withBillingEstimatePad(
        Math.max(...speechCandidates),
        BILLING_ESTIMATE_HEURISTIC_PAD_SEC
      ),
      source: 'speech_duration',
      computedAt,
    };
  }

  const shotDurationSec = totalShotDurationSec(session);
  if (Number.isFinite(shotDurationSec) && shotDurationSec > 0) {
    return {
      estimatedSec: withBillingEstimatePad(shotDurationSec, BILLING_ESTIMATE_HEURISTIC_PAD_SEC),
      source: 'shot_durations',
      computedAt,
    };
  }

  const captionTimelineSec = totalCaptionTimelineSec(session);
  if (Number.isFinite(captionTimelineSec) && captionTimelineSec > 0) {
    return {
      estimatedSec: withBillingEstimatePad(captionTimelineSec, BILLING_ESTIMATE_HEURISTIC_PAD_SEC),
      source: 'caption_timeline',
      computedAt,
    };
  }

  return {
    estimatedSec: withBillingEstimatePad(0, BILLING_ESTIMATE_HEURISTIC_PAD_SEC),
    source: 'speech_duration',
    computedAt,
  };
}

function setHeuristicBillingEstimate(session) {
  const heuristic = deriveHeuristicBillingEstimate(session);
  session.billingEstimate = buildSyncBillingEstimate(session, heuristic);
  updateVoiceSyncEstimate(session);
  return session;
}

export function refreshStorySessionHeuristicEstimate(session) {
  return setHeuristicBillingEstimate(session);
}

export function sanitizeStorySessionForClient(session) {
  if (!session || typeof session !== 'object') return session;
  const safeSession = safeJsonClone(session);
  const previewReadiness = buildStoryPreviewReadiness(session);
  const playbackTimelineV1 = buildStoryPlaybackTimelineV1(session, previewReadiness);

  delete safeSession.renderedSegments;
  delete safeSession.playbackTimelineV1;
  delete safeSession.previewReadinessV1;
  delete safeSession.captionOverlayV1;
  if (Array.isArray(safeSession.beats)) {
    safeSession.beats = safeSession.beats.map((beat) => {
      if (!beat || typeof beat !== 'object') return beat;
      const nextBeat = { ...beat };
      if (nextBeat.narration && typeof nextBeat.narration === 'object') {
        nextBeat.narration = {
          fingerprint: nextBeat.narration.fingerprint ?? null,
          durationSec: nextBeat.narration.durationSec ?? null,
          syncedAt: nextBeat.narration.syncedAt ?? null,
        };
      }
      return nextBeat;
    });
  }

  if (safeSession.voiceSync && typeof safeSession.voiceSync === 'object') {
    safeSession.voiceSync = {
      ...normalizeVoiceSyncSummary(safeSession),
      previewAudioStoragePath: undefined,
    };
  }

  safeSession.voiceOptions = safeVoiceOptions();
  safeSession.draftPreviewV1 = buildMobileDraftPreviewProjection(session);
  safeSession.captionOverlayV1 = buildCaptionOverlayProjection(session);
  safeSession.previewReadinessV1 = {
    version: 1,
    ready: previewReadiness.ready === true,
    reasonCode: previewReadiness.reasonCode ?? null,
    missingBeatIndices: Array.isArray(previewReadiness.missingBeatIndices)
      ? previewReadiness.missingBeatIndices
      : [],
  };
  if (playbackTimelineV1) {
    safeSession.playbackTimelineV1 = playbackTimelineV1;
  }
  return safeSession;
}

function normalizeRenderRecoveryAttemptId(attemptId, previous = null) {
  if (typeof attemptId === 'string' && attemptId.trim().length > 0) {
    return attemptId.trim();
  }
  if (typeof previous === 'string' && previous.trim().length > 0) {
    return previous.trim();
  }
  return null;
}

export function buildRenderRecoveryProjection({
  state,
  attemptId,
  previous = {},
  shortId = null,
  error = null,
}) {
  const now = new Date().toISOString();
  const normalizedAttemptId = normalizeRenderRecoveryAttemptId(attemptId, previous.attemptId);
  const priorShortId =
    typeof previous?.shortId === 'string' && previous.shortId.trim().length > 0
      ? previous.shortId
      : null;

  if (state === 'pending') {
    return {
      state: 'pending',
      attemptId: normalizedAttemptId,
      startedAt: previous?.startedAt || now,
      updatedAt: now,
      shortId: null,
      finishedAt: null,
      failedAt: null,
      code: null,
      message: null,
    };
  }

  if (state === 'done') {
    return {
      state: 'done',
      attemptId: normalizedAttemptId,
      startedAt: previous?.startedAt || now,
      updatedAt: now,
      shortId:
        typeof shortId === 'string' && shortId.trim().length > 0 ? shortId.trim() : priorShortId,
      finishedAt: now,
      failedAt: null,
      code: null,
      message: null,
    };
  }

  return {
    state: 'failed',
    attemptId: normalizedAttemptId,
    startedAt: previous?.startedAt || now,
    updatedAt: now,
    shortId: priorShortId,
    finishedAt: null,
    failedAt: now,
    code:
      typeof error?.code === 'string' && error.code.trim().length > 0
        ? error.code
        : 'STORY_FINALIZE_FAILED',
    message:
      typeof error?.message === 'string' && error.message.trim().length > 0
        ? error.message
        : 'Failed to finalize story',
  };
}

/**
 * Save story session
 */
export async function saveStorySession({ uid, sessionId, data }) {
  const next = ensureSessionDefaults(data);
  await saveJSON({ uid, studioId: sessionId, file: 'story.json', data: next });
}

/**
 * Load story session
 */
export async function loadStorySession({ uid, sessionId }) {
  const data = await loadJSON({ uid, studioId: sessionId, file: 'story.json' });
  if (!data) return null;

  const session = ensureSessionDefaults(data);

  // Check expiration
  if (session.expiresAt && Date.now() > Date.parse(session.expiresAt)) {
    return null;
  }

  return session;
}

async function persistRenderRecovery({
  uid,
  sessionId,
  attemptId,
  state,
  shortId = null,
  error = null,
}) {
  const session = await loadStorySession({ uid, sessionId });
  if (!session) return null;

  const previous =
    session.renderRecovery && typeof session.renderRecovery === 'object'
      ? session.renderRecovery
      : {};
  const next = buildRenderRecoveryProjection({
    state,
    attemptId,
    previous,
    shortId,
    error,
  });

  session.renderRecovery = next;
  session.updatedAt = next.updatedAt;
  await saveStorySession({ uid, sessionId, data: session });
  emitFinalizeEvent('info', FINALIZE_EVENTS.RECOVERY_PROJECTED, {
    uid,
    sessionId,
    attemptId,
    shortId: next.shortId || null,
    jobState: next.state || null,
    stage: FINALIZE_STAGES.PERSIST_RECOVERY,
    failureReason: next.code || null,
  });
  return session;
}

export async function persistStoryRenderRecovery({
  uid,
  sessionId,
  attemptId,
  state,
  shortId = null,
  error = null,
}) {
  return await persistRenderRecovery({
    uid,
    sessionId,
    attemptId,
    state,
    shortId,
    error,
  });
}

/**
 * Create a new story session
 */
export async function createStorySession({
  uid,
  input,
  inputType = 'paragraph',
  styleKey = 'default',
}) {
  const sessionId = `story-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const session = ensureSessionDefaults({
    id: sessionId,
    uid,
    input: {
      text: String(input || '').trim(),
      type: inputType,
      url: inputType === 'link' ? input : undefined,
    },
    styleKey: styleKey || 'default',
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  });

  setHeuristicBillingEstimate(session);
  await saveStorySession({ uid, sessionId, data: session });
  return session;
}

/**
 * Get story session
 */
export async function getStorySession({ uid, sessionId }) {
  return await loadStorySession({ uid, sessionId });
}

/**
 * Generate story from input
 */
export async function generateStory({ uid, sessionId, input, inputType }) {
  let session = await loadStorySession({ uid, sessionId });

  if (!session) {
    // Create new session if doesn't exist
    session = await createStorySession({ uid, input, inputType });
  }

  // Update input if provided
  if (input) {
    session.input = {
      text: String(input).trim(),
      type: inputType || session.input.type,
      url: inputType === 'link' ? input : session.input.url,
    };
  }

  logger.info('story.generate.service.start', {
    sessionId: session.id,
    inputType: session.input.type,
  });

  // Generate story using LLM
  const styleKey = session.styleKey || 'default';
  const story = await generateStoryFromInput({
    input: session.input.text,
    inputType: session.input.type,
    styleKey: styleKey,
  });

  session.story = story;
  resetVoiceSyncForNewScript(session);
  session.status = 'story_generated';
  session.updatedAt = new Date().toISOString();

  setHeuristicBillingEstimate(session);
  await saveStorySession({ uid, sessionId: session.id, data: session });
  logger.info('story.generate.service.completed', {
    sessionId: session.id,
    sentenceCount: session.story?.sentences?.length ?? 0,
  });
  return session;
}

/**
 * Update story sentences (when user edits script)
 */
export async function updateStorySentences({ uid, sessionId, sentences }) {
  const session = await loadStorySession({ uid, sessionId });
  if (!session) throw new Error('SESSION_NOT_FOUND');

  if (!Array.isArray(sentences) || sentences.length === 0) {
    throw new Error('INVALID_SENTENCES');
  }

  const normalizedSentences = validateStoryCharacterLimits(sentences);

  // Update story sentences
  if (!session.story) {
    session.story = {};
  }
  session.story.sentences = normalizedSentences;
  session.beats = [];
  resetVoiceSyncForNewScript(session);
  clearScriptDerivedArtifacts(session);

  session.status = 'story_generated';
  session.updatedAt = new Date().toISOString();

  setHeuristicBillingEstimate(session);
  await saveStorySession({ uid, sessionId, data: session });
  return session;
}

/**
 * Plan visual shots for the story
 */
export async function planShots({ uid, sessionId }) {
  const session = await loadStorySession({ uid, sessionId });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  if (!session.story?.sentences) throw new Error('STORY_REQUIRED');

  const plan = await planVisualShots({ sentences: session.story.sentences });

  session.plan = plan;
  session.status = 'shots_planned';
  session.updatedAt = new Date().toISOString();

  await saveStorySession({ uid, sessionId, data: session });
  return session;
}

// NASA affinity detection constants
const NASA_STRONG_KEYWORDS = [
  'space',
  'nasa',
  'galaxy',
  'galaxies',
  'nebula',
  'nebulae',
  'cosmos',
  'cosmic',
  'astronomy',
  'astronaut',
  'astronauts',
  'planet',
  'planets',
  'solar system',
  'black hole',
  'black holes',
  'supernova',
  'supernovae',
  'universe',
  'milky way',
  'mars',
  'moon',
  'lunar',
  'saturn',
  'jupiter',
  'eclipse',
  'telescope',
  'deep space',
];

const NASA_SOFT_KEYWORDS = [
  'starlight',
  'stars',
  'night sky',
  'sky full of stars',
  'dreamy sky',
  'cosmic vibes',
  'dreamy universe',
  'galactic',
  'interstellar',
  'celestial',
];

const NASA_MAX_CLIPS_STRONG = 12;
const NASA_MAX_CLIPS_SOFT = 6;

/**
 * Determine NASA affinity level for a query
 * @param {string} queryRaw - Search query
 * @returns {'strong'|'soft'|'none'}
 */
function getNasaAffinity(queryRaw = '') {
  const query = queryRaw.toLowerCase();
  const hasStrong = NASA_STRONG_KEYWORDS.some((k) => query.includes(k));
  if (hasStrong) return 'strong';
  const hasSoft = NASA_SOFT_KEYWORDS.some((k) => query.includes(k));
  if (hasSoft) return 'soft';
  return 'none';
}

/**
 * Get provider weight for scoring (higher weight = better score when dividing)
 * @param {string} provider - Provider name
 * @param {'strong'|'soft'|'none'} nasaAffinity - NASA affinity level
 * @returns {number} Weight multiplier
 */
function getProviderWeight(provider, nasaAffinity) {
  if (provider === 'nasa') {
    if (nasaAffinity === 'strong') return 1.4; // strongly favor NASA
    if (nasaAffinity === 'soft') return 1.15; // mild boost
    return 0.85; // slightly down-weight otherwise
  }
  // Pexels & Pixabay neutral
  return 1.0;
}

/**
 * Search and normalize clips for a single shot (helper function)
 * Returns normalized candidates and best match
 */
async function searchSingleShot(query, options = {}) {
  const { perPage = 6, targetDur = 8, page = 1 } = options;

  // Determine NASA affinity
  const nasaAffinity = getNasaAffinity(query);

  // Search all providers in parallel (NASA only if affinity !== 'none')
  const [pexelsResult, pixabayResult, nasaResult] = await Promise.all([
    callProviderSearch(
      'pexels',
      async () =>
        await pexelsSearchVideos({
          query: query,
          perPage: perPage,
          targetDur: targetDur,
          page: page,
        })
    ),
    callProviderSearch(
      'pixabay',
      async () =>
        await pixabaySearchVideos({
          query: query,
          perPage: perPage,
          page: page,
        })
    ),
    callProviderSearch(
      'nasa',
      async () =>
        await nasaSearchVideos({
          query,
          perPage,
          page,
        }),
      { consulted: nasaAffinity !== 'none' }
    ),
  ]);
  const providerResults = [pexelsResult, pixabayResult, nasaResult];

  logger.info('story.search.providers.nasa_result', {
    queryLength: String(query || '').trim().length,
    page,
    ok: nasaResult.ok,
    reason: nasaResult.reason || 'N/A',
    itemCount: nasaResult.items?.length || 0,
  });

  // Cap NASA items based on affinity
  let nasaItems = nasaResult.items || [];
  if (nasaItems.length) {
    const nasaLimit =
      nasaAffinity === 'strong'
        ? NASA_MAX_CLIPS_STRONG
        : nasaAffinity === 'soft'
          ? NASA_MAX_CLIPS_SOFT
          : 0; // Shouldn't happen since we don't call NASA for 'none'
    nasaItems = nasaItems.slice(0, nasaLimit);
  }

  const pexelsItems = pexelsResult.items || [];
  const pixabayItems = pixabayResult.items || [];

  // Merge results from all providers
  const allItems = [...nasaItems, ...pexelsItems, ...pixabayItems];

  // Aggregate pagination info from providers
  // If any provider has more pages, we have more results
  // Check if nextPage is a number (not null/undefined) to handle failed providers correctly
  const hasMore =
    typeof pexelsResult.nextPage === 'number' ||
    typeof pixabayResult.nextPage === 'number' ||
    typeof nasaResult.nextPage === 'number';

  logger.info('story.search.providers.summary', {
    queryLength: String(query || '').trim().length,
    page,
    nasaAffinity,
    nasa: nasaItems.length,
    pexels: pexelsItems.length,
    pixabay: pixabayItems.length,
    consultedProviders: providerResults
      .filter((result) => result.consulted)
      .map((result) => ({
        provider: result.provider,
        ok: result.ok,
        reason: result.reason,
        transient: result.transient,
        itemCount: result.items.length,
      })),
    pagination: {
      pexelsNextPage: pexelsResult.nextPage,
      pixabayNextPage: pixabayResult.nextPage,
      nasaNextPage: nasaResult.nextPage,
      hasMore,
    },
  });

  if (allItems.length === 0) {
    const consultedProviders = providerResults.filter((result) => result.consulted);
    const transientFailures = consultedProviders.filter(
      (result) => !result.ok && isTransientProviderResult(result)
    );
    if (consultedProviders.length > 0 && transientFailures.length === consultedProviders.length) {
      throw createRetryableStoryError(
        'STORY_SEARCH_TEMPORARILY_UNAVAILABLE',
        'Story search is temporarily unavailable. Please retry shortly.'
      );
    }
    return { candidates: [], best: null, page, hasMore: false };
  }

  // Normalize all candidates to same structure
  const candidates = allItems.map((item) => {
    // Extract providerId from id if not present
    const providerId = item.providerId || item.id?.replace(/^(pexels|pixabay|nasa)-video-/, '');

    return {
      id: item.id,
      url: item.fileUrl || item.url, // Support both formats
      thumbUrl: item.thumbUrl || null,
      duration: item.duration, // Already in seconds for both providers
      width: item.width,
      height: item.height,
      photographer: item.photographer,
      sourceUrl: item.sourceUrl,
      // New optional fields
      provider: item.provider || 'pexels',
      providerId: providerId,
      license: item.license || item.provider || 'pexels',
    };
  });

  // Pick best match: closest duration to target, portrait orientation, with provider-aware scoring
  let bestClip = null;
  let bestScore = Infinity;

  for (const item of allItems) {
    const durationDelta = Math.abs((item.duration || 0) - targetDur);
    const isPortrait = item.height > item.width;
    const baseScore = durationDelta + (isPortrait ? 0 : 10); // Penalize landscape
    const providerWeight = getProviderWeight(item.provider, nasaAffinity);
    const score = baseScore / providerWeight; // Division: higher weight = lower score = better

    if (score < bestScore) {
      bestScore = score;
      bestClip = item;
    }
  }

  // Normalize best clip
  const best = bestClip
    ? {
        id: bestClip.id,
        url: bestClip.fileUrl || bestClip.url,
        thumbUrl: bestClip.thumbUrl || null,
        duration: bestClip.duration,
        width: bestClip.width,
        height: bestClip.height,
        photographer: bestClip.photographer,
        sourceUrl: bestClip.sourceUrl,
        provider: bestClip.provider || 'pexels',
        providerId:
          bestClip.providerId || bestClip.id?.replace(/^(pexels|pixabay|nasa)-video-/, ''),
        license: bestClip.license || bestClip.provider || 'pexels',
      }
    : null;

  return { candidates, best, page, hasMore };
}

/**
 * Search stock videos for each shot (Phase 3)
 */
export async function searchShots({ uid, sessionId }) {
  return await withStorySearchAdmission(async () => {
    const session = await loadStorySession({ uid, sessionId });
    if (!session) throw new Error('SESSION_NOT_FOUND');
    if (!session.plan) throw new Error('PLAN_REQUIRED');

    const shots = [];

    for (const shot of session.plan) {
      try {
        // Use helper function to search and normalize
        const { candidates, best } = await searchSingleShot(shot.searchQuery, {
          perPage: 6,
          targetDur: shot.durationSec,
        });

        shots.push({
          ...shot,
          selectedClip: best,
          candidates: candidates,
        });
      } catch (error) {
        if (error?.status === 503 || error?.retryAfter) {
          throw error;
        }
        logger.warn('story.search.shot_failed', {
          sentenceIndex: shot.sentenceIndex,
          queryLength: String(shot.searchQuery || '').trim().length,
          error,
        });
        shots.push({
          ...shot,
          selectedClip: null,
          candidates: [],
        });
      }
    }

    session.shots = shots;
    invalidateRenderedOutput(session, 'clips_searched');
    session.status = 'clips_searched';
    session.updatedAt = new Date().toISOString();

    await saveStorySession({ uid, sessionId, data: session });
    return session;
  });
}

/**
 * Search clips for a single shot (Phase 3 - Clip Search)
 */
export async function searchClipsForShot({ uid, sessionId, sentenceIndex, query, page = 1 }) {
  return await withStorySearchAdmission(async () => {
    const session = await loadStorySession({ uid, sessionId });
    if (!session) throw new Error('SESSION_NOT_FOUND');
    if (!session.shots) throw new Error('SHOTS_REQUIRED');

    const shot = session.shots.find((s) => s.sentenceIndex === sentenceIndex);
    if (!shot) {
      throw new Error(`SHOT_NOT_FOUND: sentenceIndex=${sentenceIndex}`);
    }

    // Determine search query: use provided query, or fall back to shot.searchQuery, or sentence text
    const searchQuery =
      query?.trim() || shot.searchQuery || session.story?.sentences?.[sentenceIndex] || '';

    if (!searchQuery) {
      throw new Error('NO_SEARCH_QUERY_AVAILABLE');
    }

    // Search with perPage 12 for frontend to show 8 nicely
    const {
      candidates,
      best,
      page: resultPage,
      hasMore,
    } = await searchSingleShot(searchQuery, {
      perPage: 12,
      targetDur: shot.durationSec || 8,
      page: page,
    });

    // Update candidates: append new candidates with deduplication by id
    // For page 1, replace existing candidates (new search). For page > 1, append.
    if (page === 1) {
      // First page: replace candidates (new search)
      shot.candidates = candidates;
    } else {
      // Subsequent pages: append new candidates, deduplicating by id
      const existingCandidates = shot.candidates || [];
      const existingIds = new Set(existingCandidates.map((c) => c.id).filter((id) => id != null));
      const newCandidates = candidates.filter((c) => c.id == null || !existingIds.has(c.id));
      shot.candidates = [...existingCandidates, ...newCandidates];
    }

    // Keep current selectedClip if it's still in the merged candidates; otherwise use best
    const mergedCandidates = shot.candidates || [];
    const maybeKeep =
      shot.selectedClip && mergedCandidates.find((c) => c.id === shot.selectedClip.id);
    shot.selectedClip = maybeKeep || best || null;
    invalidateRenderedOutput(session);

    session.updatedAt = new Date().toISOString();

    await saveStorySession({ uid, sessionId, data: session });

    // Return shot with pagination info
    return { shot, page: resultPage, hasMore };
  });
}

/**
 * Update selected clip for a shot (Phase 2 - Clip Swap)
 */
export async function updateShotSelectedClip({ uid, sessionId, sentenceIndex, clipId }) {
  const session = await loadStorySession({ uid, sessionId });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  if (!session.shots) throw new Error('SHOTS_REQUIRED');

  const shot = session.shots.find((s) => s.sentenceIndex === sentenceIndex);
  if (!shot) throw new Error('SHOT_NOT_FOUND');

  if (!shot.candidates || shot.candidates.length === 0) {
    throw new Error('NO_CANDIDATES_AVAILABLE');
  }

  const candidate = shot.candidates.find((c) => c.id === clipId);
  if (!candidate) throw new Error('CLIP_NOT_FOUND_IN_CANDIDATES');

  // Update selectedClip
  shot.selectedClip = candidate;
  invalidateRenderedOutput(session);
  session.updatedAt = new Date().toISOString();

  await saveStorySession({ uid, sessionId, data: session });

  return { shots: session.shots };
}

/**
 * Insert a new beat with automatic clip search
 */
export async function insertBeatWithSearch({ uid, sessionId, insertAfterIndex, text }) {
  const session = await loadStorySession({ uid, sessionId });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  if (!session.story) throw new Error('STORY_REQUIRED');
  if (!session.story.sentences) session.story.sentences = [];
  if (!session.shots) session.shots = [];
  if (!Array.isArray(session.beats)) session.beats = [];

  // Handle insert at beginning (insertAfterIndex < 0)
  const newIndex = insertAfterIndex < 0 ? 0 : insertAfterIndex + 1;
  const normalizedText = normalizeNarrationText(text);
  if (!normalizedText) {
    const error = new Error('INVALID_SENTENCE_TEXT');
    error.code = 'INVALID_SENTENCE_TEXT';
    error.status = 400;
    throw error;
  }

  // Insert sentence at newIndex
  session.story.sentences.splice(newIndex, 0, normalizedText);
  validateStoryCharacterLimits(session.story.sentences);
  session.beats.splice(newIndex, 0, {});
  resetVoiceSyncForNewScript(session);

  // Calculate duration from text
  const durationSec = calculateReadingDuration(normalizedText);

  // Create new shot object
  const newShot = {
    sentenceIndex: newIndex,
    searchQuery: normalizedText,
    durationSec: durationSec,
    selectedClip: null,
    candidates: [],
  };

  // Insert shot at same position
  session.shots.splice(newIndex, 0, newShot);

  // Reindex all shots to maintain invariant: shots[i].sentenceIndex === i
  for (let i = 0; i < session.shots.length; i++) {
    session.shots[i].sentenceIndex = i;
  }

  // Search for clips using the text as query
  // After reindexing, get the shot from the array to ensure we're updating the correct object
  const insertedShot = session.shots[newIndex];
  try {
    const { candidates, best } = await searchSingleShot(normalizedText, {
      perPage: 12,
      targetDur: durationSec,
    });

    insertedShot.candidates = candidates;
    insertedShot.selectedClip = best;

    console.log(
      `[story.service] insertBeatWithSearch: search completed, candidates=${candidates.length}, best=${best ? 'found' : 'null'}`
    );
  } catch (error) {
    console.warn(
      `[story.service] Search failed for new beat at index ${newIndex}:`,
      error?.message
    );
    // Continue with empty candidates
  }

  session.updatedAt = new Date().toISOString();

  setHeuristicBillingEstimate(session);
  await saveStorySession({ uid, sessionId, data: session });

  console.log(
    `[story.service] insertBeatWithSearch: insertAfterIndex=${insertAfterIndex}, newIndex=${newIndex}, sentences.length=${session.story.sentences.length}, shots.length=${session.shots.length}`
  );

  return {
    sentences: session.story.sentences,
    shots: session.shots,
  };
}

/**
 * Delete a beat (sentence + shot)
 */
export async function deleteBeat({ uid, sessionId, sentenceIndex }) {
  const session = await loadStorySession({ uid, sessionId });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  if (!session.story?.sentences) throw new Error('STORY_REQUIRED');
  if (!session.shots) throw new Error('SHOTS_REQUIRED');

  // Validate sentenceIndex
  if (sentenceIndex < 0 || sentenceIndex >= session.story.sentences.length) {
    throw new Error('INVALID_SENTENCE_INDEX');
  }

  // Remove sentence
  session.story.sentences.splice(sentenceIndex, 1);
  validateStoryCharacterLimits(session.story.sentences);

  // Find and remove matching shot
  const shotIndex = session.shots.findIndex((s) => s.sentenceIndex === sentenceIndex);
  if (shotIndex !== -1) {
    session.shots.splice(shotIndex, 1);
  }

  // Reindex all remaining shots to maintain invariant: shots[i].sentenceIndex === i
  for (let i = 0; i < session.shots.length; i++) {
    session.shots[i].sentenceIndex = i;
  }

  if (Array.isArray(session.beats)) {
    session.beats.splice(sentenceIndex, 1);
  }
  resetVoiceSyncForNewScript(session);

  session.updatedAt = new Date().toISOString();

  setHeuristicBillingEstimate(session);
  await saveStorySession({ uid, sessionId, data: session });

  console.log(
    `[story.service] deleteBeat: sentenceIndex=${sentenceIndex}, remaining sentences.length=${session.story.sentences.length}, shots.length=${session.shots.length}`
  );

  return {
    sentences: session.story.sentences,
    shots: session.shots,
  };
}

/**
 * Update beat text (sentence text only, does not change clip)
 */
export async function updateBeatText({ uid, sessionId, sentenceIndex, text }) {
  const session = await loadStorySession({ uid, sessionId });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  if (!session.story?.sentences) throw new Error('STORY_REQUIRED');

  const sentences = session.story?.sentences || [];
  const shots = session.shots || [];

  if (typeof sentenceIndex !== 'number' || sentenceIndex < 0 || sentenceIndex >= sentences.length) {
    throw new Error('INVALID_SENTENCE_INDEX');
  }

  const normalizedText = normalizeNarrationText(text);
  if (!normalizedText) {
    const error = new Error('INVALID_SENTENCE_TEXT');
    error.code = 'INVALID_SENTENCE_TEXT';
    error.status = 400;
    throw error;
  }

  const nextSentences = [...sentences];
  nextSentences[sentenceIndex] = normalizedText;
  validateStoryCharacterLimits(nextSentences);

  // Update sentence text
  sentences[sentenceIndex] = normalizedText;

  // Preserve existing visual-intent fields for this beat. Narration edits should not
  // silently rewrite later clip-search intent or clip state.
  markVoiceSyncStale(session, { scope: 'beat', beatIndices: [sentenceIndex] });

  session.updatedAt = new Date().toISOString();
  setHeuristicBillingEstimate(session);
  await saveStorySession({ uid, sessionId, data: session });

  console.log(
    '[story.service] updateBeatText: sentenceIndex=%s, newText=%s',
    sentenceIndex,
    normalizedText.slice(0, 80)
  );

  return {
    sentences,
    shots,
  };
}

/**
 * Build timeline from selected clips (Phase 4)
 */
export async function buildTimeline({ uid, sessionId }) {
  const session = await loadStorySession({ uid, sessionId });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  if (!session.shots) throw new Error('SHOTS_REQUIRED');

  // Filter shots with valid clips
  const shotsWithClips = session.shots.filter((s) => s.selectedClip?.url);
  if (shotsWithClips.length === 0) {
    throw new Error('NO_CLIPS_SELECTED');
  }

  // Prepare clips for fetching
  const clipsToFetch = shotsWithClips.map((shot) => ({
    url: shot.selectedClip.url,
    durationSec: shot.durationSec || shot.selectedClip.duration || 3,
  }));

  // Fetch clips to temporary files
  const { clips: fetchedClips, tmpDir } = await fetchClipsToTmp(clipsToFetch);

  try {
    if (fetchedClips.length === 0) {
      throw new Error('NO_CLIPS_FETCHED');
    }

    // Create output path
    const outPath = path.join(tmpDir, 'timeline.mp4');

    // Concatenate clips
    const result = await concatenateClips({
      clips: fetchedClips,
      outPath,
      options: {
        width: 1080,
        height: 1920,
        fps: 24,
      },
    });

    session.timeline = {
      videoPath: outPath,
      durationSec: result.durationSec,
      tmpDir, // Keep reference for cleanup later
    };

    session.status = 'timeline_built';
    session.updatedAt = new Date().toISOString();

    await saveStorySession({ uid, sessionId, data: session });
    return session;
  } finally {
    // Cleanup temp directory
    try {
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch (cleanupErr) {
      console.warn('[story.service] Cleanup failed:', cleanupErr.message);
    }
  }
}

/**
 * Generate caption timings (Phase 5)
 */
export async function generateCaptionTimings({ uid, sessionId }) {
  const session = await loadStorySession({ uid, sessionId });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  if (!session.story?.sentences || !session.plan) {
    throw new Error('STORY_AND_PLAN_REQUIRED');
  }

  // Calculate timings based on shot durations
  // Recalculate durations from text to ensure consistency with reading speed
  const captions = [];
  let cumulativeTime = 0;

  for (let i = 0; i < session.story.sentences.length; i++) {
    const shot = session.plan.find((s) => s.sentenceIndex === i) || session.plan[i];
    const sentence = session.story.sentences[i];

    // Recalculate duration from text to ensure consistency
    // Use shot duration as fallback, but prefer calculated duration
    const calculatedDuration = calculateReadingDuration(sentence);
    const shotDuration = shot?.durationSec || calculatedDuration;

    // Use the calculated duration, but respect shot duration if reasonable
    const durationSec =
      shotDuration >= 3 && shotDuration <= 10
        ? Math.round(((calculatedDuration + shotDuration) / 2) * 2) / 2
        : calculatedDuration;

    captions.push({
      sentenceIndex: i,
      text: sentence,
      startTimeSec: cumulativeTime,
      endTimeSec: cumulativeTime + durationSec,
    });

    cumulativeTime += durationSec;
  }

  session.captions = captions;
  invalidateRenderedOutput(session);
  session.status = 'captions_timed';
  session.updatedAt = new Date().toISOString();

  await saveStorySession({ uid, sessionId, data: session });
  logger.info('story.search.completed', {
    sessionId,
    shotCount: Array.isArray(session.plan) ? session.plan.length : 0,
  });
  return session;
}

/**
 * Compute cut times in seconds from boundaries and beat durations.
 * Used for validation (with dummy durations) and at render time.
 * @param {Array<{leftBeat: number, pos: {beatIndex: number, pct: number}}>} boundaries
 * @param {number[]} beatsDurSec - duration per beat in seconds
 * @returns {number[]} cutTimes[0..N] where cutTimes[0]=0, cutTimes[N]=total
 */
function boundariesToCutTimes(boundaries, beatsDurSec) {
  const N = beatsDurSec.length;
  if (N === 0) return [];
  const cutTimes = [0];
  if (boundaries.length === 0) {
    for (let k = 0; k < N; k++) {
      cutTimes.push(cutTimes[cutTimes.length - 1] + beatsDurSec[k]);
    }
    return cutTimes;
  }
  for (let k = 0; k < boundaries.length; k++) {
    const { pos } = boundaries[k];
    const beatIdx = Math.max(0, Math.min(pos.beatIndex, N - 1));
    const pct = Math.max(0, Math.min(1, pos.pct));
    let t = 0;
    for (let j = 0; j < beatIdx; j++) t += beatsDurSec[j];
    t += pct * beatsDurSec[beatIdx];
    cutTimes.push(t);
  }
  const total = beatsDurSec.reduce((a, b) => a + b, 0);
  cutTimes.push(total);
  return cutTimes;
}

/** FNV-1a 32-bit hash. @returns {number} uint32 */
function fnv1a32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic float in [0,1). */
function stableHash01(str) {
  return (fnv1a32(str) >>> 0) / 4294967296;
}

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Hex string hash of sentences for staleness check. */
function sentencesHash(sentences) {
  return fnv1a32((sentences || []).join('\n')).toString(16);
}

const CONJUNCTION_WORDS = new Set(['and', 'but', 'so', 'then', 'because']);
// No overlap with CONJUNCTION_WORDS (e.g. do not include "then")
const SHIFT_WORDS = new Set([
  'however',
  'meanwhile',
  'suddenly',
  'next',
  'finally',
  'otherwise',
  'instead',
]);
const ACTION_WORDS = new Set([
  'run',
  'sprint',
  'chase',
  'slam',
  'crash',
  'explode',
  'grab',
  'throw',
  'jump',
  'rush',
  'attack',
  'escape',
  'surge',
  'fire',
  'strike',
  'spin',
]);
const AUTO_CUTS_GEN_V = 4;

/** Closers to skip when scanning backward for terminal punctuation. */
const CLOSING_PUNCT = new Set([
  ' ',
  '\t',
  '\n',
  '\r',
  "'",
  '"',
  '\u201C',
  '\u201D',
  '\u2019',
  ')',
  ']',
  '}',
]);

/**
 * Terminal punctuation class: scan backward skipping whitespace and closing quotes/brackets.
 * Detects ellipsis (... or Ã¢â‚¬Â¦), strong (.!?), semi (; : Ã¢â‚¬â€ Ã¢â‚¬â€œ), soft (comma), else none.
 * @param {string} sentence
 * @returns {'ellipsis'|'strong'|'semi'|'soft'|'none'}
 */
function getTerminalPunct(sentence) {
  const s = String(sentence ?? '').trimEnd();
  let j = s.length - 1;
  while (j >= 0 && CLOSING_PUNCT.has(s[j])) j--;
  if (j < 0) return 'none';
  const c = s[j];
  if (c === '\u2026') return 'ellipsis';
  if (c === '.' && j >= 2 && s[j - 1] === '.' && s[j - 2] === '.') return 'ellipsis';
  if (['.', '!', '?'].includes(c)) return 'strong';
  if ([';', ':', '\u2014', '\u2013'].includes(c)) return 'semi';
  if (c === ',' || c === '-') return 'soft';
  return 'none';
}

/** Earliest pause punctuation in sentence; pct in [0.12, 0.75] only. Deterministic. */
const SEMI_CHARS = [';', ':', '\u2014', '\u2013'];

/**
 * Find earliest pause anchor in sentence for cut placement.
 * @param {string} sentence
 * @returns {{ pct: number, kind: 'semi'|'comma' }|null}
 */
function findPauseAnchorPct(sentence) {
  const s = String(sentence ?? '').trim();
  if (s.length === 0) return null;
  let semiIdx = -1;
  let commaIdx = -1;
  for (let i = 0; i < s.length; i++) {
    if (SEMI_CHARS.includes(s[i]) && semiIdx === -1) semiIdx = i;
    if (s[i] === ',' && commaIdx === -1) commaIdx = i;
  }
  if (semiIdx >= 0) {
    const pct = semiIdx / s.length;
    if (pct >= 0.12 && pct <= 0.75) return { pct, kind: 'semi' };
  }
  if (commaIdx >= 0) {
    const pct = commaIdx / s.length;
    if (pct >= 0.12 && pct <= 0.75) return { pct, kind: 'comma' };
  }
  return null;
}

/** First word of sentence, lowercased. */
function firstWord(sentence) {
  return (
    String(sentence ?? '')
      .trim()
      .split(/\s+/)[0] || ''
  ).toLowerCase();
}

/** Tokenize into words (lowercase). */
function tokenize(sentence) {
  return (
    String(sentence ?? '')
      .toLowerCase()
      .match(/\b\w+\b/g) || []
  );
}

/** Count tokens that are in ACTION_WORDS. */
function countActionWords(tokens) {
  return tokens.filter((t) => ACTION_WORDS.has(t)).length;
}

/**
 * Script cadence score in [0..1]: higher = more cuts (pauses, action, short sentences).
 * Deterministic aggregate of ellipsis, strong punct, soft punct density, action words, short-sentence ratio.
 */
function scoreScriptCadence(sentences) {
  const arr = sentences || [];
  if (arr.length === 0) return 0.5;
  let ellipsisCount = 0;
  let strongCount = 0;
  let softDensitySum = 0;
  let actionSum = 0;
  let shortCount = 0;
  const shortThreshold = 60;
  for (let i = 0; i < arr.length; i++) {
    const s = String(arr[i] ?? '').trim();
    const endClass = getTerminalPunct(s);
    if (endClass === 'ellipsis') ellipsisCount += 1;
    if (endClass === 'strong' || endClass === 'semi') strongCount += 1;
    const tokens = tokenize(s);
    const wordCount = tokens.length;
    const softInSentence = (s.match(/[,;:\u2014\u2013-]/g) || []).length;
    softDensitySum += wordCount > 0 ? softInSentence / wordCount : 0;
    actionSum += countActionWords(tokens);
    if (s.length > 0 && s.length < shortThreshold) shortCount += 1;
  }
  const n = arr.length;
  const ellipsisNorm = Math.min(1, (ellipsisCount / Math.max(1, n)) * 3);
  const strongNorm = Math.min(1, (strongCount / Math.max(1, n)) * 1.5);
  const softNorm = Math.min(1, (softDensitySum / Math.max(1, n)) * 2);
  const actionNorm = Math.min(1, actionSum / Math.max(1, n * 5));
  const shortNorm = shortCount / Math.max(1, n);
  const raw =
    0.2 * ellipsisNorm + 0.25 * strongNorm + 0.2 * softNorm + 0.2 * actionNorm + 0.15 * shortNorm;
  return clamp(raw, 0, 1);
}

/**
 * Build auto VideoCutsV1 boundaries (deterministic heuristics).
 * @param {{ sessionId: string, sentences: string[] }}
 * @returns {{ version: 1, boundaries: Array<{leftBeat: number, pos: {beatIndex: number, pct: number}}> }}
 */
function buildAutoVideoCutsV1({ sessionId, sentences }) {
  const N = (sentences || []).length;
  if (N < 2) return { version: 1, boundaries: [] };
  const boundaries = [];
  for (let i = 0; i < N - 1; i++) {
    const curr = String(sentences[i] ?? '').trimEnd();
    const next = String(sentences[i + 1] ?? '').trim();
    const endClass = getTerminalPunct(curr);
    const fw = firstWord(next);
    const nextTokens = tokenize(next);
    const actionCount = countActionWords(nextTokens);
    const actionHeavy = nextTokens.length > 0 && actionCount / nextTokens.length >= 0.15;

    let minPct = 0.16;
    let maxPct = 0.6;
    if (endClass === 'ellipsis') {
      minPct = 0.22;
      maxPct = 0.65;
    } else if (endClass === 'strong') {
      minPct = 0.1;
      maxPct = 0.42;
    } else if (endClass === 'semi') {
      minPct = 0.02;
      maxPct = 0.18;
    }
    if (CONJUNCTION_WORDS.has(fw)) {
      maxPct = Math.min(0.75, maxPct + 0.05);
      minPct = Math.min(minPct, maxPct - 0.01);
    }
    if (SHIFT_WORDS.has(fw) || actionHeavy) {
      maxPct = Math.max(minPct + 0.01, maxPct - 0.12);
    }

    const r = stableHash01(`${sessionId}:${i}:${sentences[i]}:${sentences[i + 1]}`);
    let pctHash = lerp(minPct, maxPct, r);
    const anchor = findPauseAnchorPct(next);
    let pct;
    if (anchor) {
      const w = anchor.kind === 'semi' ? 0.35 : 0.5;
      pct = lerp(anchor.pct, pctHash, w);
    } else {
      pct = pctHash;
    }
    pct = clamp(pct, 0.02, 0.75);
    boundaries.push({ leftBeat: i, pos: { beatIndex: i + 1, pct } });
  }
  return { version: 1, boundaries };
}

function getShotBySentenceIndex(shots, sentenceIndex) {
  const items = Array.isArray(shots) ? shots : [];
  return items.find((entry) => entry?.sentenceIndex === sentenceIndex) || null;
}

function getMissingClipBeatIndices({ shots, beatCount }) {
  const missingBeatIndices = [];
  if (!Number.isInteger(beatCount) || beatCount <= 0) return missingBeatIndices;
  for (let beatIndex = 0; beatIndex < beatCount; beatIndex += 1) {
    const shot = getShotBySentenceIndex(shots, beatIndex);
    if (!shot?.selectedClip?.url) {
      missingBeatIndices.push(beatIndex);
    }
  }
  return missingBeatIndices;
}

function hasClipsForAllStoryBeats({ shots, beatCount }) {
  return getMissingClipBeatIndices({ shots, beatCount }).length === 0;
}

function hasValidVideoCutsV1({ videoCutsV1, beatCount }) {
  const boundaries = videoCutsV1?.boundaries;
  if (!Array.isArray(boundaries) || boundaries.length !== beatCount - 1) {
    return false;
  }
  return boundaries.every((boundary, index) => {
    if (typeof boundary?.leftBeat !== 'number' || boundary.leftBeat !== index) return false;
    const pos = boundary.pos;
    if (!pos || typeof pos.beatIndex !== 'number' || typeof pos.pct !== 'number') return false;
    if (pos.beatIndex < index + 1 || pos.beatIndex >= beatCount) return false;
    if (pos.pct < 0 || pos.pct > 1) return false;
    return true;
  });
}

function buildResolvedAutoVideoCutsV1({ sessionId, sentences, currentSentencesHash }) {
  const autoCuts = buildAutoVideoCutsV1({ sessionId, sentences });
  return {
    version: 1,
    boundaries: autoCuts.boundaries,
    source: 'auto',
    sentencesHash: currentSentencesHash,
    autoGenV: AUTO_CUTS_GEN_V,
  };
}

function resolveStoryVideoCutsPlan({ session, sentences = session?.story?.sentences ?? [] }) {
  const beatCount = Array.isArray(sentences) ? sentences.length : 0;
  const currentSentencesHash = sentencesHash(sentences);
  const enableVideoCutsV1 =
    process.env.ENABLE_VIDEO_CUTS_V1 === 'true' || process.env.ENABLE_VIDEO_CUTS_V1 === '1';
  const hasClipsForAllBeats = hasClipsForAllStoryBeats({ shots: session?.shots, beatCount });
  const canUseVideoCutsV1 =
    enableVideoCutsV1 &&
    hasClipsForAllBeats &&
    beatCount >= 2 &&
    session?.videoCutsV1Disabled !== true;

  const plan = {
    source: 'classic',
    debugSource: 'classic',
    useVideoCutsV1: false,
    resolvedVideoCutsV1: null,
    shouldPersistResolvedVideoCutsV1: false,
    currentSentencesHash,
    hasClipsForAllBeats,
  };

  if (!canUseVideoCutsV1) {
    return plan;
  }

  const existingVideoCutsV1 = session?.videoCutsV1;
  const hasValidExisting = hasValidVideoCutsV1({ videoCutsV1: existingVideoCutsV1, beatCount });
  const hasExistingBoundaries =
    Array.isArray(existingVideoCutsV1?.boundaries) && existingVideoCutsV1.boundaries.length > 0;

  if (!hasValidExisting && hasExistingBoundaries) {
    return {
      ...plan,
      debugSource: 'invalid',
    };
  }

  if (!hasValidExisting) {
    const resolvedVideoCutsV1 = buildResolvedAutoVideoCutsV1({
      sessionId: session?.id,
      sentences,
      currentSentencesHash,
    });
    return {
      ...plan,
      source: 'auto',
      debugSource: 'auto',
      useVideoCutsV1: true,
      resolvedVideoCutsV1,
      shouldPersistResolvedVideoCutsV1: true,
    };
  }

  if (existingVideoCutsV1.source !== 'auto') {
    return {
      ...plan,
      source: 'manual',
      debugSource: 'manual',
      useVideoCutsV1: true,
      resolvedVideoCutsV1: existingVideoCutsV1,
    };
  }

  if (
    existingVideoCutsV1.sentencesHash === currentSentencesHash &&
    existingVideoCutsV1.autoGenV === AUTO_CUTS_GEN_V
  ) {
    return {
      ...plan,
      source: 'auto',
      debugSource: 'auto',
      useVideoCutsV1: true,
      resolvedVideoCutsV1: existingVideoCutsV1,
    };
  }

  const resolvedVideoCutsV1 = buildResolvedAutoVideoCutsV1({
    sessionId: session?.id,
    sentences,
    currentSentencesHash,
  });
  return {
    ...plan,
    source: 'auto',
    debugSource: 'auto',
    useVideoCutsV1: true,
    resolvedVideoCutsV1,
    shouldPersistResolvedVideoCutsV1: true,
  };
}

export function buildStoryVideoCutsTimelinePlan({
  session,
  sentences = session?.story?.sentences ?? [],
  beatsDurSec,
  playbackPlan = null,
} = {}) {
  const resolvedPlaybackPlan = playbackPlan || resolveStoryVideoCutsPlan({ session, sentences });
  const normalizedBeatsDurSec = Array.isArray(beatsDurSec)
    ? beatsDurSec.map((value) => Number(value))
    : [];
  if (
    !resolvedPlaybackPlan.useVideoCutsV1 ||
    normalizedBeatsDurSec.length === 0 ||
    normalizedBeatsDurSec.some((value) => !Number.isFinite(value) || value <= 0)
  ) {
    return {
      playbackPlan: resolvedPlaybackPlan,
      source: resolvedPlaybackPlan.source,
      useVideoCutsV1: false,
      resolvedVideoCutsV1: null,
      segments: [],
      beatSlices: [],
      totalDurationSec: 0,
    };
  }

  const segments =
    resolvedPlaybackPlan.source === 'auto'
      ? computeVideoSegmentsFromCutsAutoBudget({
          beatsDurSec: normalizedBeatsDurSec,
          shots: session?.shots,
          videoCutsV1: resolvedPlaybackPlan.resolvedVideoCutsV1,
          sessionId: session?.id,
          sentences,
          sentencesHash: resolvedPlaybackPlan.currentSentencesHash,
        })
      : computeVideoSegmentsFromCuts({
          beatsDurSec: normalizedBeatsDurSec,
          shots: session?.shots,
          videoCutsV1: resolvedPlaybackPlan.resolvedVideoCutsV1,
        });

  let cursorSec = 0;
  const beatSlices = normalizedBeatsDurSec.map((durationSec, beatIndex) => {
    const startSec = cursorSec;
    cursorSec += durationSec;
    return {
      beatIndex,
      startSec,
      endSec: cursorSec,
      durationSec,
    };
  });

  return {
    playbackPlan: resolvedPlaybackPlan,
    source: resolvedPlaybackPlan.source,
    useVideoCutsV1: true,
    resolvedVideoCutsV1: resolvedPlaybackPlan.resolvedVideoCutsV1,
    segments,
    beatSlices,
    totalDurationSec: cursorSec,
  };
}

function buildBeatDurationsFromSyncedCaptions(session, beatCount) {
  if (!Array.isArray(session?.captions) || beatCount <= 0) return null;
  const captionBySentenceIndex = new Map();
  for (const caption of session.captions) {
    const sentenceIndex = Number(caption?.sentenceIndex);
    const startTimeSec = Number(caption?.startTimeSec);
    const endTimeSec = Number(caption?.endTimeSec);
    if (
      !Number.isFinite(sentenceIndex) ||
      !Number.isFinite(startTimeSec) ||
      !Number.isFinite(endTimeSec)
    ) {
      continue;
    }
    captionBySentenceIndex.set(sentenceIndex, {
      startTimeSec,
      endTimeSec,
    });
  }

  const beatsDurSec = [];
  for (let beatIndex = 0; beatIndex < beatCount; beatIndex += 1) {
    const caption = captionBySentenceIndex.get(beatIndex);
    if (!caption) return null;
    const durationSec = caption.endTimeSec - caption.startTimeSec;
    if (!Number.isFinite(durationSec) || durationSec <= 0) return null;
    beatsDurSec.push(durationSec);
  }
  return beatsDurSec;
}

function buildStoryPreviewReadiness(session) {
  const syncSummary = normalizeVoiceSyncSummary(session);
  if (syncSummary.state !== 'current') {
    return {
      ready: false,
      reasonCode: 'VOICE_SYNC_NOT_CURRENT',
      missingBeatIndices: [],
      playbackSource: null,
      segments: null,
    };
  }
  if (!syncSummary.previewAudioUrl) {
    return {
      ready: false,
      reasonCode: 'PREVIEW_AUDIO_MISSING',
      missingBeatIndices: [],
      playbackSource: null,
      segments: null,
    };
  }

  const sentences = Array.isArray(session?.story?.sentences) ? session.story.sentences : [];
  const beatCount = sentences.length;
  if (beatCount === 0) {
    return {
      ready: false,
      reasonCode: 'CAPTIONS_INCOMPLETE',
      missingBeatIndices: [],
      playbackSource: null,
      segments: null,
    };
  }

  const beatsDurSec = buildBeatDurationsFromSyncedCaptions(session, beatCount);
  if (!Array.isArray(beatsDurSec) || beatsDurSec.length !== beatCount) {
    return {
      ready: false,
      reasonCode: 'CAPTIONS_INCOMPLETE',
      missingBeatIndices: [],
      playbackSource: null,
      segments: null,
    };
  }

  const missingBeatIndices = getMissingClipBeatIndices({ shots: session?.shots, beatCount });
  if (missingBeatIndices.length > 0) {
    return {
      ready: false,
      reasonCode: 'MISSING_CLIP_COVERAGE',
      missingBeatIndices,
      playbackSource: null,
      segments: null,
    };
  }

  const playbackPlan = resolveStoryVideoCutsPlan({ session, sentences });
  try {
    const segments = playbackPlan.useVideoCutsV1
      ? playbackPlan.source === 'auto'
        ? computeVideoSegmentsFromCutsAutoBudget({
            beatsDurSec,
            shots: session.shots,
            videoCutsV1: playbackPlan.resolvedVideoCutsV1,
            sessionId: session.id,
            sentences,
            sentencesHash: playbackPlan.currentSentencesHash,
          })
        : computeVideoSegmentsFromCuts({
            beatsDurSec,
            shots: session.shots,
            videoCutsV1: playbackPlan.resolvedVideoCutsV1,
          })
      : computeVideoSegmentsFromCuts({
          beatsDurSec,
          shots: session.shots,
          videoCutsV1: { version: 1, boundaries: [] },
        });

    if (!Array.isArray(segments) || segments.length !== beatCount) {
      return {
        ready: false,
        reasonCode: 'INVALID_PLAYBACK_SEGMENTS',
        missingBeatIndices: [],
        playbackSource: null,
        segments: null,
      };
    }

    return {
      ready: true,
      reasonCode: null,
      missingBeatIndices: [],
      playbackSource: playbackPlan.source,
      segments,
    };
  } catch {
    return {
      ready: false,
      reasonCode: 'INVALID_PLAYBACK_SEGMENTS',
      missingBeatIndices: [],
      playbackSource: null,
      segments: null,
    };
  }
}

function buildStoryPlaybackTimelineV1(session, previewReadiness = null) {
  const readiness = previewReadiness || buildStoryPreviewReadiness(session);
  if (!readiness?.ready || !Array.isArray(readiness.segments)) {
    return null;
  }

  const segments = readiness.segments;
  const beatCount = segments.length;
  const timelineSegments = segments
    .map((segment, segmentIndex) => {
      const clipUrl = typeof segment?.clipUrl === 'string' ? segment.clipUrl : '';
      const globalStartSec = Number(segment?.globalStartSec);
      const globalEndSec = Number(segment?.globalEndSec);
      const clipStartSec = Number(segment?.inSec);
      const durationSec = Number(segment?.durSec);
      const sentenceIndex = Number(segment?.sentenceIndex);
      const ownerSentenceIndex = Number(
        Number.isFinite(Number(segment?.ownerSentenceIndex))
          ? segment.ownerSentenceIndex
          : segment?.sentenceIndex
      );
      if (
        !clipUrl ||
        !Number.isFinite(globalStartSec) ||
        !Number.isFinite(globalEndSec) ||
        !Number.isFinite(clipStartSec) ||
        !Number.isFinite(durationSec) ||
        !Number.isFinite(sentenceIndex) ||
        !Number.isFinite(ownerSentenceIndex)
      ) {
        return null;
      }
      return {
        segmentIndex,
        sentenceIndex,
        ownerSentenceIndex,
        clipUrl,
        clipThumbUrl: segment?.clipThumbUrl ?? null,
        globalStartSec,
        globalEndSec,
        clipStartSec,
        durationSec,
      };
    })
    .filter(Boolean);

  if (timelineSegments.length !== beatCount) {
    return null;
  }

  return {
    version: 1,
    source: readiness.playbackSource,
    totalDurationSec:
      timelineSegments.length > 0 ? timelineSegments[timelineSegments.length - 1].globalEndSec : 0,
    segments: timelineSegments,
  };
}

function buildDraftPreviewRenderBeatDurationInputs({ session, beatCount }) {
  if (!Number.isInteger(beatCount) || beatCount <= 0) return null;
  const captionsBySentenceIndex = new Map(
    (Array.isArray(session?.captions) ? session.captions : []).map((caption) => [
      Number(caption?.sentenceIndex),
      caption,
    ])
  );
  const beatsDurSec = [];
  for (let beatIndex = 0; beatIndex < beatCount; beatIndex += 1) {
    const caption = captionsBySentenceIndex.get(beatIndex);
    const narration = getBeatNarrationMeta(session, beatIndex);
    if (!caption || !narration?.audioStoragePath || !narration?.timingStoragePath) {
      return null;
    }
    const details = resolveStoredRenderBeatDurationDetails({
      narration,
      timing: null,
      caption,
    });
    if (!Number.isFinite(details.durationSec) || details.durationSec <= 0) {
      return null;
    }
    beatsDurSec.push(details.durationSec);
  }
  return beatsDurSec;
}

function buildDraftPreviewVisualTimelineFingerprintInput({ session, previewReadiness }) {
  if (!previewReadiness?.ready || !Array.isArray(previewReadiness.segments)) {
    return null;
  }
  const sentences = Array.isArray(session?.story?.sentences) ? session.story.sentences : [];
  const beatCount = sentences.length;
  const playbackPlan = resolveStoryVideoCutsPlan({ session, sentences });
  if (!playbackPlan.useVideoCutsV1) {
    return {
      enabled: false,
      source: playbackPlan.source,
      segments: [],
      beatSlices: [],
    };
  }
  const beatsDurSec = buildDraftPreviewRenderBeatDurationInputs({ session, beatCount });
  if (!Array.isArray(beatsDurSec) || beatsDurSec.length !== beatCount) {
    return null;
  }
  try {
    const timelinePlan = buildStoryVideoCutsTimelinePlan({
      session,
      sentences,
      beatsDurSec,
      playbackPlan,
    });
    return {
      enabled: true,
      source: timelinePlan.source,
      resolvedVideoCutsV1: timelinePlan.resolvedVideoCutsV1,
      beatSlices: timelinePlan.beatSlices.map((slice) => ({
        beatIndex: slice.beatIndex,
        startSec: Number(slice.startSec),
        endSec: Number(slice.endSec),
        durationSec: Number(slice.durationSec),
      })),
      segments: timelinePlan.segments.map((segment) => ({
        sentenceIndex: Number(segment?.sentenceIndex),
        ownerSentenceIndex: Number(segment?.ownerSentenceIndex),
        clipUrl: segment?.clipUrl ?? null,
        inSec: Number(segment?.inSec),
        durSec: Number(segment?.durSec),
        globalStartSec: Number(segment?.globalStartSec),
        globalEndSec: Number(segment?.globalEndSec),
      })),
    };
  } catch {
    return null;
  }
}

function buildDraftPreviewFingerprint({ session, previewReadiness }) {
  const syncSummary = normalizeVoiceSyncSummary(session);
  const captionsBySentenceIndex = new Map(
    (Array.isArray(session?.captions) ? session.captions : []).map((caption) => [
      Number(caption?.sentenceIndex),
      caption,
    ])
  );
  return hashStableValue({
    schemaVersion: DRAFT_PREVIEW_SCHEMA_VERSION,
    rendererVersion: DRAFT_PREVIEW_RENDERER_VERSION,
    renderConstants: {
      width: DRAFT_PREVIEW_WIDTH,
      height: DRAFT_PREVIEW_HEIGHT,
      fps: DRAFT_PREVIEW_FPS,
    },
    sessionId: session?.id ?? null,
    voiceSyncFingerprint: syncSummary.currentFingerprint ?? null,
    captionStyle: session?.overlayCaption || session?.captionStyle || {},
    playbackSource: previewReadiness?.playbackSource ?? null,
    visualTimeline: buildDraftPreviewVisualTimelineFingerprintInput({
      session,
      previewReadiness,
    }),
    segments: Array.isArray(previewReadiness?.segments)
      ? previewReadiness.segments.map((segment) => ({
          sentenceIndex: Number(segment?.sentenceIndex),
          ownerSentenceIndex: Number(segment?.ownerSentenceIndex),
          clipUrl: segment?.clipUrl ?? null,
          inSec: Number(segment?.inSec),
          durSec: Number(segment?.durSec),
          globalStartSec: Number(segment?.globalStartSec),
          globalEndSec: Number(segment?.globalEndSec),
          caption: (() => {
            const beatIndex = Number(segment?.sentenceIndex);
            const caption = captionsBySentenceIndex.get(beatIndex);
            return {
              text: caption?.text ?? null,
              startTimeSec: Number(caption?.startTimeSec),
              endTimeSec: Number(caption?.endTimeSec),
              renderInput: (() => {
                if (!caption) return null;
                const textRaw = session.story?.sentences?.[beatIndex] ?? caption.text ?? '';
                const overlayCaption = session.overlayCaption || session.captionStyle || {};
                const meta = buildCaptionMetaForBeat({
                  session,
                  beatIndex,
                  textRaw,
                  overlayCaption,
                });
                return {
                  lines: Array.isArray(meta?.lines) ? meta.lines : [],
                  effectiveStyle: meta?.effectiveStyle || {},
                  styleHash: meta?.styleHash ?? null,
                  wrapHash: meta?.wrapHash ?? null,
                  textHash: meta?.textHash ?? null,
                  maxWidthPx: Number(meta?.maxWidthPx),
                  totalTextH: Number(meta?.totalTextH),
                };
              })(),
            };
          })(),
          narration: (() => {
            const narration = getBeatNarrationMeta(session, Number(segment?.sentenceIndex));
            return {
              fingerprint: narration?.fingerprint ?? null,
              audioStoragePath: narration?.audioStoragePath ?? null,
              timingStoragePath: narration?.timingStoragePath ?? null,
              durationSec: Number(narration?.durationSec),
            };
          })(),
        }))
      : [],
  });
}

function validateDraftPreviewBeatRenderInputs({ session, previewReadiness }) {
  const segments = Array.isArray(previewReadiness?.segments) ? previewReadiness.segments : [];
  const captionsBySentenceIndex = new Map(
    (Array.isArray(session?.captions) ? session.captions : []).map((caption) => [
      Number(caption?.sentenceIndex),
      caption,
    ])
  );
  const missingBeatIndices = [];
  for (const segment of segments) {
    const beatIndex = Number(segment?.sentenceIndex);
    if (!Number.isInteger(beatIndex)) continue;
    const caption = captionsBySentenceIndex.get(beatIndex);
    const narration = getBeatNarrationMeta(session, beatIndex);
    if (!caption || !narration?.audioStoragePath || !narration?.timingStoragePath) {
      missingBeatIndices.push(beatIndex);
    }
  }
  return {
    ready: missingBeatIndices.length === 0,
    missingBeatIndices,
  };
}

function buildDraftPreviewBlockedState({ reasonCode, missingBeatIndices = [] }) {
  return {
    version: DRAFT_PREVIEW_SCHEMA_VERSION,
    state: 'blocked',
    updatedAt: new Date().toISOString(),
    rendererVersion: DRAFT_PREVIEW_RENDERER_VERSION,
    blocked: {
      reasonCode,
      missingBeatIndices: Array.isArray(missingBeatIndices) ? missingBeatIndices : [],
    },
  };
}

export function prepareDraftPreviewRequest(session) {
  if (!session || typeof session !== 'object') {
    const error = new Error('SESSION_NOT_FOUND');
    error.code = 'SESSION_NOT_FOUND';
    error.status = 404;
    throw error;
  }
  const previewReadiness = buildStoryPreviewReadiness(session);
  if (!previewReadiness.ready) {
    return {
      ready: false,
      blockedState: buildDraftPreviewBlockedState({
        reasonCode: previewReadiness.reasonCode || 'PREVIEW_BLOCKED',
        missingBeatIndices: previewReadiness.missingBeatIndices || [],
      }),
    };
  }
  const beatRenderInputs = validateDraftPreviewBeatRenderInputs({ session, previewReadiness });
  if (!beatRenderInputs.ready) {
    return {
      ready: false,
      blockedState: buildDraftPreviewBlockedState({
        reasonCode: 'VOICE_SYNC_ARTIFACT_MISSING',
        missingBeatIndices: beatRenderInputs.missingBeatIndices,
      }),
    };
  }
  const fingerprint = buildDraftPreviewFingerprint({ session, previewReadiness });
  const currentPreview = session.draftPreviewV1;
  if (
    currentPreview?.state === 'ready' &&
    currentPreview?.fingerprint === fingerprint &&
    currentPreview?.rendererVersion === DRAFT_PREVIEW_RENDERER_VERSION &&
    currentPreview?.artifact?.url
  ) {
    return {
      ready: true,
      alreadyReady: true,
      fingerprint,
      session,
    };
  }
  return {
    ready: true,
    alreadyReady: false,
    fingerprint,
    previewReadiness,
  };
}

export function getDraftPreviewObservabilityMeta() {
  return {
    rendererVersion: DRAFT_PREVIEW_RENDERER_VERSION,
  };
}

export function markDraftPreviewQueued({
  session,
  attemptId,
  previewId,
  fingerprint,
  state = 'queued',
}) {
  const now = new Date().toISOString();
  session.draftPreviewV1 = {
    version: DRAFT_PREVIEW_SCHEMA_VERSION,
    state,
    updatedAt: now,
    rendererVersion: DRAFT_PREVIEW_RENDERER_VERSION,
    fingerprint,
    previewId,
    activeAttemptId: attemptId,
    job: {
      state,
      attemptId,
      retryAfterSec: 5,
    },
  };
  return session;
}

export async function persistDraftPreviewFailure({
  uid,
  sessionId,
  attemptId,
  code = 'DRAFT_PREVIEW_FAILED',
  message = 'Failed to generate preview.',
}) {
  const session = await loadStorySession({ uid, sessionId });
  if (!session) return null;
  if (session.draftPreviewV1?.activeAttemptId !== attemptId) return session;
  session.draftPreviewV1 = {
    ...session.draftPreviewV1,
    state: 'failed',
    updatedAt: new Date().toISOString(),
    job: null,
    error: {
      code,
      message,
    },
  };
  await saveStorySession({ uid, sessionId, data: session });
  return session;
}

export async function renderStoryDraftPreview({
  uid,
  sessionId,
  attemptId,
  previewId,
  fingerprint,
}) {
  const renderStartedAt = Date.now();
  const fingerprintPrefix = previewFingerprintPrefix(fingerprint);
  let segmentCount = 0;
  let session = await loadStorySession({ uid, sessionId });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  const prepared = prepareDraftPreviewRequest(session);
  segmentCount = Array.isArray(prepared.previewReadiness?.segments)
    ? prepared.previewReadiness.segments.length
    : 0;
  if (!prepared.ready) {
    session.draftPreviewV1 = prepared.blockedState;
    await saveStorySession({ uid, sessionId, data: session });
    const error = new Error(prepared.blockedState.blocked.reasonCode);
    error.code = prepared.blockedState.blocked.reasonCode;
    error.status = 409;
    throw error;
  }
  if (prepared.fingerprint !== fingerprint) {
    const error = new Error('DRAFT_PREVIEW_SUPERSEDED');
    error.code = 'DRAFT_PREVIEW_SUPERSEDED';
    error.status = 409;
    throw error;
  }
  if (session.draftPreviewV1?.activeAttemptId !== attemptId) {
    const error = new Error('DRAFT_PREVIEW_SUPERSEDED');
    error.code = 'DRAFT_PREVIEW_SUPERSEDED';
    error.status = 409;
    throw error;
  }

  logger.info('story.preview.render.started', {
    uid,
    sessionId,
    attemptId,
    previewId,
    rendererVersion: DRAFT_PREVIEW_RENDERER_VERSION,
    fingerprintPrefix,
    segmentCount,
    outcome: 'started',
  });

  markDraftPreviewQueued({
    session,
    attemptId,
    previewId,
    fingerprint,
    state: 'running',
  });
  await saveStorySession({ uid, sessionId, data: session });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaiform-story-preview-'));
  try {
    const renderedSegments = [];
    const colorMetaCache = new Map();
    const videoProbeCache = new Map();
    const sentences = Array.isArray(session?.story?.sentences) ? session.story.sentences : [];
    const playbackPlan = resolveStoryVideoCutsPlan({ session, sentences });

    if (playbackPlan.useVideoCutsV1) {
      const perBeat = [];
      const beatsDurSecArr = [];
      const readinessSegmentsByBeat = new Map(
        prepared.previewReadiness.segments.map((segment) => [
          Number(segment?.sentenceIndex),
          segment,
        ])
      );
      for (let beatIndex = 0; beatIndex < sentences.length; beatIndex += 1) {
        const info = await buildStoredRenderBeat({ session, beatIndex, tmpDir });
        beatsDurSecArr.push(info.durationSec);
        perBeat.push(info);

        const readinessSegment = readinessSegmentsByBeat.get(beatIndex);
        const captionSpanSec = Math.max(
          0,
          Number(info.caption?.endTimeSec || 0) - Number(info.caption?.startTimeSec || 0)
        );
        logger.debug('story.preview.segment_duration_resolved', {
          sessionId,
          attemptId,
          previewId,
          segmentIndex: beatIndex,
          beatIndex,
          sentenceIndex: beatIndex,
          segmentDurSec: Number(readinessSegment?.durSec),
          renderDurationSec: info.durationSec,
          narrationDurationSec: Number(getBeatNarrationMeta(session, beatIndex)?.durationSec),
          timingDurationMs: null,
          captionSpanSec,
          durationSource: 'stored_render_beat',
        });
      }

      const timelinePlan = buildStoryVideoCutsTimelinePlan({
        session,
        sentences,
        beatsDurSec: beatsDurSecArr,
        playbackPlan,
      });
      if (timelinePlan.segments.length === 0) {
        throw new Error('VIDEO_CUTS_V1_NO_SEGMENTS');
      }

      const fetchedCache = new Map();
      const trimmedPaths = [];
      for (let segmentIndex = 0; segmentIndex < timelinePlan.segments.length; segmentIndex += 1) {
        const segment = timelinePlan.segments[segmentIndex];
        let fetched = fetchedCache.get(segment.clipUrl);
        if (!fetched) {
          fetched = await fetchVideoToTmp(segment.clipUrl);
          fetchedCache.set(segment.clipUrl, fetched);
        }
        const trimmedPath = path.join(tmpDir, `captioned_v1_trim_${segmentIndex}.mp4`);
        try {
          await trimClipToSegment({
            path: fetched.path,
            inSec: segment.inSec,
            durSec: segment.durSec,
            outPath: trimmedPath,
            options: {
              width: DRAFT_PREVIEW_WIDTH,
              height: DRAFT_PREVIEW_HEIGHT,
              videoProbeCache,
            },
          });
        } catch (trimError) {
          const trimCode = trimError?.code || trimError?.message || 'TRIM_SEGMENT_FAILED';
          if (String(trimCode).startsWith('TRIM_')) {
            const error = new Error('Draft preview segment video input was invalid.');
            error.code = 'DRAFT_PREVIEW_SEGMENT_VIDEO_MISSING';
            error.status = 500;
            error.cause = trimError;
            logger.warn('story.preview.segment_video_missing', {
              sessionId,
              attemptId,
              previewId,
              segmentIndex,
              beatIndex: Number(segment.sentenceIndex),
              sentenceIndex: Number(segment.sentenceIndex),
              inSec: Number(segment.inSec),
              durSec: Number(segment.durSec),
              clipUrl: segment.clipUrl,
              sourceDurationSec: Number.isFinite(Number(trimError?.sourceDurationSec))
                ? Number(trimError.sourceDurationSec)
                : null,
              trimCode,
            });
            throw error;
          }
          throw trimError;
        }
        trimmedPaths.push({ path: trimmedPath, durationSec: segment.durSec });
      }

      const globalTimelinePath = path.join(tmpDir, 'captioned_v1_global.mp4');
      await concatenateClipsVideoOnly({
        clips: trimmedPaths,
        outPath: globalTimelinePath,
        options: {
          width: DRAFT_PREVIEW_WIDTH,
          height: DRAFT_PREVIEW_HEIGHT,
          fps: DRAFT_PREVIEW_FPS,
        },
      });

      for (const slice of timelinePlan.beatSlices) {
        const beatIndex = slice.beatIndex;
        const info = perBeat[beatIndex];
        const slicePath = path.join(tmpDir, `captioned_v1_slice_${beatIndex}.mp4`);
        await extractSegmentFromFile({
          path: globalTimelinePath,
          startSec: slice.startSec,
          durSec: slice.durationSec,
          outPath: slicePath,
          options: { width: DRAFT_PREVIEW_WIDTH, height: DRAFT_PREVIEW_HEIGHT },
        });
        const segmentPath = path.join(tmpDir, `captioned_segment_${beatIndex}.mp4`);
        await renderVideoQuoteOverlay({
          videoPath: slicePath,
          outPath: segmentPath,
          width: DRAFT_PREVIEW_WIDTH,
          height: DRAFT_PREVIEW_HEIGHT,
          durationSec: slice.durationSec,
          fps: DRAFT_PREVIEW_FPS,
          text: info.caption.text,
          captionText: info.caption.text,
          ttsPath: info.ttsPath,
          assPath: info.assPath,
          overlayCaption: info.overlayCaption,
          keepVideoAudio: true,
          bgAudioVolume: 0.5,
          watermark: true,
          padSec: 0,
          colorMetaCache,
        });
        renderedSegments.push({ path: segmentPath, durationSec: slice.durationSec });
      }
    } else {
      const fetchedCache = new Map();
      const captionsBySentenceIndex = new Map(
        (Array.isArray(session?.captions) ? session.captions : []).map((caption) => [
          Number(caption?.sentenceIndex),
          caption,
        ])
      );
      for (
        let segmentIndex = 0;
        segmentIndex < prepared.previewReadiness.segments.length;
        segmentIndex += 1
      ) {
        const segment = prepared.previewReadiness.segments[segmentIndex];
        const beatIndex = Number(segment.sentenceIndex);
        const caption = captionsBySentenceIndex.get(beatIndex);
        const narration = getBeatNarrationMeta(session, beatIndex);
        if (!caption || !narration?.audioStoragePath || !narration?.timingStoragePath) {
          const error = new Error('VOICE_SYNC_ARTIFACT_MISSING');
          error.code = 'VOICE_SYNC_ARTIFACT_MISSING';
          error.status = 409;
          throw error;
        }
        const audioPath = await downloadPrivateObjectToTmp({
          bucketPath: narration.audioStoragePath,
          tmpDir,
          name: `preview_voice_${beatIndex}.mp3`,
        });
        const timing = await loadStoredBeatTimingData(session, beatIndex);
        const durationDetails = resolveStoredRenderBeatDurationDetails({
          narration,
          timing,
          caption,
        });
        const renderDurationSec = durationDetails.durationSec;
        const captionSpanSec = Math.max(
          0,
          Number(caption.endTimeSec || 0) - Number(caption.startTimeSec || 0)
        );
        logger.debug('story.preview.segment_duration_resolved', {
          sessionId,
          attemptId,
          previewId,
          segmentIndex,
          beatIndex,
          sentenceIndex: beatIndex,
          segmentDurSec: Number(segment.durSec),
          renderDurationSec,
          narrationDurationSec: Number(narration.durationSec),
          timingDurationMs: Number(timing.durationMs),
          captionSpanSec,
          durationSource: durationDetails.durationSource,
        });
        let fetched = fetchedCache.get(segment.clipUrl);
        if (!fetched) {
          fetched = await fetchVideoToTmp(segment.clipUrl);
          fetchedCache.set(segment.clipUrl, fetched);
        }
        const trimmedPath = path.join(tmpDir, `captioned_trim_${segmentIndex}.mp4`);
        try {
          await trimClipToSegment({
            path: fetched.path,
            inSec: segment.inSec,
            durSec: renderDurationSec,
            outPath: trimmedPath,
            options: {
              width: DRAFT_PREVIEW_WIDTH,
              height: DRAFT_PREVIEW_HEIGHT,
              videoProbeCache,
            },
          });
        } catch (trimError) {
          const trimCode = trimError?.code || trimError?.message || 'TRIM_SEGMENT_FAILED';
          if (String(trimCode).startsWith('TRIM_')) {
            const error = new Error('Draft preview segment video input was invalid.');
            error.code = 'DRAFT_PREVIEW_SEGMENT_VIDEO_MISSING';
            error.status = 500;
            error.cause = trimError;
            logger.warn('story.preview.segment_video_missing', {
              sessionId,
              attemptId,
              previewId,
              segmentIndex,
              beatIndex,
              sentenceIndex: beatIndex,
              inSec: Number(segment.inSec),
              durSec: renderDurationSec,
              clipUrl: segment.clipUrl,
              sourceDurationSec: Number.isFinite(Number(trimError?.sourceDurationSec))
                ? Number(trimError.sourceDurationSec)
                : null,
              trimCode,
            });
            throw error;
          }
          throw trimError;
        }
        const captionInput = await buildStoredRenderBeatCaptionInput({
          session,
          beatIndex,
          caption,
          timing,
          audioPath,
        });
        const segmentPath = path.join(tmpDir, `captioned_segment_${segmentIndex}.mp4`);
        await renderVideoQuoteOverlay({
          videoPath: trimmedPath,
          outPath: segmentPath,
          width: DRAFT_PREVIEW_WIDTH,
          height: DRAFT_PREVIEW_HEIGHT,
          durationSec: renderDurationSec,
          fps: DRAFT_PREVIEW_FPS,
          text: caption.text,
          captionText: caption.text,
          ttsPath: audioPath,
          assPath: captionInput.assPath,
          overlayCaption: captionInput.overlayCaption,
          keepVideoAudio: true,
          bgAudioVolume: 0.5,
          watermark: true,
          padSec: 0,
          colorMetaCache,
        });
        renderedSegments.push({ path: segmentPath, durationSec: renderDurationSec });
      }
    }

    const captionedPath = path.join(tmpDir, 'captioned.mp4');
    const captioned = await concatenateClips({
      clips: renderedSegments,
      outPath: captionedPath,
      options: { width: DRAFT_PREVIEW_WIDTH, height: DRAFT_PREVIEW_HEIGHT, fps: DRAFT_PREVIEW_FPS },
    });

    session = await loadStorySession({ uid, sessionId });
    if (!session) throw new Error('SESSION_NOT_FOUND');
    const latest = prepareDraftPreviewRequest(session);
    if (
      !latest.ready ||
      latest.fingerprint !== fingerprint ||
      session.draftPreviewV1?.activeAttemptId !== attemptId
    ) {
      const error = new Error('DRAFT_PREVIEW_SUPERSEDED');
      error.code = 'DRAFT_PREVIEW_SUPERSEDED';
      error.status = 409;
      throw error;
    }

    const storagePath = `artifacts/${uid}/${sessionId}/previews/${previewId}/captioned.mp4`;
    const upload = await uploadPublic(captionedPath, storagePath, DRAFT_PREVIEW_CONTENT_TYPE, {
      cacheControl: DRAFT_PREVIEW_CACHE_CONTROL,
    });
    const outputDurationSec =
      captioned.durationSec ??
      renderedSegments.reduce((sum, segment) => sum + (Number(segment.durationSec) || 0), 0);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    session.draftPreviewV1 = {
      version: DRAFT_PREVIEW_SCHEMA_VERSION,
      state: 'ready',
      updatedAt: now,
      rendererVersion: DRAFT_PREVIEW_RENDERER_VERSION,
      fingerprint,
      previewId,
      artifact: {
        url: upload.publicUrl,
        storagePath,
        contentType: DRAFT_PREVIEW_CONTENT_TYPE,
        durationSec: outputDurationSec,
        width: DRAFT_PREVIEW_WIDTH,
        height: DRAFT_PREVIEW_HEIGHT,
        createdAt: now,
        expiresAt,
      },
      job: null,
    };
    await saveStorySession({ uid, sessionId, data: session });
    logger.info('story.preview.render.completed', {
      uid,
      sessionId,
      attemptId,
      previewId,
      rendererVersion: DRAFT_PREVIEW_RENDERER_VERSION,
      fingerprintPrefix,
      segmentCount,
      outputDurationSec,
      renderWallMs: Date.now() - renderStartedAt,
      outcome: 'completed',
    });
    return session;
  } catch (error) {
    logger.error('story.preview.render.failed', {
      uid,
      sessionId,
      attemptId,
      previewId,
      rendererVersion: DRAFT_PREVIEW_RENDERER_VERSION,
      fingerprintPrefix,
      segmentCount,
      renderWallMs: Date.now() - renderStartedAt,
      outcome: 'failed',
      failureCode: error?.code || error?.message || 'DRAFT_PREVIEW_FAILED',
    });
    throw error;
  } finally {
    try {
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch (cleanupErr) {
      console.warn('[story.preview] Cleanup failed:', cleanupErr.message);
    }
  }
}

/**
 * Update session video cuts (videoCutsV1). Validates against story length.
 */
export async function updateVideoCuts({ uid, sessionId, videoCutsV1 }) {
  const session = await loadStorySession({ uid, sessionId });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  const N = session.story?.sentences?.length ?? 0;
  if (N === 0) throw new Error('STORY_REQUIRED');

  if (!videoCutsV1 || videoCutsV1.version !== 1) {
    throw new Error('INVALID_VIDEO_CUTS_VERSION');
  }
  const boundaries = videoCutsV1.boundaries;
  if (!Array.isArray(boundaries)) {
    throw new Error('INVALID_VIDEO_CUTS_BOUNDARIES');
  }
  if (boundaries.length > 0 && boundaries.length !== N - 1) {
    throw new Error('INVALID_VIDEO_CUTS_LENGTH');
  }
  for (let i = 0; i < boundaries.length; i++) {
    const b = boundaries[i];
    if (typeof b.leftBeat !== 'number' || b.leftBeat !== i) {
      throw new Error('INVALID_VIDEO_CUTS_LEFT_BEAT');
    }
    const pos = b.pos;
    if (!pos || typeof pos.beatIndex !== 'number' || typeof pos.pct !== 'number') {
      throw new Error('INVALID_VIDEO_CUTS_POS');
    }
    if (pos.beatIndex < 0 || pos.beatIndex >= N) throw new Error('INVALID_VIDEO_CUTS_BEAT_INDEX');
    if (pos.pct < 0 || pos.pct > 1) throw new Error('INVALID_VIDEO_CUTS_PCT');
  }
  // Non-decreasing cut times (use equal dummy durations for validation)
  const dummyDurations = Array(N).fill(1);
  const cutTimes = boundariesToCutTimes(boundaries, dummyDurations);
  for (let i = 1; i < cutTimes.length; i++) {
    if (cutTimes[i] < cutTimes[i - 1]) {
      throw new Error('INVALID_VIDEO_CUTS_NON_DECREASING');
    }
  }

  if (boundaries.length === 0) {
    session.videoCutsV1Disabled = true;
    session.videoCutsV1 = { version: 1, boundaries: [] };
  } else {
    session.videoCutsV1Disabled = false;
    session.videoCutsV1 = { ...videoCutsV1, source: 'manual' };
  }
  invalidateRenderedOutput(session);
  session.updatedAt = new Date().toISOString();
  await saveStorySession({ uid, sessionId, data: session });
  return session;
}

/**
 * Compute video segments for building global timeline from videoCutsV1.
 * @param {{ beatsDurSec: number[], shots: Array<{sentenceIndex: number, selectedClip?: {url: string}}>, videoCutsV1: { version: number, boundaries: Array<{leftBeat: number, pos: {beatIndex: number, pct: number}}> } }}
 * @returns {Array<{ clipUrl: string, inSec: number, durSec: number, globalStartSec: number, globalEndSec: number }>}
 */
function computeVideoSegmentsFromCuts({ beatsDurSec, shots, videoCutsV1 }) {
  const N = beatsDurSec.length;
  if (N === 0) return [];
  const boundaries = videoCutsV1?.boundaries ?? [];
  const cutTimes = boundariesToCutTimes(boundaries, beatsDurSec);
  const segments = [];
  let sumPrev = 0;
  for (let k = 0; k < N; k++) {
    const shot = getShotBySentenceIndex(shots, k);
    const clip = shot?.selectedClip || null;
    const clipUrl = clip?.url;
    if (!clipUrl) continue;
    const globalStartSec = cutTimes[k];
    const globalEndSec = cutTimes[k + 1];
    const durSec = globalEndSec - globalStartSec;
    const inSec = globalStartSec - sumPrev;
    sumPrev += beatsDurSec[k];
    segments.push({
      sentenceIndex: k,
      ownerSentenceIndex: k,
      clipUrl,
      clipThumbUrl: clip?.thumbUrl ?? null,
      inSec: Math.max(0, inSec),
      durSec,
      globalStartSec,
      globalEndSec,
    });
  }
  return segments;
}

/** Target clip count for auto budget. N=8 => K in [5..7]. */
function getAutoClipBudget(N, seedStr) {
  const minK = Math.max(1, Math.ceil(N * 0.6));
  const maxK = Math.min(N, Math.ceil(N * 0.875));
  const r = stableHash01(seedStr);
  return Math.floor(r * (maxK - minK + 1)) + minK;
}

/** Smart clip budget: K from [Kmin..Kmax] by script cadence + deterministic jitter. Kmax=N allows no merges when cadence high. */
function getAutoClipBudgetSmart(N, seedStr, sentences) {
  const Kmin = Math.max(1, Math.ceil(N * 0.7));
  const Kmax = N;
  const cadence = scoreScriptCadence(sentences);
  const jitter = (stableHash01(`${seedStr}:kJitter`) - 0.5) * 0.18;
  const t = clamp(0.15 + cadence + jitter, 0, 1);
  const K = Math.round(lerp(Kmin, Kmax, t));
  return clamp(K, Kmin, Kmax);
}

/** Pick boundary indices to merge. No adjacent merges. Boundary-aware mergePreference + jitter. */
function pickMergeBoundaries(N, mergesNeeded, { sessionId, sentencesHash, sentences }) {
  const maxMerges = Math.floor((N - 1 + 1) / 2);
  const toMerge = clamp(mergesNeeded, 0, maxMerges);
  if (toMerge === 0) return new Set();
  const candidates = [];
  for (let i = 0; i < N - 1; i++) {
    const curr = String(sentences[i] ?? '').trimEnd();
    const next = String(sentences[i + 1] ?? '').trim();
    const endClass = getTerminalPunct(curr);
    const fw = firstWord(next);
    const nextTokens = tokenize(next);
    const actionCount = countActionWords(nextTokens);

    let mergePreference = 0.5;
    if (endClass === 'ellipsis') mergePreference = 0.45;
    else if (endClass === 'strong' || endClass === 'semi') mergePreference = 0.2;
    else if (endClass === 'soft') mergePreference = 0.65;
    else if (endClass === 'none') mergePreference = 0.55;
    if (CONJUNCTION_WORDS.has(fw)) mergePreference += 0.15;
    if (SHIFT_WORDS.has(fw)) mergePreference -= 0.25;
    mergePreference -= Math.min(0.3, actionCount * 0.06);
    if (findPauseAnchorPct(next)?.kind === 'semi') mergePreference -= 0.15;

    const jitter = (stableHash01(`${sessionId}:${sentencesHash}:m:${i}`) - 0.5) * 0.15;
    const score = clamp(mergePreference + jitter, 0, 1);
    candidates.push({ i, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const mergeSet = new Set();
  for (const { i } of candidates) {
    if (mergeSet.size >= toMerge) break;
    if (mergeSet.has(i - 1) || mergeSet.has(i + 1)) continue;
    mergeSet.add(i);
  }
  return mergeSet;
}

/** owners[k] = start beat of group containing k. */
function buildOwners(N, mergeSet) {
  const owners = [];
  let owner = 0;
  for (let k = 0; k < N; k++) {
    if (!(k > 0 && mergeSet.has(k - 1))) {
      owner = k;
    }
    owners[k] = owner;
  }
  return owners;
}

/**
 * Compute video segments for auto mode with clip budget (fewer distinct clips).
 * Returns exactly N segments; throws if clipUrl missing.
 */
function computeVideoSegmentsFromCutsAutoBudget({
  beatsDurSec,
  shots,
  videoCutsV1,
  sessionId,
  sentences,
  sentencesHash,
}) {
  const N = beatsDurSec.length;
  if (N === 0) return [];
  const boundaries = videoCutsV1?.boundaries ?? [];
  const cutTimes = boundariesToCutTimes(boundaries, beatsDurSec);
  const pieceDur = [];
  for (let k = 0; k < N; k++) {
    pieceDur[k] = cutTimes[k + 1] - cutTimes[k];
  }
  const total = cutTimes[N] - cutTimes[0];
  const K = getAutoClipBudgetSmart(N, `${sessionId}:${sentencesHash}`, sentences);
  const mergesNeeded = N - K;
  const mergeSet = pickMergeBoundaries(N, mergesNeeded, { sessionId, sentencesHash, sentences });
  const owners = buildOwners(N, mergeSet);
  const clipByBeat = new Map();
  for (let k = 0; k < N; k++) {
    const shot = getShotBySentenceIndex(shots, k);
    clipByBeat.set(k, shot?.selectedClip || null);
  }
  const cursor = new Map();
  const segments = [];
  for (let k = 0; k < N; k++) {
    const owner = owners[k];
    const ownerClip = clipByBeat.get(owner);
    const clipUrl = ownerClip?.url;
    if (!clipUrl) {
      throw new Error(`VIDEO_CUTS_AUTO_BUDGET_MISSING_CLIP: beat=${k} owner=${owner}`);
    }
    let inSec = cursor.get(clipUrl);
    if (inSec === undefined) {
      inSec = stableHash01(`${sessionId}:${sentencesHash}:start:${owner}`) * 1.5;
      cursor.set(clipUrl, inSec);
    }
    const durSec = pieceDur[k];
    segments.push({
      sentenceIndex: k,
      ownerSentenceIndex: owner,
      clipUrl,
      clipThumbUrl: ownerClip?.thumbUrl ?? null,
      inSec,
      durSec,
      globalStartSec: cutTimes[k],
      globalEndSec: cutTimes[k + 1],
    });
    cursor.set(clipUrl, inSec + durSec);
  }
  if (segments.length !== N) {
    throw new Error(`VIDEO_CUTS_AUTO_BUDGET_SEGMENT_COUNT: expected=${N} got=${segments.length}`);
  }
  const sumDur = segments.reduce((s, seg) => s + seg.durSec, 0);
  if (Math.abs(sumDur - total) > 0.001) {
    throw new Error(`VIDEO_CUTS_AUTO_BUDGET_DURATION_MISMATCH: sum=${sumDur} total=${total}`);
  }
  return segments;
}

function buildCaptionMetaForBeat({ session, beatIndex, textRaw, overlayCaption }) {
  const compiled = compileCaptionSSOT({
    textRaw,
    style: overlayCaption || {},
    frameW: 1080,
    frameH: 1920,
  });
  const beatMeta = session?.beats?.[beatIndex]?.captionMeta;
  const currentTextHash = crypto
    .createHash('sha256')
    .update(textRaw.trim().toLowerCase())
    .digest('hex')
    .slice(0, 16);

  if (
    beatMeta?.lines &&
    beatMeta?.styleHash &&
    beatMeta?.textHash === currentTextHash &&
    beatMeta?.styleHash === compiled.styleHash
  ) {
    return beatMeta;
  }

  return {
    lines: compiled.lines,
    effectiveStyle: compiled.effectiveStyle,
    styleHash: compiled.styleHash,
    wrapHash: compiled.wrapHash,
    textHash: currentTextHash,
    maxWidthPx: compiled.maxWidthPx,
    totalTextH: compiled.totalTextH,
  };
}

async function buildStoredRenderBeatCaptionInput({
  session,
  beatIndex,
  caption,
  timing,
  audioPath,
}) {
  const overlayCaption = session.overlayCaption || session.captionStyle || {};
  const textRaw = session.story?.sentences?.[beatIndex] ?? caption.text;
  const captionMeta = buildCaptionMetaForBeat({
    session,
    beatIndex,
    textRaw,
    overlayCaption,
  });

  const assPath = await buildKaraokeASSFromTimestamps({
    text: caption.text,
    timestamps: timing.timestamps,
    durationMs: timing.durationMs,
    audioPath,
    wrappedText: captionMeta.lines.join('\n'),
    overlayCaption: captionMeta.effectiveStyle,
    width: 1080,
    height: 1920,
  });

  return {
    assPath,
    meta: captionMeta,
    sentenceText: textRaw,
    overlayCaption,
  };
}

function buildCaptionsFromBeatDurations(sentences = [], beatDurationsMs = []) {
  let cursorMs = 0;
  return sentences.map((sentence, sentenceIndex) => {
    const durationMs = Math.max(0, Number(beatDurationsMs[sentenceIndex]) || 0);
    const startMs = cursorMs;
    const endMs = cursorMs + durationMs;
    cursorMs = endMs;
    return {
      sentenceIndex,
      text: sentence,
      startTimeSec: billingMsToSeconds(startMs),
      endTimeSec: billingMsToSeconds(endMs),
    };
  });
}

function getBeatNarrationMeta(session, beatIndex) {
  const beat = session?.beats?.[beatIndex];
  if (!beat || typeof beat !== 'object') return null;
  return beat.narration && typeof beat.narration === 'object' ? beat.narration : null;
}

async function loadStoredBeatTimingData(session, beatIndex) {
  const narration = getBeatNarrationMeta(session, beatIndex);
  if (!narration?.timingStoragePath) {
    const error = new Error('VOICE_SYNC_ARTIFACT_MISSING');
    error.code = 'VOICE_SYNC_ARTIFACT_MISSING';
    error.status = 409;
    throw error;
  }
  return await readPrivateJson(narration.timingStoragePath);
}

function resolveStoredRenderBeatDurationDetails({ narration, timing, caption }) {
  const narrationDurationSec = Number(narration?.durationSec);
  if (Number.isFinite(narrationDurationSec) && narrationDurationSec > 0) {
    return { durationSec: narrationDurationSec, durationSource: 'narration.durationSec' };
  }

  const timingDurationMs = Number(timing?.durationMs) || 0;
  const timingDurationSec = billingMsToSeconds(timingDurationMs);
  if (Number.isFinite(timingDurationSec) && timingDurationSec > 0) {
    return { durationSec: timingDurationSec, durationSource: 'timing.durationMs' };
  }

  const captionSpanSec = Math.max(
    0,
    Number(caption?.endTimeSec || 0) - Number(caption?.startTimeSec || 0)
  );
  return { durationSec: captionSpanSec, durationSource: 'caption.span' };
}

function resolveStoredRenderBeatDurationSec({ narration, timing, caption }) {
  return resolveStoredRenderBeatDurationDetails({ narration, timing, caption }).durationSec;
}

async function buildStoredRenderBeat({ session, beatIndex, tmpDir }) {
  const caption = session.captions.find((item) => item.sentenceIndex === beatIndex);
  if (!caption) {
    const error = new Error('VOICE_SYNC_CAPTION_MISSING');
    error.code = 'VOICE_SYNC_CAPTION_MISSING';
    error.status = 409;
    throw error;
  }

  const narration = getBeatNarrationMeta(session, beatIndex);
  if (!narration?.audioStoragePath || !narration?.timingStoragePath) {
    const error = new Error('VOICE_SYNC_ARTIFACT_MISSING');
    error.code = 'VOICE_SYNC_ARTIFACT_MISSING';
    error.status = 409;
    throw error;
  }

  const audioPath = await downloadPrivateObjectToTmp({
    bucketPath: narration.audioStoragePath,
    tmpDir,
    name: `voice_${beatIndex}.mp3`,
  });
  const timing = await loadStoredBeatTimingData(session, beatIndex);
  const captionInput = await buildStoredRenderBeatCaptionInput({
    session,
    beatIndex,
    caption,
    timing,
    audioPath,
  });

  return {
    ttsPath: audioPath,
    assPath: captionInput.assPath,
    durationSec: resolveStoredRenderBeatDurationSec({ narration, timing, caption }),
    caption,
    meta: captionInput.meta,
    sentenceText: captionInput.sentenceText,
    overlayCaption: captionInput.overlayCaption,
  };
}

export async function buildStoryVoiceSyncPlan({
  uid,
  sessionId,
  mode = 'stale',
  voicePreset = null,
  voicePacePreset = null,
}) {
  const session = await loadStorySession({ uid, sessionId });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  if (!Array.isArray(session?.story?.sentences) || session.story.sentences.length === 0) {
    throw new Error('STORY_REQUIRED');
  }

  validateStoryCharacterLimits(session.story.sentences);
  const plan = buildVoiceSyncPlan(session, {
    mode,
    voicePreset,
    voicePacePreset,
  });

  session.voiceSync = {
    ...normalizeVoiceSyncSummary(session),
    nextEstimatedChargeSec: plan.nextEstimatedChargeSec,
  };
  return {
    session,
    plan,
  };
}

export async function syncStoryVoice({
  uid,
  sessionId,
  mode = 'stale',
  voicePreset = null,
  voicePacePreset = null,
  session: preloadedSession = null,
  plan: preloadedPlan = null,
}) {
  ensureTimestampCapableVoiceSync();

  const { session, plan } =
    preloadedSession && preloadedPlan
      ? { session: preloadedSession, plan: preloadedPlan }
      : await buildStoryVoiceSyncPlan({
          uid,
          sessionId,
          mode,
          voicePreset,
          voicePacePreset,
        });
  const now = new Date().toISOString();

  if (plan.matchesStoredFingerprint) {
    session.voicePreset = plan.voice.voicePresetKey;
    session.voicePacePreset = plan.voice.voicePacePreset;
    session.voiceSync = {
      ...normalizeVoiceSyncSummary(session),
      state: 'current',
      staleScope: 'none',
      staleBeatIndices: [],
      currentFingerprint: plan.fullFingerprint,
      nextEstimatedChargeSec: 0,
      lastChargeSec: 0,
      cached: true,
    };
    session.updatedAt = now;
    setHeuristicBillingEstimate(session);
    await saveStorySession({ uid, sessionId, data: session });
    return {
      session,
      billedSec: 0,
      cached: true,
    };
  }

  if (!Array.isArray(session.beats)) session.beats = [];
  const beatDurationsMs = [];
  const localAudioPaths = new Map();

  for (let beatIndex = 0; beatIndex < session.story.sentences.length; beatIndex += 1) {
    const sentence = session.story.sentences[beatIndex];
    const targetFingerprint = plan.beatFingerprints[beatIndex];
    const currentNarration = getBeatNarrationMeta(session, beatIndex);
    const shouldRegenerate =
      plan.scope === 'full' ||
      plan.targetIndices.includes(beatIndex) ||
      currentNarration?.fingerprint !== targetFingerprint ||
      !currentNarration?.audioStoragePath ||
      !currentNarration?.timingStoragePath;

    if (!session.beats[beatIndex] || typeof session.beats[beatIndex] !== 'object') {
      session.beats[beatIndex] = {};
    }

    if (!shouldRegenerate) {
      beatDurationsMs[beatIndex] = secondsToBillingMs(currentNarration.durationSec);
      if (!(beatDurationsMs[beatIndex] > 0)) {
        const storedTiming = await loadStoredBeatTimingData(session, beatIndex);
        beatDurationsMs[beatIndex] = Number(storedTiming?.durationMs) || 0;
      }
      continue;
    }

    const ttsResult = await synthVoiceWithTimestamps({
      text: sentence,
      voiceId: plan.voice.voiceId,
      modelId: plan.voice.modelId,
      outputFormat: 'mp3_44100_128',
      voiceSettings: plan.voice.voiceSettings,
    });
    if (!ttsResult.audioPath || !ttsResult.timestamps) {
      const error = new Error('VOICE_SYNC_GENERATION_FAILED');
      error.code = 'VOICE_SYNC_GENERATION_FAILED';
      error.status = 503;
      throw error;
    }

    const durationMs =
      Number(ttsResult.durationMs) > 0
        ? Number(ttsResult.durationMs)
        : await getDurationMsFromMedia(ttsResult.audioPath);
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      const error = new Error('VOICE_SYNC_DURATION_UNAVAILABLE');
      error.code = 'VOICE_SYNC_DURATION_UNAVAILABLE';
      error.status = 500;
      throw error;
    }

    const audioStoragePath = buildStorageObjectPath({
      uid,
      sessionId,
      fingerprint: targetFingerprint,
      ext: 'mp3',
    });
    const timingStoragePath = buildStorageObjectPath({
      uid,
      sessionId,
      fingerprint: targetFingerprint,
      ext: 'json',
    });

    await uploadPrivateLocalFile({
      localPath: ttsResult.audioPath,
      bucketPath: audioStoragePath,
      contentType: SYNC_AUDIO_CONTENT_TYPE,
    });
    await savePrivateObject({
      bucketPath: timingStoragePath,
      body: Buffer.from(
        JSON.stringify({
          schemaVersion: VOICE_SYNC_SCHEMA_VERSION,
          beatIndex,
          text: sentence,
          durationMs,
          timestamps: ttsResult.timestamps,
          voice: plan.voice,
          fingerprint: targetFingerprint,
          syncedAt: now,
        }),
        'utf8'
      ),
      contentType: SYNC_TIMING_CONTENT_TYPE,
    });

    session.beats[beatIndex].narration = {
      schemaVersion: VOICE_SYNC_SCHEMA_VERSION,
      fingerprint: targetFingerprint,
      durationSec: billingMsToSeconds(durationMs),
      audioStoragePath,
      timingStoragePath,
      syncedAt: now,
    };
    beatDurationsMs[beatIndex] = durationMs;
    localAudioPaths.set(beatIndex, ttsResult.audioPath);
  }

  const previewTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaiform-sync-preview-'));
  try {
    const previewAudioPaths = [];
    for (let beatIndex = 0; beatIndex < session.story.sentences.length; beatIndex += 1) {
      if (localAudioPaths.has(beatIndex)) {
        previewAudioPaths.push(localAudioPaths.get(beatIndex));
        continue;
      }
      const narration = getBeatNarrationMeta(session, beatIndex);
      const audioPath = await downloadPrivateObjectToTmp({
        bucketPath: narration.audioStoragePath,
        tmpDir: previewTmpDir,
        name: `reuse_${beatIndex}.mp3`,
      });
      previewAudioPaths.push(audioPath);
      beatDurationsMs[beatIndex] =
        beatDurationsMs[beatIndex] || secondsToBillingMs(narration.durationSec);
    }

    const previewLocalPath = path.join(previewTmpDir, 'preview.mp3');
    await concatenateAudioFiles({
      audioPaths: previewAudioPaths,
      outPath: previewLocalPath,
    });
    const previewStoragePath = `artifacts/${uid}/${sessionId}/sync/${plan.fullFingerprint}/preview.mp3`;
    const previewUpload = await uploadPublic(
      previewLocalPath,
      previewStoragePath,
      SYNC_PREVIEW_CONTENT_TYPE
    );
    const totalDurationMs = beatDurationsMs.reduce(
      (sum, value) => sum + (Number.isFinite(Number(value)) ? Number(value) : 0),
      0
    );
    const billedMs = computeSyncChargeMs(
      plan.targetIndices.reduce(
        (sum, beatIndex) => sum + (Number(beatDurationsMs[beatIndex]) || 0),
        0
      )
    );

    session.captions = buildCaptionsFromBeatDurations(session.story.sentences, beatDurationsMs);
    session.voicePreset = plan.voice.voicePresetKey;
    session.voicePacePreset = plan.voice.voicePacePreset;
    session.voiceSync = {
      ...normalizeVoiceSyncSummary(session),
      state: 'current',
      staleScope: 'none',
      staleBeatIndices: [],
      currentFingerprint: plan.fullFingerprint,
      nextEstimatedChargeSec: 0,
      totalDurationSec: billingMsToSeconds(totalDurationMs),
      previewAudioUrl: previewUpload.publicUrl,
      previewAudioStoragePath: previewStoragePath,
      previewAudioDurationSec: billingMsToSeconds(totalDurationMs),
      lastChargeSec: billingMsToSeconds(billedMs),
      totalBilledSec: billingMsToSeconds(
        secondsToBillingMs(normalizeVoiceSyncSummary(session).totalBilledSec) + billedMs
      ),
      lastSyncedAt: now,
      cached: false,
    };
    invalidateDraftPreviewBase(session, 'VOICE_SYNC_CHANGED');
    session.status = session.finalVideo ? session.status : 'voice_synced';
    session.updatedAt = now;
    setHeuristicBillingEstimate(session);
    await saveStorySession({ uid, sessionId, data: session });

    return {
      session,
      billedSec: billingMsToSeconds(billedMs),
      cached: false,
    };
  } finally {
    try {
      if (fs.existsSync(previewTmpDir)) {
        fs.rmSync(previewTmpDir, { recursive: true, force: true });
      }
    } catch {
      // Best-effort temp cleanup.
    }
  }
}

/**
 * Render final video (Phase 6)
 * Renders each clip with its caption, then concatenates
 */
async function renderStoryLegacy({ uid, sessionId }) {
  const session = await loadStorySession({ uid, sessionId });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  const syncSummary = normalizeVoiceSyncSummary(session);
  if (syncSummary.state === 'never_synced') {
    const error = new Error('VOICE_SYNC_REQUIRED');
    error.code = 'VOICE_SYNC_REQUIRED';
    error.status = 409;
    throw error;
  }
  if (syncSummary.state !== 'current') {
    const error = new Error('VOICE_SYNC_STALE');
    error.code = 'VOICE_SYNC_STALE';
    error.status = 409;
    throw error;
  }
  if (!session.shots || !session.captions) {
    throw new Error('SHOTS_AND_CAPTIONS_REQUIRED');
  }

  const N = session.story?.sentences?.length ?? 0;
  const enableVideoCutsV1 =
    process.env.ENABLE_VIDEO_CUTS_V1 === 'true' || process.env.ENABLE_VIDEO_CUTS_V1 === '1';
  const voicePreset = getVoicePreset(session.voicePreset || DEFAULT_VOICE_PRESET_KEY);
  const sentences = session.story?.sentences ?? [];
  const currentSentencesHash = sentencesHash(sentences);

  let hasClipsForAllBeats = N > 0;
  if (hasClipsForAllBeats) {
    for (let b = 0; b < N; b++) {
      const shot = session.shots.find((s) => s.sentenceIndex === b);
      if (!shot?.selectedClip?.url) {
        hasClipsForAllBeats = false;
        break;
      }
    }
  }

  let source = 'classic';
  let videoCutsV1ToUse = null;
  let useVideoCutsV1 = false;

  if (enableVideoCutsV1 && hasClipsForAllBeats && N >= 2 && session.videoCutsV1Disabled !== true) {
    const v1 = session.videoCutsV1;
    const bounds = v1?.boundaries;
    const hasValidExisting =
      bounds &&
      Array.isArray(bounds) &&
      bounds.length === N - 1 &&
      bounds.every((b, i) => {
        if (typeof b.leftBeat !== 'number' || b.leftBeat !== i) return false;
        const pos = b.pos;
        if (!pos || typeof pos.beatIndex !== 'number' || typeof pos.pct !== 'number') return false;
        if (pos.beatIndex < i + 1 || pos.beatIndex >= N) return false;
        if (pos.pct < 0 || pos.pct > 1) return false;
        return true;
      });

    if (!hasValidExisting && bounds && bounds.length > 0) {
      source = 'invalid';
    } else if (!hasValidExisting) {
      const autoCuts = buildAutoVideoCutsV1({ sessionId: session.id, sentences });
      session.videoCutsV1 = {
        version: 1,
        boundaries: autoCuts.boundaries,
        source: 'auto',
        sentencesHash: currentSentencesHash,
        autoGenV: AUTO_CUTS_GEN_V,
      };
      videoCutsV1ToUse = session.videoCutsV1;
      source = 'auto';
      useVideoCutsV1 = true;
    } else if (v1.source !== 'auto') {
      source = 'manual';
      videoCutsV1ToUse = v1;
      useVideoCutsV1 = true;
    } else if (v1.sentencesHash === currentSentencesHash && v1.autoGenV === AUTO_CUTS_GEN_V) {
      source = 'auto';
      videoCutsV1ToUse = v1;
      useVideoCutsV1 = true;
    } else {
      const autoCuts = buildAutoVideoCutsV1({ sessionId: session.id, sentences });
      session.videoCutsV1 = {
        version: 1,
        boundaries: autoCuts.boundaries,
        source: 'auto',
        sentencesHash: currentSentencesHash,
        autoGenV: AUTO_CUTS_GEN_V,
      };
      videoCutsV1ToUse = session.videoCutsV1;
      source = 'auto';
      useVideoCutsV1 = true;
    }
  }

  console.log('[videoCuts]', 'source=' + source, {
    sessionId: session.id,
    pcts: source !== 'classic' ? videoCutsV1ToUse?.boundaries?.map((b) => b.pos.pct) : undefined,
  });

  const shotsWithClips = session.shots.filter((s) => s.selectedClip?.url);
  if (shotsWithClips.length === 0) {
    throw new Error('NO_CLIPS_SELECTED');
  }

  // Create temp directory for rendered segments
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaiform-story-render-'));
  const renderedSegments = [];
  const segmentErrors = [];

  try {
    if (useVideoCutsV1) {
      // --- ENABLE_VIDEO_CUTS_V1: single flow Ã¢â‚¬â€ beatsDurSec Ã¢â€ â€™ cutTimes Ã¢â€ â€™ globalTimeline Ã¢â€ â€™ slice per beat Ã¢â€ â€™ overlay
      const { getDurationMsFromMedia } = await import('../utils/media.duration.js');
      const overlayCaption = session.overlayCaption || session.captionStyle;
      const beatsDurSecArr = [];
      const perBeat = []; // { ttsPath, assPath, durationSec, caption, meta, sentenceText }
      for (let b = 0; b < N; b++) {
        const shot = session.shots.find((s) => s.sentenceIndex === b);
        const caption = session.captions.find((c) => c.sentenceIndex === b);
        if (!caption) {
          console.warn(`[story.service] [v1] No caption for beat ${b}`);
          continue;
        }
        let ttsPath = null;
        let assPath = null;
        try {
          const ttsResult = await synthVoiceWithTimestamps({
            text: caption.text,
            voiceId: voicePreset.voiceId,
            modelId: process.env.ELEVEN_TTS_MODEL || 'eleven_flash_v2_5',
            outputFormat: 'mp3_44100_128',
            voiceSettings: voicePreset.voiceSettings,
          });
          if (ttsResult.audioPath && ttsResult.timestamps) {
            ttsPath = ttsResult.audioPath;
            let ttsDurationMs = ttsResult.durationMs;
            if (!ttsDurationMs && ttsPath) {
              try {
                ttsDurationMs = await getDurationMsFromMedia(ttsPath);
              } catch {
                // Keep provider duration when probing fails.
              }
            }
            const currentTextRaw = session.story?.sentences?.[b] ?? caption.text;
            let meta = null;
            const beatMeta = session.beats?.[b]?.captionMeta;
            let isStale = false;
            if (beatMeta?.lines && beatMeta?.styleHash && beatMeta?.textHash) {
              const currentTextHash = crypto
                .createHash('sha256')
                .update(currentTextRaw.trim().toLowerCase())
                .digest('hex')
                .slice(0, 16);
              const currentStyleHash = compileCaptionSSOT({
                textRaw: currentTextRaw,
                style: overlayCaption || {},
                frameW: 1080,
                frameH: 1920,
              }).styleHash;
              if (beatMeta.textHash !== currentTextHash || beatMeta.styleHash !== currentStyleHash)
                isStale = true;
            }
            if (beatMeta?.lines && beatMeta?.styleHash && !isStale) {
              meta = beatMeta;
            } else {
              meta = compileCaptionSSOT({
                textRaw: currentTextRaw,
                style: overlayCaption || {},
                frameW: 1080,
                frameH: 1920,
              });
            }
            const wrappedText = meta.lines.join('\n');
            assPath = await buildKaraokeASSFromTimestamps({
              text: caption.text,
              timestamps: ttsResult.timestamps,
              durationMs: ttsDurationMs,
              audioPath: ttsPath,
              wrappedText,
              overlayCaption: meta.effectiveStyle,
              width: 1080,
              height: 1920,
            });
          }
        } catch (e) {
          console.warn(`[story.service] [v1] TTS/ASS failed for beat ${b}:`, e?.message);
        }
        let durationSec = 3;
        if (ttsPath) {
          try {
            const ttsDurationMs = await getDurationMsFromMedia(ttsPath);
            if (ttsDurationMs) durationSec = ttsDurationMs / 1000;
            else durationSec = caption.endTimeSec - caption.startTimeSec || shot?.durationSec || 3;
          } catch {
            durationSec = caption.endTimeSec - caption.startTimeSec || shot?.durationSec || 3;
          }
        } else {
          durationSec = caption.endTimeSec - caption.startTimeSec || shot?.durationSec || 3;
        }
        beatsDurSecArr.push(durationSec);
        perBeat.push({
          ttsPath,
          assPath,
          durationSec,
          caption,
          meta: session.beats?.[b]?.captionMeta ?? null,
          sentenceText: session.story?.sentences?.[b] ?? caption.text,
          overlayCaption: overlayCaption || session.captionStyle,
        });
      }
      if (beatsDurSecArr.length !== N) {
        throw new Error('VIDEO_CUTS_V1_TTS_FAILED');
      }
      const cutTimes = boundariesToCutTimes(videoCutsV1ToUse.boundaries, beatsDurSecArr);
      const segments =
        source === 'auto'
          ? computeVideoSegmentsFromCutsAutoBudget({
              beatsDurSec: beatsDurSecArr,
              shots: session.shots,
              videoCutsV1: videoCutsV1ToUse,
              sessionId: session.id,
              sentences,
              sentencesHash: currentSentencesHash,
            })
          : computeVideoSegmentsFromCuts({
              beatsDurSec: beatsDurSecArr,
              shots: session.shots,
              videoCutsV1: videoCutsV1ToUse,
            });
      if (segments.length === 0) {
        throw new Error('VIDEO_CUTS_V1_NO_SEGMENTS');
      }
      const fetchedCache = new Map();
      const trimmedPaths = [];
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        let fetched = fetchedCache.get(seg.clipUrl);
        if (!fetched) {
          fetched = await fetchVideoToTmp(seg.clipUrl);
          fetchedCache.set(seg.clipUrl, fetched);
        }
        const outSeg = path.join(tmpDir, `v1_seg_${i}.mp4`);
        await trimClipToSegment({
          path: fetched.path,
          inSec: seg.inSec,
          durSec: seg.durSec,
          outPath: outSeg,
          options: { width: 1080, height: 1920 },
        });
        trimmedPaths.push({ path: outSeg, durationSec: seg.durSec });
      }
      const globalTimelinePath = path.join(tmpDir, 'v1_global.mp4');
      await concatenateClipsVideoOnly({
        clips: trimmedPaths,
        outPath: globalTimelinePath,
        options: { width: 1080, height: 1920, fps: 24 },
      });
      let beatStartSec = 0;
      const colorMetaCacheV1 = new Map();
      for (let b = 0; b < N; b++) {
        const info = perBeat[b];
        const durationSec = beatsDurSecArr[b];
        const slicePath = path.join(tmpDir, `v1_slice_${b}.mp4`);
        await extractSegmentFromFile({
          path: globalTimelinePath,
          startSec: beatStartSec,
          durSec: durationSec,
          outPath: slicePath,
          options: { width: 1080, height: 1920 },
        });
        const segmentPath = path.join(tmpDir, `segment_${b}.mp4`);
        await renderVideoQuoteOverlay({
          videoPath: slicePath,
          outPath: segmentPath,
          width: 1080,
          height: 1920,
          durationSec,
          fps: 24,
          text: info.caption.text,
          captionText: info.caption.text,
          ttsPath: info.ttsPath,
          assPath: info.assPath,
          overlayCaption: info.overlayCaption,
          keepVideoAudio: true,
          bgAudioVolume: 0.5,
          watermark: true,
          padSec: 0,
          colorMetaCache: colorMetaCacheV1,
        });
        renderedSegments.push({ path: segmentPath, durationSec });
        beatStartSec += durationSec;
      }
    } else {
      // --- Current path: one clip per beat (shared color probe cache to avoid re-probing same videoPath)
      const colorMetaCache = new Map();
      for (let i = 0; i < shotsWithClips.length; i++) {
        const shot = shotsWithClips[i];
        const caption = session.captions.find((c) => c.sentenceIndex === shot.sentenceIndex);

        if (!caption) {
          console.warn(
            `[story.service] No caption found for shot ${i}, sentenceIndex ${shot.sentenceIndex}`
          );
          continue;
        }

        try {
          // Generate TTS with timestamps for this caption
          let ttsPath = null;
          let assPath = null;

          try {
            console.log(
              `[story.service] Generating TTS for segment ${i}: "${caption.text.substring(0, 50)}..."`
            );
            const ttsResult = await synthVoiceWithTimestamps({
              text: caption.text,
              voiceId: voicePreset.voiceId,
              modelId: process.env.ELEVEN_TTS_MODEL || 'eleven_flash_v2_5',
              outputFormat: 'mp3_44100_128',
              voiceSettings: voicePreset.voiceSettings,
            });

            if (ttsResult.audioPath && ttsResult.timestamps) {
              ttsPath = ttsResult.audioPath;

              // Build ASS file from timestamps with overlay styling (SSOT)
              try {
                // Check if session has overlay caption styling
                const overlayCaption = session.overlayCaption || session.captionStyle;

                // Safety guard: Warn if dangerous fields present
                if (overlayCaption) {
                  const dangerousKeys = ['mode', 'lines', 'rasterUrl', 'rasterHash'];
                  const foundDangerous = dangerousKeys.filter((k) =>
                    Object.prototype.hasOwnProperty.call(overlayCaption, k)
                  );
                  if (foundDangerous.length > 0) {
                    console.warn(
                      `[render-guard] Found dangerous fields in overlayCaption: ${foundDangerous.join(', ')}. These should not be in global style.`
                    );
                  }
                }

                // Get TTS duration for accurate timing
                let ttsDurationMs = ttsResult.durationMs;
                if (!ttsDurationMs && ttsPath) {
                  try {
                    const { getDurationMsFromMedia } = await import('../utils/media.duration.js');
                    ttsDurationMs = await getDurationMsFromMedia(ttsPath);
                  } catch (err) {
                    console.warn(`[story.service] Could not get TTS duration:`, err?.message);
                  }
                }

                // Ã¢Å“â€¦ CORRECT PRECEDENCE: Prefer beat-specific captionMeta (SSOT persisted), but verify staleness
                // Each beat has different text, so meta must be per-beat
                let wrappedText = null;
                let meta = null;

                const beatMeta = session.beats?.[i]?.captionMeta;

                // Ã¢Å“â€¦ STALENESS DETECTION: Verify beatMeta is still valid before using
                let isStale = false;
                if (beatMeta?.lines && beatMeta?.styleHash && beatMeta?.textHash) {
                  // Compute current text hash (canonical source: session.story.sentences[i])
                  const currentTextRaw = session.story?.sentences?.[i] || caption.text || '';
                  const currentTextHash = crypto
                    .createHash('sha256')
                    .update(currentTextRaw.trim().toLowerCase())
                    .digest('hex')
                    .slice(0, 16);

                  // Compute current style hash (from current overlayCaption merged with defaults)
                  const currentStyleHash = compileCaptionSSOT({
                    textRaw: currentTextRaw,
                    style: overlayCaption || {},
                    frameW: 1080,
                    frameH: 1920,
                  }).styleHash;

                  // Check for staleness
                  if (
                    beatMeta.textHash !== currentTextHash ||
                    beatMeta.styleHash !== currentStyleHash
                  ) {
                    isStale = true;
                    console.warn('[render:ssot:staleness] Beat meta is stale, recompiling:', {
                      beatIndex: i,
                      textHashMismatch: beatMeta.textHash !== currentTextHash,
                      styleHashMismatch: beatMeta.styleHash !== currentStyleHash,
                    });
                  }
                }

                if (beatMeta?.lines && beatMeta?.styleHash && !isStale) {
                  meta = beatMeta;
                  wrappedText = meta.lines.join('\n');
                  console.log('[render:ssot] Using stored beat meta:', {
                    beatIndex: i,
                    styleHash: meta.styleHash,
                    linesCount: meta.lines.length,
                    letterSpacingPx: meta.effectiveStyle.letterSpacingPx,
                  });
                } else {
                  // Compile fresh meta from caption.textRaw + session.overlayCaption (style-only, already sanitized)
                  const currentTextRaw = session.story?.sentences?.[i] || caption.text || '';
                  meta = compileCaptionSSOT({
                    textRaw: currentTextRaw,
                    style: overlayCaption || {}, // overlayCaption is style-only, sanitized by extractStyleOnly() in update route
                    frameW: 1080,
                    frameH: 1920,
                  });
                  wrappedText = meta.lines.join('\n');
                  console.log('[render:ssot] Compiled fresh meta:', {
                    beatIndex: i,
                    styleHash: meta.styleHash,
                    linesCount: meta.lines.length,
                    letterSpacingPx: meta.effectiveStyle.letterSpacingPx,
                    reason: isStale ? 'stale' : 'missing',
                  });
                }

                assPath = await buildKaraokeASSFromTimestamps({
                  text: caption.text,
                  timestamps: ttsResult.timestamps,
                  durationMs: ttsDurationMs,
                  audioPath: ttsPath, // Pass audio path for duration verification and scaling
                  wrappedText: wrappedText, // Pass wrapped text for line breaks
                  overlayCaption: meta.effectiveStyle, // Ã¢Å“â€¦ Pass compiler output (SSOT) as overlayCaption
                  width: 1080,
                  height: 1920,
                });
                console.log(
                  `[story.service] Generated ASS file for segment ${i}${overlayCaption ? ' with overlay styling' : ' with default styling'}`
                );
                if (ttsDurationMs) {
                  console.log(
                    `[story.service] Segment ${i} ASS dialogue will end at: ${((ttsDurationMs + 150) / 1000).toFixed(2)}s (TTS: ${(ttsDurationMs / 1000).toFixed(2)}s + 150ms fade-out)`
                  );
                }
              } catch (assError) {
                console.warn(
                  `[story.service] Failed to generate ASS file for segment ${i}:`,
                  assError.message
                );
                // Continue without ASS highlighting
              }
            } else {
              console.warn(
                `[story.service] TTS generation failed or returned no timestamps for segment ${i}`
              );
            }
          } catch (ttsError) {
            console.warn(
              `[story.service] TTS generation error for segment ${i}:`,
              ttsError.message
            );
            // Continue without TTS
          }

          // Fetch clip to temp file
          const fetched = await fetchVideoToTmp(shot.selectedClip.url);

          // Calculate duration - TTS duration is the primary source for synchronization
          let durationSec;
          if (ttsPath) {
            // TTS duration is the primary source - use it directly
            try {
              const { getDurationMsFromMedia } = await import('../utils/media.duration.js');
              const ttsDurationMs = await getDurationMsFromMedia(ttsPath);
              if (ttsDurationMs) {
                const ttsDurationSec = ttsDurationMs / 1000;
                // Use TTS duration directly without buffer to allow natural breath gaps between segments.
                // Clips will continue showing during the gap since segments are concatenated sequentially.
                // Caption disappears when speech finishes (no buffer), allowing clip to remain visible during breath gap.
                durationSec = ttsDurationSec;
                console.log(
                  `[story.service] Segment ${i} duration from TTS: ${ttsDurationSec.toFixed(2)}s (no buffer, allows natural breath gaps)`
                );
              } else {
                // Fallback if duration probe fails
                durationSec = caption.endTimeSec - caption.startTimeSec || shot.durationSec || 3;
                console.warn(
                  `[story.service] Segment ${i} TTS duration probe returned null, using caption timing: ${durationSec.toFixed(2)}s`
                );
              }
            } catch (err) {
              console.warn(
                `[story.service] Failed to get TTS duration for segment ${i}, using caption timing:`,
                err?.message
              );
              durationSec = caption.endTimeSec - caption.startTimeSec || shot.durationSec || 3;
            }
          } else {
            // No TTS - use caption timing or shot duration
            durationSec = caption.endTimeSec - caption.startTimeSec;
            if (durationSec <= 0) {
              durationSec = shot.durationSec || 3;
            }
            console.log(
              `[story.service] Segment ${i} duration from caption/shot (no TTS): ${durationSec.toFixed(2)}s`
            );
          }

          // Probe clip duration and calculate deficit for padding
          // CRITICAL: durationSec must be computed BEFORE this step
          const { getDurationMsFromMedia } = await import('../utils/media.duration.js');
          const clipDurMs = await getDurationMsFromMedia(fetched.path);
          const clipDurSec = clipDurMs ? clipDurMs / 1000 : null;
          const deficitSec =
            Number.isFinite(clipDurSec) && Number.isFinite(durationSec)
              ? Math.max(0, durationSec - clipDurSec)
              : 0;
          const rawPadSec = deficitSec > 0.25 ? deficitSec : 0;
          const padSec = Math.min(rawPadSec, 5); // Cap at 5s to prevent pathological padding

          if (padSec > 0) {
            console.log(
              `[story.service] Segment ${i} clipDur=${clipDurSec.toFixed(2)}s, audioDur=${durationSec.toFixed(2)}s, deficit=${deficitSec.toFixed(2)}s, padding=${padSec.toFixed(2)}s`
            );
          }

          // Render segment with caption, TTS, and ASS highlighting
          const segmentPath = path.join(tmpDir, `segment_${i}.mp4`);

          // Check if session has overlay caption styling to pass to render
          const overlayCaption = session.overlayCaption || session.captionStyle;

          // PROBE (Commit 0): gated debug logs. Remove after confirming behavior.
          if (process.env.PROBE_SESSION_STRUCTURE === '1') {
            const oc = overlayCaption || {};
            const hasRaster = Boolean(
              oc.rasterUrl || oc.rasterDataUrl || oc.rasterPng || oc.storagePath
            );
            console.log('[PROBE:SESSION_STRUCTURE]', {
              ts: new Date().toISOString(),
              uid,
              sessionId,
              hasSessionOverlayCaption: Boolean(session.overlayCaption),
              hasSessionCaptionStyle: Boolean(session.captionStyle),
              overlayCaptionMode: oc.mode || null,
              hasRaster,
              rasterUrlLength: (oc.rasterUrl || oc.rasterDataUrl || oc.rasterPng || '').length || 0,
              storagePath: oc.storagePath || null,
              keys: Object.keys(oc).slice(0, 60),
            });
          }

          // PROBE (Commit 0): gated debug logs. Remove after confirming behavior.
          if (process.env.PROBE_PER_BEAT_TEXT === '1') {
            const oc = overlayCaption || {};
            console.log('[PROBE:PER_BEAT_TEXT]', {
              ts: new Date().toISOString(),
              sentenceIndex: caption.sentenceIndex,
              text: caption.text?.substring(0, 50) || null,
              overlayCaptionMode: oc.mode || null,
              hasRaster: Boolean(oc.rasterUrl || oc.rasterDataUrl || oc.storagePath),
            });
          }

          await renderVideoQuoteOverlay({
            videoPath: fetched.path,
            outPath: segmentPath,
            width: 1080,
            height: 1920,
            durationSec,
            fps: 24,
            text: caption.text,
            captionText: caption.text,
            ttsPath: ttsPath,
            assPath: assPath, // ASS file for word highlighting (overlays on top of existing captions)
            overlayCaption: overlayCaption, // Pass overlay styling for caption rendering
            keepVideoAudio: true, // Keep background audio (will auto-detect if audio exists)
            bgAudioVolume: 0.5,
            watermark: true,
            padSec: padSec,
            colorMetaCache,
          });

          renderedSegments.push({
            path: segmentPath,
            durationSec,
          });

          console.log(
            `[story.service] Successfully rendered segment ${i}/${shotsWithClips.length - 1}: "${caption.text.substring(0, 50)}..."`
          );
        } catch (error) {
          const errorMsg = error?.message || error?.stderr || String(error);
          console.warn(
            `[story.service] Render failed for segment ${i} (sentence "${caption.text.substring(0, 50)}..."):`,
            errorMsg
          );
          segmentErrors.push({
            segmentIndex: i,
            sentenceIndex: shot.sentenceIndex,
            error: errorMsg,
          });
          // Continue with other segments
        }
      }
    }

    if (renderedSegments.length === 0) {
      const errorDetail =
        segmentErrors.length > 0
          ? `All ${segmentErrors.length} segments failed. First error: ${segmentErrors[0].error}`
          : 'No segments were attempted';
      throw new Error(`NO_SEGMENTS_RENDERED: ${errorDetail}`);
    }

    // Log summary of successes and failures
    if (segmentErrors.length > 0) {
      console.warn(
        `[story.service] Rendered ${renderedSegments.length}/${shotsWithClips.length} segments successfully. ${segmentErrors.length} segments failed.`
      );
    } else {
      console.log(`[story.service] Successfully rendered all ${renderedSegments.length} segments.`);
    }

    // Concatenate all segments
    const finalPath = path.join(tmpDir, 'final.mp4');
    await concatenateClips({
      clips: renderedSegments,
      outPath: finalPath,
      options: { width: 1080, height: 1920, fps: 24 },
    });

    // Upload to storage
    const jobId = `story-${Date.now().toString(36)}`;
    const durationSec = renderedSegments.reduce((sum, s) => sum + s.durationSec, 0);
    const joinedText = session.story?.sentences?.join(' ') || '';
    let publicUrl = null;
    let thumbUrl = null;
    await withFinalizeStage(FINALIZE_STAGES.UPLOAD_ARTIFACTS, {}, async () => {
      const destPath = `artifacts/${uid}/${jobId}/story.mp4`;
      const uploadedVideo = await uploadPublic(finalPath, destPath, 'video/mp4');
      publicUrl = uploadedVideo.publicUrl;

      // Extract and upload thumbnail (best-effort)
      if (!fs.existsSync(finalPath)) return;
      try {
        const thumbLocal = path.join(tmpDir, 'thumb.jpg');
        const ok = await extractCoverJpeg({
          inPath: finalPath,
          outPath: thumbLocal,
          durationSec: durationSec || 8,
          width: 720,
        });
        if (ok && fs.existsSync(thumbLocal)) {
          const thumbDest = `artifacts/${uid}/${jobId}/thumb.jpg`;
          const { publicUrl: thumbPublicUrl } = await uploadPublic(
            thumbLocal,
            thumbDest,
            'image/jpeg'
          );
          thumbUrl = thumbPublicUrl;
          console.log(`[story.service] Thumbnail uploaded: ${thumbUrl}`);
        }
      } catch (e) {
        console.warn(`[story.service] Thumbnail extraction failed: ${e?.message || e}`);
      }
    });

    // Create Firestore document in 'shorts' collection so it appears in My Shorts
    const db = admin.firestore();
    const shortsRef = db.collection('shorts').doc(jobId);

    await withFinalizeStage(FINALIZE_STAGES.WRITE_SHORT, {}, async () => {
      try {
        await shortsRef.set({
          ownerId: uid,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          status: 'ready',
          videoUrl: publicUrl,
          thumbUrl: thumbUrl,
          coverImageUrl: thumbUrl, // Backward compatibility
          durationSec: durationSec,
          quoteText: joinedText,
          mode: 'story',
          template: 'story',
          voiceover: true, // TTS is now enabled
          wantAttribution: false,
          captionMode: 'overlay',
          watermark: true,
          background: {
            kind: 'video',
            type: 'video',
          },
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[story.service] Created Firestore doc in shorts collection: ${jobId}`);
      } catch (error) {
        console.warn(`[story.service] Failed to create Firestore doc: ${error.message}`);
      }
    });

    session.renderedSegments = renderedSegments.map((s) => s.path);
    session.finalVideo = {
      url: publicUrl,
      durationSec: durationSec,
      jobId: jobId, // Store jobId for frontend redirect
    };
    session.status = 'rendered';
    session.updatedAt = new Date().toISOString();

    await saveStorySession({ uid, sessionId, data: session });
    return session;
  } finally {
    // Cleanup temp directory
    try {
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch (cleanupErr) {
      console.warn('[story.service] Cleanup failed:', cleanupErr.message);
    }
  }
}

void renderStoryLegacy;

export async function renderStory({ uid, sessionId }) {
  const session = await loadStorySession({ uid, sessionId });
  if (!session) throw new Error('SESSION_NOT_FOUND');

  const syncSummary = normalizeVoiceSyncSummary(session);
  if (syncSummary.state === 'never_synced') {
    const error = new Error('VOICE_SYNC_REQUIRED');
    error.code = 'VOICE_SYNC_REQUIRED';
    error.status = 409;
    throw error;
  }
  if (syncSummary.state !== 'current') {
    const error = new Error('VOICE_SYNC_STALE');
    error.code = 'VOICE_SYNC_STALE';
    error.status = 409;
    throw error;
  }
  if (!session.shots || !session.captions) {
    throw new Error('SHOTS_AND_CAPTIONS_REQUIRED');
  }

  const sentences = session.story?.sentences ?? [];
  const N = sentences.length;
  const playbackPlan = resolveStoryVideoCutsPlan({ session, sentences });
  const videoCutsV1ToUse = playbackPlan.resolvedVideoCutsV1;
  const useVideoCutsV1 = playbackPlan.useVideoCutsV1;
  if (playbackPlan.shouldPersistResolvedVideoCutsV1 && playbackPlan.resolvedVideoCutsV1) {
    session.videoCutsV1 = safeJsonClone(playbackPlan.resolvedVideoCutsV1);
  }

  console.log('[videoCuts]', `source=${playbackPlan.debugSource}`, {
    sessionId: session.id,
    pcts: useVideoCutsV1 ? videoCutsV1ToUse?.boundaries?.map((item) => item.pos.pct) : undefined,
  });

  const shotsWithClips = session.shots
    .filter((shot) => shot.selectedClip?.url)
    .sort((left, right) => left.sentenceIndex - right.sentenceIndex);
  if (shotsWithClips.length === 0) {
    throw new Error('NO_CLIPS_SELECTED');
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaiform-story-render-'));
  const renderedSegments = [];
  const segmentErrors = [];

  try {
    if (useVideoCutsV1) {
      const beatsDurSecArr = [];
      const perBeat = [];
      for (let beatIndex = 0; beatIndex < N; beatIndex += 1) {
        const info = await buildStoredRenderBeat({ session, beatIndex, tmpDir });
        beatsDurSecArr.push(info.durationSec);
        perBeat.push(info);
      }

      if (beatsDurSecArr.length !== N) {
        throw new Error('VIDEO_CUTS_V1_SYNC_ARTIFACTS_INCOMPLETE');
      }

      const timelinePlan = buildStoryVideoCutsTimelinePlan({
        session,
        sentences,
        beatsDurSec: beatsDurSecArr,
        playbackPlan,
      });
      const segments = timelinePlan.segments;
      if (segments.length === 0) {
        throw new Error('VIDEO_CUTS_V1_NO_SEGMENTS');
      }

      const fetchedCache = new Map();
      const trimmedPaths = [];
      for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
        const segment = segments[segmentIndex];
        let fetched = fetchedCache.get(segment.clipUrl);
        if (!fetched) {
          fetched = await fetchVideoToTmp(segment.clipUrl);
          fetchedCache.set(segment.clipUrl, fetched);
        }
        const outSeg = path.join(tmpDir, `v1_seg_${segmentIndex}.mp4`);
        await trimClipToSegment({
          path: fetched.path,
          inSec: segment.inSec,
          durSec: segment.durSec,
          outPath: outSeg,
          options: { width: 1080, height: 1920 },
        });
        trimmedPaths.push({ path: outSeg, durationSec: segment.durSec });
      }

      const globalTimelinePath = path.join(tmpDir, 'v1_global.mp4');
      await concatenateClipsVideoOnly({
        clips: trimmedPaths,
        outPath: globalTimelinePath,
        options: { width: 1080, height: 1920, fps: 24 },
      });

      const colorMetaCache = new Map();
      for (let beatIndex = 0; beatIndex < N; beatIndex += 1) {
        const info = perBeat[beatIndex];
        const slice = timelinePlan.beatSlices[beatIndex];
        const durationSec = slice.durationSec;
        const slicePath = path.join(tmpDir, `v1_slice_${beatIndex}.mp4`);
        await extractSegmentFromFile({
          path: globalTimelinePath,
          startSec: slice.startSec,
          durSec: durationSec,
          outPath: slicePath,
          options: { width: 1080, height: 1920 },
        });
        const segmentPath = path.join(tmpDir, `segment_${beatIndex}.mp4`);
        await renderVideoQuoteOverlay({
          videoPath: slicePath,
          outPath: segmentPath,
          width: 1080,
          height: 1920,
          durationSec,
          fps: 24,
          text: info.caption.text,
          captionText: info.caption.text,
          ttsPath: info.ttsPath,
          assPath: info.assPath,
          overlayCaption: info.overlayCaption,
          keepVideoAudio: true,
          bgAudioVolume: 0.5,
          watermark: true,
          padSec: 0,
          colorMetaCache,
        });
        renderedSegments.push({ path: segmentPath, durationSec });
      }
    } else {
      const colorMetaCache = new Map();
      for (let index = 0; index < shotsWithClips.length; index += 1) {
        const shot = shotsWithClips[index];
        try {
          const info = await buildStoredRenderBeat({
            session,
            beatIndex: shot.sentenceIndex,
            tmpDir,
          });
          const fetched = await fetchVideoToTmp(shot.selectedClip.url);
          const durationSec =
            Number(info.durationSec) > 0
              ? Number(info.durationSec)
              : Math.max(
                  0,
                  Number(info.caption?.endTimeSec || 0) - Number(info.caption?.startTimeSec || 0)
                ) ||
                shot.durationSec ||
                3;

          const clipDurMs = await getDurationMsFromMedia(fetched.path);
          const clipDurSec = clipDurMs ? clipDurMs / 1000 : null;
          const deficitSec =
            Number.isFinite(clipDurSec) && Number.isFinite(durationSec)
              ? Math.max(0, durationSec - clipDurSec)
              : 0;
          const rawPadSec = deficitSec > 0.25 ? deficitSec : 0;
          const padSec = Math.min(rawPadSec, 5);

          const segmentPath = path.join(tmpDir, `segment_${index}.mp4`);
          await renderVideoQuoteOverlay({
            videoPath: fetched.path,
            outPath: segmentPath,
            width: 1080,
            height: 1920,
            durationSec,
            fps: 24,
            text: info.caption.text,
            captionText: info.caption.text,
            ttsPath: info.ttsPath,
            assPath: info.assPath,
            overlayCaption: info.overlayCaption,
            keepVideoAudio: true,
            bgAudioVolume: 0.5,
            watermark: true,
            padSec,
            colorMetaCache,
          });
          renderedSegments.push({ path: segmentPath, durationSec });
        } catch (error) {
          const caption = session.captions.find(
            (item) => item.sentenceIndex === shot.sentenceIndex
          );
          const errorMsg = error?.message || error?.stderr || String(error);
          console.warn(
            `[story.service] Render failed for segment ${index} (sentence "${caption?.text?.substring(0, 50) || shot.sentenceIndex}..."):`,
            errorMsg
          );
          segmentErrors.push({
            segmentIndex: index,
            sentenceIndex: shot.sentenceIndex,
            error: errorMsg,
          });
        }
      }
    }

    if (renderedSegments.length === 0) {
      const errorDetail =
        segmentErrors.length > 0
          ? `All ${segmentErrors.length} segments failed. First error: ${segmentErrors[0].error}`
          : 'No segments were attempted';
      throw new Error(`NO_SEGMENTS_RENDERED: ${errorDetail}`);
    }

    if (segmentErrors.length > 0) {
      console.warn(
        `[story.service] Rendered ${renderedSegments.length}/${shotsWithClips.length} segments successfully. ${segmentErrors.length} segments failed.`
      );
    } else {
      console.log(`[story.service] Successfully rendered all ${renderedSegments.length} segments.`);
    }

    const finalPath = path.join(tmpDir, 'final.mp4');
    await concatenateClips({
      clips: renderedSegments,
      outPath: finalPath,
      options: { width: 1080, height: 1920, fps: 24 },
    });

    const jobId = `story-${Date.now().toString(36)}`;
    const durationSec = renderedSegments.reduce((sum, segment) => sum + segment.durationSec, 0);
    const joinedText = session.story?.sentences?.join(' ') || '';
    let publicUrl = null;
    let thumbUrl = null;
    await withFinalizeStage(FINALIZE_STAGES.UPLOAD_ARTIFACTS, {}, async () => {
      const destPath = `artifacts/${uid}/${jobId}/story.mp4`;
      const uploadedVideo = await uploadPublic(finalPath, destPath, 'video/mp4');
      publicUrl = uploadedVideo.publicUrl;

      if (!fs.existsSync(finalPath)) return;
      try {
        const thumbLocal = path.join(tmpDir, 'thumb.jpg');
        const ok = await extractCoverJpeg({
          inPath: finalPath,
          outPath: thumbLocal,
          durationSec: durationSec || 8,
          width: 720,
        });
        if (ok && fs.existsSync(thumbLocal)) {
          const thumbDest = `artifacts/${uid}/${jobId}/thumb.jpg`;
          const { publicUrl: thumbPublicUrl } = await uploadPublic(
            thumbLocal,
            thumbDest,
            'image/jpeg'
          );
          thumbUrl = thumbPublicUrl;
          console.log(`[story.service] Thumbnail uploaded: ${thumbUrl}`);
        }
      } catch (error) {
        console.warn(`[story.service] Thumbnail extraction failed: ${error?.message || error}`);
      }
    });

    const db = admin.firestore();
    const shortsRef = db.collection('shorts').doc(jobId);

    await withFinalizeStage(FINALIZE_STAGES.WRITE_SHORT, {}, async () => {
      try {
        await shortsRef.set({
          ownerId: uid,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          status: 'ready',
          videoUrl: publicUrl,
          thumbUrl,
          coverImageUrl: thumbUrl,
          durationSec,
          quoteText: joinedText,
          mode: 'story',
          template: 'story',
          voiceover: true,
          wantAttribution: false,
          captionMode: 'overlay',
          watermark: true,
          background: {
            kind: 'video',
            type: 'video',
          },
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[story.service] Created Firestore doc in shorts collection: ${jobId}`);
      } catch (error) {
        console.warn(`[story.service] Failed to create Firestore doc: ${error.message}`);
      }
    });

    session.renderedSegments = renderedSegments.map((segment) => segment.path);
    session.finalVideo = {
      url: publicUrl,
      durationSec,
      jobId,
    };
    invalidateDraftPreviewBase(session, 'FINALIZE_COMPLETED');
    session.status = 'rendered';
    session.updatedAt = new Date().toISOString();

    await saveStorySession({ uid, sessionId, data: session });
    return session;
  } finally {
    try {
      if (tmpDir && fs.existsSync(tmpDir)) {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    } catch (cleanupErr) {
      console.warn('[story.service] Cleanup failed:', cleanupErr.message);
    }
  }
}

/**
 * Create story session from manual script (manual mode)
 */
export async function createManualStorySession({ uid, scriptText }) {
  // Split scriptText by newlines, trim, drop empty
  const beats = scriptText
    .split('\n')
    .map((s) => String(s).trim())
    .filter((s) => s.length > 0);

  // Validate server-side
  if (beats.length > MAX_BEATS) {
    throw new Error(`Script exceeds maximum of ${MAX_BEATS} beats (got ${beats.length})`);
  }

  for (let i = 0; i < beats.length; i++) {
    if (beats[i].length > MAX_BEAT_CHARS) {
      throw new Error(
        `Beat ${i + 1} exceeds maximum of ${MAX_BEAT_CHARS} characters (got ${beats[i].length})`
      );
    }
  }

  const totalChars = scriptText.length;
  if (totalChars > MAX_TOTAL_CHARS) {
    throw new Error(
      `Script exceeds maximum of ${MAX_TOTAL_CHARS} total characters (got ${totalChars})`
    );
  }

  // Create session via createStorySession
  const session = await createStorySession({
    uid,
    input: 'manual',
    inputType: 'paragraph',
    styleKey: 'default',
  });

  // Set story sentences (same structure as generateStory output)
  session.story = { sentences: beats };
  resetVoiceSyncForNewScript(session);
  session.status = 'story_generated';
  session.updatedAt = new Date().toISOString();

  // Save session
  setHeuristicBillingEstimate(session);
  await saveStorySession({ uid, sessionId: session.id, data: session });

  return session;
}

/**
 * Finalize story - run full pipeline (Phase 7)
 */
export async function finalizeStory({ uid, sessionId, options = {}, attemptId = null }) {
  const override = getRuntimeOverride('story.service.finalizeStory');
  if (override) {
    return await override({ uid, sessionId, options, attemptId });
  }

  let session = await withFinalizeStage(
    FINALIZE_STAGES.HYDRATE_SESSION,
    { sessionId, attemptId },
    () => loadStorySession({ uid, sessionId })
  );
  if (!session) throw new Error('SESSION_NOT_FOUND');

  try {
    logger.info('story.finalize.service.start', {
      sessionId,
      attemptId,
      hasStory: Boolean(session.story),
      hasShots: Array.isArray(session.shots) && session.shots.length > 0,
      hasFinalVideo: Boolean(session.finalVideo),
    });
    session = await withFinalizeStage(
      FINALIZE_STAGES.PERSIST_RECOVERY,
      { sessionId, attemptId, shortId: null },
      async () =>
        await persistRenderRecovery({
          uid,
          sessionId,
          attemptId,
          state: 'pending',
        })
    );
    if (!session) throw new Error('SESSION_NOT_FOUND_AFTER_PENDING');
    logger.info('story.finalize.recovery_pending_persisted', {
      sessionId,
      attemptId,
      recoveryState: session.renderRecovery?.state || null,
    });

    // Step 1: Generate story if not done
    if (!session.story) {
      await withFinalizeStage(
        FINALIZE_STAGES.STORY_GENERATE,
        { sessionId, attemptId },
        async () => {
          await generateStory({
            uid,
            sessionId,
            input: session.input.text,
            inputType: session.input.type,
          });
        }
      );
    }

    // Step 2: Plan shots if not done
    if (!session.plan) {
      await withFinalizeStage(FINALIZE_STAGES.PLAN_SHOTS, { sessionId, attemptId }, async () => {
        await planShots({ uid, sessionId });
      });
    }

    // Step 3: Search clips if not done
    if (!session.shots) {
      await withFinalizeStage(FINALIZE_STAGES.CLIP_SEARCH, { sessionId, attemptId }, async () => {
        await searchShots({ uid, sessionId });
      });
    }

    const syncSummary = normalizeVoiceSyncSummary(session);
    if (syncSummary.state === 'never_synced') {
      const error = new Error('VOICE_SYNC_REQUIRED');
      error.code = 'VOICE_SYNC_REQUIRED';
      error.status = 409;
      throw error;
    }
    if (syncSummary.state !== 'current') {
      const error = new Error('VOICE_SYNC_STALE');
      error.code = 'VOICE_SYNC_STALE';
      error.status = 409;
      throw error;
    }

    // Step 4: Render segments from persisted synced narration artifacts
    if (!session.finalVideo) {
      await withFinalizeStage(FINALIZE_STAGES.RENDER_VIDEO, { sessionId, attemptId }, async () => {
        await withSharedFinalizeRenderLease(() =>
          withRenderSlot(() =>
            renderStory({
              uid,
              sessionId,
            })
          )
        );
      });
      // Reload session to get updated finalVideo field
      session = await withFinalizeStage(
        FINALIZE_STAGES.HYDRATE_SESSION,
        { sessionId, attemptId },
        () => loadStorySession({ uid, sessionId })
      );
      if (!session) throw new Error('SESSION_NOT_FOUND_AFTER_RENDER');
    }

    session = await withFinalizeStage(
      FINALIZE_STAGES.PERSIST_RECOVERY,
      { sessionId, attemptId, shortId: session?.finalVideo?.jobId || null },
      async () =>
        await persistRenderRecovery({
          uid,
          sessionId,
          attemptId,
          state: 'done',
          shortId: session?.finalVideo?.jobId || null,
        })
    );
    if (!session) throw new Error('SESSION_NOT_FOUND_AFTER_RENDER');
    logger.info('story.finalize.service.completed', {
      sessionId,
      attemptId,
      shortId: session?.finalVideo?.jobId || null,
      recoveryState: session.renderRecovery?.state || null,
    });

    return session;
  } catch (error) {
    logger.error('story.finalize.service.failed', {
      sessionId,
      attemptId,
      error,
    });
    try {
      await withFinalizeStage(
        FINALIZE_STAGES.PERSIST_RECOVERY,
        { sessionId, attemptId, shortId: null },
        async () =>
          await persistRenderRecovery({
            uid,
            sessionId,
            attemptId,
            state: 'failed',
            error,
          })
      );
    } catch (persistError) {
      logger.error('story.finalize.recovery_failure_persist_failed', {
        sessionId,
        attemptId,
        error: persistError,
      });
    }
    throw error;
  }
}

export default {
  createStorySession,
  getStorySession,
  generateStory,
  createManualStorySession,
  planShots,
  searchShots,
  buildTimeline,
  generateCaptionTimings,
  renderStory,
  renderStoryDraftPreview,
  finalizeStory,
  updateBeatText,
  updateVideoCuts,
  buildStoryVideoCutsTimelinePlan,
  prepareDraftPreviewRequest,
  markDraftPreviewQueued,
  invalidateDraftPreviewBase,
  persistDraftPreviewFailure,
  saveStorySession,
};
