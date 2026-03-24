#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';

const PRETTIER_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.json',
  '.md',
  '.yml',
  '.yaml',
  '.css',
  '.scss',
  '.html',
  '.htm',
]);

function normalizeFile(input) {
  return input.replace(/\\/g, '/').replace(/^\.\/+/, '');
}

function parseArgs(argv) {
  const files = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--files') {
      i += 1;
      while (i < argv.length && !argv[i].startsWith('--')) {
        const chunk = argv[i];
        for (const part of chunk.split(',')) {
          const trimmed = part.trim();
          if (trimmed) files.push(trimmed);
        }
        i += 1;
      }
      i -= 1;
    }
  }
  return { files };
}

function runGit(cmd) {
  return execSync(cmd, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function tryGitDiff(range) {
  try {
    const out = runGit(`git diff --name-only ${range}`);
    if (!out) return [];
    return out
      .split(/\r?\n/)
      .map((f) => f.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function refExists(ref) {
  try {
    runGit(`git rev-parse --verify ${ref}`);
    return true;
  } catch {
    return false;
  }
}

function resolveChangedFiles(explicitFiles) {
  if (explicitFiles.length) {
    return { files: explicitFiles, source: 'explicit' };
  }

  const allowBroad = process.env.ALLOW_BROAD_SCAN === '1';
  const base = process.env.BASE_SHA;
  const head = process.env.HEAD_SHA;
  if (base && head) {
    const bySha = tryGitDiff(`${base}..${head}`);
    if (bySha.length) return { files: bySha, source: 'ci_sha' };

    if (allowBroad) {
      if (refExists('origin/main')) {
        const byMain = tryGitDiff('origin/main...HEAD');
        if (byMain.length) return { files: byMain, source: 'ci_sha_fallback_origin_main' };
      }

      if (refExists('HEAD~1')) {
        const byPrev = tryGitDiff('HEAD~1..HEAD');
        if (byPrev.length) return { files: byPrev, source: 'ci_sha_fallback_head_prev' };
      }
    }

    return { files: [], source: 'ci_sha' };
  }

  if (allowBroad) {
    if (refExists('origin/main')) {
      const byMain = tryGitDiff('origin/main...HEAD');
      if (byMain.length) return { files: byMain, source: 'broad' };
    }

    if (refExists('HEAD~1')) {
      const byPrev = tryGitDiff('HEAD~1..HEAD');
      if (byPrev.length) return { files: byPrev, source: 'broad' };
    }
  }

  return { files: [], source: 'none' };
}

function isEligible(file) {
  return PRETTIER_EXTENSIONS.has(path.extname(file).toLowerCase());
}

function runPrettierCheck(files) {
  const prettierBin = path.resolve(
    process.cwd(),
    'node_modules',
    'prettier',
    'bin',
    'prettier.cjs'
  );
  const useLocalBin = fs.existsSync(prettierBin);
  const command = useLocalBin ? process.execPath : process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const args = useLocalBin ? [prettierBin, '--check', ...files] : ['prettier', '--check', ...files];

  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: !useLocalBin && process.platform === 'win32',
  });

  if (result.error) {
    console.error(`[check-format-changed] Failed to run Prettier: ${result.error.message}`);
    return 1;
  }
  return typeof result.status === 'number' ? result.status : 1;
}

function main() {
  const { files: explicitFiles } = parseArgs(process.argv.slice(2));
  const resolution = resolveChangedFiles(explicitFiles);
  const changed = resolution.files.map(normalizeFile);

  if (resolution.source.startsWith('ci_sha_fallback_')) {
    console.log(`[check-format-changed] ci_sha empty; using fallback source=${resolution.source}`);
  } else if (
    resolution.source === 'ci_sha' &&
    !changed.length &&
    process.env.ALLOW_BROAD_SCAN === '1'
  ) {
    console.log('[check-format-changed] ci_sha empty and no fallback diff candidates resolved');
  }

  if (!changed.length && resolution.source === 'none') {
    console.error('No file scope provided.');
    console.error('Usage: node scripts/check-format-changed.mjs --files <file1,file2,...>');
    console.error(
      'Or set BASE_SHA and HEAD_SHA (CI mode). Optional broad fallback: set ALLOW_BROAD_SCAN=1.'
    );
    process.exit(1);
  }

  const eligible = [...new Set(changed.filter(isEligible))].filter((rel) =>
    fs.existsSync(path.resolve(process.cwd(), rel))
  );

  if (!eligible.length) {
    console.log('No eligible changed files for Prettier check; skipping.');
    process.exit(0);
  }

  console.log(`[check-format-changed] Running Prettier check on ${eligible.length} file(s).`);
  const status = runPrettierCheck(eligible);
  process.exit(status);
}

main();
