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
import { concatenateClips, fetchClipsToTmp } from '../utils/ffmpeg.timeline.js';
import { renderVideoQuoteOverlay } from '../utils/ffmpeg.video.js';
import { fetchVideoToTmp } from '../utils/video.fetch.js';
import { uploadPublic } from '../utils/storage.js';
import admin from '../config/firebase.js';

const TTL_HOURS = Number(process.env.STORY_TTL_HOURS || 48);

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
async function saveStorySession({ uid, sessionId, data }) {
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
export async function createStorySession({ uid, input, inputType = 'paragraph' }) {
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
  const story = await generateStoryFromInput({
    input: session.input.text,
    inputType: session.input.type
  });
  
  session.story = story;
  session.status = 'story_generated';
  session.updatedAt = new Date().toISOString();
  
  await saveStorySession({ uid, sessionId: session.id, data: session });
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
      // Search for clips matching the shot's search query
      const searchResult = await pexelsSearchVideos({
        query: shot.searchQuery,
        perPage: 3,
        targetDur: shot.durationSec,
        page: 1
      });
      
      if (searchResult.ok && searchResult.items.length > 0) {
        // Pick best match: closest duration to target, portrait orientation
        let bestClip = null;
        let bestScore = Infinity;
        
        for (const item of searchResult.items) {
          const durationDelta = Math.abs((item.duration || 0) - shot.durationSec);
          const isPortrait = item.height > item.width;
          const score = durationDelta + (isPortrait ? 0 : 10); // Penalize landscape
          
          if (score < bestScore) {
            bestScore = score;
            bestClip = item;
          }
        }
        
        shots.push({
          ...shot,
          selectedClip: bestClip ? {
            id: bestClip.id,
            url: bestClip.fileUrl,
            duration: bestClip.duration,
            width: bestClip.width,
            height: bestClip.height,
            photographer: bestClip.photographer,
            sourceUrl: bestClip.sourceUrl
          } : null
        });
      } else {
        // No results found, keep shot without clip
        shots.push({
          ...shot,
          selectedClip: null
        });
      }
    } catch (error) {
      console.warn(`[story.service] Search failed for shot ${shot.sentenceIndex}:`, error?.message);
      shots.push({
        ...shot,
        selectedClip: null
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
  const captions = [];
  let cumulativeTime = 0;
  
  for (let i = 0; i < session.story.sentences.length; i++) {
    const shot = session.plan.find(s => s.sentenceIndex === i) || session.plan[i];
    const durationSec = shot?.durationSec || 3;
    
    captions.push({
      sentenceIndex: i,
      text: session.story.sentences[i],
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
 * Render final video (Phase 6)
 * Renders each clip with its caption, then concatenates
 */
export async function renderStory({ uid, sessionId }) {
  const session = await loadStorySession({ uid, sessionId });
  if (!session) throw new Error('SESSION_NOT_FOUND');
  if (!session.shots || !session.captions) {
    throw new Error('SHOTS_AND_CAPTIONS_REQUIRED');
  }
  
  const shotsWithClips = session.shots.filter(s => s.selectedClip?.url);
  if (shotsWithClips.length === 0) {
    throw new Error('NO_CLIPS_SELECTED');
  }
  
  // Create temp directory for rendered segments
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaiform-story-render-'));
  const renderedSegments = [];
  
  // Render each segment
  const segmentErrors = [];
  for (let i = 0; i < shotsWithClips.length; i++) {
    const shot = shotsWithClips[i];
    const caption = session.captions.find(c => c.sentenceIndex === shot.sentenceIndex);
    
    if (!caption) {
      console.warn(`[story.service] No caption found for shot ${i}, sentenceIndex ${shot.sentenceIndex}`);
      continue;
    }
    
    try {
      // Fetch clip to temp file
      const fetched = await fetchVideoToTmp(shot.selectedClip.url);
      
      // Render segment with caption
      const segmentPath = path.join(tmpDir, `segment_${i}.mp4`);
      await renderVideoQuoteOverlay({
        videoPath: fetched.path,
        outPath: segmentPath,
        width: 1080,
        height: 1920,
        durationSec: shot.durationSec || 3,
        fps: 24,
        text: caption.text,
        captionText: caption.text,
        ttsPath: null, // No TTS for now
        keepVideoAudio: true, // Keep background audio (will auto-detect if audio exists)
        bgAudioVolume: 0.5,
        watermark: true
      });
      
      renderedSegments.push({
        path: segmentPath,
        durationSec: shot.durationSec || 3
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
  
  // Create Firestore document in 'shorts' collection so it appears in My Shorts
  const db = admin.firestore();
  const shortsRef = db.collection('shorts').doc(jobId);
  
  try {
    await shortsRef.set({
      ownerId: uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: 'ready',
      videoUrl: publicUrl,
      durationSec: durationSec,
      quoteText: joinedText,
      mode: 'story',
      template: 'story',
      voiceover: false,
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
  planShots,
  searchShots,
  buildTimeline,
  generateCaptionTimings,
  renderStory,
  finalizeStory
};

