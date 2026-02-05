/**
 * FFmpeg utilities for video timeline concatenation
 */

import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fetchVideoToTmp } from './video.fetch.js';
import { getDurationMsFromMedia } from './media.duration.js';

/**
 * Concatenate multiple video clips into a single continuous video
 * @param {Array<{path: string, durationSec: number, startTimeSec?: number}>} clips - Array of clip info
 * @param {string} outPath - Output video path
 * @param {object} options - { width: 1080, height: 1920, fps: 24 }
 * @returns {Promise<{durationSec: number}>}
 */
export async function concatenateClips({ clips, outPath, options = {} }) {
  if (!Array.isArray(clips) || clips.length === 0) {
    throw new Error('CLIPS_REQUIRED');
  }
  
  const width = options.width || 1080;
  const height = options.height || 1920;
  const fps = options.fps || 24;
  
  // Filter out clips without paths
  const validClips = clips.filter(c => c.path && fs.existsSync(c.path));
  if (validClips.length === 0) {
    throw new Error('NO_VALID_CLIPS');
  }
  
  // Calculate total duration
  const totalDurationSec = validClips.reduce((sum, clip) => sum + (clip.durationSec || 0), 0);
  
  // Build filter_complex for concatenation
  // Scale all clips to same dimensions, then concat
  const scaleFilters = validClips.map((clip, i) => {
    return `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS-STARTPTS[v${i}]`;
  }).join(';');
  
  // Video concatenation (video only)
  const concatInputs = validClips.map((_, i) => `[v${i}]`).join('');
  const concatFilter = `${concatInputs}concat=n=${validClips.length}:v=1:a=0[outv]`;
  
  // Audio processing: normalize all inputs to same format
  // Process each input's audio stream
  // Note: Segments should all have audio (rendered with TTS), but if one doesn't, FFmpeg will error
  const audioFilters = validClips.map((clip, i) => {
    // Process audio: resample to 48kHz, format to stereo fltp, reset PTS
    return `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`;
  }).join(';');
  
  // Audio concatenation
  const audioConcatInputs = validClips.map((_, i) => `[a${i}]`).join('');
  const audioConcatFilter = `${audioConcatInputs}concat=n=${validClips.length}:v=0:a=1[outa]`;
  
  // Combined filter complex: video scaling, video concat, audio processing, audio concat
  const filterComplex = `${scaleFilters};${concatFilter};${audioFilters};${audioConcatFilter}`;
  
  // Log filter complex for debugging
  console.log('[ffmpeg.timeline] Concatenating', validClips.length, 'clips with audio');
  console.log('[ffmpeg.timeline] Filter complex length:', filterComplex.length);
  console.log('[ffmpeg.timeline] Filter complex:', filterComplex);
  console.log('[ffmpeg.timeline] Input files:', validClips.map(c => c.path));
  
  // Build FFmpeg args
  // Note: Segments are already rendered to correct duration, so no need to trim inputs
  const inputArgs = validClips.flatMap((clip) => ['-i', clip.path]);
  
  const args = [
    ...inputArgs,
    '-filter_complex', filterComplex,
    '-map', '[outv]',
    '-map', '[outa]', // Map audio output
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    '-preset', 'veryfast',
    '-crf', '23',
    '-c:a', 'aac', // Audio codec
    '-b:a', '96k', // Audio bitrate
    '-movflags', '+faststart',
    outPath
  ];
  
  await runFfmpeg(args);
  
  return { durationSec: totalDurationSec };
}

/**
 * Run FFmpeg command
 */
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const timeoutMs = 300000; // 5 minutes
    const p = spawn(ffmpegPath, ['-y', '-v', 'error', ...args], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', d => stdout += d);
    p.stderr.on('data', d => stderr += d);
    
    const timeout = setTimeout(() => {
      p.kill('SIGKILL');
      reject(new Error('FFMPEG_TIMEOUT'));
    }, timeoutMs);
    
    p.on('exit', (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        console.error('[ffmpeg.timeline] exit', { code, signal, stderr: String(stderr).slice(0, 2000) });
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(0, 500)}`));
      }
    });
    
    p.on('error', err => {
      clearTimeout(timeout);
      reject(new Error(`FFmpeg spawn error: ${err.message}`));
    });
  });
}

const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 1920;
const DEFAULT_FPS = 24;

/**
 * Concatenate video clips video-only (no audio). Use for global timeline from raw/trimmed clips.
 * Map only [outv]; do not inject anullsrc. Overlay step adds TTS per beat.
 * @param {{ clips: Array<{path: string, durationSec?: number}>, outPath: string, options?: { width?: number, height?: number, fps?: number } }}
 * @returns {Promise<{ durationSec: number }>}
 */
export async function concatenateClipsVideoOnly({ clips, outPath, options = {} }) {
  if (!Array.isArray(clips) || clips.length === 0) {
    throw new Error('CLIPS_REQUIRED');
  }
  const width = options.width || DEFAULT_WIDTH;
  const height = options.height || DEFAULT_HEIGHT;
  const fps = options.fps || DEFAULT_FPS;
  const validClips = clips.filter(c => c.path && fs.existsSync(c.path));
  if (validClips.length === 0) {
    throw new Error('NO_VALID_CLIPS');
  }
  const totalDurationSec = validClips.reduce((sum, c) => sum + (c.durationSec || 0), 0);
  const scaleFilters = validClips.map((_, i) =>
    `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS-STARTPTS[v${i}]`
  ).join(';');
  const concatInputs = validClips.map((_, i) => `[v${i}]`).join('');
  const concatFilter = `${concatInputs}concat=n=${validClips.length}:v=1:a=0[outv]`;
  const filterComplex = `${scaleFilters};${concatFilter}`;
  const inputArgs = validClips.flatMap(c => ['-i', c.path]);
  const args = [
    ...inputArgs,
    '-filter_complex', filterComplex,
    '-map', '[outv]',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-r', String(fps),
    '-preset', 'veryfast',
    '-crf', '23',
    '-movflags', '+faststart',
    outPath
  ];
  await runFfmpeg(args);
  return { durationSec: totalDurationSec };
}

/**
 * Trim a clip to a segment starting at inSec with length durSec. Output starts at 0.
 * If source is shorter than requested durSec, pad last frame (tpad=stop_mode=clone) to reach durSec; do not clamp.
 * @param {{ path: string, inSec: number, durSec: number, outPath: string, options?: { width?: number, height?: number } }}
 */
export async function trimClipToSegment({ path: inPath, inSec, durSec, outPath, options = {} }) {
  if (!inPath || !fs.existsSync(inPath)) throw new Error('TRIM_INPUT_REQUIRED');
  const width = options.width || DEFAULT_WIDTH;
  const height = options.height || DEFAULT_HEIGHT;
  const clipDurMs = await getDurationMsFromMedia(inPath);
  const clipDurSec = clipDurMs != null ? clipDurMs / 1000 : 0;
  const available = Math.max(0, clipDurSec - inSec);
  const takeDur = Math.min(durSec, available);
  const padDur = Math.max(0, durSec - takeDur);
  const scalePad = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
  const trimFilter = `trim=start=0:duration=${takeDur}`;
  const tpadFilter = padDur > 0 ? `,tpad=stop_mode=clone:stop_duration=${padDur}` : '';
  const filter = `[0:v]${trimFilter},${scalePad}${tpadFilter},setpts=PTS-STARTPTS[v]`;
  const args = [
    '-ss', String(inSec),
    '-i', inPath,
    '-filter_complex', filter,
    '-map', '[v]',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-t', String(durSec),
    '-movflags', '+faststart',
    outPath
  ];
  await runFfmpeg(args);
}

/**
 * Extract a segment from a file (e.g. global timeline). Output starts at 0. Video only.
 * @param {{ path: string, startSec: number, durSec: number, outPath: string, options?: { width?: number, height?: number } }}
 */
export async function extractSegmentFromFile({ path: inPath, startSec, durSec, outPath, options = {} }) {
  if (!inPath || !fs.existsSync(inPath)) throw new Error('EXTRACT_INPUT_REQUIRED');
  const width = options.width || DEFAULT_WIDTH;
  const height = options.height || DEFAULT_HEIGHT;
  const scalePad = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,setpts=PTS-STARTPTS[v]`;
  const args = [
    '-ss', String(startSec),
    '-i', inPath,
    '-filter_complex', `[0:v]${scalePad}`,
    '-map', '[v]',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-t', String(durSec),
    '-movflags', '+faststart',
    outPath
  ];
  await runFfmpeg(args);
}

/**
 * Fetch clips to temporary files and prepare for concatenation
 * @param {Array<{url: string, durationSec: number}>} clips - Clips with URLs
 * @returns {Promise<Array<{path: string, durationSec: number}>>}
 */
export async function fetchClipsToTmp(clips) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vaiform-timeline-'));
  const fetchedClips = [];
  
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    try {
      const fetched = await fetchVideoToTmp(clip.url);
      const destPath = path.join(tmpDir, `clip_${i}.mp4`);
      fs.copyFileSync(fetched.path, destPath);
      fetchedClips.push({
        path: destPath,
        durationSec: clip.durationSec || fetched.bytes / 1000000 * 0.1 // rough estimate if not provided
      });
    } catch (error) {
      console.warn(`[ffmpeg.timeline] Failed to fetch clip ${i}:`, error?.message);
      // Continue with other clips
    }
  }
  
  return { clips: fetchedClips, tmpDir };
}

export default { concatenateClips, concatenateClipsVideoOnly, trimClipToSegment, extractSegmentFromFile, fetchClipsToTmp };

