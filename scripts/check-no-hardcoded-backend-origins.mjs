#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const scanDir = path.join(root, 'web', 'public');
const exts = new Set(['.js', '.mjs', '.html', '.ts', '.tsx']);
const allowlistedLineRes = [
  /https:\/\/www\.gstatic\.com\//i,
  /https:\/\/fonts\.googleapis\.com\//i,
  /https:\/\/fonts\.gstatic\.com\//i,
  /https:\/\/cdn\.jsdelivr\.net\//i,
  /https:\/\/unpkg\.com\//i,
  /https:\/\/cdn\.tailwindcss\.com\//i,
];
const forbiddenHostRe = /janeway\.replit\.dev/i;
const absoluteApiRe = /https?:\/\/[^\s'"`]+\/api(?:[/?#'"`\s]|$)/i;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (exts.has(path.extname(entry.name))) out.push(full);
  }
  return out;
}

function isAllowlisted(text) {
  return allowlistedLineRes.some((re) => re.test(text));
}

const violations = [];
const seen = new Set();

for (const file of walk(scanDir)) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file);
  const lines = src.split(/\r?\n/);

  lines.forEach((line, idx) => {
    if (forbiddenHostRe.test(line)) {
      const key = `${rel}:${idx + 1}:host`;
      if (!seen.has(key)) {
        seen.add(key);
        violations.push({
          file: rel,
          line: idx + 1,
          reason: 'forbidden backend host',
          snippet: line.trim().slice(0, 200),
        });
      }
      return;
    }

    if (absoluteApiRe.test(line) && !isAllowlisted(line)) {
      const key = `${rel}:${idx + 1}:absolute-api`;
      if (!seen.has(key)) {
        seen.add(key);
        violations.push({
          file: rel,
          line: idx + 1,
          reason: 'absolute browser API origin',
          snippet: line.trim().slice(0, 200),
        });
      }
    }
  });
}

if (violations.length) {
  console.error('Hardcoded backend origin guard failed:');
  for (const violation of violations) {
    console.error(
      ` - ${violation.file}:${violation.line} ${violation.reason}: ${violation.snippet}`
    );
  }
  process.exit(1);
}

console.log('Hardcoded backend origin guard passed');
