/**
 * Story-based video pipeline service
 * Orchestrates: input → story → visual plan → stock search → timeline → render
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
  concatenateClips,
  concatenateClipsVideoOnly,
  trimClipToSegment,
  extractSegmentFromFile,
  fetchClipsToTmp
} from '../utils/ffmpeg.timeline.js';
import { renderVideoQuoteOverlay } from '../utils/ffmpeg.video.js';
import { fetchVideoToTmp } from '../utils/video.fetch.js';
import { uploadPublic } from '../utils/storage.js';
import { calculateReadingDuration } from '../utils/text.duration.js';
import admin from '../config/firebase.js';
import { extractCoverJpeg } from '../utils/ffmpeg.cover.js';
import { synthVoiceWithTimestamps } from './tts.service.js';
import { getVoicePreset, getDefaultVoicePreset } from '../constants/voice.presets.js';
import { buildKaraokeASSFromTimestamps } from '../utils/karaoke.ass.js';
import { wrapTextWithFont } from '../utils/caption.wrap.js';
import { deriveCaptionWrapWidthPx } from '../utils/caption.wrapWidth.js';
import { compileCaptionSSOT } from '../captions/compile.js';

const TTL_HOURS = Number(process.env.STORY_TTL_HOURS || 48);

// Manual script mode constants
const MAX_BEATS = 8;
const MAX_BEAT_CHARS = 160;
const MAX_TOTAL_CHARS = 850;

/**
 * Ensure session has default structure
 */
function ensureSessionDefaults(session) {
  if (!session.id) session.id = `story-${crypto.randomUUID()}`;
  if (!session.uid) throw new Error('UID_REQUIRED');
  if (!session.input) session.input = { text: '', type: 'paragraph' };
  if (!session.createdAt) session.createdAt = new Date().toISOString();
  if (!session.updatedAt) session.updatedAt = new Date().toISOString();
  
  // Set expiration
  if (!session.expiresAt) {
    const created = Date.parse(session.createdAt);
    session.expiresAt = new Date(created + TTL_HOURS * 3600 * 1000).toISOString();
  }
  
  return session;
}

/**
 * Save story session
 */
export async function saveStorySession({ uid, sessionId, data }) {
  await saveJSON({ uid, studioId: sessionId, file: 'story.json', data });
}

/**
 * Load story session
 */
async function loadStorySession({ uid, sessionId }) {
  const data = await loadJSON({ uid, studioId: sessionId, file: 'story.json' });
  if (!data) return null;
  
  const session = ensureSessionDefaults(data);
  
  // Check expiration
  if (session.expiresAt && Date.now() > Date.parse(session.expiresAt)) {
    return null;
  }
  
  return session;
}

/**
 * Create a new story session
 */
export async function createStorySession({ uid, input, inputType = 'paragraph', styleKey = 'default' }) {
  const sessionId = `story-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  
  const session = ensureSessionDefaults({
    id: sessionId,
    uid,
    input: {
      text: String(input || '').trim(),
      type: inputType,
      url: inputType === 'link' ? input : undefined
    },
    styleKey: styleKey || 'default',
    status: 'draft',
    createdAt: now,
    updatedAt: now
  });
  
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
      url: inputType === 'link' ? input : session.input.url
    };
  }
  
  // Generate story using LLM
  const styleKey = session.styleKey || 'default';
  const story = await generateStoryFromInput({
    input: session.input.text,
    inputType: session.input.type,
    styleKey: styleKey
  });
  
  session.story = story;
  session.status = 'story_generated';
  session.updatedAt = new Date().toISOString();
  
  await saveStorySession({ uid, sessionId: session.id, data: session });
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
  
  // Update story sentences
  if (!session.story) {
    session.story = {};
  }
  session.story.sentences = sentences.map(s => String(s).trim()).filter(s => s.length > 0);
  
  // Clear plan and shots to force re-plan with new sentences
  if (session.plan) delete session.plan;
  if (session.shots) delete session.shots;
  
  session.status = 'story_generated';
  session.updatedAt = new Date().toISOString();
  
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
  'space', 'nasa', 'galaxy', 'galaxies', 'nebula', 'nebulae',
  'cosmos', 'cosmic', 'astronomy', 'astronaut', 'astronauts',
  'planet', 'planets', 'solar system', 'black hole', 'black holes',
  'supernova', 'supernovae', 'universe', 'milky way',
  'mars', 'moon', 'lunar', 'saturn', 'jupiter',
  'eclipse', 'telescope', 'deep space',
];

const NASA_SOFT_KEYWORDS = [
  'starlight', 'stars', 'night sky', 'sky full of stars',
  'dreamy sky', 'cosmic vibes', 'dreamy universe',
  'galactic', 'interstellar', 'celestial',
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
  const hasStrong = NASA_STRONG_KEYWORDS.some(k => query.includes(k));
  if (hasStrong) return 'strong';
  const hasSoft = NASA_SOFT_KEYWORDS.some(k => query.includes(k));
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
    if (nasaAffinity === 'strong') return 1.4;   // strongly favor NASA
    if (nasaAffinity === 'soft') return 1.15;   // mild boost
    return 0.85;                                 // slightly down-weight otherwise
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
    pexelsSearchVideos({
      query: query,
      perPage: perPage,
      targetDur: targetDur,
      page: page
    }),
    pixabaySearchVideos({
      query: query,
      perPage: perPage,
      page: page
    }).catch(() => ({ ok: false, items: [], nextPage: null })), // Silent failure for Pixabay
    nasaAffinity === 'none'
      ? Promise.resolve({ ok: false, items: [], nextPage: null })
      : nasaSearchVideos({ query, perPage, page: page })
          .catch(() => ({ ok: false, items: [], nextPage: null }))
  ]);
  
  // Log NASA result details
  console.log(`[story] nasaResult: ok=${nasaResult.ok}, reason="${nasaResult.reason || 'N/A'}", items.length=${nasaResult.items?.length || 0}`);
  
  // Cap NASA items based on affinity
  let nasaItems = nasaResult.items || [];
  if (nasaItems.length) {
    const nasaLimit = nasaAffinity === 'strong'
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
  const hasMore = (typeof pexelsResult.nextPage === 'number') || 
                  (typeof pixabayResult.nextPage === 'number') || 
                  (typeof nasaResult.nextPage === 'number');
  
  // Log provider usage and pagination for debugging
  console.log('[story.searchShots] providers used:', {
    query,
    page,
    nasaAffinity,
    nasa: nasaItems.length,
    pexels: pexelsItems.length,
    pixabay: pixabayItems.length,
    pagination: {
      pexelsNextPage: pexelsResult.nextPage,
      pixabayNextPage: pixabayResult.nextPage,
      nasaNextPage: nasaResult.nextPage,
      hasMore
    }
  });
  
  if (allItems.length === 0) {
    return { candidates: [], best: null, page, hasMore: false };
  }
  
  // Normalize all candidates to same structure
  const candidates = allItems.map(item => {
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
      license: item.license || item.provider || 'pexels'
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
  const best = bestClip ? {
    id: bestClip.id,
    url: bestClip.fileUrl || bestClip.url,
    thumbUrl: bestClip.thumbUrl || null,
    duration: bestClip.duration,
    width: bestClip.width,
    height: bestClip.height,
    photographer: bestClip.photographer,
    sourceUrl: bestClip.sourceUrl,
    provider: bestClip.provider || 'pexels',
    providerId: bestClip.providerId || bestClip.id?.replace(/^(pexels|pixabay|nasa)-video-/, ''),
    license: bestClip.license || bestClip.provider || 'pexels'
  } : null;
  
  return { candidates, best, page, hasMore };
}

/**
 * Search stock videos for each shot (Phase 3)
 */
export async function searchShots({ uid, sessionId }) {
  const session = await loadStorySession({ uid, sessionId });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  if (!session.plan) throw new Error('PLAN_REQUIRED');
  
  const shots = [];
  
  for (const shot of session.plan) {
    try {
      // Use helper function to search and normalize
      const { candidates, best } = await searchSingleShot(shot.searchQuery, {
        perPage: 6,
        targetDur: shot.durationSec
      });
      
      shots.push({
        ...shot,
        selectedClip: best,
        candidates: candidates
      });
    } catch (error) {
      console.warn(`[story.service] Search failed for shot ${shot.sentenceIndex}:`, error?.message);
      shots.push({
        ...shot,
        selectedClip: null,
        candidates: []
      });
    }
  }
  
  session.shots = shots;
  session.status = 'clips_searched';
  session.updatedAt = new Date().toISOString();
  
  await saveStorySession({ uid, sessionId, data: session });
  return session;
}

/**
 * Search clips for a single shot (Phase 3 - Clip Search)
 */
export async function searchClipsForShot({ uid, sessionId, sentenceIndex, query, page = 1 }) {
  const session = await loadStorySession({ uid, sessionId });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  if (!session.shots) throw new Error('SHOTS_REQUIRED');
  
  const shot = session.shots.find(s => s.sentenceIndex === sentenceIndex);
  if (!shot) {
    throw new Error(`SHOT_NOT_FOUND: sentenceIndex=${sentenceIndex}`);
  }
  
  // Determine search query: use provided query, or fall back to shot.searchQuery, or sentence text
  const searchQuery = query?.trim() || shot.searchQuery || session.story?.sentences?.[sentenceIndex] || '';
  
  if (!searchQuery) {
    throw new Error('NO_SEARCH_QUERY_AVAILABLE');
  }
  
  // Search with perPage 12 for frontend to show 8 nicely
  const { candidates, best, page: resultPage, hasMore } = await searchSingleShot(searchQuery, {
    perPage: 12,
    targetDur: shot.durationSec || 8,
    page: page
  });
  
  // Update candidates: append new candidates with deduplication by id
  // For page 1, replace existing candidates (new search). For page > 1, append.
  if (page === 1) {
    // First page: replace candidates (new search)
    shot.candidates = candidates;
  } else {
    // Subsequent pages: append new candidates, deduplicating by id
    const existingCandidates = shot.candidates || [];
    const existingIds = new Set(existingCandidates.map(c => c.id).filter(id => id != null));
    const newCandidates = candidates.filter(c => c.id == null || !existingIds.has(c.id));
    shot.candidates = [...existingCandidates, ...newCandidates];
  }
  
  // Keep current selectedClip if it's still in the merged candidates; otherwise use best
  const mergedCandidates = shot.candidates || [];
  const maybeKeep = shot.selectedClip && mergedCandidates.find(c => c.id === shot.selectedClip.id);
  shot.selectedClip = maybeKeep || best || null;
  
  session.updatedAt = new Date().toISOString();
  
  await saveStorySession({ uid, sessionId, data: session });
  
  // Return shot with pagination info
  return { shot, page: resultPage, hasMore };
}

/**
 * Update selected clip for a shot (Phase 2 - Clip Swap)
 */
export async function updateShotSelectedClip({ uid, sessionId, sentenceIndex, clipId }) {
  const session = await loadStorySession({ uid, sessionId });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  if (!session.shots) throw new Error('SHOTS_REQUIRED');
  
  const shot = session.shots.find(s => s.sentenceIndex === sentenceIndex);
  if (!shot) throw new Error('SHOT_NOT_FOUND');
  
  if (!shot.candidates || shot.candidates.length === 0) {
    throw new Error('NO_CANDIDATES_AVAILABLE');
  }
  
  const candidate = shot.candidates.find(c => c.id === clipId);
  if (!candidate) throw new Error('CLIP_NOT_FOUND_IN_CANDIDATES');
  
  // Update selectedClip
  shot.selectedClip = candidate;
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
  
  // Handle insert at beginning (insertAfterIndex < 0)
  const newIndex = insertAfterIndex < 0 ? 0 : insertAfterIndex + 1;
  
  // Insert sentence at newIndex
  session.story.sentences.splice(newIndex, 0, text.trim());
  
  // Calculate duration from text
  const durationSec = calculateReadingDuration(text);
  
  // Create new shot object
  const newShot = {
    sentenceIndex: newIndex,
    searchQuery: text.trim(),
    durationSec: durationSec,
    selectedClip: null,
    candidates: []
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
    const { candidates, best } = await searchSingleShot(text.trim(), {
      perPage: 12,
      targetDur: durationSec
    });
    
    insertedShot.candidates = candidates;
    insertedShot.selectedClip = best;
    
    console.log(`[story.service] insertBeatWithSearch: search completed, candidates=${candidates.length}, best=${best ? 'found' : 'null'}`);
  } catch (error) {
    console.warn(`[story.service] Search failed for new beat at index ${newIndex}:`, error?.message);
    // Continue with empty candidates
  }
  
  session.updatedAt = new Date().toISOString();
  
  await saveStorySession({ uid, sessionId, data: session });
  
  console.log(`[story.service] insertBeatWithSearch: insertAfterIndex=${insertAfterIndex}, newIndex=${newIndex}, sentences.length=${session.story.sentences.length}, shots.length=${session.shots.length}`);
  
  return {
    sentences: session.story.sentences,
    shots: session.shots
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
  
  // Find and remove matching shot
  const shotIndex = session.shots.findIndex(s => s.sentenceIndex === sentenceIndex);
  if (shotIndex !== -1) {
    session.shots.splice(shotIndex, 1);
  }
  
  // Reindex all remaining shots to maintain invariant: shots[i].sentenceIndex === i
  for (let i = 0; i < session.shots.length; i++) {
    session.shots[i].sentenceIndex = i;
  }
  
  session.updatedAt = new Date().toISOString();
  
  await saveStorySession({ uid, sessionId, data: session });
  
  console.log(`[story.service] deleteBeat: sentenceIndex=${sentenceIndex}, remaining sentences.length=${session.story.sentences.length}, shots.length=${session.shots.length}`);
  
  return {
    sentences: session.story.sentences,
    shots: session.shots
  };
}

/**
 * Update beat text (sentence text only, does not change clip)
 */
export async function updateBeatText({ uid, sessionId, sentenceIndex, text }) {
  const session = await loadStorySession({ uid, sessionId });
  
  const sentences = session.story?.sentences || [];
  const shots = session.shots || [];
  
  if (
    typeof sentenceIndex !== "number" ||
    sentenceIndex < 0 ||
    sentenceIndex >= sentences.length
  ) {
    throw new Error(`Invalid sentenceIndex ${sentenceIndex}`);
  }
  
  // Update sentence text
  sentences[sentenceIndex] = text;
  
  // Keep shot.searchQuery in sync if a shot exists, but DON'T touch selectedClip/candidates
  const shot = shots.find((s) => s.sentenceIndex === sentenceIndex);
  if (shot) {
    shot.searchQuery = text;
  }
  
  await saveStorySession({ uid, sessionId, data: session });
  
  console.log(
    "[story.service] updateBeatText: sentenceIndex=%s, newText=%s",
    sentenceIndex,
    text.slice(0, 80)
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
  const shotsWithClips = session.shots.filter(s => s.selectedClip?.url);
  if (shotsWithClips.length === 0) {
    throw new Error('NO_CLIPS_SELECTED');
  }
  
  // Prepare clips for fetching
  const clipsToFetch = shotsWithClips.map(shot => ({
    url: shot.selectedClip.url,
    durationSec: shot.durationSec || shot.selectedClip.duration || 3
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
        fps: 24
      }
    });
    
    session.timeline = {
      videoPath: outPath,
      durationSec: result.durationSec,
      tmpDir // Keep reference for cleanup later
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
    const shot = session.plan.find(s => s.sentenceIndex === i) || session.plan[i];
    const sentence = session.story.sentences[i];
    
    // Recalculate duration from text to ensure consistency
    // Use shot duration as fallback, but prefer calculated duration
    const calculatedDuration = calculateReadingDuration(sentence);
    const shotDuration = shot?.durationSec || calculatedDuration;
    
    // Use the calculated duration, but respect shot duration if reasonable
    const durationSec = (shotDuration >= 3 && shotDuration <= 10) 
      ? Math.round((calculatedDuration + shotDuration) / 2 * 2) / 2 
      : calculatedDuration;
    
    captions.push({
      sentenceIndex: i,
      text: sentence,
      startTimeSec: cumulativeTime,
      endTimeSec: cumulativeTime + durationSec
    });
    
    cumulativeTime += durationSec;
  }
  
  session.captions = captions;
  session.status = 'captions_timed';
  session.updatedAt = new Date().toISOString();
  
  await saveStorySession({ uid, sessionId, data: session });
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
const SHIFT_WORDS = new Set(['however', 'meanwhile', 'suddenly', 'next', 'finally', 'otherwise', 'instead']);
const ACTION_WORDS = new Set(['run', 'sprint', 'chase', 'slam', 'crash', 'explode', 'grab', 'throw', 'jump', 'rush', 'attack', 'escape', 'surge', 'fire', 'strike', 'spin']);
const AUTO_CUTS_GEN_V = 4;

/** Closers to skip when scanning backward for terminal punctuation. */
const CLOSING_PUNCT = new Set([' ', '\t', '\n', '\r', "'", '"', '\u201C', '\u201D', '\u2019', ')', ']', '}']);

/**
 * Terminal punctuation class: scan backward skipping whitespace and closing quotes/brackets.
 * Detects ellipsis (... or …), strong (.!?), semi (; : — –), soft (comma), else none.
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
  return (String(sentence ?? '').trim().split(/\s+/)[0] || '').toLowerCase();
}

/** Tokenize into words (lowercase). */
function tokenize(sentence) {
  return (String(sentence ?? '').toLowerCase().match(/\b\w+\b/g)) || [];
}

/** Count tokens that are in ACTION_WORDS. */
function countActionWords(tokens) {
  return tokens.filter(t => ACTION_WORDS.has(t)).length;
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
  const ellipsisNorm = Math.min(1, ellipsisCount / Math.max(1, n) * 3);
  const strongNorm = Math.min(1, strongCount / Math.max(1, n) * 1.5);
  const softNorm = Math.min(1, softDensitySum / Math.max(1, n) * 2);
  const actionNorm = Math.min(1, actionSum / Math.max(1, n * 5));
  const shortNorm = shortCount / Math.max(1, n);
  const raw = 0.2 * ellipsisNorm + 0.25 * strongNorm + 0.2 * softNorm + 0.2 * actionNorm + 0.15 * shortNorm;
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
    const shot = shots.find(s => s.sentenceIndex === k);
    const clipUrl = shot?.selectedClip?.url;
    if (!clipUrl) continue;
    const globalStartSec = cutTimes[k];
    const globalEndSec = cutTimes[k + 1];
    const durSec = globalEndSec - globalStartSec;
    const inSec = globalStartSec - sumPrev;
    sumPrev += beatsDurSec[k];
    segments.push({ clipUrl, inSec: Math.max(0, inSec), durSec, globalStartSec, globalEndSec });
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
    if (k > 0 && mergeSet.has(k - 1)) {
    } else {
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
function computeVideoSegmentsFromCutsAutoBudget({ beatsDurSec, shots, videoCutsV1, sessionId, sentences, sentencesHash }) {
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
  const clipUrlByBeat = new Map();
  for (let k = 0; k < N; k++) {
    const shot = shots.find(s => s.sentenceIndex === k);
    const url = shot?.selectedClip?.url;
    clipUrlByBeat.set(k, url);
  }
  const cursor = new Map();
  const segments = [];
  for (let k = 0; k < N; k++) {
    const owner = owners[k];
    const clipUrl = clipUrlByBeat.get(owner);
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
      clipUrl,
      inSec,
      durSec,
      globalStartSec: cutTimes[k],
      globalEndSec: cutTimes[k + 1]
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

/**
 * Render final video (Phase 6)
 * Renders each clip with its caption, then concatenates
 */
export async function renderStory({ uid, sessionId }) {
  const session = await loadStorySession({ uid, sessionId });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  if (!session.shots || !session.captions) {
    throw new Error('SHOTS_AND_CAPTIONS_REQUIRED');
  }

  const N = session.story?.sentences?.length ?? 0;
  const enableVideoCutsV1 = process.env.ENABLE_VIDEO_CUTS_V1 === 'true' || process.env.ENABLE_VIDEO_CUTS_V1 === '1';
  const sentences = session.story?.sentences ?? [];
  const currentSentencesHash = sentencesHash(sentences);

  let hasClipsForAllBeats = N > 0;
  if (hasClipsForAllBeats) {
    for (let b = 0; b < N; b++) {
      const shot = session.shots.find(s => s.sentenceIndex === b);
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
    const hasValidExisting = bounds && Array.isArray(bounds) && bounds.length === N - 1 &&
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
      session.videoCutsV1 = { version: 1, boundaries: autoCuts.boundaries, source: 'auto', sentencesHash: currentSentencesHash, autoGenV: AUTO_CUTS_GEN_V };
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
      session.videoCutsV1 = { version: 1, boundaries: autoCuts.boundaries, source: 'auto', sentencesHash: currentSentencesHash, autoGenV: AUTO_CUTS_GEN_V };
      videoCutsV1ToUse = session.videoCutsV1;
      source = 'auto';
      useVideoCutsV1 = true;
    }
  }

  console.log('[videoCuts]', 'source=' + source, { sessionId: session.id, pcts: source !== 'classic' ? videoCutsV1ToUse?.boundaries?.map(b => b.pos.pct) : undefined });

  const shotsWithClips = session.shots.filter(s => s.selectedClip?.url);
  if (shotsWithClips.length === 0) {
    throw new Error('NO_CLIPS_SELECTED');
  }

  // Get voice preset (default to calm male if not set)
  const voicePresetKey = session.voicePreset || 'male_calm';
  const voicePreset = getVoicePreset(voicePresetKey);
  console.log(`[story.service] Using voice preset: ${voicePreset.name} (${voicePresetKey})`);

  // Create temp directory for rendered segments
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaiform-story-render-'));
  const renderedSegments = [];
  const segmentErrors = [];

  try {
    if (useVideoCutsV1) {
      // --- ENABLE_VIDEO_CUTS_V1: single flow — beatsDurSec → cutTimes → globalTimeline → slice per beat → overlay
      const { getDurationMsFromMedia } = await import('../utils/media.duration.js');
      const overlayCaption = session.overlayCaption || session.captionStyle;
      const beatsDurSecArr = [];
      const perBeat = []; // { ttsPath, assPath, durationSec, caption, meta, sentenceText }
      for (let b = 0; b < N; b++) {
        const shot = session.shots.find(s => s.sentenceIndex === b);
        const caption = session.captions.find(c => c.sentenceIndex === b);
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
            voiceSettings: voicePreset.voiceSettings
          });
          if (ttsResult.audioPath && ttsResult.timestamps) {
            ttsPath = ttsResult.audioPath;
            let ttsDurationMs = ttsResult.durationMs;
            if (!ttsDurationMs && ttsPath) {
              try {
                ttsDurationMs = await getDurationMsFromMedia(ttsPath);
              } catch (_) {}
            }
            const currentTextRaw = session.story?.sentences?.[b] ?? caption.text;
            let meta = null;
            const beatMeta = session.beats?.[b]?.captionMeta;
            let isStale = false;
            if (beatMeta?.lines && beatMeta?.styleHash && beatMeta?.textHash) {
              const currentTextHash = crypto.createHash('sha256').update(currentTextRaw.trim().toLowerCase()).digest('hex').slice(0, 16);
              const currentStyleHash = compileCaptionSSOT({
                textRaw: currentTextRaw,
                style: overlayCaption || {},
                frameW: 1080,
                frameH: 1920
              }).styleHash;
              if (beatMeta.textHash !== currentTextHash || beatMeta.styleHash !== currentStyleHash) isStale = true;
            }
            if (beatMeta?.lines && beatMeta?.styleHash && !isStale) {
              meta = beatMeta;
            } else {
              meta = compileCaptionSSOT({
                textRaw: currentTextRaw,
                style: overlayCaption || {},
                frameW: 1080,
                frameH: 1920
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
              height: 1920
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
          } catch (_) {
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
          meta: session.beats?.[b]?.captionMeta ?? meta,
          sentenceText: session.story?.sentences?.[b] ?? caption.text,
          overlayCaption: overlayCaption || session.captionStyle
        });
      }
      if (beatsDurSecArr.length !== N) {
        throw new Error('VIDEO_CUTS_V1_TTS_FAILED');
      }
      const cutTimes = boundariesToCutTimes(videoCutsV1ToUse.boundaries, beatsDurSecArr);
      const segments = source === 'auto'
        ? computeVideoSegmentsFromCutsAutoBudget({
            beatsDurSec: beatsDurSecArr,
            shots: session.shots,
            videoCutsV1: videoCutsV1ToUse,
            sessionId: session.id,
            sentences,
            sentencesHash: currentSentencesHash
          })
        : computeVideoSegmentsFromCuts({
            beatsDurSec: beatsDurSecArr,
            shots: session.shots,
            videoCutsV1: videoCutsV1ToUse
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
          options: { width: 1080, height: 1920 }
        });
        trimmedPaths.push({ path: outSeg, durationSec: seg.durSec });
      }
      const globalTimelinePath = path.join(tmpDir, 'v1_global.mp4');
      await concatenateClipsVideoOnly({
        clips: trimmedPaths,
        outPath: globalTimelinePath,
        options: { width: 1080, height: 1920, fps: 24 }
      });
      let beatStartSec = 0;
      for (let b = 0; b < N; b++) {
        const info = perBeat[b];
        const durationSec = beatsDurSecArr[b];
        const slicePath = path.join(tmpDir, `v1_slice_${b}.mp4`);
        await extractSegmentFromFile({
          path: globalTimelinePath,
          startSec: beatStartSec,
          durSec: durationSec,
          outPath: slicePath,
          options: { width: 1080, height: 1920 }
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
          padSec: 0
        });
        renderedSegments.push({ path: segmentPath, durationSec });
        beatStartSec += durationSec;
      }
    } else {
      // --- Current path: one clip per beat
      for (let i = 0; i < shotsWithClips.length; i++) {
        const shot = shotsWithClips[i];
      const caption = session.captions.find(c => c.sentenceIndex === shot.sentenceIndex);
      
      if (!caption) {
        console.warn(`[story.service] No caption found for shot ${i}, sentenceIndex ${shot.sentenceIndex}`);
        continue;
      }
      
      try {
        // Generate TTS with timestamps for this caption
        let ttsPath = null;
        let assPath = null;
        
        try {
          console.log(`[story.service] Generating TTS for segment ${i}: "${caption.text.substring(0, 50)}..."`);
        const ttsResult = await synthVoiceWithTimestamps({
          text: caption.text,
          voiceId: voicePreset.voiceId,
          modelId: process.env.ELEVEN_TTS_MODEL || "eleven_flash_v2_5",
          outputFormat: "mp3_44100_128",
          voiceSettings: voicePreset.voiceSettings
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
              const foundDangerous = dangerousKeys.filter(k => 
                Object.prototype.hasOwnProperty.call(overlayCaption, k)
              );
              if (foundDangerous.length > 0) {
                console.warn(`[render-guard] Found dangerous fields in overlayCaption: ${foundDangerous.join(', ')}. These should not be in global style.`);
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
            
            // ✅ CORRECT PRECEDENCE: Prefer beat-specific captionMeta (SSOT persisted), but verify staleness
            // Each beat has different text, so meta must be per-beat
            let wrappedText = null;
            let meta = null;
            
            const beatMeta = session.beats?.[i]?.captionMeta;
            
            // ✅ STALENESS DETECTION: Verify beatMeta is still valid before using
            let isStale = false;
            if (beatMeta?.lines && beatMeta?.styleHash && beatMeta?.textHash) {
              // Compute current text hash (canonical source: session.story.sentences[i])
              const currentTextRaw = session.story?.sentences?.[i] || caption.text || '';
              const currentTextHash = crypto.createHash('sha256').update(currentTextRaw.trim().toLowerCase()).digest('hex').slice(0, 16);
              
              // Compute current style hash (from current overlayCaption merged with defaults)
              const currentStyleHash = compileCaptionSSOT({
                textRaw: currentTextRaw,
                style: overlayCaption || {},
                frameW: 1080,
                frameH: 1920
              }).styleHash;
              
              // Check for staleness
              if (beatMeta.textHash !== currentTextHash || beatMeta.styleHash !== currentStyleHash) {
                isStale = true;
                console.warn('[render:ssot:staleness] Beat meta is stale, recompiling:', {
                  beatIndex: i,
                  textHashMismatch: beatMeta.textHash !== currentTextHash,
                  styleHashMismatch: beatMeta.styleHash !== currentStyleHash
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
                letterSpacingPx: meta.effectiveStyle.letterSpacingPx
              });
            } else {
              // Compile fresh meta from caption.textRaw + session.overlayCaption (style-only, already sanitized)
              const currentTextRaw = session.story?.sentences?.[i] || caption.text || '';
              meta = compileCaptionSSOT({
                textRaw: currentTextRaw,
                style: overlayCaption || {},  // overlayCaption is style-only, sanitized by extractStyleOnly() in update route
                frameW: 1080,
                frameH: 1920
              });
              wrappedText = meta.lines.join('\n');
              console.log('[render:ssot] Compiled fresh meta:', { 
                beatIndex: i,
                styleHash: meta.styleHash, 
                linesCount: meta.lines.length,
                letterSpacingPx: meta.effectiveStyle.letterSpacingPx,
                reason: isStale ? 'stale' : 'missing'
              });
            }
            
            assPath = await buildKaraokeASSFromTimestamps({
              text: caption.text,
              timestamps: ttsResult.timestamps,
              durationMs: ttsDurationMs,
              audioPath: ttsPath, // Pass audio path for duration verification and scaling
              wrappedText: wrappedText, // Pass wrapped text for line breaks
              overlayCaption: meta.effectiveStyle,  // ✅ Pass compiler output (SSOT) as overlayCaption
              width: 1080,
              height: 1920
            });
            console.log(`[story.service] Generated ASS file for segment ${i}${overlayCaption ? ' with overlay styling' : ' with default styling'}`);
            if (ttsDurationMs) {
              console.log(`[story.service] Segment ${i} ASS dialogue will end at: ${((ttsDurationMs + 150) / 1000).toFixed(2)}s (TTS: ${(ttsDurationMs / 1000).toFixed(2)}s + 150ms fade-out)`);
            }
          } catch (assError) {
            console.warn(`[story.service] Failed to generate ASS file for segment ${i}:`, assError.message);
            // Continue without ASS highlighting
          }
        } else {
          console.warn(`[story.service] TTS generation failed or returned no timestamps for segment ${i}`);
        }
      } catch (ttsError) {
        console.warn(`[story.service] TTS generation error for segment ${i}:`, ttsError.message);
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
            console.log(`[story.service] Segment ${i} duration from TTS: ${ttsDurationSec.toFixed(2)}s (no buffer, allows natural breath gaps)`);
          } else {
            // Fallback if duration probe fails
            durationSec = caption.endTimeSec - caption.startTimeSec || shot.durationSec || 3;
            console.warn(`[story.service] Segment ${i} TTS duration probe returned null, using caption timing: ${durationSec.toFixed(2)}s`);
          }
        } catch (err) {
          console.warn(`[story.service] Failed to get TTS duration for segment ${i}, using caption timing:`, err?.message);
          durationSec = caption.endTimeSec - caption.startTimeSec || shot.durationSec || 3;
        }
      } else {
        // No TTS - use caption timing or shot duration
        durationSec = caption.endTimeSec - caption.startTimeSec;
        if (durationSec <= 0) {
          durationSec = shot.durationSec || 3;
        }
        console.log(`[story.service] Segment ${i} duration from caption/shot (no TTS): ${durationSec.toFixed(2)}s`);
      }
      
      // Probe clip duration and calculate deficit for padding
      // CRITICAL: durationSec must be computed BEFORE this step
      const { getDurationMsFromMedia } = await import('../utils/media.duration.js');
      const clipDurMs = await getDurationMsFromMedia(fetched.path);
      const clipDurSec = clipDurMs ? clipDurMs / 1000 : null;
      const deficitSec = (Number.isFinite(clipDurSec) && Number.isFinite(durationSec))
        ? Math.max(0, durationSec - clipDurSec)
        : 0;
      const rawPadSec = deficitSec > 0.25 ? deficitSec : 0;
      const padSec = Math.min(rawPadSec, 5); // Cap at 5s to prevent pathological padding
      
      if (padSec > 0) {
        console.log(`[story.service] Segment ${i} clipDur=${clipDurSec.toFixed(2)}s, audioDur=${durationSec.toFixed(2)}s, deficit=${deficitSec.toFixed(2)}s, padding=${padSec.toFixed(2)}s`);
      }
      
      // Render segment with caption, TTS, and ASS highlighting
      const segmentPath = path.join(tmpDir, `segment_${i}.mp4`);
      
      // Check if session has overlay caption styling to pass to render
      const overlayCaption = session.overlayCaption || session.captionStyle;
      
      // PROBE (Commit 0): gated debug logs. Remove after confirming behavior.
      if (process.env.PROBE_SESSION_STRUCTURE === '1') {
        const oc = overlayCaption || {};
        const hasRaster = Boolean(oc.rasterUrl || oc.rasterDataUrl || oc.rasterPng || oc.storagePath);
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
          keys: Object.keys(oc).slice(0, 60)
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
          hasRaster: Boolean(oc.rasterUrl || oc.rasterDataUrl || oc.storagePath)
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
        padSec: padSec
      });
      
      renderedSegments.push({
        path: segmentPath,
        durationSec
      });
      
      console.log(`[story.service] Successfully rendered segment ${i}/${shotsWithClips.length - 1}: "${caption.text.substring(0, 50)}..."`);
    } catch (error) {
      const errorMsg = error?.message || error?.stderr || String(error);
      console.warn(`[story.service] Render failed for segment ${i} (sentence "${caption.text.substring(0, 50)}..."):`, errorMsg);
      segmentErrors.push({
        segmentIndex: i,
        sentenceIndex: shot.sentenceIndex,
        error: errorMsg
      });
      // Continue with other segments
    }
  }
  }

  if (renderedSegments.length === 0) {
    const errorDetail = segmentErrors.length > 0 
      ? `All ${segmentErrors.length} segments failed. First error: ${segmentErrors[0].error}`
      : 'No segments were attempted';
    throw new Error(`NO_SEGMENTS_RENDERED: ${errorDetail}`);
  }
  
  // Log summary of successes and failures
  if (segmentErrors.length > 0) {
    console.warn(`[story.service] Rendered ${renderedSegments.length}/${shotsWithClips.length} segments successfully. ${segmentErrors.length} segments failed.`);
  } else {
    console.log(`[story.service] Successfully rendered all ${renderedSegments.length} segments.`);
  }
  
  // Concatenate all segments
  const finalPath = path.join(tmpDir, 'final.mp4');
  await concatenateClips({
    clips: renderedSegments,
    outPath: finalPath,
    options: { width: 1080, height: 1920, fps: 24 }
  });
  
  // Upload to storage
  const jobId = `story-${Date.now().toString(36)}`;
  const destPath = `artifacts/${uid}/${jobId}/story.mp4`;
  const { publicUrl } = await uploadPublic(finalPath, destPath, 'video/mp4');
  
  const durationSec = renderedSegments.reduce((sum, s) => sum + s.durationSec, 0);
  const joinedText = session.story?.sentences?.join(' ') || '';
  
  // Extract and upload thumbnail (best-effort)
  let thumbUrl = null;
  if (fs.existsSync(finalPath)) {
    try {
      const thumbLocal = path.join(tmpDir, 'thumb.jpg');
      const ok = await extractCoverJpeg({ 
        inPath: finalPath, 
        outPath: thumbLocal, 
        durationSec: durationSec || 8,
        width: 720 
      });
      if (ok && fs.existsSync(thumbLocal)) {
        const thumbDest = `artifacts/${uid}/${jobId}/thumb.jpg`;
        const { publicUrl: thumbPublicUrl } = await uploadPublic(thumbLocal, thumbDest, 'image/jpeg');
        thumbUrl = thumbPublicUrl;
        console.log(`[story.service] Thumbnail uploaded: ${thumbUrl}`);
      }
    } catch (e) {
      console.warn(`[story.service] Thumbnail extraction failed: ${e?.message || e}`);
      // Continue without thumbnail
    }
  }
  
  // Create Firestore document in 'shorts' collection so it appears in My Shorts
  const db = admin.firestore();
  const shortsRef = db.collection('shorts').doc(jobId);
  
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
        type: 'video'
      },
      completedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(`[story.service] Created Firestore doc in shorts collection: ${jobId}`);
  } catch (error) {
    console.warn(`[story.service] Failed to create Firestore doc: ${error.message}`);
  }
  
    session.renderedSegments = renderedSegments.map(s => s.path);
    session.finalVideo = {
      url: publicUrl,
      durationSec: durationSec,
      jobId: jobId // Store jobId for frontend redirect
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

/**
 * Create story session from manual script (manual mode)
 */
export async function createManualStorySession({ uid, scriptText }) {
  // Split scriptText by newlines, trim, drop empty
  const beats = scriptText.split('\n')
    .map(s => String(s).trim())
    .filter(s => s.length > 0);
  
  // Validate server-side
  if (beats.length > MAX_BEATS) {
    throw new Error(`Script exceeds maximum of ${MAX_BEATS} beats (got ${beats.length})`);
  }
  
  for (let i = 0; i < beats.length; i++) {
    if (beats[i].length > MAX_BEAT_CHARS) {
      throw new Error(`Beat ${i + 1} exceeds maximum of ${MAX_BEAT_CHARS} characters (got ${beats[i].length})`);
    }
  }
  
  const totalChars = scriptText.length;
  if (totalChars > MAX_TOTAL_CHARS) {
    throw new Error(`Script exceeds maximum of ${MAX_TOTAL_CHARS} total characters (got ${totalChars})`);
  }
  
  // Create session via createStorySession
  const session = await createStorySession({
    uid,
    input: 'manual',
    inputType: 'paragraph',
    styleKey: 'default'
  });
  
  // Set story sentences (same structure as generateStory output)
  session.story = { sentences: beats };
  session.status = 'story_generated';
  session.updatedAt = new Date().toISOString();
  
  // Save session
  await saveStorySession({ uid, sessionId: session.id, data: session });
  
  return session;
}

/**
 * Finalize story - run full pipeline (Phase 7)
 */
export async function finalizeStory({ uid, sessionId, options = {} }) {
  let session = await loadStorySession({ uid, sessionId });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  
  try {
    // Step 1: Generate story if not done
    if (!session.story) {
      await generateStory({
        uid,
        sessionId,
        input: session.input.text,
        inputType: session.input.type
      });
    }
    
    // Step 2: Plan shots if not done
    if (!session.plan) {
      await planShots({ uid, sessionId });
    }
    
    // Step 3: Search clips if not done
    if (!session.shots) {
      await searchShots({ uid, sessionId });
    }
    
    // Step 4: Build timeline if not done (optional, we render from individual clips)
    // Skipped for now - we render directly from clips
    
    // Step 5: Generate caption timings if not done
    if (!session.captions) {
      await generateCaptionTimings({ uid, sessionId });
    }
    
    // Step 6: Render segments
    if (!session.finalVideo) {
      await renderStory({ uid, sessionId });
      // Reload session to get updated finalVideo field
      session = await loadStorySession({ uid, sessionId });
      if (!session) throw new Error('SESSION_NOT_FOUND_AFTER_RENDER');
    }
    
    return session;
  } catch (error) {
    console.error('[story.service] Finalize failed:', error);
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
  finalizeStory,
  updateBeatText,
  updateVideoCuts,
  saveStorySession
};

