#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

function runGit(args) {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
}

function getStagedFiles() {
  const output = runGit(['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
  if (!output) return [];
  return output
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean);
}

function runNodeScript(scriptPath, files) {
  execFileSync(process.execPath, [scriptPath, '--files', ...files], {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
}

function main() {
  const stagedFiles = getStagedFiles();
  if (!stagedFiles.length) {
    console.log('[precommit-changed] No staged files; skipping changed-file checks.');
    process.exit(0);
  }

  runNodeScript('scripts/check-format-changed.mjs', stagedFiles);
  runNodeScript('scripts/check-responses-changed.mjs', stagedFiles);
}

main();
