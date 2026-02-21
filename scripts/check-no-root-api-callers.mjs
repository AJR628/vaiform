#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const scanDir = path.join(root, 'web', 'public');
const exts = new Set(['.js', '.mjs', '.html', '.ts', '.tsx']);

const allowRoot = ['/health', '/stripe/webhook', '/assets/'];
const legacyApiFetchAliases = new Set(['/start', '/session', '/subscription', '/portal']);
const fetchRootAliasRe =
  /(^|[^A-Za-z0-9_])(\/(credits|whoami|generate|enhance|limits(?:\/|$)|checkout\/(start|session|subscription|portal)))(?=[/?#]|$)/;
const fetchConcatRootAliasRe =
  /\bfetch\s*\([\s\S]{0,160}?\+\s*(['"`])\/(credits|whoami|generate|enhance|limits(?:\/|$)|checkout\/(start|session|subscription|portal))\1/g;

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

function findCallLiterals(source) {
  const out = [];
  const re = /\b(fetch|apiFetch)\s*\(\s*(`(?:\\`|[^`])*`|'(?:\\'|[^'])*'|"(?:\\"|[^"])*")/g;
  let m;
  while ((m = re.exec(source))) {
    const fn = m[1];
    const token = m[2];
    const literal = token.slice(1, -1);
    const line = source.slice(0, m.index).split('\n').length;
    out.push({ fn, literal, line });
  }
  return out;
}

function isViolation({ fn, literal }) {
  if (allowRoot.some((p) => literal.includes(p))) return false;

  if (fn === 'apiFetch') {
    // apiFetch already prefixes /api via API_ROOT; only block deprecated checkout aliases.
    if (literal.startsWith('/api/')) return true;
    return legacyApiFetchAliases.has(literal.trim());
  }

  // For raw fetch() calls, block direct/root alias usage but allow /api/* calls.
  if (literal.includes('/api/')) return false;
  return fetchRootAliasRe.test(literal);
}

const violations = [];
for (const file of walk(scanDir)) {
  const src = fs.readFileSync(file, 'utf8');
  for (const hit of findCallLiterals(src)) {
    if (!isViolation(hit)) continue;
    violations.push({
      file: path.relative(root, file),
      line: hit.line,
      fn: hit.fn,
      literal: hit.literal.slice(0, 180),
    });
  }

  let concatMatch;
  while ((concatMatch = fetchConcatRootAliasRe.exec(src))) {
    const line = src.slice(0, concatMatch.index).split('\n').length;
    violations.push({
      file: path.relative(root, file),
      line,
      fn: 'fetch',
      literal: `(concat) ...+ '/${concatMatch[2]}'`,
    });
  }
}

if (violations.length) {
  console.error('Root API caller guard failed:');
  for (const v of violations) {
    console.error(` - ${v.file}:${v.line} ${v.fn}("${v.literal}")`);
  }
  process.exit(1);
}

console.log('Root API caller guard passed');
