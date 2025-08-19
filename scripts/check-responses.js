// scripts/check-responses.js
import fs from "fs";
import path from "path";

const ROOT = path.resolve(process.cwd(), "src");
const badFindings = [];

// Walk src/ recursively
function walk(dir) {
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name);
    if (name.isDirectory()) walk(full);
    else if (name.isFile() && name.name.endsWith(".js")) scan(full);
  }
}

// Strip comments (naive but good enough): //... and /* ... */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function report(file, line, col, msg, snippet) {
  badFindings.push({ file, line, col, msg, snippet });
}

// Find “res.status(...).json({ ... })” blocks and check keys inside
function scan(file) {
  let src = fs.readFileSync(file, "utf8");
  const raw = src;
  src = stripComments(src);

  // Regex to find res.status(...).json({ ... }) or res.json({ ... })
  // We’ll capture the JSON-ish object (not a real parser, but good enough)
  const callRE = /res\s*\.\s*(?:status\s*\(\s*\d+\s*\)\s*\.\s*)?json\s*\(\s*{([\s\S]*?)}\s*\)/g;

  // Also detect HTTP status (to flag 'message' in 4xx/5xx only)
  const callWithStatusRE = /res\s*\.\s*status\s*\(\s*(\d{3})\s*\)\s*\.?\s*json\s*\(\s*{([\s\S]*?)}\s*\)/g;

  // 1) Flag forbidden keys in ANY res.json payload: ok:, code:, and issues: at top-level
  let m;
  while ((m = callRE.exec(src))) {
    const body = m[1];
    const startIdx = m.index;
    const pre = src.slice(0, startIdx);
    const line = pre.split("\n").length;
    // quick col calc
    const col = startIdx - pre.lastIndexOf("\n");

    if (/\bok\s*:/.test(body)) {
      report(file, line, col, "Disallowed key 'ok:' in response payload", body.slice(0, 200));
    }
    if (/\bcode\s*:/.test(body)) {
      report(file, line, col, "Disallowed key 'code:' in response payload", body.slice(0, 200));
    }
    // Disallow array-style issues payload (we standardized on detail + flatten())
    if (/\bissues\s*:/.test(body)) {
      report(file, line, col, "Disallowed key 'issues:' in response payload", body.slice(0, 200));
    }
  }

  // 2) Flag 'message:' only in 4xx/5xx responses
  while ((m = callWithStatusRE.exec(src))) {
    const status = Number(m[1]);
    const body = m[2];
    const startIdx = m.index;
    const pre = src.slice(0, startIdx);
    const line = pre.split("\n").length;
    const col = startIdx - pre.lastIndexOf("\n");
    if (status >= 400 && /\bmessage\s*:/.test(body)) {
      report(file, line, col, "Use 'detail:' (not 'message:') in error responses", body.slice(0, 200));
    }
  }
}

walk(ROOT);

if (badFindings.length) {
  console.error("❌ Response shape guard failed:\n");
  for (const f of badFindings) {
    console.error(`- ${f.file}:${f.line}:${f.col} – ${f.msg}`);
    console.error(`  … ${String(f.snippet).replace(/\s+/g, " ").slice(0, 160)}\n`);
  }
  process.exit(1);
} else {
  console.log("✅ Response shape guard passed");
}