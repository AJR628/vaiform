#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const webDir = path.join(root, 'web');
const forbiddenPaths = [
  path.join(webDir, '_redirects'),
  path.join(webDir, 'public', '_redirects'),
  path.join(webDir, 'dist', '_redirects'),
];

const violations = [];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (entry.name === '_redirects') out.push(full);
  }
  return out;
}

function hasWildcardHtmlFallback(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean)
    .some((line) => /^\/\*\s+\/index\.html(?:\s+|$).*?\b200\b/.test(line));
}

for (const p of forbiddenPaths) {
  if (fs.existsSync(p)) {
    violations.push(`forbidden _redirects path exists: ${path.relative(root, p)}`);
  }
}

const allRedirectFiles = walk(webDir);
for (const file of allRedirectFiles) {
  const text = fs.readFileSync(file, 'utf8');
  if (hasWildcardHtmlFallback(text)) {
    violations.push(
      `wildcard HTML fallback detected in ${path.relative(root, file)}: "/* /index.html 200"`
    );
  }
  if (!forbiddenPaths.includes(file)) {
    violations.push(`unexpected _redirects file exists: ${path.relative(root, file)}`);
  }
}

if (violations.length) {
  console.error('Netlify redirect SSOT guard failed:');
  for (const v of violations) console.error(` - ${v}`);
  process.exit(1);
}

console.log('Netlify redirect SSOT guard passed');
