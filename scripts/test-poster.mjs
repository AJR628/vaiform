// scripts/test-poster.mjs
// Run: node scripts/test-poster.mjs
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import ffmpegPath from 'ffmpeg-static';
import { exportPoster } from '../src/utils/ffmpeg.video.js';

function sh(args, { cwd = process.cwd() } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath, args, { stdio: ['ignore', 'inherit', 'inherit'], cwd });
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('spawn_failed'))));
  });
}

async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'poster-test-'));
  const videoPath = path.join(tmp, 'test.mp4');
  const outPngPath = path.join(tmp, 'poster.png');

  // Create a tiny 1s test video
  await sh([
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=black:s=320x240:d=1',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    videoPath,
  ]);

  // Export poster using library function
  await exportPoster({ videoPath, outPngPath, width: 1080, height: 1920, atSec: 0.2 });

  const st = await fs.stat(outPngPath);
  if (!st || st.size <= 0) throw new Error('poster_zero_size');
  console.log('[test-poster] OK:', outPngPath, st.size, 'bytes');
}

main().catch((e) => {
  console.error('[test-poster] FAIL:', e?.message || e);
  process.exit(1);
});
