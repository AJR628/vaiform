import assert from 'node:assert/strict';
import test from 'node:test';

import { __testables } from '../../src/utils/ffmpeg.video.js';

const {
  readJobColorspaceCompatibility,
  resolveColorspaceDecision,
  stripColorspaceFromArgs,
  runFfmpegWithColorspaceFallback,
} = __testables;

function createLogger() {
  const entries = [];
  return {
    entries,
    log: (message, payload) => entries.push({ level: 'log', message, payload }),
    warn: (message, payload) => entries.push({ level: 'warn', message, payload }),
    error: (message, payload) => entries.push({ level: 'error', message, payload }),
  };
}

test('raster mode never applies the colorspace filter', () => {
  const decision = resolveColorspaceDecision({
    usingCaptionPng: true,
    mode: 'auto',
    meta: { color_space: 'bt709', color_primaries: 'bt709', color_transfer: 'bt709' },
  });

  assert.equal(decision.addColorspaceFilter, false);
  assert.equal(decision.log.status, 'skipped');
  assert.equal(decision.log.reason, 'raster_png_path');
  assert.equal(decision.log.mode, 'raster');
});

test('conservative auto skips unknown colorspace metadata', () => {
  const decision = resolveColorspaceDecision({
    usingCaptionPng: false,
    mode: 'auto',
    meta: { color_space: '2', color_primaries: null, color_transfer: null },
  });

  assert.equal(decision.addColorspaceFilter, false);
  assert.equal(decision.log.status, 'skipped');
  assert.equal(decision.log.reason, 'unknown_input_colorspace');
  assert.equal(decision.log.color_space, '2');
});

test('conservative auto skips non-bt709 colorspace metadata', () => {
  const decision = resolveColorspaceDecision({
    usingCaptionPng: false,
    mode: 'auto',
    meta: {
      color_space: 'smpte170m',
      color_primaries: 'smpte170m',
      color_transfer: 'bt709',
    },
  });

  assert.equal(decision.addColorspaceFilter, false);
  assert.equal(decision.log.status, 'skipped');
  assert.equal(decision.log.reason, 'auto_requires_explicit_bt709');
  assert.equal(decision.log.color_space, 'smpte170m');
});

test('classified colorspace failure retries once without colorspace and succeeds', async () => {
  const logger = createLogger();
  const calls = [];
  const colorMetaCache = new Map();
  const args = [
    '-i',
    'input.mp4',
    '-filter_complex',
    '[0:v]format=yuv420p,colorspace=all=bt709:fast=1[vout]',
    '-map',
    '[vout]',
  ];

  const result = await runFfmpegWithColorspaceFallback({
    args,
    usingCaptionPng: false,
    finalFilter: '[0:v]format=yuv420p,colorspace=all=bt709:fast=1[vout]',
    colorspaceLog: { mode: 'auto', color_space: 'bt709' },
    colorMetaCache,
    logger,
    runFfmpegImpl: async (nextArgs) => {
      calls.push(nextArgs);
      if (calls.length === 1) {
        const error = new Error(
          'Unsupported input colorspace 2 (unknown)\nError while filtering: Invalid argument'
        );
        error.stderr =
          'Unsupported input colorspace 2 (unknown)\nError while filtering: Invalid argument';
        throw error;
      }
      return { stdout: '', stderr: '' };
    },
  });

  assert.equal(result.retriedWithoutColorspace, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][3].includes('colorspace=all=bt709:fast=1'), true);
  assert.equal(calls[1][3].includes('colorspace=all=bt709:fast=1'), false);
  assert.equal(readJobColorspaceCompatibility(colorMetaCache).incompatibleAfterRetry, true);
  assert.equal(
    calls[1][3],
    stripColorspaceFromArgs(args)[3],
    'retry should remove only the colorspace filter'
  );
  assert.deepEqual(
    logger.entries.map((entry) => entry.level),
    ['warn', 'log'],
    'successful classified retry should emit one retry warn and one success log'
  );
  assert.equal(logger.entries[1].payload.compatibilityMemory, 'job_incompatible_after_retry');
});

test('same-job incompatible auto render skips later colorspace-first attempts across paths', async () => {
  const sharedCache = new Map();
  const firstAttemptDecision = resolveColorspaceDecision({
    usingCaptionPng: false,
    mode: 'auto',
    meta: { color_space: 'bt709', color_primaries: 'bt709', color_transfer: 'bt709' },
    compatibilityState: readJobColorspaceCompatibility(sharedCache),
  });

  assert.equal(firstAttemptDecision.addColorspaceFilter, true);
  assert.equal(firstAttemptDecision.log.reason, 'auto_explicit_bt709');

  await runFfmpegWithColorspaceFallback({
    args: [
      '-i',
      'segment-a.mp4',
      '-filter_complex',
      '[0:v]format=yuv420p,colorspace=all=bt709:fast=1[vout]',
      '-map',
      '[vout]',
    ],
    usingCaptionPng: false,
    finalFilter: '[0:v]format=yuv420p,colorspace=all=bt709:fast=1[vout]',
    colorspaceLog: { mode: 'auto', color_space: 'bt709' },
    colorMetaCache: sharedCache,
    logger: createLogger(),
    runFfmpegImpl: async (nextArgs) => {
      if (nextArgs[3].includes('colorspace=all=bt709:fast=1')) {
        const error = new Error(
          'Unsupported input colorspace 2 (unknown)\nError while filtering: Invalid argument'
        );
        error.stderr =
          'Unsupported input colorspace 2 (unknown)\nError while filtering: Invalid argument';
        throw error;
      }
      return { stdout: '', stderr: '' };
    },
  });

  const laterPathDecision = resolveColorspaceDecision({
    usingCaptionPng: false,
    mode: 'auto',
    meta: { color_space: 'bt709', color_primaries: 'bt709', color_transfer: 'bt709' },
    compatibilityState: readJobColorspaceCompatibility(sharedCache),
  });

  assert.equal(laterPathDecision.addColorspaceFilter, false);
  assert.equal(laterPathDecision.log.reason, 'job_incompatible_after_retry');
});

test('non-colorspace ffmpeg failure does not take the colorspace fallback path', async () => {
  const logger = createLogger();
  const args = [
    '-i',
    'input.mp4',
    '-filter_complex',
    '[0:v]format=yuv420p,colorspace=all=bt709:fast=1[vout]',
    '-map',
    '[vout]',
  ];
  const error = new Error('No such filter: definitely_not_colorspace');
  error.stderr = 'No such filter: definitely_not_colorspace';
  let calls = 0;

  await assert.rejects(
    () =>
      runFfmpegWithColorspaceFallback({
        args,
        usingCaptionPng: false,
        finalFilter: '[0:v]format=yuv420p,colorspace=all=bt709:fast=1[vout]',
        colorspaceLog: { mode: 'force', color_space: 'force' },
        logger,
        runFfmpegImpl: async () => {
          calls += 1;
          throw error;
        },
      }),
    error
  );

  assert.equal(calls, 1);
  assert.equal(logger.entries.length, 0);
});
