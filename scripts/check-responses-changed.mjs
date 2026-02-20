#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const DISALLOWED_KEYS = new Set(['ok', 'reason', 'code', 'message', 'issues']);

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
  return file.startsWith('src/') && /\.(?:js|mjs)$/.test(file);
}

function buildLineIndex(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i += 1) {
    if (src[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineOf(index, starts) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (starts[mid] <= index) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi + 1;
}

function skipQuotedString(src, start, quote) {
  let i = start + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i += 1;
  }
  return src.length;
}

function skipLineComment(src, start) {
  let i = start + 2;
  while (i < src.length && src[i] !== '\n') i += 1;
  return i;
}

function skipBlockComment(src, start) {
  let i = start + 2;
  while (i < src.length - 1) {
    if (src[i] === '*' && src[i + 1] === '/') return i + 2;
    i += 1;
  }
  return src.length;
}

function skipWhitespace(src, start) {
  let i = start;
  while (i < src.length && /\s/.test(src[i])) i += 1;
  return i;
}

function findMatchingObjectEnd(src, openBraceIndex) {
  let depth = 1;
  let i = openBraceIndex + 1;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];

    if (ch === "'" || ch === '"' || ch === '`') {
      i = skipQuotedString(src, i, ch);
      continue;
    }
    if (ch === '/' && next === '/') {
      i = skipLineComment(src, i);
      continue;
    }
    if (ch === '/' && next === '*') {
      i = skipBlockComment(src, i);
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (depth === 0) return i;
    i += 1;
  }
  return -1;
}

function findObjectArgStart(src, openParenIndex) {
  const i = skipWhitespace(src, openParenIndex + 1);
  return src[i] === '{' ? i : -1;
}

function collectDisallowedKeys(src, objStart, objEnd, lineStarts) {
  const violations = [];
  let i = objStart + 1;
  let depth = 0;

  while (i < objEnd) {
    const ch = src[i];
    const next = src[i + 1];

    if (ch === "'" || ch === '"' || ch === '`') {
      if (depth === 0 && (ch === "'" || ch === '"')) {
        const keyStart = i;
        let j = i + 1;
        let key = '';
        while (j < objEnd) {
          const c = src[j];
          if (c === '\\') {
            j += 2;
            continue;
          }
          if (c === ch) break;
          key += c;
          j += 1;
        }
        if (j < objEnd && src[j] === ch) {
          const after = skipWhitespace(src, j + 1);
          if (src[after] === ':' && DISALLOWED_KEYS.has(key)) {
            violations.push({ key, line: lineOf(keyStart, lineStarts) });
          }
        }
      }
      i = skipQuotedString(src, i, ch);
      continue;
    }
    if (ch === '/' && next === '/') {
      i = skipLineComment(src, i);
      continue;
    }
    if (ch === '/' && next === '*') {
      i = skipBlockComment(src, i);
      continue;
    }

    if (ch === '{' || ch === '[' || ch === '(') {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === '}' || ch === ']' || ch === ')') {
      depth -= 1;
      i += 1;
      continue;
    }

    if (depth === 0 && /[A-Za-z_$]/.test(ch)) {
      const keyStart = i;
      let j = i + 1;
      while (j < objEnd && /[A-Za-z0-9_$]/.test(src[j])) j += 1;
      const key = src.slice(i, j);
      const after = skipWhitespace(src, j);
      if (src[after] === ':' && DISALLOWED_KEYS.has(key)) {
        violations.push({ key, line: lineOf(keyStart, lineStarts) });
      }
      i = j;
      continue;
    }

    i += 1;
  }

  return violations;
}

function scanFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const lineStarts = buildLineIndex(src);
  const findings = [];
  const responseCallRe = /res\s*\.\s*(?:status\s*\([^)]*\)\s*\.\s*)?(?:json|send)\s*\(/g;

  let match;
  while ((match = responseCallRe.exec(src))) {
    const openParenIndex = responseCallRe.lastIndex - 1;
    const objStart = findObjectArgStart(src, openParenIndex);
    if (objStart < 0) continue;

    const objEnd = findMatchingObjectEnd(src, objStart);
    if (objEnd < 0) continue;

    for (const item of collectDisallowedKeys(src, objStart, objEnd, lineStarts)) {
      findings.push({
        file: normalizeFile(path.relative(process.cwd(), filePath)),
        line: item.line,
        key: item.key,
      });
    }
  }

  return findings;
}

function main() {
  const { files: explicitFiles } = parseArgs(process.argv.slice(2));
  const resolution = resolveChangedFiles(explicitFiles);
  const changed = resolution.files.map(normalizeFile);

  if (resolution.source.startsWith('ci_sha_fallback_')) {
    console.log(
      `[check-responses-changed] ci_sha empty; using fallback source=${resolution.source}`
    );
  } else if (
    resolution.source === 'ci_sha' &&
    !changed.length &&
    process.env.ALLOW_BROAD_SCAN === '1'
  ) {
    console.log('[check-responses-changed] ci_sha empty and no fallback diff candidates resolved');
  }

  if (!changed.length && resolution.source === 'none') {
    console.error('No file scope provided.');
    console.error('Usage: node scripts/check-responses-changed.mjs --files <file1,file2,...>');
    console.error(
      'Or set BASE_SHA and HEAD_SHA (CI mode). Optional broad fallback: set ALLOW_BROAD_SCAN=1.'
    );
    process.exit(1);
  }

  const eligible = [...new Set(changed.filter(isEligible))].filter((rel) =>
    fs.existsSync(path.resolve(process.cwd(), rel))
  );

  if (!eligible.length) {
    console.log('No eligible changed files in src/**/*.js|mjs; skipping response contract check.');
    process.exit(0);
  }

  const findings = [];
  for (const relPath of eligible) {
    const absPath = path.resolve(process.cwd(), relPath);
    findings.push(...scanFile(absPath));
  }

  if (!findings.length) {
    console.log(`Response contract check passed for ${eligible.length} changed file(s).`);
    process.exit(0);
  }

  console.error('Response contract violations found:');
  for (const item of findings) {
    console.error(`${item.file}:${item.line} key=${item.key}`);
  }
  console.error(`Total violations: ${findings.length}`);
  process.exit(1);
}

main();
