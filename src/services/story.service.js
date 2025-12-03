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
import { concatenateClips, fetchClipsToTmp } from '../utils/ffmpeg.timeline.js';
import { renderVideoQuoteOverlay } from '../utils/ffmpeg.video.js';
import { fetchVideoToTmp } from '../utils/video.fetch.js';
import { uploadPublic } from '../utils/storage.js';
import { calculateReadingDuration } from '../utils/text.duration.js';
import admin from '../config/firebase.js';
import { synthVoiceWithTimestamps } from './tts.service.js';
import { getVoicePreset, getDefaultVoicePreset } from '../constants/voice.presets.js';
import { buildKaraokeASSFromTimestamps } from '../utils/karaoke.ass.js';

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

/**
 * Search and normalize clips for a single shot (helper function)
 * Returns normalized candidates and best match
 */
async function searchSingleShot(query, options = {}) {
  const { perPage = 6, targetDur = 8 } = options;
  
  // Search both providers in parallel
  const [pexelsResult, pixabayResult] = await Promise.all([
    pexelsSearchVideos({
      query: query,
      perPage: perPage,
      targetDur: targetDur,
      page: 1
    }),
    pixabaySearchVideos({
      query: query,
      perPage: perPage,
      page: 1
    }).catch(() => ({ ok: false, items: [] })) // Silent failure for Pixabay
  ]);
  
  // Merge results from both providers
  const allItems = [...(pexelsResult.items || []), ...(pixabayResult.items || [])];
  
  // Log provider usage for debugging
  console.log('[story.searchShots] providers used:', {
    query,
    pexels: pexelsResult.items?.length || 0,
    pixabay: pixabayResult.items?.length || 0
  });
  
  if (allItems.length === 0) {
    return { candidates: [], best: null };
  }
  
  // Normalize all candidates to same structure
  const candidates = allItems.map(item => {
    // Extract providerId from id if not present
    const providerId = item.providerId || item.id?.replace(/^(pexels|pixabay)-video-/, '');
    
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
  
  // Pick best match: closest duration to target, portrait orientation
  let bestClip = null;
  let bestScore = Infinity;
  
  for (const item of allItems) {
    const durationDelta = Math.abs((item.duration || 0) - targetDur);
    const isPortrait = item.height > item.width;
    const score = durationDelta + (isPortrait ? 0 : 10); // Penalize landscape
    
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
    providerId: bestClip.providerId || bestClip.id?.replace(/^(pexels|pixabay)-video-/, ''),
    license: bestClip.license || bestClip.provider || 'pexels'
  } : null;
  
  return { candidates, best };
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
export async function searchClipsForShot({ uid, sessionId, sentenceIndex, query }) {
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
  const { candidates, best } = await searchSingleShot(searchQuery, {
    perPage: 12,
    targetDur: shot.durationSec || 8
  });
  
  // Update candidates
  shot.candidates = candidates;
  
  // Keep current selectedClip if it's still in the new candidates; otherwise use best
  const maybeKeep = shot.selectedClip && candidates.find(c => c.id === shot.selectedClip.id);
  shot.selectedClip = maybeKeep || best || null;
  
  session.updatedAt = new Date().toISOString();
  
  await saveStorySession({ uid, sessionId, data: session });
  
  return shot;
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
  
  // Get voice preset (default to calm male if not set)
  const voicePresetKey = session.voicePreset || 'male_calm';
  const voicePreset = getVoicePreset(voicePresetKey);
  console.log(`[story.service] Using voice preset: ${voicePreset.name} (${voicePresetKey})`);
  
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
            
            // Extract wrapped text from overlayCaption.lines or compute it
            let wrappedText = null;
            if (overlayCaption?.lines && Array.isArray(overlayCaption.lines)) {
              wrappedText = overlayCaption.lines.join('\n');
              console.log(`[story.service] Using wrapped text from overlayCaption.lines: ${overlayCaption.lines.length} lines`);
            } else if (caption?.text) {
              // Compute wrapped text using same logic as renderVideoQuoteOverlay
              try {
                const ffmpegVideo = await import('../utils/ffmpeg.video.js');
                // fitQuoteToBox is not exported, so we'll use a simple approach
                // or extract from overlayCaption if available
                const fontPx = overlayCaption?.fontPx || overlayCaption?.sizePx || 64;
                const boxWidthPx = 1080 - 120; // Same as renderVideoQuoteOverlay
                // Simple word wrapping approximation
                const words = String(caption.text).trim().split(/\s+/);
                const approxCharW = fontPx * 0.55;
                const maxChars = Math.max(12, Math.floor(boxWidthPx / approxCharW));
                const lines = [];
                let line = '';
                for (const w of words) {
                  const next = line ? line + ' ' + w : w;
                  if (next.length <= maxChars) {
                    line = next;
                  } else {
                    if (line) lines.push(line);
                    line = w;
                  }
                }
                if (line) lines.push(line);
                wrappedText = lines.join('\n');
                console.log(`[story.service] Computed wrapped text: ${lines.length} lines`);
              } catch (wrapErr) {
                console.warn(`[story.service] Could not compute wrapped text:`, wrapErr?.message);
              }
            }
            
            assPath = await buildKaraokeASSFromTimestamps({
              text: caption.text,
              timestamps: ttsResult.timestamps,
              durationMs: ttsDurationMs,
              audioPath: ttsPath, // Pass audio path for duration verification and scaling
              wrappedText: wrappedText, // Pass wrapped text for line breaks
              overlayCaption: overlayCaption, // Pass overlay styling (SSOT)
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
      
      // Render segment with caption, TTS, and ASS highlighting
      const segmentPath = path.join(tmpDir, `segment_${i}.mp4`);
      
      // Check if session has overlay caption styling to pass to render
      const overlayCaption = session.overlayCaption || session.captionStyle;
      
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
        watermark: true
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

