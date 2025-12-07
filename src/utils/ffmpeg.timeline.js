/**
 * FFmpeg utilities for video timeline concatenation
 */

import { spawn } from 'child_process';
import ffmpegPath from 'ffmpeg-static';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fetchVideoToTmp } from './video.fetch.js';

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

export default { concatenateClips, fetchClipsToTmp };

