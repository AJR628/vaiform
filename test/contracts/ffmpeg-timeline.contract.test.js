import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import ffmpegPath from 'ffmpeg-static';
import { trimClipToSegment } from '../../src/utils/ffmpeg.timeline.js';
import { getDurationMsFromMedia, hasReadableVideoFrame } from '../../src/utils/media.duration.js';

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vaiform-ffmpeg-timeline-test-'));
}

function runFfmpeg(args) {
  const result = spawnSync(ffmpegPath, ['-y', '-v', 'error', ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function makeSyntheticVideo(filePath, durationSec = 1) {
  runFfmpeg([
    '-f',
    'lavfi',
    '-i',
    `testsrc=size=320x240:rate=24:duration=${durationSec}`,
    '-pix_fmt',
    'yuv420p',
    filePath,
  ]);
}

function makeSyntheticAudio(filePath, durationSec = 1) {
  runFfmpeg([
    '-f',
    'lavfi',
    '-i',
    `sine=frequency=440:duration=${durationSec}`,
    '-c:a',
    'aac',
    filePath,
  ]);
}

test('trimClipToSegment produces readable video for in-range trims', async () => {
  const tmpDir = makeTmpDir();
  try {
    const sourcePath = path.join(tmpDir, 'source.mp4');
    const outPath = path.join(tmpDir, 'trimmed.mp4');
    makeSyntheticVideo(sourcePath, 1);

    await trimClipToSegment({
      path: sourcePath,
      inSec: 0.2,
      durSec: 0.5,
      outPath,
      options: { width: 320, height: 240 },
    });

    assert.equal(await hasReadableVideoFrame(outPath), true);
    assert.ok((await getDurationMsFromMedia(outPath)) > 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('trimClipToSegment clamps out-of-range starts to readable padded video', async () => {
  const tmpDir = makeTmpDir();
  try {
    const sourcePath = path.join(tmpDir, 'source.mp4');
    const outPath = path.join(tmpDir, 'trimmed-padded.mp4');
    makeSyntheticVideo(sourcePath, 1);

    await trimClipToSegment({
      path: sourcePath,
      inSec: 2,
      durSec: 2,
      outPath,
      options: { width: 320, height: 240 },
    });

    assert.equal(await hasReadableVideoFrame(outPath), true);
    assert.ok((await getDurationMsFromMedia(outPath)) > 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('trimClipToSegment rejects sources without readable video', async () => {
  const tmpDir = makeTmpDir();
  try {
    const sourcePath = path.join(tmpDir, 'source.m4a');
    const outPath = path.join(tmpDir, 'trimmed.mp4');
    makeSyntheticAudio(sourcePath, 1);

    await assert.rejects(
      trimClipToSegment({
        path: sourcePath,
        inSec: 0,
        durSec: 1,
        outPath,
        options: { width: 320, height: 240 },
      }),
      { code: 'TRIM_SOURCE_VIDEO_MISSING' }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('trimClipToSegment rejects invalid durations before trimming', async () => {
  const tmpDir = makeTmpDir();
  try {
    const sourcePath = path.join(tmpDir, 'source.mp4');
    const outPath = path.join(tmpDir, 'trimmed.mp4');
    makeSyntheticVideo(sourcePath, 1);

    await assert.rejects(
      trimClipToSegment({
        path: sourcePath,
        inSec: 0,
        durSec: 0,
        outPath,
        options: { width: 320, height: 240 },
      }),
      { code: 'TRIM_DURATION_INVALID' }
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
